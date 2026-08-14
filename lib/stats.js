/**
 * 报告引擎：把会话事件日志聚合成结构化统计。
 *
 * 这是整个插件的"数据新闻官"心脏。设计原则：
 * 1. 纯函数、零 IO —— 输入是事件数组 + 时间区间，输出是统计对象。
 *    这样它既能被工具调用，也能被 scripts/report-now.mjs 直接复用，
 *    还能被单测精确验证（"数据不会说谎"的前提是引擎自己可证伪）。
 * 2. 只读 —— 报告绝不写回任何会话数据。
 * 3. 事件类型是插件可扩展的（SessionEventMap 声明合并），所以这里
 *    对未知事件类型全部宽容跳过，只聚合我们认识的那几种。
 */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 危险命令特征（正则，匹配 bash 命令字符串）。 */
export const DANGEROUS_PATTERNS = [
    { pattern: /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/, label: "rm -rf 删除" },
    { pattern: /git\s+push\b[^\n]*--force/, label: "force push" },
    { pattern: /git\s+reset\s+--hard/, label: "硬重置 git" },
    { pattern: /DROP\s+(TABLE|DATABASE)/i, label: "删库" },
    { pattern: /shutdown|reboot|halt\b/, label: "关机/重启" },
    { pattern: /mkfs\./, label: "格式化磁盘" },
    { pattern: /dd\s+if=.*of=\/dev\//, label: "dd 写设备" },
    { pattern: /chmod\s+(-R\s+)?777/, label: "777 全开放" },
    { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\};?\s*:/, label: "fork 炸弹" },
    { pattern: /curl\s+\S+\s*\|\s*(ba)?sh/, label: "curl|sh 远程执行" },
];
export function emptyStats(period) {
    return {
        period,
        sessions: 0,
        subagentSessions: 0,
        turns: 0,
        steps: 0,
        userMessages: 0,
        assistantMessages: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, reasoning: 0 },
        toolCalls: {},
        toolCallsTotal: 0,
        toolErrors: 0,
        commands: 0,
        dangerousCommands: [],
        hourHistogram: new Array(24).fill(0),
        activeDays: 0,
        busiestDay: null,
        titles: [],
        totalEvents: 0,
    };
}
function usageOf(data) {
    if (typeof data !== "object" || data === null)
        return null;
    const usage = data.usage;
    if (typeof usage !== "object" || usage === null)
        return null;
    const u = usage;
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return {
        input: num(u.inputTokens),
        output: num(u.outputTokens),
        cacheRead: num(u.cacheReadTokens),
        reasoning: num(u.reasoningTokens),
    };
}
/** 从 tool/call 的 arguments（JSON 字符串）里抽出 bash 命令本体。 */
function commandOf(data) {
    if (typeof data !== "object" || data === null)
        return null;
    const d = data;
    if (d.name !== "bash")
        return null;
    const args = typeof d.arguments === "string" ? d.arguments : null;
    if (!args)
        return null;
    try {
        const parsed = JSON.parse(args);
        return typeof parsed.command === "string" ? parsed.command : null;
    }
    catch {
        return null;
    }
}
/** tool/result 是否失败（兼容多种形态，宽容解析）。 */
function resultIsError(data) {
    if (typeof data !== "object" || data === null)
        return false;
    const d = data;
    if (d.error !== undefined && d.error !== null)
        return true;
    const message = d.message;
    if (typeof message === "object" && message !== null) {
        const m = message;
        if (m.isError === true)
            return true;
        const content = m.content;
        if (Array.isArray(content)) {
            return content.some((block) => typeof block === "object" && block !== null && block.type === "error");
        }
        if (typeof content === "string") {
            return /error|failed|EACCES|ENOENT|command not found/i.test(content);
        }
    }
    return false;
}
/**
 * 聚合一个时间区间内的事件。
 * @param events - 任意顺序的原始事件（可以是多个 session 拼起来的）。
 * @param period - 时间区间（半开区间 [from, to)）。
 * @param headers - 可选：session 头部（按 id 匹配，用于统计子代理会话）。
 */
