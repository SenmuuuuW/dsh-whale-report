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
export interface ModelUsage {
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
    /** 危险命令列表（带分类标签与严重级）。 */
    dangerousCommands: {
        command: string;
        time: number;
        sessionId: string;
        label: string;
        sev: DangerSeverity;
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
    /** 按模型分组的 token 用量（对齐 DS 开放平台"用量"页）。 */
    models: Record<string, ModelUsage>;
    /** 30 分钟粒度的活跃直方图（48 格，比 24 小时更密集）。 */
    halfHourHistogram: number[];
    /** 按日事件数序列（趋势图用）。 */
    dailySeries: {
        date: string;
        count: number;
    }[];
    /** 按日 × 24 小时的事件矩阵（GitHub 贡献图风格的活动图）。 */
    dayHourSeries: {
        date: string;
        hours: number[];
    }[];
    /** 重试风暴次数：同一命令连续重复 ≥3 次（洞察引擎用）。 */
    retryBursts: number;
}
/** 危险命令严重级：red = 致命级（可能造成不可逆破坏），amber = 需留意。 */
export type DangerSeverity = "red" | "amber";
/**
 * 危险命令特征（正则，匹配 bash 命令字符串）。红色规则排前面：
 * 命中即按该规则分级，所以"删除根目录"必须先于泛化的"rm -rf 删除"。
 */
export declare const DANGEROUS_PATTERNS: {
    pattern: RegExp;
    label: string;
    sev: DangerSeverity;
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
/** 一个时间分桶（10 分钟粒度）的计数。 */
export interface HourBucket {
    /** epoch 小时（毫秒，向下取整）。 */
    h: number;
    /** 该小时事件总数（含 chunk 类事件，只用于总量/活跃度）。 */
    total: number;
    turns: number;
    steps: number;
    userMessages: number;
    assistantMessages: number;
    input: number;
    output: number;
    cacheRead: number;
    reasoning: number;
    toolCallsTotal: number;
    toolCalls: Record<string, number>;
    toolErrors: number;
    commands: number;
    /** 危险命令样本（每会话保留上限，见 DANGER_SAMPLE_CAP），带分类标签与严重级。 */
    danger: {
        cmd: string;
        ms: number;
        label: string;
        sev: DangerSeverity;
    }[];
    /** 该分桶内按模型的 token 用量。 */
    modelUsage: Record<string, {
        input: number;
        output: number;
        cacheRead: number;
        reasoning: number;
    }>;
    /** 该分桶内重试风暴（连续相同命令 ≥3 次）的次数。 */
    retryBursts: number;
}
/** 分桶粒度：10 分钟（区间边界的裁剪误差 ≤ 2×10min/会话）。 */
export declare const BUCKET_MS: number;
/**
 * 把一个会话的原始事件折叠成小时分桶。
 * @param sessionId - 归属会话（危险命令归属用）。
 * @param events - 完整逻辑日志。
 * @param ownStart - seedLength：seq 小于它的继承事件不计入。
 * @param stopAfter - 可选：时间上限（ms），超过即停止（时间单调）。
 */
export declare function bucketizeOwnEvents(sessionId: string, events: {
    type: string;
    seq: number;
    time: number;
    data?: unknown;
}[], ownStart: number, stopAfter?: number): {
    buckets: HourBucket[];
    titles: string[];
    lastSeq: number;
    lastMs: number;
};
/** 索引聚合视图：一个会话的分桶 + 标题。 */
export interface SessionBucketView {
    sessionId: string;
    buckets: HourBucket[];
    titles: string[];
}
/** 把多个会话的分桶视图聚合成区间统计（与 aggregate 等价，但 O(分桶数)）。 */
export declare function aggregateBuckets(views: SessionBucketView[], period: Period, headers?: RawSessionHeader[]): ReportStats;
//# sourceMappingURL=stats.d.ts.map