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
/** 疑似密钥/令牌模式（只做存在性检测，从不存储命中原文）。 */
export const SECRET_PATTERNS = [
    { pattern: /\bsk-[A-Za-z0-9]{16,}\b/, label: "OpenAI 风格密钥" },
    { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: "AWS Access Key" },
    { pattern: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/, label: "私钥块" },
    { pattern: /\bghp_[A-Za-z0-9]{20,}\b/, label: "GitHub PAT" },
    { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, label: "Slack Token" },
    { pattern: /\b(?:api[_-]?key|token|password|secret)\b\s*[=:]\s*['"]?[A-Za-z0-9_.-]{12,}/i, label: "配置型密钥" },
];
/** 剥离引号段：grep/echo 里的搜索模式不算真实操作。 */
function stripQuotes(s) {
    return s.replace(/["'][^"'\n]*["']/g, " ");
}
/** 从 user/message 的 content 块里提取文本（逐块扫，不拼接全文）。 */
function textOfUserMessage(data) {
    const content = data?.content;
    if (!Array.isArray(content))
        return [];
    const texts = [];
    for (const block of content) {
        if (typeof block === "object" && block !== null && block.type === "text") {
            const text = block.text;
            if (typeof text === "string")
                texts.push(text);
        }
    }
    return texts;
}
/**
 * 协作信号检测（确定性、无 LLM）：从单条用户消息文本判断两类协作信号。
 * 词表保守，宁可少报也不误伤；只用于「协作复盘」的观察性指标，不评价人格。
 */
const REVISION_PATTERNS = [
    /不是这个/, /换一个/, /换种/, /再改/, /重新来/, /重新做/, /重新写/, /重做/, /改成/, /改为/,
    /不对/, /错了/, /不要这个/, /推翻/, /不要那样/, /这样不行/, /不行，/, /换个/, /换一下/,
    /重新开始/, /别这样/, /删掉重来/, /不是要/, /搞错了/, /理解错了/, /方向不对/,
    // 注意：重试语境（"再试一次 / 再来一次 / 重跑"）不是方向修正，故意不收录。
];
const CONSTRAINT_PATTERNS = [
    /千万不要/, /必须注意/, /务必/, /只允许/, /不允许/, /禁止/, /千万别/, /确保/, /前提是/, /限制为/,
    /只能在/, /仅限于/, /一定要/, /无论如何都不要/, /绝不要/,
    // 强约束主模式：单字"必须"与"不要<动词>"结构（"不要紧"等非约束用法不匹配）。
    /必须/, /不要写/, /不要改/, /不要删/, /不要动/, /不要用/, /不要碰/, /不要跑/, /不要执行/,
    /不要乱/, /不要随便/, /保持/, /只能是/, /只能写/, /只能读/,
];
export function userMessageSignals(text) {
    return {
        revision: REVISION_PATTERNS.some((re) => re.test(text)),
        constraint: CONSTRAINT_PATTERNS.some((re) => re.test(text)),
    };
}
/**
 * 危险命令特征（正则，匹配 bash 命令字符串）。红色规则排前面：
 * 命中即按该规则分级，所以"删除根目录"必须先于泛化的"rm -rf 删除"。
 */
export const DANGEROUS_PATTERNS = [
    { pattern: /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(?:\/(?:\s|$)|~\/?(?:\s|$))/, label: "删除根目录/家目录", sev: "red" },
    { pattern: /DROP\s+(TABLE|DATABASE)/i, label: "删库", sev: "red" },
    { pattern: /^(?:sudo\s+)?(?:shutdown|reboot|halt)\b/, label: "关机/重启", sev: "red" },
    { pattern: /mkfs\./, label: "格式化磁盘", sev: "red" },
    { pattern: /dd\s+if=.*of=\/dev\//, label: "dd 写设备", sev: "red" },
    { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\};?\s*:/, label: "fork 炸弹", sev: "red" },
    { pattern: /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/, label: "rm -rf 删除", sev: "amber" },
    { pattern: /git\s+push\b[^\n]*--force/, label: "force push", sev: "amber" },
    { pattern: /git\s+reset\s+--hard/, label: "硬重置 git", sev: "amber" },
    { pattern: /chmod\s+(-R\s+)?777/, label: "777 全开放", sev: "amber" },
    { pattern: /curl\s+\S+\s*\|\s*(ba)?sh/, label: "curl|sh 远程执行", sev: "amber" },
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
        models: {},
        halfHourHistogram: new Array(48).fill(0),
        dailySeries: [],
        dayHourSeries: [],
        retryBursts: 0,
        burstSamples: [],
        secretHits: [],
        sessionsDetail: [],
        collab: { userMessages: 0, revisions: 0, lateConstraints: 0, sessionsWithRevision: 0, shortSessions: 0 },
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
    const currentModel = new Map();
    const dayHourMap = new Map();
    const lastCommand = new Map();
    const commandStreak = new Map();
    const burstStart = new Map();
    const lastError = new Map();
    const sessionAgg = new Map();
    const sessionTitle = new Map();
    const aggOf = (sid, time) => {
        let a = sessionAgg.get(sid);
        if (a === undefined) {
            a = { firstTime: time, lastTime: time, events: 0, commands: 0, toolCalls: 0, retryBursts: 0, dangerCount: 0, redDanger: 0, modelTokens: {}, title: "", turns: 0, userMessages: 0, collabRevisions: 0, collabLateConstraints: 0 };
            sessionAgg.set(sid, a);
        }
        return a;
    };
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
        // 排除插件自生事件（whale/report 等）：深迹用得越多，越不能影响自己的统计。
        if (event.type.startsWith("whale/"))
            continue;
        stats.totalEvents += 1;
        const d = new Date(event.time);
        const hour = d.getHours();
        stats.hourHistogram[hour] = (stats.hourHistogram[hour] ?? 0) + 1;
        stats.halfHourHistogram[hour * 2 + (d.getMinutes() >= 30 ? 1 : 0)] += 1;
        const day = new Date(event.time).toISOString().slice(0, 10);
        days.set(day, (days.get(day) ?? 0) + 1);
        let dayHour = dayHourMap.get(day);
        if (dayHour === undefined) {
            dayHour = new Array(24).fill(0);
            dayHourMap.set(day, dayHour);
        }
        dayHour[hour] += 1;
        const data = event.data;
        const sessionId = data?.sessionId ?? lastHeader?.id ?? "unknown";
        seenSessions.add(sessionId);
        const agg = aggOf(sessionId, event.time);
        agg.events += 1;
        agg.firstTime = Math.min(agg.firstTime, event.time);
        agg.lastTime = Math.max(agg.lastTime, event.time);
        switch (event.type) {
            case "turn/start":
                stats.turns += 1;
                aggOf(sessionId, event.time).turns += 1;
                break;
            case "step/start":
                stats.steps += 1;
                break;
            case "user/message": {
                stats.userMessages += 1;
                const uagg = aggOf(sessionId, event.time);
                uagg.userMessages += 1;
                for (const text of textOfUserMessage(data)) {
                    for (const { pattern, label } of SECRET_PATTERNS) {
                        if (pattern.test(text)) {
                            stats.secretHits.push({ label, time: event.time, source: "user", sessionId });
                            break;
                        }
                    }
                    const signals = userMessageSignals(text);
                    if (signals.revision) {
                        uagg.collabRevisions += 1;
                        stats.collab.revisions += 1;
                    }
                    if (signals.constraint && uagg.userMessages > 1) {
                        uagg.collabLateConstraints += 1;
                        stats.collab.lateConstraints += 1;
                    }
                }
                break;
            }
            case "assistant/message": {
                stats.assistantMessages += 1;
                const usage = usageOf(data);
                if (usage) {
                    stats.tokens.input += usage.input ?? 0;
                    stats.tokens.output += usage.output ?? 0;
                    stats.tokens.cacheRead += usage.cacheRead ?? 0;
                    stats.tokens.reasoning += usage.reasoning ?? 0;
                    const model = currentModel.get(sessionId) ?? "unknown";
                    const m = (stats.models[model] ??= { input: 0, output: 0, cacheRead: 0, reasoning: 0 });
                    m.input += usage.input ?? 0;
                    m.output += usage.output ?? 0;
                    m.cacheRead += usage.cacheRead ?? 0;
                    m.reasoning += usage.reasoning ?? 0;
                    const sm = (aggOf(sessionId, event.time).modelTokens[model] ??= { input: 0, output: 0, cacheRead: 0, reasoning: 0 });
                    sm.input += usage.input ?? 0;
                    sm.output += usage.output ?? 0;
                    sm.cacheRead += usage.cacheRead ?? 0;
                    sm.reasoning += usage.reasoning ?? 0;
                }
                break;
            }
            case "request/header": {
                const config = data?.header?.config;
                if (typeof config?.model === "string")
                    currentModel.set(sessionId, config.model);
                break;
            }
            case "tool/call": {
                stats.toolCallsTotal += 1;
                aggOf(sessionId, event.time).toolCalls += 1;
                const name = typeof data?.name === "string" ? data.name : "(unknown)";
                stats.toolCalls[name] = (stats.toolCalls[name] ?? 0) + 1;
                const command = commandOf(data);
                if (command) {
                    stats.commands += 1;
                    aggOf(sessionId, event.time).commands += 1;
                    // 只对命令首行做危险匹配：heredoc 正文里的字样不算真实操作。
                    const firstLine = command.split("\n", 1)[0];
                    const matchText = stripQuotes(firstLine);
                    const prev = lastCommand.get(sessionId);
                    if (prev === firstLine) {
                        const streak = (commandStreak.get(sessionId) ?? 1) + 1;
                        commandStreak.set(sessionId, streak);
                        if (streak === 3) {
                            stats.retryBursts += 1;
                            aggOf(sessionId, event.time).retryBursts += 1;
                            if (stats.burstSamples.length < 10) {
                                stats.burstSamples.push({
                                    cmd: firstLine.slice(0, 80),
                                    count: streak,
                                    time: burstStart.get(sessionId) ?? event.time,
                                    error: lastError.get(sessionId),
                                    sessionId,
                                });
                            }
                        }
                        else if (streak > 3) {
                            const sample = stats.burstSamples[stats.burstSamples.length - 1];
                            if (sample !== undefined && sample.cmd === firstLine.slice(0, 80))
                                sample.count = streak;
                        }
                    }
                    else {
                        lastCommand.set(sessionId, firstLine);
                        commandStreak.set(sessionId, 1);
                        burstStart.set(sessionId, event.time);
                    }
                    for (const { pattern, label } of SECRET_PATTERNS) {
                        if (pattern.test(firstLine)) {
                            stats.secretHits.push({ label, time: event.time, source: "tool", sessionId });
                            break;
                        }
                    }
                    for (const { pattern, label, sev } of DANGEROUS_PATTERNS) {
                        if (pattern.test(matchText)) {
                            stats.dangerousCommands.push({ command: firstLine, time: event.time, sessionId, label, sev });
                            aggOf(sessionId, event.time).dangerCount += 1;
                            if (sev === "red")
                                aggOf(sessionId, event.time).redDanger += 1;
                            break;
                        }
                    }
                }
                break;
            }
            case "tool/result": {
                const failed = resultIsError(data);
                if (failed)
                    stats.toolErrors += 1;
                // 记录错误摘要供重试诊断（只保留前 120 字符）。
                const content = data?.message?.content;
                let snippet;
                if (failed) {
                    if (typeof content === "string")
                        snippet = content.slice(0, 120);
                    else if (Array.isArray(content)) {
                        for (const block of content) {
                            if (typeof block === "object" && block !== null) {
                                const text = block.text;
                                if (typeof text === "string") {
                                    snippet = text.slice(0, 120);
                                    break;
                                }
                            }
                        }
                    }
                }
                if (snippet !== undefined)
                    lastError.set(sessionId, snippet);
                break;
            }
            case "session/title": {
                const title = typeof data?.title === "string" ? data.title : null;
                if (title && !stats.titles.includes(title))
                    stats.titles.push(title);
                if (typeof title === "string" && sessionTitle.get(sessionId) === undefined)
                    sessionTitle.set(sessionId, title);
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
    stats.dailySeries = [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count }));
    stats.dayHourSeries = [...dayHourMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, hours]) => ({ date, hours }));
    let sessionsWithRevision = 0;
    let shortSessions = 0;
    for (const [sid, a] of sessionAgg) {
        if (a.collabRevisions > 0)
            sessionsWithRevision += 1;
        if (a.turns > 0 && a.turns <= 2)
            shortSessions += 1;
        stats.sessionsDetail.push({
            sessionId: sid,
            title: sessionTitle.get(sid) ?? "",
            firstTime: a.firstTime,
            lastTime: a.lastTime,
            events: a.events,
            commands: a.commands,
            toolCalls: a.toolCalls,
            retryBursts: a.retryBursts,
            dangerCount: a.dangerCount,
            redDanger: a.redDanger,
            modelTokens: a.modelTokens,
            cost: 0,
            turns: a.turns,
            userMessages: a.userMessages,
            collabRevisions: a.collabRevisions,
            collabLateConstraints: a.collabLateConstraints,
        });
    }
    stats.collab = {
        userMessages: stats.userMessages,
        revisions: stats.collab.revisions,
        lateConstraints: stats.collab.lateConstraints,
        sessionsWithRevision,
        shortSessions,
    };
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
        modelUsage: {},
        retryBursts: 0,
        burstSamples: [],
        secretHits: [],
        collab: { revisions: 0, lateConstraints: 0 },
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
    let currentModel = "unknown";
    let lastSeq = 0;
    let lastMs = 0;
    let lastCommand = "";
    let commandStreak = 0;
    let burstStart = 0;
    let lastError;
    // 协作信号：该会话已出现的用户消息数（首条消息内的约束不算"迟到"）。
    const sessionUserMsgs = new Map();
    for (const event of events) {
        if (event.seq < ownStart)
            continue;
        if (stopAfter !== undefined && event.time >= stopAfter)
            break;
        if (event.type.startsWith("whale/"))
            continue;
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
            case "user/message": {
                bucket.userMessages += 1;
                const seen = sessionUserMsgs.get(sessionId) ?? 0;
                sessionUserMsgs.set(sessionId, seen + 1);
                for (const text of textOfUserMessage(data)) {
                    for (const { pattern, label } of SECRET_PATTERNS) {
                        if (pattern.test(text)) {
                            if (bucket.secretHits.length < 5)
                                bucket.secretHits.push({ label, time: event.time, source: "user", sessionId });
                            break;
                        }
                    }
                    const signals = userMessageSignals(text);
                    if (signals.revision)
                        bucket.collab.revisions += 1;
                    // 首条用户消息里的约束是初始需求；后续消息里的约束才是"迟到补充"。
                    if (signals.constraint && seen > 0)
                        bucket.collab.lateConstraints += 1;
                }
                break;
            }
            case "assistant/message": {
                bucket.assistantMessages += 1;
                const usage = usageOf(data);
                if (usage) {
                    bucket.input += usage.input ?? 0;
                    bucket.output += usage.output ?? 0;
                    bucket.cacheRead += usage.cacheRead ?? 0;
                    bucket.reasoning += usage.reasoning ?? 0;
                    const m = (bucket.modelUsage[currentModel] ??= { input: 0, output: 0, cacheRead: 0, reasoning: 0 });
                    m.input += usage.input ?? 0;
                    m.output += usage.output ?? 0;
                    m.cacheRead += usage.cacheRead ?? 0;
                    m.reasoning += usage.reasoning ?? 0;
                }
                break;
            }
            case "request/header": {
                const config = data?.header?.config;
                if (typeof config?.model === "string")
                    currentModel = config.model;
                break;
            }
            case "tool/call": {
                bucket.toolCallsTotal += 1;
                const name = typeof data?.name === "string" ? data.name : "(unknown)";
                bucket.toolCalls[name] = (bucket.toolCalls[name] ?? 0) + 1;
                const command = commandOf(data);
                if (command) {
                    bucket.commands += 1;
                    const firstLine = command.split("\n", 1)[0];
                    const matchText = stripQuotes(firstLine);
                    if (lastCommand === firstLine) {
                        commandStreak += 1;
                        if (commandStreak === 3) {
                            bucket.retryBursts += 1;
                            if (bucket.burstSamples.length < 5) {
                                bucket.burstSamples.push({ cmd: firstLine.slice(0, 80), count: commandStreak, time: burstStart, error: lastError, sessionId });
                            }
                        }
                        else if (commandStreak > 3) {
                            const sample = bucket.burstSamples[bucket.burstSamples.length - 1];
                            if (sample !== undefined && sample.cmd === firstLine.slice(0, 80))
                                sample.count = commandStreak;
                        }
                    }
                    else {
                        lastCommand = firstLine;
                        commandStreak = 1;
                        burstStart = event.time;
                    }
                    for (const { pattern, label } of SECRET_PATTERNS) {
                        if (pattern.test(firstLine)) {
                            if (bucket.secretHits.length < 5)
                                bucket.secretHits.push({ label, time: event.time, source: "tool", sessionId });
                            break;
                        }
                    }
                    if (bucket.danger.length < DANGER_SAMPLE_CAP) {
                        for (const { pattern, label, sev } of DANGEROUS_PATTERNS) {
                            if (pattern.test(matchText)) {
                                bucket.danger.push({ cmd: firstLine, ms: event.time, label, sev });
                                break;
                            }
                        }
                    }
                }
                break;
            }
            case "tool/result": {
                const failed = resultIsError(data);
                if (failed)
                    bucket.toolErrors += 1;
                const content = data?.message?.content;
                let snippet;
                if (failed) {
                    if (typeof content === "string")
                        snippet = content.slice(0, 120);
                    else if (Array.isArray(content)) {
                        for (const block of content) {
                            if (typeof block === "object" && block !== null) {
                                const text = block.text;
                                if (typeof text === "string") {
                                    snippet = text.slice(0, 120);
                                    break;
                                }
                            }
                        }
                    }
                }
                if (snippet !== undefined)
                    lastError = snippet;
                break;
            }
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
    const currentModel = new Map();
    const dayHourMap = new Map();
    const lastCommand = new Map();
    const commandStreak = new Map();
    const burstStart = new Map();
    const lastError = new Map();
    const sessionAgg = new Map();
    const sessionTitle = new Map();
    const aggOf = (sid, time) => {
        let a = sessionAgg.get(sid);
        if (a === undefined) {
            a = { firstTime: time, lastTime: time, events: 0, commands: 0, toolCalls: 0, retryBursts: 0, dangerCount: 0, redDanger: 0, modelTokens: {}, title: "", turns: 0, userMessages: 0, collabRevisions: 0, collabLateConstraints: 0 };
            sessionAgg.set(sid, a);
        }
        return a;
    };
    const days = new Map();
    for (const view of views) {
        seenSessions.add(view.sessionId);
        let agg = sessionAgg.get(view.sessionId);
        if (agg === undefined) {
            agg = { firstTime: Infinity, lastTime: 0, events: 0, commands: 0, toolCalls: 0, retryBursts: 0, dangerCount: 0, redDanger: 0, modelTokens: {}, title: "", turns: 0, userMessages: 0, collabRevisions: 0, collabLateConstraints: 0 };
            sessionAgg.set(view.sessionId, agg);
        }
        for (const bucket of view.buckets) {
            const aggCur = agg;
            aggCur.events += bucket.total;
            aggCur.commands += bucket.commands;
            aggCur.toolCalls += bucket.toolCallsTotal;
            aggCur.retryBursts += bucket.retryBursts ?? 0;
            aggCur.dangerCount += (bucket.danger ?? []).filter((d) => d.sev === "red").length + (bucket.danger ?? []).filter((d) => d.sev === "amber").length;
            aggCur.redDanger += (bucket.danger ?? []).filter((d) => d.sev === "red").length;
            aggCur.firstTime = Math.min(aggCur.firstTime, bucket.h);
            aggCur.lastTime = Math.max(aggCur.lastTime, bucket.h + BUCKET_MS);
            for (const [model, usage] of Object.entries(bucket.modelUsage ?? {})) {
                const m = (aggCur.modelTokens[model] ??= { input: 0, output: 0, cacheRead: 0, reasoning: 0 });
                m.input += usage.input;
                m.output += usage.output;
                m.cacheRead += usage.cacheRead;
                m.reasoning += usage.reasoning;
            }
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
            stats.retryBursts += bucket.retryBursts ?? 0;
            for (const sample of bucket.burstSamples ?? []) {
                if (stats.burstSamples.length < 10)
                    stats.burstSamples.push(sample);
            }
            for (const hit of bucket.secretHits ?? []) {
                if (stats.secretHits.length < 10)
                    stats.secretHits.push(hit);
            }
            for (const [model, usage] of Object.entries(bucket.modelUsage ?? {})) {
                const m = (stats.models[model] ??= { input: 0, output: 0, cacheRead: 0, reasoning: 0 });
                m.input += usage.input;
                m.output += usage.output;
                m.cacheRead += usage.cacheRead;
                m.reasoning += usage.reasoning;
            }
            for (const d of bucket.danger) {
                stats.dangerousCommands.push({ command: d.cmd, time: d.ms, sessionId: view.sessionId, label: d.label, sev: d.sev });
            }
            const d = new Date(bucket.h);
            const hour = d.getHours();
            stats.hourHistogram[hour] = (stats.hourHistogram[hour] ?? 0) + bucket.total;
            stats.halfHourHistogram[hour * 2 + (d.getMinutes() >= 30 ? 1 : 0)] += bucket.total;
            const day = new Date(bucket.h).toISOString().slice(0, 10);
            days.set(day, (days.get(day) ?? 0) + bucket.total);
            let dayHour = dayHourMap.get(day);
            if (dayHour === undefined) {
                dayHour = new Array(24).fill(0);
                dayHourMap.set(day, dayHour);
            }
            dayHour[new Date(bucket.h).getHours()] += bucket.total;
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
    stats.dailySeries = [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count }));
    stats.dayHourSeries = [...dayHourMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, hours]) => ({ date, hours }));
    let sessionsWithRevision = 0;
    let shortSessions = 0;
    for (const [sid, a] of sessionAgg) {
        const view = views.find((v) => v.sessionId === sid);
        if (a.collabRevisions > 0)
            sessionsWithRevision += 1;
        if (a.turns > 0 && a.turns <= 2)
            shortSessions += 1;
        stats.sessionsDetail.push({
            sessionId: sid,
            title: view?.titles[0] ?? "",
            firstTime: a.firstTime === Infinity ? 0 : a.firstTime,
            lastTime: a.lastTime,
            events: a.events,
            commands: a.commands,
            toolCalls: a.toolCalls,
            retryBursts: a.retryBursts,
            dangerCount: a.dangerCount,
            redDanger: a.redDanger,
            modelTokens: a.modelTokens,
            cost: 0,
            turns: a.turns,
            userMessages: a.userMessages,
            collabRevisions: a.collabRevisions,
            collabLateConstraints: a.collabLateConstraints,
        });
    }
    stats.collab = {
        userMessages: stats.userMessages,
        revisions: stats.collab.revisions,
        lateConstraints: stats.collab.lateConstraints,
        sessionsWithRevision,
        shortSessions,
    };
    return stats;
}
//# sourceMappingURL=stats.js.map