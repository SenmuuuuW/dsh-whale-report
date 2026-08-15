/**
 * 洞察引擎：确定性规则把统计变成"可行动的卡片"。
 *
 * 设计原则：
 * 1. 不用 LLM —— 规则是纯函数，可测试、可复算、可对质；
 * 2. 每条洞察 = 发生了什么（数据）→ 建议怎么做（行动）→ 量化参考（诚实估算）；
 * 3. 阈值宁可保守：只有真实信号才触发，避免"狼来了"毁掉可信度。
 */
import type { ReportStats } from "./stats.js";
import type { PeriodStatsRecord } from "./state.js";
import type { CostBreakdown } from "./pricing.js";
export type InsightLevel = "info" | "tip" | "warning" | "critical";
export interface Insight {
    id: string;
    level: InsightLevel;
    title: string;
    detail: string;
    action: string;
    /** 量化收益（参考口径，明确标注估算）。 */
    estimate?: string;
}
export interface InsightInput {
    stats: ReportStats;
    prev?: PeriodStatsRecord;
    cost?: CostBreakdown;
}
/** 缓存命中率：缓存命中占输入+命中的比例。 */
export declare function cacheHitRate(stats: ReportStats): number;
/** 凌晨（0-6 点）事件占比。 */
export declare function nightRatio(stats: ReportStats): number;
/** 费用涨跌（相对上一周期），百分比。prev 缺失时返回 null。 */
export declare function costDeltaPct(input: InsightInput): number | null;
export declare function computeInsights(input: InsightInput): Insight[];
/** 周期 key：dy-YYYY-MM-DD / wk-YYYY-Www / mo-YYYY-MM / yr-YYYY（按"结束时刻"归属）。 */
/**
 * 周期 key（自然周期语义，前缀互不冲突）：
 *   day-YYYY-MM-DD  日报（自然日）
 *   24h-YYYY-MM-DD  滚动 24 小时（只存自身基线，不做"上一周期"对比）
 *   wk-YYYY-Www     周报（ISO 周）
 *   mo-YYYY-MM      月报
 *   yr-YYYY         年报
 */
export declare function periodKey(preset: string, toMs: number): string;
/** 上一周期 key。24h 为滚动窗口，没有干净的自然"上一周期"→ 返回 null（不对比）。 */
export declare function previousPeriodKey(preset: string, toMs: number): string | null;
/** 按工具调用数归族排序（面板与 markdown 共用）。 */
export declare function toolFamilies(toolCalls: Record<string, number>): {
    family: string;
    count: number;
}[];
//# sourceMappingURL=insights.d.ts.map