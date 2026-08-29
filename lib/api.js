import { isTrustedApiRequest } from "./trust-fence.js";
import { REPORT_SEM } from "./state.js";
/** summary 概览新鲜度：同周期报告超过此窗口即重新计算（原地更新，不删历史）。 */
const SUMMARY_FRESHNESS_MS = 5 * 60 * 1000;
import { renderReport, presetRange } from "./report.js";
import { renderHtmlReport } from "./html.js";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isTrendRowIncluded, periodKey } from "./insights.js";
import { customPeriodKey, naturalPeriodKey, resolvePeriod } from "./period.js";
import { queryPeriod } from "./query-engine.js";
import { buildReportFromStats } from "./tools.js";
import { computeCostTimed } from "./pricing.js";
import { buildProviderBreakdown } from "./usage.js";
import { generateReportData, toPeriodRecord } from "./tools.js";
import { adapterOf, queryBalance } from "./balance.js";
import { createSingleFlight } from "./single-flight.js";
const DAY_MS = 24 * 60 * 60 * 1000;
/** P0.3 单飞：相同 period 的 summary 生成共享同一个 in-flight Promise。 */
const summaryFlight = createSingleFlight();
/** P1 comparison scope：按 provider 拆分的用量（与 DeepSeek Platform 对账时只取 deepseek-official）。 */
function withProviderScope(record) {
    const stats = record.stats;
    return {
        ...record,
        providerBreakdown: buildProviderBreakdown(stats?.models ?? {}),
    };
}
/** 后台持久化写失败：bounded 诊断（计数 + 每 10 次采样一条日志），绝不 unhandled rejection。 */
const writeFailureCounts = new Map();
function trackWriteFailure(scope, error) {
    const n = (writeFailureCounts.get(scope) ?? 0) + 1;
    writeFailureCounts.set(scope, n);
    if (n <= 3 || n % 10 === 0) {
        console.error(`[whale] ${scope} 写失败（第 ${n} 次）:`, error instanceof Error ? error.message : String(error));
    }
}
/** live 桶 → live-session 卡片聚合（零 readSession）。 */
function summarizeLiveBuckets(sessionId, snap) {
    let turns = 0;
    let toolCalls = 0;
    const tokens = { input: 0, output: 0, cacheRead: 0, reasoning: 0 };
    const timeModelTokens = [];
    let lastTime = 0;
    for (const b of snap.buckets) {
        turns += b.turns;
        toolCalls += b.toolCallsTotal;
        tokens.input += b.input;
        tokens.output += b.output;
        tokens.cacheRead += b.cacheRead;
        tokens.reasoning += b.reasoning;
        // b.h = 10 分钟桶起点 epoch ms：直接作为定价时间（pricingTierForTime 按上海日期+小时判定，
        // 含周末新规；桶起点是 10 分钟整点，绝不跨越整点峰谷边界，且不依赖机器本地时区）。
        timeModelTokens.push({ time: b.h, modelTokens: b.modelUsage });
        const end = b.h + 10 * 60 * 1000;
        if (end > lastTime)
            lastTime = end;
    }
    return {
        title: snap.titles[0] ?? "",
        turns,
        toolCalls,
        tokens,
        totalTokens: tokens.input + tokens.cacheRead + tokens.output,
        timeModelTokens,
        lastTime,
    };
}
function writeJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
}
async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length === 0)
        return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch {
        throw new Error("请求体不是合法 JSON");
    }
}
function parseTime(value, fallback) {
    if (typeof value !== "string" || value === "")
        return fallback;
    const ms = Date.parse(value);
    if (Number.isNaN(ms))
        throw new Error(`无法解析时间：${String(value)}`);
    return ms;
}
/** 生成一份报告（与聊天工具同一引擎），并落库。 */
async function generateReport(svc, payload) {
    const preset = payload.preset ?? "weekly";
    if (!["daily", "24h", "weekly", "monthly", "yearly", "custom"].includes(preset)) {
        throw new Error(`未知预设：${String(preset)}`);
    }
    const now = Date.now();
    const range = preset === "custom"
        ? {
            from: parseTime(payload.from, now - 7 * DAY_MS),
            to: parseTime(payload.to, now),
        }
        : presetRange(preset, now);
    if (range.to <= range.from)
        throw new Error("时间区间无效：to 必须晚于 from");
    const gen = await generateReportData(svc, preset, range);
    await svc.periodStats.put(gen.key, toPeriodRecord(gen.key, preset, range, gen));
    const stats = gen.stats;
    const cost = gen.cost;
    const markdown = renderReport(stats, preset, cost, gen.prev, gen.insights, gen.improvements);
    const record = {
        sem: REPORT_SEM,
        id: `whale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        preset,
        from: range.from,
        to: range.to,
        createdAt: now,
        sessions: stats.sessions,
        turns: stats.turns,
        totalEvents: stats.totalEvents,
        stats: stats,
        markdown,
        cost,
        insights: gen.insights,
        improvements: gen.improvements,
        reportGeneration: gen.reportGeneration,
        prev: gen.prev
            ? {
                key: gen.prev.key,
                cost: gen.prev.cost,
                sessions: gen.prev.sessions,
                turns: gen.prev.turns,
                tokens: gen.prev.tokens,
                cacheHitRate: gen.prev.cacheHitRate,
                nightRatio: gen.prev.nightRatio,
                dangerCount: gen.prev.dangerCount,
            }
            : undefined,
    };
    await svc.domain.table("reports").put(record.id, record);
    return record;
}
const ASSET_ALLOWLIST = [
    "whale-happy", "whale-angry", "whale-sleepy", "whale-dazed", "whale-hero",
];
const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "whale");
const MIME = { ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg" };
/** 鲸鱼娘素材路由：白名单文件名，防路径穿越。 */
export function registerAssetRoutes(ctx, server) {
    ctx.effect(() => server.register({
        kind: "prefix",
        path: "/whale/assets",
        handler: async (req, res) => {
            if (!isTrustedApiRequest({ headers: req.headers })) {
                res.writeHead(403);
                res.end("forbidden");
                return;
            }
            const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
            const name = pathname.replace(/^\/whale\/assets\//, "").replace(/\.[a-z]+$/, "");
            if (!ASSET_ALLOWLIST.includes(name)) {
                res.writeHead(404);
                res.end("not found");
                return;
            }
            for (const ext of [".png", ".svg", ".webp", ".jpg"]) {
                const file = join(ASSET_DIR, name + ext);
                if (existsSync(file)) {
                    res.writeHead(200, {
                        "content-type": MIME[ext] ?? "application/octet-stream",
                        "cache-control": "public, max-age=3600",
                    });
                    res.end(readFileSync(file));
                    return;
                }
            }
            res.writeHead(404);
            res.end("not found");
        },
    }), "dsh-whale-report: /whale/assets routes");
}
/** 注册 /whale/api 路由（经 ctx.effect 挂载，卸载自动摘除）。 */
export function registerApiRoutes(ctx, server, svc) {
    ctx.effect(() => server.register({
        kind: "prefix",
        path: "/whale/api",
        handler: async (req, res) => {
            if (!isTrustedApiRequest({ headers: req.headers })) {
                writeJson(res, 403, { ok: false, error: { code: "forbidden", message: "forbidden" } });
                return;
            }
            const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
            const method = pathname.startsWith("/whale/api/") ? pathname.slice("/whale/api/".length) : "";
            const table = svc.domain.table("reports");
            try {
                if (req.method === "GET" && method === "trends") {
                    // 历史趋势：读 period_stats，按 preset 前缀过滤并取最近 N 个周期。
                    const url = new URL(req.url ?? "/", "http://dsh.internal");
                    const preset = url.searchParams.get("preset") ?? "weekly";
                    const limit = Math.min(24, Math.max(2, Number(url.searchParams.get("limit") ?? 8)));
                    const prefixes = {
                        daily: "day-", "24h": "24h-", weekly: "wk-", monthly: "mo-", yearly: "yr-", custom: "",
                    };
                    const prefix = prefixes[preset] ?? "wk-";
                    // 当前进行中周期（确定性判定：key 等于当前自然周期 key）。
                    // 仅用于 LIVE 展示语义，不参与任何统计。
                    let currentKey = null;
                    try {
                        currentKey = periodKey(preset, Date.now());
                    }
                    catch {
                        currentKey = null;
                    }
                    const table = svc.domain.table("period_stats");
                    const rows = [...table.entries()]
                        .map(([, record]) => ({
                        key: record.key,
                        preset: record.preset,
                        from: record.from,
                        to: record.to,
                        cost: record.cost,
                        sessions: record.sessions,
                        turns: record.turns,
                        totalEvents: record.totalEvents,
                        tokens: {
                            input: record.tokens?.input ?? 0,
                            output: record.tokens?.output ?? 0,
                            cacheRead: record.tokens?.cacheRead ?? 0,
                            reasoning: record.tokens?.reasoning ?? 0,
                        },
                        nightRatio: record.nightRatio,
                        cacheHitRate: record.cacheHitRate,
                        dangerCount: record.dangerCount,
                        redDanger: record.redDanger,
                        retryBursts: record.retryBursts,
                        activeDays: record.activeDays,
                        // 数据完整性：损坏/读取失败被跳过的会话数（0/缺失 = 完整）。
                        skippedCount: record.skippedCount ?? 0,
                        // 进行中周期：key 命中当前自然周期。custom 无自然周期 → 恒 false。
                        isCurrent: currentKey !== null && record.key === currentKey,
                    }))
                        // 读取侧兼容：标准周期趋势排除旧版 custom 污染记录（preset=custom 且 key 为 wk-…）。
                        .filter((r) => isTrendRowIncluded(r.key, r.preset, prefix))
                        .sort((a, b) => (a.key < b.key ? -1 : 1))
                        .slice(-limit);
                    writeJson(res, 200, { ok: true, trends: rows });
                    return;
                }
                if (req.method === "GET" && method === "live-session") {
                    // v0.5.x repair：live 消耗从内存增量桶聚合 —— 绝不 readSession 全量（<50ms）。
                    const ingest = svc.ingest;
                    const results = [];
                    for (const id of [...ingest.statusOf().liveIds].slice(0, 5)) {
                        const snap = ingest.liveSnapshot(id);
                        if (snap === null)
                            continue;
                        const summary = summarizeLiveBuckets(id, snap);
                        if (summary.totalTokens === 0 && summary.turns === 0 && summary.toolCalls === 0)
                            continue;
                        const cost = computeCostTimed(summary.timeModelTokens);
                        results.push({
                            sessionId: id,
                            title: summary.title,
                            turns: summary.turns,
                            toolCalls: summary.toolCalls,
                            tokens: summary.tokens,
                            totalTokens: summary.totalTokens,
                            cost: cost.total,
                            costSource: "peak-offpeak",
                            peakShare: cost.peakShare,
                            lastTime: summary.lastTime,
                        });
                    }
                    writeJson(res, 200, { ok: true, sessions: results });
                    return;
                }
                if (req.method === "GET" && method === "balance") {
                    // Provider 余额：服务端发起的只读探针。key 永不出宿主进程。
                    const url = new URL(req.url ?? "/", "http://dsh.internal");
                    const provider = url.searchParams.get("provider") ?? "deepseek";
                    const refresh = url.searchParams.get("refresh") === "1";
                    const adapter = adapterOf(provider);
                    if (adapter === undefined) {
                        writeJson(res, 404, { ok: false, error: { code: "unknown-provider", message: `未知 provider ${provider}` } });
                        return;
                    }
                    try {
                        const balance = await queryBalance(adapter, refresh);
                        writeJson(res, 200, { ok: true, balance });
                    }
                    catch {
                        // 余额查询失败绝不影响报告链路：返回不可用态而不是 500。
                        writeJson(res, 200, {
                            ok: true,
                            balance: {
                                provider: adapter.id,
                                name: adapter.name,
                                status: "unavailable",
                                checkedAt: Date.now(),
                                error: "PROVIDER FAILURE",
                            },
                        });
                    }
                    return;
                }
                if (req.method === "GET" && method === "overview") {
                    // v0.5.x repair：Overview = Query Engine 实时结果（不再以 reports 表为真相）。
                    const url = new URL(req.url ?? "/", "http://dsh.internal");
                    const preset = (url.searchParams.get("preset") ?? "weekly");
                    const now = Date.now();
                    let spec;
                    try {
                        spec = resolvePeriod({
                            preset,
                            now,
                            from: url.searchParams.get("from") ?? undefined,
                            to: url.searchParams.get("to") ?? undefined,
                        });
                    }
                    catch (error) {
                        writeJson(res, 400, { ok: false, error: { code: "bad-request", message: error instanceof Error ? error.message : String(error) } });
                        return;
                    }
                    void svc.ingest.bootstrap();
                    const meta = svc.ingest.statusOf();
                    const { stats } = queryPeriod(svc.index, spec, meta.headers, meta);
                    const gen = await buildReportFromStats(svc, preset, spec.from, spec.to, stats);
                    const report = {
                        sem: REPORT_SEM,
                        id: `overview-${spec.queryId}`,
                        preset,
                        from: spec.from,
                        to: spec.to,
                        createdAt: now,
                        sessions: gen.stats.sessions,
                        turns: gen.stats.turns,
                        totalEvents: gen.stats.totalEvents,
                        stats: gen.stats,
                        cost: gen.cost,
                        insights: gen.insights,
                        improvements: gen.improvements,
                        reportGeneration: gen.reportGeneration,
                        prev: gen.prev
                            ? { key: gen.prev.key, cost: gen.prev.cost, sessions: gen.prev.sessions, turns: gen.prev.turns, cacheHitRate: gen.prev.cacheHitRate, nightRatio: gen.prev.nightRatio, dangerCount: gen.prev.dangerCount }
                            : undefined,
                    };
                    writeJson(res, 200, {
                        ok: true,
                        snapshot: true,
                        fresh: !meta.indexing,
                        lastUpdated: meta.indexedThrough,
                        ageMs: 0,
                        indexing: meta.indexing,
                        missing: meta.missing,
                        indexedThrough: meta.indexedThrough,
                        report: withProviderScope(report),
                    });
                    return;
                }
                if (req.method === "GET" && method === "list") {
                    const items = [...table.entries()]
                        .map(([, record]) => ({
                        id: record.id,
                        preset: record.preset,
                        from: record.from,
                        to: record.to,
                        createdAt: record.createdAt,
                        sessions: record.sessions,
                        turns: record.turns,
                        totalEvents: record.totalEvents,
                    }))
                        .sort((a, b) => b.createdAt - a.createdAt);
                    writeJson(res, 200, { ok: true, reports: items });
                    return;
                }
                if (req.method === "GET" && method === "get") {
                    const url = new URL(req.url ?? "/", "http://dsh.internal");
                    const id = url.searchParams.get("id") ?? "";
                    const record = table.get(id);
                    if (!record) {
                        writeJson(res, 404, { ok: false, error: { code: "not-found", message: "报告不存在" } });
                        return;
                    }
                    writeJson(res, 200, { ok: true, report: withProviderScope(record) });
                    return;
                }
                if (req.method === "GET" && method === "html") {
                    // 独立可打印 HTML 页（面板"导出 PDF"用；浏览器打印 → 另存为 PDF）
                    const url = new URL(req.url ?? "/", "http://dsh.internal");
                    const id = url.searchParams.get("id") ?? "";
                    const record = table.get(id);
                    if (!record) {
                        writeJson(res, 404, { ok: false, error: { code: "not-found", message: "报告不存在" } });
                        return;
                    }
                    const html = renderHtmlReport(record);
                    res.writeHead(200, {
                        "content-type": "text/html; charset=utf-8",
                        "cache-control": "no-store",
                        "content-length": Buffer.byteLength(html),
                    });
                    res.end(html);
                    return;
                }
                if (req.method === "POST" && method === "summary") {
                    // v0.5.x repair：Summary = Query Engine（只读 index）+ 报告构建 + 落库 artifact。
                    // 普通 Refresh 不再触发 session replay / readSession / salvage。
                    const tAll = Date.now();
                    const payload = (await readJsonBody(req));
                    const preset = payload.preset ?? "weekly";
                    const now = Date.now();
                    let spec;
                    try {
                        spec = resolvePeriod({
                            preset,
                            now,
                            from: payload.from,
                            to: payload.to,
                        });
                    }
                    catch (error) {
                        writeJson(res, 400, { ok: false, error: { code: "bad-request", message: error instanceof Error ? error.message : String(error) } });
                        return;
                    }
                    void svc.ingest.bootstrap();
                    const meta = svc.ingest.statusOf();
                    const { stats } = queryPeriod(svc.index, spec, meta.headers, meta);
                    const gen = await buildReportFromStats(svc, preset, spec.from, spec.to, stats);
                    const perf = { queryMs: Date.now() - tAll };
                    // 24h rolling 不落 artifact（每次实时 query）；自然周期与 custom 落库供 History/Export。
                    const record = {
                        sem: REPORT_SEM,
                        id: `whale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                        preset,
                        from: spec.from,
                        to: spec.to,
                        createdAt: now,
                        sessions: gen.stats.sessions,
                        turns: gen.stats.turns,
                        totalEvents: gen.stats.totalEvents,
                        stats: gen.stats,
                        markdown: renderReport(gen.stats, preset, gen.cost, gen.prev, gen.insights, gen.improvements),
                        cost: gen.cost,
                        insights: gen.insights,
                        improvements: gen.improvements,
                        reportGeneration: gen.reportGeneration,
                        prev: gen.prev
                            ? { key: gen.prev.key, cost: gen.prev.cost, sessions: gen.prev.sessions, turns: gen.prev.turns, cacheHitRate: gen.prev.cacheHitRate, nightRatio: gen.prev.nightRatio, dangerCount: gen.prev.dangerCount }
                            : undefined,
                    };
                    if (preset !== "24h") {
                        const tSer = Date.now();
                        void svc.periodStats.put(spec.queryId, toPeriodRecord(spec.queryId, preset, { from: spec.from, to: spec.to }, gen)).catch((e) => trackWriteFailure("period_stats", e));
                        // 同周期覆盖式落库（复用已有 id，避免 History 膨胀）。
                        for (const [, existing] of table.entries()) {
                            if (existing.preset === preset && existing.sem === REPORT_SEM && existing.cost !== undefined) {
                                const existingKey = spec.queryId.startsWith("custom-") ? customPeriodKey(existing.from, existing.to) : naturalPeriodKey(existing.preset, existing.to);
                                if (existingKey === spec.queryId) {
                                    record.id = existing.id;
                                    break;
                                }
                            }
                        }
                        void table.put(record.id, record).catch((e) => trackWriteFailure("reports", e));
                        perf.serializeMs = Date.now() - tSer;
                    }
                    writeJson(res, 200, {
                        ok: true,
                        fresh: true,
                        indexing: meta.indexing,
                        missing: meta.missing,
                        indexedThrough: meta.indexedThrough,
                        perf,
                        report: withProviderScope(record),
                    });
                    return;
                }
                if (req.method === "POST") {
                    const payload = (await readJsonBody(req));
                    if (method === "generate") {
                        const record = await generateReport(svc, payload);
                        writeJson(res, 200, { ok: true, report: withProviderScope(record) });
                        return;
                    }
                    if (method === "delete") {
                        const id = typeof payload.id === "string" ? payload.id : "";
                        const existed = await table.delete(id);
                        writeJson(res, existed ? 200 : 404, {
                            ok: existed,
                            error: existed ? undefined : { code: "not-found", message: "报告不存在" },
                        });
                        return;
                    }
                }
                writeJson(res, 404, { ok: false, error: { code: "not-found", message: `未知方法 ${method}` } });
            }
            catch (error) {
                writeJson(res, 400, {
                    ok: false,
                    error: { code: "bad-request", message: error instanceof Error ? error.message : String(error) },
                });
            }
        },
    }), "dsh-whale-report: /whale/api routes");
}
//# sourceMappingURL=api.js.map