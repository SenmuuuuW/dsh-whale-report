export type PeriodPreset = "daily" | "24h" | "weekly" | "monthly" | "yearly" | "custom";
export interface PeriodSpec {
    preset: PeriodPreset;
    from: number;
    to: number;
    /** 本次精确查询身份：包含实际 from/to（24h/custom 的 rolling identity）。 */
    queryId: string;
    /** 用户可见标签。 */
    label: string;
    /** rolling 窗口（24h）为 true；有自然"上一周期"的为 false。 */
    rolling: boolean;
}
export declare const PERIOD_LABELS: Record<PeriodPreset, string>;
/** 自然周期 key（daily/weekly/monthly/yearly）。24h/custom 无自然 key → null。 */
export declare function naturalPeriodKey(preset: PeriodPreset, toMs: number): string | null;
/** custom 精确 identity。 */
export declare function customPeriodKey(from: number, to: number): string;
/** 24h rolling identity：绝不使用自然日 key。 */
export declare function rolling24hKey(from: number, to: number): string;
/** 唯一窗口真相源。 */
export declare function resolvePeriod(opts: {
    preset: PeriodPreset;
    now: number;
    from?: string | number;
    to?: string | number;
}): PeriodSpec;
//# sourceMappingURL=period.d.ts.map