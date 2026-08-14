/**
 * 报告文案层：把统计数字变成干净、写实的 markdown 报告。
 *
 * 文案规则：数字先说、事实直陈、不加装饰。
 */
import { type ReportStats } from "./stats.js";
import type { CostBreakdown } from "./pricing.js";
import { type Insight } from "./insights.js";
import type { PeriodStatsRecord } from "./state.js";
export type ReportPreset = "daily" | "weekly" | "monthly" | "yearly" | "custom";
export declare const PRESET_LABELS: Record<ReportPreset, string>;
/** 预设区间 → [from, to) 毫秒。 */
export declare function presetRange(preset: ReportPreset, now: number): {
    from: number;
    to: number;
};
export declare function renderReport(stats: ReportStats, preset: ReportPreset, cost?: CostBreakdown, prev?: PeriodStatsRecord | null, insights?: Insight[]): string;
//# sourceMappingURL=report.d.ts.map