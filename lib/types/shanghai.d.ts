/**
 * Asia/Shanghai（UTC+8，无 DST）时间语义工具（v0.5.x Phase 3）。
 * epoch ms 仍是底层时间；所有"小时/天/周/月/年"派生必须走这里，
 * 禁止使用机器本地时区的 getHours/getDay/setHours/toISOString 切片。
 */
export declare const SHANGHAI_OFFSET_MS: number;
/** 上海时刻所在自然日 00:00（UTC ms）。 */
export declare function shanghaiDayStart(ms: number): number;
/** 上海日期 key（YYYY-MM-DD）。 */
export declare function shanghaiDateKey(ms: number): string;
/** 上海小时（0-23）。 */
export declare function shanghaiHour(ms: number): number;
/** 上海星期几（0=周日 … 6=周六；周一=1）。 */
export declare function shanghaiDayOfWeek(ms: number): number;
/** 上海"本周一 00:00"（UTC ms）。 */
export declare function shanghaiWeekStart(ms: number): number;
/** 上海自然月 1 日 00:00（UTC ms）。 */
export declare function shanghaiMonthStart(ms: number): number;
/** 上海自然年 1 月 1 日 00:00（UTC ms）。 */
export declare function shanghaiYearStart(ms: number): number;
/** 上海自然周 key（wk-YYYY-Wxx；与窗口同构，周一为起点）。 */
export declare function shanghaiWeekKey(ms: number): string;
/** 上海自然月 key（mo-YYYY-MM）。 */
export declare function shanghaiMonthKey(ms: number): string;
//# sourceMappingURL=shanghai.d.ts.map