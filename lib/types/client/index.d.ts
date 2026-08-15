export declare const name = "whale-report-client";
export declare const inject: string[];
interface ReportMeta {
    id: string;
    preset: string;
    from: number;
    to: number;
    createdAt: number;
    sessions: number;
    turns: number;
    totalEvents: number;
}
interface InsightJson {
    id: string;
    level: "info" | "tip" | "warning" | "critical";
    title: string;
    detail: string;
    action: string;
    estimate?: string;
}
interface PrevSummary {
    key: string;
    cost: number;
    sessions: number;
    turns: number;
    cacheHitRate: number;
    nightRatio: number;
    dangerCount: number;
}
interface ReportFull extends ReportMeta {
    stats: StatsJson;
    markdown: string;
    cost?: {
        perModel: Record<string, number>;
        total: number;
        currency: string;
        source: string;
    };
    insights?: InsightJson[];
    prev?: PrevSummary;
}
interface StatsJson {
    period: {
        from: number;
        to: number;
    };
    sessions: number;
    subagentSessions: number;
    turns: number;
    steps: number;
    userMessages: number;
    assistantMessages: number;
    tokens: {
        input: number;
        output: number;
        cacheRead: number;
        reasoning: number;
    };
    toolCalls: Record<string, number>;
    toolCallsTotal: number;
    toolErrors: number;
    commands: number;
    dangerousCommands: {
        command: string;
        time: number;
        sessionId: string;
        label: string;
        sev: "red" | "amber";
    }[];
    hourHistogram: number[];
    activeDays: number;
    busiestDay: {
        date: string;
        events: number;
    } | null;
    titles: string[];
    totalEvents: number;
    models: Record<string, {
        input: number;
        output: number;
        cacheRead: number;
        reasoning: number;
    }>;
    halfHourHistogram: number[];
    dailySeries: {
        date: string;
        count: number;
    }[];
    dayHourSeries: {
        date: string;
        hours: number[];
    }[];
    retryBursts?: number;
    burstSamples?: {
        cmd: string;
        count: number;
        time: number;
        error?: string;
        sessionId?: string;
    }[];
    secretHits?: {
        label: string;
        time: number;
        source: string;
        sessionId?: string;
    }[];
    plugins?: string[];
    sessionsDetail?: {
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
        cost: number;
        modelTokens?: Record<string, {
            input: number;
            output: number;
            cacheRead: number;
            reasoning: number;
        }>;
    }[];
}
/** 长图导出：canvas 绘制报告为 PNG（零依赖）。 */
export declare function exportReportImage(report: ReportFull): void;
/** 客户端 cordis 上下文的最小结构化视图（type-only，不引入运行时依赖）。 */
interface ClientContext {
    effect(execute: () => () => void): unknown;
    inject(names: string[], callback: (ctx: Record<string, unknown>) => void): unknown;
}
export declare function apply(ctx: ClientContext): void;
export {};
//# sourceMappingURL=index.d.ts.map