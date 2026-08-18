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
/** 会话级钻取明细（按费用排序，最多保留若干条）。 */
export interface SessionDetail {
    sessionId: string;
    title: string;
    firstTime: number;
    lastTime: number;
    events: number;
    commands: number;
    toolCalls: number;
    retryBursts: number;
    dangerCount: number;
    redDanger: number;
    /** 该会话内按模型的 token 用量。 */
    modelTokens: Record<string, ModelUsage>;
    /** 折算费用（CNY；生成管线填充）。 */
    cost: number;
    /** 回合数（协作复盘用）。 */
    turns: number;
    /** 用户消息数（协作复盘用）。 */
    userMessages: number;
    /** 方向修正信号（协作复盘用）。 */
    collabRevisions: number;
    /** 迟到约束信号（协作复盘用）。 */
    collabLateConstraints: number;
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
    /** 重试风暴样本（只读诊断用）：命令首行 + 次数 + 最近一次错误摘要。 */
    burstSamples: {
        cmd: string;
        count: number;
        time: number;
        error?: string;
        sessionId: string;
    }[];
    /** 疑似密钥/令牌命中（只存标签与时间，不存原文）。 */
    secretHits: {
        label: string;
        time: number;
        source: "user" | "tool";
        sessionId: string;
    }[];
    /** 会话级钻取明细（按费用排序，生成管线填充 cost）。 */
    sessionsDetail: SessionDetail[];
    /** 协作信号（协作复盘用；确定性规则，不改任何既有口径）。 */
    collab: CollabSignals;
    /** 工具健康（按工具名聚合；确定性配对 call→result）。 */
    toolHealth: ToolHealth[];
    /** 小时级活跃明细（tooltip 用；与 dayHourSeries 同日期集）。 */
    dayHourDetail: HourlyDetail[];
}
/** 疑似密钥/令牌模式（只做存在性检测，从不存储命中原文）。 */
export declare const SECRET_PATTERNS: {
    pattern: RegExp;
    label: string;
}[];
export interface UserMessageSignals {
    /** 方向修正 / 需求反复信号（推翻、换一个、再改……）。 */
    revision: boolean;
    /** 新约束补充信号（执行中途追加的强约束性要求）。 */
    constraint: boolean;
}
export declare function userMessageSignals(text: string): UserMessageSignals;
/** 小时级活跃明细（历史趋势/活跃扫描 tooltip 用；周期聚合阶段准备，无 hover IO）。 */
export interface HourlyDetail {
    date: string;
    hours: {
        /** input + output + cacheRead + reasoning。 */
        tokens: number;
        /** 该小时有事件的会话数。 */
        sessions: number;
        turns: number;
        toolCalls: number;
        /** 该小时按模型的 token 用量（生成管线据此折算精确费用）。 */
        modelTokens: Record<string, ModelUsage>;
        /** 该小时费用（CNY；生成管线按模型单价折算）。 */
        cost: number;
    }[];
}
/**
 * 活跃度分级（基于小时 tokens 的固定 log 阈值，全周期可比、跨周可比）：
 * level 0 无活动；1 低（<1M）；2 中低（1M–10M）；3 中（10M–30M）；
 * 4 高（30M–80M）；5 非常高（≥80M）。
 * 阈值由真实周报数据校准（p50≈16.8M、p90≈40.6M、max≈59.7M），
 * 避免"今天只跑一点点也最深色"的相对归一问题。
 */
export declare function activityLevel(tokens: number): number;
/** 工具健康（Tool Health）：按工具名聚合的确定性统计。 */
export interface ToolHealth {
    name: string;
    calls: number;
    completed: number;
    failed: number;
    incomplete: number;
    /** 0..1；calls 为 0 时记 0。 */
    successRate: number;
    /** 0..1。 */
    failureRate: number;
    /** 平均耗时 ms（仅配对成功的 call→result）。 */
    avgDurationMs: number;
    p50DurationMs: number;
    p95DurationMs: number;
    /** 失败原因分布（只存 error code 枚举，不存 error body）。 */
    errorCodes: Record<string, number>;
}
/** 工具健康内部聚合态（统计过程用）。 */
interface ToolHealthAcc {
    name: string;
    calls: number;
    completed: number;
    failed: number;
    incomplete: number;
    durations: number[];
    errorCodes: Record<string, number>;
}
/** 把内部聚合态固化为报告结构（确定性；排序由调用方决定）。 */
export declare function finalizeToolHealth(acc: ToolHealthAcc): ToolHealth;
/** 全量固化：按名称排序保证确定性（展示层再按关注度排序）。 */
export declare function finalizeAllToolHealth(accs: Map<string, ToolHealthAcc>): ToolHealth[];
/** 小时级明细组装：date 分组 → 固定 24 小时数组（空小时补零）。 */
export declare function assembleHourDetail(raw: Map<string, {
    tokens: number;
    turns: number;
    toolCalls: number;
    modelTokens: Record<string, ModelUsage>;
    sessions: Set<string>;
}>): HourlyDetail[];
/** 协作信号聚合（报告级）。 */
export interface CollabSignals {
    /** 用户消息总数。 */
    userMessages: number;
    /** 方向修正信号总数。 */
    revisions: number;
    /** 迟到约束信号总数（首条用户消息之后的约束性补充）。 */
    lateConstraints: number;
    /** 出现过 ≥1 次方向修正的会话数。 */
    sessionsWithRevision: number;
    /** 短会话数（≤2 回合）。 */
    shortSessions: number;
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
 * provider 归一化与别名映射。
 *
 * 归一化：trim + lowercase（OpenCode-Go / OPENCODE-GO → opencode-go）。
 * 别名：默认**不做任何假设**（不含 deepseek-modlens 等本机环境）；
 * 由用户通过环境变量 `WHALE_PROVIDER_ALIASES`（逗号分隔的 provider 列表）
 * 显式声明哪些包装 provider 应归一到 opencode-go。模块加载时读取一次。
 */
export declare function normalizeProvider(value: string): string;
/** 从 request/header 事件里尽量识别 provider；识别不到返回 unknown。 */
export declare function providerOf(data: unknown): string;
/** 模型统计键：优先带上 provider，方便区分官方与 opencode-go 订阅。 */
export declare function modelKey(provider: string, model: string): string;
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
    /** 重试风暴样本（会话级，上限 5）。 */
    burstSamples: {
        cmd: string;
        count: number;
        time: number;
        error?: string;
        sessionId: string;
    }[];
    /** 疑似密钥命中（只存标签与时间）。 */
    secretHits: {
        label: string;
        time: number;
        source: "user" | "tool";
        sessionId: string;
    }[];
    /** 协作信号（确定性词表检测；协作复盘用）。 */
    collab: {
        revisions: number;
        lateConstraints: number;
    };
    /** 工具健康聚合（确定性配对；跨桶配对在 bucketize 会话级 pending 中完成）。 */
    toolHealth: Record<string, ToolHealthAcc>;
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
export {};
//# sourceMappingURL=stats.d.ts.map