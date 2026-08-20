/**
 * DeepTrace v0.5 — IMPROVE 引擎。
 *
 * Finding 回答"发生了什么异常"；Improve 回答"这个异常是否值得改变 Agent 的行为，以及怎么改"。
 *
 * 原则（与报告引擎一致）：
 * 1. 纯函数、零 IO、确定性 —— 同一输入永远产生同一输出与同一排序；
 * 2. Evidence 是第一等公民 —— 每条建议必须能回答"你为什么这么说"；
 * 3. 保守阈值 —— 没有跨 session 重复性 / 真实证据的不生成；
 * 4. Privacy-first —— correction 只存类别与计数，绝不保存用户原句；
 * 5. 0 EXTRA LLM TOKENS —— 全部规则都是可测试的白名单 / 正则 / 阈值。
 */
import type { ReportStats } from "./stats.js";
import type { CostBreakdown } from "./pricing.js";
export type ImprovementCategory = "TOOL" | "WORKFLOW" | "INSTRUCTION" | "MODEL" | "COST" | "RELIABILITY";
export type ImprovementSeverity = "HIGH" | "MEDIUM" | "LOW";
export type ImprovementStatus = "DETECTED" | "DISMISSED";
/** v0.5 只落 DETECTED / DISMISSED；其余为未来 Apply / self-healing 预留。 */
export type ImprovementVerdict = "IMPROVED" | "NO_CHANGE" | "REGRESSED" | "INSUFFICIENT_DATA";
export interface ImprovementEvidence {
    /** 关键数字（UI 强数字展示）：calls / failures / rate / sessions / bursts / avoidableCost ... */
    metrics: Record<string, number>;
    affectedTools: string[];
    /** 只存 sessionId（会话跳转用），不存任何原文。 */
    affectedSessions: string[];
    affectedModels: string[];
    affectedProviders: string[];
    /** 跨 session 重复数（recurrence）。 */
    occurrences: number;
    /** 0..1；确定性计算（规则固有 + 模式一致性），不是 LLM score。 */
    confidence: number;
    /** 实验性标记（如 RepeatedUserCorrection 首批为 EXPERIMENTAL）。 */
    experimental?: boolean;
}
/** VERIFY 预留：v0.5 只搭 schema 与展示，不做 Apply / before-after 伪造。 */
export interface VerificationPlan {
    targetMetric: string;
    baseline: number | null;
    target: string;
    window: string;
}
export interface Verification {
    improvementId: string;
    baselinePeriod: string;
    appliedAt?: number;
    verificationPeriod?: string;
    targetMetric: string;
    before: number | null;
    after: number | null;
    delta: number | null;
    deltaRatio: number | null;
    verdict: ImprovementVerdict;
}
export interface ImprovementItem {
    /** 稳定 id：跨周期同目标同 id（如 improve-tool-edit）。 */
    id: string;
    period: string;
    category: ImprovementCategory;
    severity: ImprovementSeverity;
    /** 中文主文案（一行）。 */
    title: string;
    /** 一句话摘要（发生了什么 → 为什么值得改）。 */
    summary: string;
    evidence: ImprovementEvidence;
    /** 具体、可执行的建议（固定模板，不空泛）。 */
    recommendation: string;
    verificationPlan: VerificationPlan;
    status: ImprovementStatus;
    createdAt: number;
}
export type CorrectionCategory = "COMMIT_CONTROL" | "REPO_SCOPE" | "UI_SCOPE" | "NO_EXTRA_CHANGES" | "NO_REPEAT_QUESTION" | "OUTPUT_FORMAT";
export declare const CORRECTION_CATEGORIES: CorrectionCategory[];
export declare const CORRECTION_LABEL: Record<CorrectionCategory, string>;
/** 归一化：lowercase → 去引号段 → 去数字/hash/路径（只用于匹配，不存储原文）。 */
export declare function normalizeCorrectionText(text: string): string;
/** 一条用户消息 → 命中的纠正类别（0..n；确定性白名单匹配）。 */
export declare function classifyCorrectionText(text: string): CorrectionCategory[];
/** 命令归一化（内部聚合键 / 展示用）：去引号段、去路径段、去数字，截断。 */
export declare function redactCommand(cmd: string): string;
/** 确定性排序：severity → score → occurrences → category → id。 */
export declare function rankImprovements(items: ImprovementItem[]): ImprovementItem[];
/** 工具健康门槛（复用 insights 校准值；Improve 再加跨 session 维度）。 */
export declare const IMPROVE_TOOL_MIN_CALLS = 30;
export declare const IMPROVE_TOOL_MIN_FAILED = 5;
export declare const IMPROVE_TOOL_MIN_FAILURE_RATE = 0.08;
export declare const IMPROVE_TOOL_MIN_SESSIONS = 3;
/** 主错误码占比门槛：单一错误码占失败 ≥40% 且 ≥5 次才算"重复根因"。 */
export declare const IMPROVE_MAIN_CODE_SHARE = 0.4;
export declare const IMPROVE_MAIN_CODE_MIN = 5;
/** Retry / Workflow Waste：同一命令在多会话中重复重试（确定性聚合；cmd 只做内部键）。 */
export interface BurstLike {
    cmd: string;
    count: number;
    error?: string;
    sessionId: string;
}
export declare const IMPROVE_BURST_MIN_SESSIONS = 2;
export declare const IMPROVE_BURST_MIN_TOTAL = 3;
/** Repeated User Correction（EXPERIMENTAL）：有限分类 + 会话级计数，不存原文。 */
export interface CorrectionAggregate {
    category: CorrectionCategory;
    sessions: number;
    count: number;
    sampleSessionIds: string[];
}
export declare const IMPROVE_CORRECTION_MIN_SESSIONS = 2;
/** Peak Cost Opportunity：只在有"可延迟负载"证据时提示（夜间活跃 = 非交互批量负载）。 */
export declare const IMPROVE_PEAK_MIN_SHARE = 3;
export declare const IMPROVE_PEAK_MIN_RATIO = 0.5;
export declare const IMPROVE_PEAK_MIN_NIGHT = 5;
export interface ImproveInput {
    stats: ReportStats;
    cost?: CostBreakdown;
    /** 周期 key（periodKey，如 wk-2026-W33）。 */
    period: string;
    /** 工具失败会话映射（stats.toolFailedSessions；缺省按空处理）。 */
    failedSessions?: Record<string, string[]>;
    /** 人工纠正聚合（stats.correctionSignals；缺省按空处理）。 */
    corrections?: CorrectionAggregate[];
    now?: number;
}
/** 计算全部 Improve（有界：规则保守，正常 0–5 条），按确定性排序。 */
export declare function computeImprovements(input: ImproveInput): ImprovementItem[];
//# sourceMappingURL=improvements.d.ts.map