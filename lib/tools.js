/**
 * 工具层：whale_report —— 立即生成任意区间的鲸鱼报告。
 *
 * 数据来源是官方的会话查询服务（ctx.sessionQuery）：
 *   listSessions() → 全部会话头
 *   readSession(id) → 单会话完整事件日志（含 data 载荷）
 * 引擎只读，不写回任何会话数据。
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { computeCost, computeCostTimed, modelCost, modelTier, OPENCODE_GO_PRICES, PEAK_PRICES, OFFPEAK_PRICES, isPeakHourCST } from "./pricing.js";
import { computeInsights, periodKey, previousPeriodKey, cacheHitRate, nightRatio } from "./insights.js";
import { computeImprovements } from "./improvements.js";
import { aggregateBuckets, bucketizeOwnEvents, emptyPartial, SKIP_IDS_CAP } from "./stats.js";
import { findSessionLogPath, resolveDshHome, salvageSessionFile } from "./salvage.js";
import { renderReport, presetRange, PRESET_LABELS } from "./report.js";
const DAY_MS = 24 * 60 * 60 * 1000;
function parseTime(value, fallback) {
    if (value === undefined || value === "")
        return fallback;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
        throw new Error(`无法解析时间：${value}（请用 ISO 格式，如 2026-08-14）`);
    }
    return ms;
}
/** 有限并发映射：报告生成要读几十个会话的完整日志，串行太慢。 */
async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (;;) {
            const i = next;
            next += 1;
            if (i >= items.length)
                return;
            results[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return results;
}
/** 索引新鲜度窗口：窗口内的持久化会话索引直接复用，过期才重读完整日志。 */
export const INDEX_TTL_MS = 10 * 60 * 1000;
/** 索引结构版本：结构变更（如新增 modelUsage）时递增，旧记录自然失效重建。 */
export const INDEX_VERSION = 14;
/**
 * 读取失败原因粗分类（fault isolation）。
 *
 * 原则：只产出**有界、稳定、非敏感**的类别（如 "corrupt-log"），
 * 绝不把错误消息 / 堆栈原文存进报告 —— 日志损坏原因属于技术诊断，
 * 报告只声明"哪类失败、多少会话"，细节留给用户自己看 ~/.dsh。
 */
export function classifyReadError(error) {
    if (error instanceof Error && /corrupt|torn|zstd|zstandard|jsonl/i.test(error.message)) {
        return "corrupt-log";
    }
    return "read-failed";
}
/**
 * 收集区间统计。两条数据路径：
 * - live 会话：readSession 走内存快照，直接分桶；
 * - 持久化会话：优先读 whale 域的会话索引（10 分钟新鲜度窗口），
 *   过期才读完整日志（zstd 解压重放，实测 60s+）并回写索引。
 * 返回与 aggregate(events, …) 等价的 ReportStats。
 *
 * Fault isolation：单个会话损坏 / 读取失败 → 跳过该会话并记入
 * stats.partial（id + 粗分类原因），其余健康会话照常聚合；
 * 缺失数据不按 0 处理 —— 报告与 UI 必须披露 partial。
 */
export async function collectEvents(svc, period) {
    const sessions = await svc.sessionQuery.listSessions();
    const headers = sessions.map((record) => ({
        id: record.header.id,
        createdAt: record.header.createdAt,
        cwd: record.header.cwd,
        delegationDepth: record.header.delegationDepth,
    }));
    const candidates = sessions.filter((record) => record.header.createdAt < period.to);
    const views = [];
    const skippedIds = [];
    const skippedIdSet = new Set();
    const skippedReasons = new Set();
    let skippedCount = 0;
    // P0 salvage：被恢复会话的聚合（recoveredRecords/droppedRecords 只统计区间内窗口，不泄原文）。
    let recoveredSessions = 0;
    let recoveredRecords = 0;
    let droppedRecords = 0;
    await mapWithConcurrency(candidates, 12, async (record) => {
        const now = Date.now();
        // 持久化会话：索引新鲜直接复用
        if (!record.live) {
            const cached = svc.index.get(record.header.id);
            if (cached !== undefined && cached.v === INDEX_VERSION && now - cached.builtAt < INDEX_TTL_MS) {
                views.push({
                    sessionId: cached.sessionId,
                    buckets: cached.buckets,
                    titles: cached.titles,
                });
                return;
            }
        }
        try {
            const snapshot = await svc.sessionQuery.readSession(record.header.id);
            const built = bucketizeOwnEvents(snapshot.session.id, snapshot.events, snapshot.session.seedLength ?? 0, period.to);
            views.push({ sessionId: snapshot.session.id, buckets: built.buckets, titles: built.titles });
            if (!record.live) {
                await svc.index.put(record.header.id, {
                    sessionId: snapshot.session.id,
                    v: INDEX_VERSION,
                    builtAt: now,
                    lastSeq: built.lastSeq,
                    lastMs: built.lastMs,
                    buckets: built.buckets,
                    titles: built.titles,
                });
            }
        }
        catch (error) {
            // P0 salvage：官方读取器拒读（如尾部 spliced seq 校验失败 / torn tail）时，
            // 尝试只读恢复：逐帧解压 + 完整 JSONL record 进入聚合，残缺尾部丢弃。
            // 只在 zstd 无法解压 / 中间 corruption / 无 header 时 fallback 到整 session skip。
            const salvaged = trySalvageSession(svc, record.header.id, period.to);
            if (salvaged.ok) {
                views.push({
                    sessionId: salvaged.sessionId ?? record.header.id,
                    buckets: salvaged.buckets,
                    titles: salvaged.titles,
                });
                recoveredSessions += 1;
                recoveredRecords += salvaged.recoveredRecords;
                droppedRecords += salvaged.droppedRecords;
                return;
            }
            // 单会话损坏/读取失败且无法安全恢复：跳过，不影响其他会话；只记 id + 粗分类原因。
            skippedCount += 1;
            skippedIdSet.add(record.header.id);
            if (skippedIds.length < SKIP_IDS_CAP)
                skippedIds.push(record.header.id);
            skippedReasons.add(classifyReadError(error));
        }
    });
    const partial = {
        ...(skippedCount > 0
            ? { skippedSessionIds: skippedIds, skippedCount, reasons: [...skippedReasons].sort() }
            : emptyPartial()),
        ...(recoveredSessions > 0
            ? {
                salvage: {
                    recoveredSessions,
                    recoveredRecords,
                    droppedRecords,
                },
                reasons: [
                    ...(skippedCount > 0 ? [...skippedReasons].sort() : []),
                    droppedRecords > 0 ? "torn-jsonl-tail" : "salvaged",
                ],
            }
            : {}),
    };
    // 被跳过的会话不进聚合：既不计入 sessions/subagentSessions，也不产生任何统计痕迹；
    // 它们的缺失通过 partial 披露（缺失 ≠ 0），不按"无活动"处理。
    // salvage 恢复的会话正常计入聚合（与健康会话同路径）。
    const coveredHeaders = skippedCount > 0 ? headers.filter((h) => !skippedIdSet.has(h.id)) : headers;
    return aggregateBuckets(views, period, coveredHeaders, partial);
}
/** P0 salvage 尝试：官方读取器失败后，直读 ~/.dsh 日志做只读恢复。 */
function trySalvageSession(svc, sessionId, periodTo) {
    try {
        const path = findSessionLogPath(resolveDshHome(), sessionId);
        if (path === null)
            return { ok: false };
        const salvaged = salvageSessionFile(path);
        if (!salvaged.ok || salvaged.sessionId === undefined)
            return { ok: false };
        const built = bucketizeOwnEvents(salvaged.sessionId, salvaged.events, 0, periodTo);
        // 恢复的会话不进 session_index（数据源是只读修复，避免污染索引缓存语义）。
        return {
            ok: true,
            sessionId: salvaged.sessionId,
            buckets: built.buckets,
            titles: built.titles,
            recoveredRecords: salvaged.recoveredRecords,
            droppedRecords: salvaged.droppedRecords,
        };
    }
    catch {
        return { ok: false };
    }
}
/**
 * 后台预热：为所有持久化会话预建索引（无时间上限）。
 * 首次生成报告的 50s 成本移到启动后的一次性后台任务里，
 * 之后的每次生成都命中索引（实测 0.1-0.3s）。
 */
export async function warmIndex(svc) {
    const sessions = await svc.sessionQuery.listSessions();
    const toBuild = sessions.filter((record) => !record.live && svc.index.get(record.header.id) === undefined);
    await mapWithConcurrency(toBuild, 4, async (record) => {
        try {
            const snapshot = await svc.sessionQuery.readSession(record.header.id);
            const built = bucketizeOwnEvents(snapshot.session.id, snapshot.events, snapshot.session.seedLength ?? 0);
            await svc.index.put(record.header.id, {
                sessionId: snapshot.session.id,
                v: INDEX_VERSION,
                builtAt: Date.now(),
                lastSeq: built.lastSeq,
                lastMs: built.lastMs,
                buckets: built.buckets,
                titles: built.titles,
            });
        }
        catch {
            // 单会话失败不影响预热整体
        }
    });
}
export async function generateReportData(svc, preset, range) {
    const stats = await collectEvents(svc, range);
    // 峰谷计价：按 dayHourDetail 的每小时模型用量 × 该时段价格分段累加。
    // 旧报告/无小时明细时回退 computeCost 总量估算。
    let cost;
    let peakRatio;
    if (stats.dayHourDetail.length > 0) {
        const timed = computeCostTimed(stats.dayHourDetail.flatMap((day) => day.hours.map((h, hour) => ({ hour, modelTokens: h.modelTokens }))));
        peakRatio = timed.peakRatio;
        cost = {
            perModel: timed.perModel,
            total: timed.total,
            currency: "CNY",
            source: "peak-offpeak",
            fetchedAt: Date.now(),
            peakRatio,
            peakShare: timed.peakShare,
        };
    }
    else {
        cost = await computeCost(stats.models);
    }
    // 会话钻取与小时级费用统一按官方峰谷价折算：
    // - sessionsDetail：按空闲价基准（确定性，会话跨时段无法精确拆分，排名用途一致即可）
    // - dayHourDetail.hours[].cost：按该小时所属时段（高峰/空闲）精确计价
    for (const detail of stats.sessionsDetail) {
        let total = 0;
        for (const [model, usage] of Object.entries(detail.modelTokens)) {
            const provider = model.includes("/") ? model.slice(0, model.indexOf("/")) : "deepseek";
            const priceSet = provider === "opencode-go" ? OPENCODE_GO_PRICES : OFFPEAK_PRICES;
            total += modelCost(usage, priceSet[modelTier(model)]);
        }
        detail.cost = total;
    }
    for (const day of stats.dayHourDetail) {
        for (let hour = 0; hour < 24; hour++) {
            const h = day.hours[hour];
            const priceSet = isPeakHourCST(hour * 3600_000) ? PEAK_PRICES : OFFPEAK_PRICES;
            let hourCost = 0;
            for (const [model, usage] of Object.entries(h.modelTokens)) {
                const provider = model.includes("/") ? model.slice(0, model.indexOf("/")) : "deepseek";
                const ps = provider === "opencode-go" ? OPENCODE_GO_PRICES : priceSet;
                hourCost += modelCost(usage, ps[modelTier(model)]);
            }
            h.cost = hourCost;
        }
    }
    stats.sessionsDetail.sort((a, b) => b.cost - a.cost);
    stats.sessionsDetail = stats.sessionsDetail.slice(0, 20);
    stats.plugins = svc.plugins ?? [];
    const key = periodKey(preset, range.to);
    const prevKey = previousPeriodKey(preset, range.to);
    const prev = prevKey !== null ? (svc.periodStats?.get(prevKey) ?? null) : null;
    const insights = computeInsights({ stats, prev: prev ?? undefined, cost });
    // Improve（v0.5）：基于聚合证据的确定性建议；不重扫原始事件，无额外 IO。
    const improvements = computeImprovements({
        stats,
        cost,
        period: key,
        failedSessions: stats.toolFailedSessions,
        corrections: stats.correctionSignals,
    });
    // 生成本报告消耗：DeepTrace 的 stats → insights → 鲸评 → 导出全为本地确定性代码，
    // 不调用任何模型 API —— 报告生成本身消耗 0 token（这是产品事实，不是估算）。
    const reportGeneration = {
        mode: "local",
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        totalTokens: 0,
        estimatedCostCny: 0,
    };
    return { stats, cost, key, prev, insights, improvements, reportGeneration };
}
export function toPeriodRecord(key, preset, range, gen) {
    const s = gen.stats;
    return {
        key,
        preset,
        from: range.from,
        to: range.to,
        createdAt: Date.now(),
        sessions: s.sessions,
        turns: s.turns,
        toolCallsTotal: s.toolCallsTotal,
        commands: s.commands,
        toolErrors: s.toolErrors,
        totalEvents: s.totalEvents,
        tokens: { ...s.tokens },
        cost: gen.cost.total,
        nightRatio: nightRatio(s),
        cacheHitRate: cacheHitRate(s),
        dangerCount: s.dangerousCommands.length,
        redDanger: s.dangerousCommands.filter((d) => d.sev === "red").length,
        retryBursts: s.retryBursts,
        activeDays: s.activeDays,
        skippedCount: s.partial.skippedCount,
    };
}
export function registerReportTools(ctx, svc) {
    ctx.tools.register(whaleReportTool(svc));
}
export function whaleReportTool(svc) {
    return defineTool({
        name: "whale_report",
        description: "Generate a DeepTrace report (深迹 日报/周报/月报/年报) from the user's session event history over any time range. " +
            "Presets: daily (last 1 day), weekly (7 days), monthly (30 days), yearly (365 days), or custom with explicit from/to dates. " +
            "The report is read-only and covers: activity volume, token burn, work-hours profile, dangerous commands, and session titles. " +
            "Call this when the user asks for a report of their agent usage ('给我一份周报', '这个月我干了啥', '年报'). " +
            "After receiving the result, present the markdown report to the user with light commentary — do not fabricate numbers.",
        parameters: {
            preset: {
                type: "string",
                required: true,
                enum: ["daily", "24h", "weekly", "monthly", "yearly", "custom"],
                description: "Report period preset. Use custom for arbitrary ranges.",
            },
            from: {
                type: "string",
                description: "Start time in ISO format (e.g. 2026-08-01). Required when preset is custom.",
            },
            to: {
                type: "string",
                description: "End time in ISO format (e.g. 2026-08-14). Required when preset is custom. Defaults to now.",
            },
        },
        output: {
            schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    preset: { type: "string", required: true },
                    label: { type: "string", required: true },
                    from: { type: "string", required: true },
                    to: { type: "string", required: true },
                    sessions: { type: "integer", required: true },
                    turns: { type: "integer", required: true },
                    totalEvents: { type: "integer", required: true },
                    report: { type: "string", required: true },
                    cost: {
                        type: "object",
                        required: true,
                        additionalProperties: false,
                        properties: {
                            // DSH 校验器只支持 boolean additionalProperties（不支持对象形式），
                            // 动态模型键（provider/model）只能以 additionalProperties: true 放行。
                            perModel: { type: "object", required: true, additionalProperties: true },
                            total: { type: "number", required: true },
                            currency: { type: "string", required: true },
                            source: { type: "string", required: true },
                        },
                    },
                    insights: {
                        type: "array",
                        required: true,
                        items: {
                            type: "object",
                            additionalProperties: false,
                            properties: {
                                id: { type: "string", required: true },
                                level: { type: "string", required: true },
                                title: { type: "string", required: true },
                                detail: { type: "string", required: true },
                                action: { type: "string", required: true },
                                estimate: { type: "string" },
                            },
                        },
                    },
                    prevCost: { oneOf: [{ type: "number" }, { type: "null" }], required: true },
                },
            },
            render: (_args, value) => [
                {
                    type: "text",
                    text: value.report,
                },
            ],
        },
        execute: async (args, exec) => {
            const { preset, from, to } = args;
            const now = Date.now();
            const range = preset === "custom"
                ? { from: parseTime(from, now - 7 * DAY_MS), to: parseTime(to, now) }
                : presetRange(preset, now);
            if (range.to <= range.from) {
                throw new Error("时间区间无效：to 必须晚于 from");
            }
            const gen = await generateReportData(svc, preset, range);
            if (svc.periodStats !== undefined) {
                await svc.periodStats.put(gen.key, toPeriodRecord(gen.key, preset, range, gen));
            }
            const report = renderReport(gen.stats, preset, gen.cost, gen.prev, gen.insights, gen.improvements);
            // 不再把 whale/report 写进会话日志：核心 harness 的 KNOWN_SESSION_EVENT_TYPES
            // 不认插件自定义事件，且当前 Session.append 不支持 ignorable 标记，写入会让
            // 旧版本（含 rc.6）拒绝加载整个会话历史。报告数据由 periodStats 持久化。
            return {
                preset,
                label: PRESET_LABELS[preset],
                from: new Date(range.from).toISOString(),
                to: new Date(range.to).toISOString(),
                sessions: gen.stats.sessions,
                turns: gen.stats.turns,
                totalEvents: gen.stats.totalEvents,
                report,
                cost: { perModel: gen.cost.perModel, total: gen.cost.total, currency: gen.cost.currency, source: gen.cost.source },
                insights: gen.insights,
                prevCost: gen.prev?.cost ?? null,
            };
        },
        presentCall: (args) => ({
            card: "generic",
            title: `生成深迹${PRESET_LABELS[args.preset] ?? "报告"}`,
            kind: "other",
            rawInput: args,
        }),
    });
}
//# sourceMappingURL=tools.js.map