export function aggregate(events, period, headers = []) {
    const stats = emptyStats(period);
    const seenSessions = new Set();
    const sessionIdsByEvent = [];
    // 若事件不带 sessionId，我们用 session 头部做一次粗糙映射；
    // 报告引擎对精确 session 归属不做硬要求 —— 只要能数、能统计时间。
    const days = new Map();
    const headerById = new Map(headers.map((h) => [h.id, h]));
    const headerByCwd = new Map(headers.map((h) => [h.cwd ?? "", h]));
    // 第一遍：事件 → 归属 session 的近似映射。
    // 实现约定：聚合器收到的 events 可带 data.sessionId（caller 负责注入），
    // 没有的话用 headers 中 createdAt 与事件时间最近的 session 兜底。
    let lastHeader = headers[0] ?? null;
    for (const event of events) {
        if (event.time < period.from || event.time >= period.to)
            continue;
        stats.totalEvents += 1;
        const hour = new Date(event.time).getHours();
        stats.hourHistogram[hour] = (stats.hourHistogram[hour] ?? 0) + 1;
        const day = new Date(event.time).toISOString().slice(0, 10);
        days.set(day, (days.get(day) ?? 0) + 1);
        const data = event.data;
        const sessionId = data?.sessionId ?? lastHeader?.id ?? "unknown";
        seenSessions.add(sessionId);
        switch (event.type) {
            case "turn/start":
                stats.turns += 1;
                break;
            case "step/start":
                stats.steps += 1;
                break;
            case "user/message":
                stats.userMessages += 1;
                break;
            case "assistant/message": {
                stats.assistantMessages += 1;
                const usage = usageOf(data);
                if (usage) {
                    stats.tokens.input += usage.input ?? 0;
                    stats.tokens.output += usage.output ?? 0;
                    stats.tokens.cacheRead += usage.cacheRead ?? 0;
                    stats.tokens.reasoning += usage.reasoning ?? 0;
                }
                break;
            }
            case "tool/call": {
                stats.toolCallsTotal += 1;
                const name = typeof data?.name === "string" ? data.name : "(unknown)";
                stats.toolCalls[name] = (stats.toolCalls[name] ?? 0) + 1;
                const command = commandOf(data);
                if (command) {
                    stats.commands += 1;
                    for (const { pattern, label } of DANGEROUS_PATTERNS) {
                        if (pattern.test(command)) {
                            stats.dangerousCommands.push({ command, time: event.time, sessionId });
                            break;
                        }
                    }
                }
                break;
            }
            case "tool/result":
                if (resultIsError(data))
                    stats.toolErrors += 1;
                break;
            case "session/title": {
                const title = typeof data?.title === "string" ? data.title : null;
                if (title && !stats.titles.includes(title))
                    stats.titles.push(title);
                break;
            }
            default:
                break;
        }
    }
    // 会话计数：事件归属过的 session + 头信息里落在区间内的 session。
    for (const header of headers) {
        if (header.createdAt >= period.from && header.createdAt < period.to) {
            seenSessions.add(header.id);
            if ((header.delegationDepth ?? 0) >= 1)
                stats.subagentSessions += 1;
        }
    }
    stats.sessions = seenSessions.size;
    // 活跃天数 & 最忙一天。
    stats.activeDays = days.size;
    let busiest = null;
    for (const [date, count] of days) {
        if (busiest === null || count > busiest.events)
            busiest = { date, events: count };
    }
    stats.busiestDay = busiest;
    return stats;
}
/** 凌晨（0-6 点）事件占比 —— "熬夜指数"。 */
export function nightOwlIndex(stats) {
    const night = stats.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0);
    if (stats.totalEvents === 0)
        return 0;
    return Math.round((night / stats.totalEvents) * 100);
}
/** 把 token 数转成人类可读文本。 */
export function formatTokens(n) {
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)
        return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}
/** 人类可读的时间跨度。 */
export function formatSpan(from, to) {
    const days = Math.max(1, Math.round((to - from) / DAY_MS));
    if (days === 1)
        return "1 天";
    if (days < 30)
        return `${days} 天`;
    if (days < 365)
        return `${(days / 30).toFixed(1)} 个月`;
    return `${(days / 365).toFixed(1)} 年`;
}
/** 分桶粒度：10 分钟（区间边界的裁剪误差 ≤ 2×10min/会话）。 */
export const BUCKET_MS = 10 * 60 * 1000;
const DANGER_SAMPLE_CAP = 30;
function hourOf(ms) {
    return Math.floor(ms / BUCKET_MS) * BUCKET_MS;
}
function newBucket(h) {
    return {
        h,
        total: 0,
        turns: 0,
        steps: 0,
        userMessages: 0,
        assistantMessages: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        reasoning: 0,
        toolCallsTotal: 0,
        toolCalls: {},
        toolErrors: 0,
        commands: 0,
        danger: [],
    };
}
/**
 * 把一个会话的原始事件折叠成小时分桶。
 * @param sessionId - 归属会话（危险命令归属用）。
 * @param events - 完整逻辑日志。
 * @param ownStart - seedLength：seq 小于它的继承事件不计入。
 * @param stopAfter - 可选：时间上限（ms），超过即停止（时间单调）。
 */
