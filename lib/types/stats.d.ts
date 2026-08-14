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
/** 一行原始会话事件的宽松形态（插件只关心这几个字段）。 */
export interface RawEvent {
    type: string;
    /** Unix epoch 毫秒。 */
    time: number;
    /** 事件载荷，形状随 type 不同。 */
    data?: unknown;
}
/** 一个会话的头部信息（session.jsonl 第一行）。 */
export interface RawSessionHeader {
    id: string;
    createdAt: number;
    cwd?: string;
    delegationDepth?: number;
}
/** 时间段。 */
export interface Period {
    from: number;
    to: number;
}
export interface TokenTotals {
    input: number;
    output: number;
    cacheRead: number;
    reasoning: number;
}
export interface ReportStats {
    period: Period;
    /** 覆盖的会话数（区间内有过事件的 session）。 */
    sessions: number;
    /** 子代理会话数（delegationDepth >= 1 的 header）。 */
    subagentSessions: number;
    turns: number;
    steps: number;
    userMessages: number;
    assistantMessages: number;
    tokens: TokenTotals;
    /** 各工具被调用次数。 */
    toolCalls: Record<string, number>;
    toolCallsTotal: number;
    /** tool/result 里的失败次数。 */
    toolErrors: number;
    /** bash 命令总数。 */
    commands: number;
    /** 危险命令列表（最刺激的部分）。 */
    dangerousCommands: {
        command: string;
        time: number;
        sessionId: string;
    }[];
    /** 24 小时直方图：凌晨 0 点到 23 点各有多少条事件。 */
    hourHistogram: number[];
    /** 有事件的天数。 */
    activeDays: number;
    /** 事件最多的一天。 */
    busiestDay: {
        date: string;
        events: number;
    } | null;
    /** 会话标题（session/title 事件里捞）。 */
    titles: string[];
    /** 区间内总事件数。 */
    totalEvents: number;
}
/** 危险命令特征（正则，匹配 bash 命令字符串）。 */
export declare const DANGEROUS_PATTERNS: {
    pattern: RegExp;
    label: string;
}[];
export declare function emptyStats(period: Period): ReportStats;
/**
 * 聚合一个时间区间内的事件。
 * @param events - 任意顺序的原始事件（可以是多个 session 拼起来的）。
 * @param period - 时间区间（半开区间 [from, to)）。
 * @param headers - 可选：session 头部（按 id 匹配，用于统计子代理会话）。
 */
export declare function aggregate(events: RawEvent[], period: Period, headers?: RawSessionHeader[]): ReportStats;
/** 凌晨（0-6 点）事件占比 —— "熬夜指数"。 */
export declare function nightOwlIndex(stats: ReportStats): number;
/** 把 token 数转成人类可读文本。 */
export declare function formatTokens(n: number): string;
/** 人类可读的时间跨度。 */
export declare function formatSpan(from: number, to: number): string;
//# sourceMappingURL=stats.d.ts.map