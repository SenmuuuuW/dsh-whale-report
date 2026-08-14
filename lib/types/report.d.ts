/**
 * 报告文案层：把统计数字变成"想发朋友圈"的中文报告。
 *
 * 文案是产品的一半。规则：
 * - 数字永远先说，金句永远在后；
 * - 危险命令原样列出（数据新闻官的可信度来自不美化）；
 * - 每个指标配一个"鲸鱼视角"的解读，而不是干巴巴的表格。
 */
import { type ReportStats } from "./stats.js";
export type ReportPreset = "daily" | "weekly" | "monthly" | "yearly" | "custom";
export declare const PRESET_LABELS: Record<ReportPreset, string>;
/** 预设区间 → [from, to) 毫秒。 */
export declare function presetRange(preset: ReportPreset, now: number): {
    from: number;
    to: number;
};
export declare function renderReport(stats: ReportStats, preset: ReportPreset): string;
//# sourceMappingURL=report.d.ts.map