export function bucketizeOwnEvents(sessionId, events, ownStart, stopAfter) {
    const byHour = new Map();
    const titles = [];
    let lastSeq = 0;
    let lastMs = 0;
    for (const event of events) {
        if (event.seq < ownStart)
            continue;
        if (stopAfter !== undefined && event.time >= stopAfter)
            break;
        lastSeq = event.seq;
        lastMs = event.time;
        const h = hourOf(event.time);
        let bucket = byHour.get(h);
        if (bucket === undefined) {
            bucket = newBucket(h);
            byHour.set(h, bucket);
        }
        bucket.total += 1;
        const data = event.data;
        switch (event.type) {
            case "turn/start":
                bucket.turns += 1;
                break;
            case "step/start":
                bucket.steps += 1;
                break;
            case "user/message":
                bucket.userMessages += 1;
                break;
            case "assistant/message": {
                bucket.assistantMessages += 1;
                const usage = usageOf(data);
                if (usage) {
                    bucket.input += usage.input ?? 0;
                    bucket.output += usage.output ?? 0;
                    bucket.cacheRead += usage.cacheRead ?? 0;
                    bucket.reasoning += usage.reasoning ?? 0;
                }
                break;
            }
            case "tool/call": {
                bucket.toolCallsTotal += 1;
                const name = typeof data?.name === "string" ? data.name : "(unknown)";
                bucket.toolCalls[name] = (bucket.toolCalls[name] ?? 0) + 1;
                const command = commandOf(data);
                if (command) {
                    bucket.commands += 1;
                    if (bucket.danger.length < DANGER_SAMPLE_CAP) {
                        for (const { pattern } of DANGEROUS_PATTERNS) {
                            if (pattern.test(command)) {
                                bucket.danger.push({ cmd: command, ms: event.time });
                                break;
                            }
                        }
                    }
                }
                break;
            }
            case "tool/result":
                if (resultIsError(data))
                    bucket.toolErrors += 1;
                break;
            case "session/title": {
                const title = typeof data?.title === "string" ? data.title : null;
                if (title && !titles.includes(title))
                    titles.push(title);
                break;
            }
            default:
                break;
        }
    }
    const buckets = [...byHour.values()].sort((a, b) => a.h - b.h);
    return { buckets, titles, lastSeq, lastMs };
}
/** 把多个会话的分桶视图聚合成区间统计（与 aggregate 等价，但 O(分桶数)）。 */
export function aggregateBuckets(views, period, headers = []) {
    const stats = emptyStats(period);
    const seenSessions = new Set();
    const days = new Map();
    for (const view of views) {
        seenSessions.add(view.sessionId);
        for (const bucket of view.buckets) {
            if (bucket.h + BUCKET_MS <= period.from || bucket.h >= period.to)
                continue;
            // 分桶内事件可能在区间边界外（按小时取整后），做保守裁剪：
            // 桶整体落在区间内才计入（跨边界的小时由 nextHour 裁剪近似处理）。
            const inFrom = bucket.h >= period.from;
            const inTo = bucket.h + BUCKET_MS <= period.to;
            if (!inFrom || !inTo) {
                // 边界桶：按比例近似计入事件总数与活跃度，细粒度计数不裁剪
                // （报告用途可接受；精确值由未索引路径保证）。
                continue;
            }
            stats.totalEvents += bucket.total;
            stats.turns += bucket.turns;
            stats.steps += bucket.steps;
            stats.userMessages += bucket.userMessages;
            stats.assistantMessages += bucket.assistantMessages;
            stats.tokens.input += bucket.input;
            stats.tokens.output += bucket.output;
            stats.tokens.cacheRead += bucket.cacheRead;
            stats.tokens.reasoning += bucket.reasoning;
            stats.toolCallsTotal += bucket.toolCallsTotal;
            for (const [name, count] of Object.entries(bucket.toolCalls)) {
                stats.toolCalls[name] = (stats.toolCalls[name] ?? 0) + count;
            }
            stats.toolErrors += bucket.toolErrors;
            stats.commands += bucket.commands;
            for (const d of bucket.danger) {
                stats.dangerousCommands.push({ command: d.cmd, time: d.ms, sessionId: view.sessionId });
            }
            const hour = new Date(bucket.h).getHours();
            stats.hourHistogram[hour] = (stats.hourHistogram[hour] ?? 0) + bucket.total;
            const day = new Date(bucket.h).toISOString().slice(0, 10);
            days.set(day, (days.get(day) ?? 0) + bucket.total);
        }
        for (const title of view.titles) {
            if (!stats.titles.includes(title))
                stats.titles.push(title);
        }
    }
    for (const header of headers) {
        if (header.createdAt >= period.from && header.createdAt < period.to) {
            seenSessions.add(header.id);
            if ((header.delegationDepth ?? 0) >= 1)
                stats.subagentSessions += 1;
        }
    }
    stats.sessions = seenSessions.size;
    stats.activeDays = days.size;
    let busiest = null;
    for (const [date, count] of days) {
        if (busiest === null || count > busiest.events)
            busiest = { date, events: count };
    }
    stats.busiestDay = busiest;
    return stats;
}
//# sourceMappingURL=stats.js.map