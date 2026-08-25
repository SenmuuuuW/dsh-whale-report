/**
 * 「深迹 DeepTrace」客户端 half。
 *
 * 呈现形态两级：
 * 1. Tab 优先 —— 若装了 DSH-better-sidebar（ctx.betterSidebar 服务存在），
 *    就往它的工作台注册一个「深迹」Tab，报告面板成为侧栏的
 *    原生一员（第三方扩展的官方接缝 registerTab）。
 * 2. 悬浮球兜底 —— 没有 better-sidebar 时，右下角入口按钮 + 抽屉面板。
 *
 * 数据不经过聊天：面板直接 fetch /whale/api（宿主 half 的围栏路由）。
 * 客户端插件通过 window.__ModuleLoader__.load({id, factory}) 注册，
 * cordis 客户端内核负责装配；betterSidebar 服务用惰性注入消费
 * （服务缺失只跳过回调，绝不阻塞装配 —— 与宿主 half 的兼容策略一致）。
 */
import { Component, type ReactNode } from "react";
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
/** Improve 建议（v0.5；服务端确定性规则，旧报告可缺省）。 */
interface ImprovementJson {
    id: string;
    period: string;
    category: string;
    severity: "HIGH" | "MEDIUM" | "LOW";
    title: string;
    summary: string;
    evidence: {
        metrics: Record<string, number>;
        affectedTools: string[];
        affectedSessions: string[];
        affectedModels: string[];
        affectedProviders: string[];
        occurrences: number;
        confidence: number;
        experimental?: boolean;
    };
    recommendation: string;
    verificationPlan: {
        targetMetric: string;
        baseline: number | null;
        target: string;
        window: string;
    };
    status: string;
    createdAt: number;
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
        peakRatio?: number;
        peakShare?: number;
    };
    insights?: InsightJson[];
    improvements?: ImprovementJson[];
    prev?: PrevSummary;
    reportGeneration?: {
        mode: "local" | "model";
        inputTokens: number;
        outputTokens: number;
        cacheTokens: number;
        totalTokens: number;
        estimatedCostCny: number;
        model?: string;
    };
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
    collab?: {
        userMessages: number;
        revisions: number;
        lateConstraints: number;
        sessionsWithRevision: number;
        shortSessions: number;
    };
    dayHourDetail?: {
        date: string;
        hours: {
            tokens: number;
            sessions: number;
            turns: number;
            toolCalls: number;
            modelTokens: Record<string, {
                input: number;
                output: number;
                cacheRead: number;
                reasoning: number;
            }>;
            cost: number;
        }[];
    }[];
    toolHealth?: {
        name: string;
        calls: number;
        completed: number;
        failed: number;
        incomplete: number;
        successRate: number;
        failureRate: number;
        avgDurationMs: number;
        p50DurationMs: number;
        p95DurationMs: number;
        errorCodes: Record<string, number>;
    }[];
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
    /** 数据完整性（fault isolation）：损坏/读取失败被跳过的会话；缺失 ≠ 0。 */
    partial?: {
        skippedSessionIds: string[];
        skippedCount: number;
        reasons: string[];
        /** P0 salvage：官方读取器拒读但已只读恢复的会话。 */
        salvage?: {
            recoveredSessions: number;
            recoveredRecords: number;
            droppedRecords: number;
        };
    };
}
declare const PRESETS: readonly [{
    readonly key: "daily";
    readonly label: "日报";
}, {
    readonly key: "24h";
    readonly label: "24小时";
}, {
    readonly key: "weekly";
    readonly label: "周报";
}, {
    readonly key: "monthly";
    readonly label: "月报";
}, {
    readonly key: "yearly";
    readonly label: "年报";
}, {
    readonly key: "custom";
    readonly label: "自定义";
}];
/** 模型用量表（对齐 DS 开放平台用量页的展示习惯）。 */
/** 工具健康确定性排序：异常工具（失败明显）优先，健康工具按调用次数。 */
export declare function sortToolHealth(health: NonNullable<StatsJson["toolHealth"]>): {
    tool: NonNullable<StatsJson["toolHealth"]>[number];
    abnormal: boolean;
}[];
interface ContentState {
    toast: string | null;
    view: "dashboard" | "report" | "history";
    preset: (typeof PRESETS)[number]["key"];
    from: string;
    to: string;
    loading: boolean;
    error: string | null;
    dashboard: ReportFull | null;
    current: ReportFull | null;
    history: ReportMeta[] | null;
}
export declare class WhaleContent extends Component<Record<string, never>, ContentState> {
    state: ContentState;
    requestSeq: number;
    requestAbort: AbortController | null;
    customDebounce: number | undefined;
    componentDidMount(): void;
    setToast(message: string): void;
    /** 仪表盘：当前周期数据（有则复用，无则生成）。preset 显式传入，避免 setState 异步竞态。
     * 韧性（v0.5.1）：超时预算 + finally 兜底 + 竞态门 + 旧请求 abort；
     * stale-while-refresh —— 失败时保留上次数据，仅提示 + 重试，骨架屏只在无缓存数据时出现。 */
    loadDashboard(preset: ContentState["preset"]): Promise<void>;
    loadHistory(): Promise<void>;
    openHistory(id: string): Promise<void>;
    deleteReport(id: string): Promise<void>;
    render(): ReactNode;
}
/** 周期短标签：wk-2026-W33 → W33；day-2026-08-16 → 08/16；mo-2026-06 → 2026-06；yr-2026 → 2026。 */
export declare function periodShortLabel(key: string): string;
/**
 * 长图导出：canvas 按面板报告同款视觉逐块绘制完整内容（零依赖、无 canvas 污染问题）。
 * - 内容与报告一致：报告头/鲸评/Findings/活跃+Token/模型与工具/风险扫描/会话轨迹/会话索引/页脚；
 * - 数据口径与面板同源（cacheRate/night/delta/费用占比/鲸评规则全部复用同一函数）；
 * - 高度：budgetExportHeight 随内容精确增长 + 绘制完成后按实际高度裁剪，任何周期都不裁切。
 */
/** 导出模式：main = 主报告（不含会话轨迹/索引）；trace = 单独导出会话轨迹+会话索引。 */
export type ExportSections = "main" | "trace";
/** 导出预算：逻辑高度（px）。与绘制使用同一组数据与行高常量，随内容单调增长。 */
export declare function budgetExportHeight(report: ReportFull, sections?: ExportSections): number;
/** 长图导出：main = 主报告（报告头/鲸评/Findings/活跃/模型工具/风险，不含会话轨迹与索引）；
 *  trace = 单独导出会话轨迹 + 会话索引。鲸鱼娘与报告面板一致（真实素材，png→svg 回退，缺图才手绘）。 */
export declare function exportReportImage(report: ReportFull, sections?: ExportSections): Promise<void>;
/** 客户端 cordis 上下文的最小结构化视图（type-only，不引入运行时依赖）。 */
interface ClientContext {
    effect(execute: () => () => void): unknown;
    inject(names: string[], callback: (ctx: Record<string, unknown>) => void): unknown;
}
export declare function apply(ctx: ClientContext): void;
export {};
//# sourceMappingURL=index.d.ts.map