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
/**
 * 长图导出：canvas 按面板报告同款视觉逐块绘制完整内容（零依赖、无 canvas 污染问题）。
 * - 内容与报告一致：报告头/鲸评/Findings/活跃+Token/模型与工具/风险扫描/会话轨迹/会话索引/页脚；
 * - 数据口径与面板同源（cacheRate/night/delta/费用占比/鲸评规则全部复用同一函数）；
 * - 高度：budgetExportHeight 随内容精确增长 + 绘制完成后按实际高度裁剪，任何周期都不裁切。
 */
/** 导出预算：逻辑高度（px）。与绘制使用同一组数据与行高常量，随内容单调增长。 */
export declare function budgetExportHeight(report: ReportFull): number;
/** 长图导出：与面板报告同视觉、同数据口径的完整 canvas 绘制。 */
export declare function exportReportImage(report: ReportFull): void;
/** 客户端 cordis 上下文的最小结构化视图（type-only，不引入运行时依赖）。 */
interface ClientContext {
    effect(execute: () => () => void): unknown;
    inject(names: string[], callback: (ctx: Record<string, unknown>) => void): unknown;
}
export declare function apply(ctx: ClientContext): void;
export {};
//# sourceMappingURL=index.d.ts.map