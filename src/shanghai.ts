/**
 * Asia/Shanghai（UTC+8，无 DST）时间语义工具（v0.5.x Phase 3）。
 * epoch ms 仍是底层时间；所有"小时/天/周/月/年"派生必须走这里，
 * 禁止使用机器本地时区的 getHours/getDay/setHours/toISOString 切片。
 */
export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 上海时刻所在自然日 00:00（UTC ms）。 */
export function shanghaiDayStart(ms: number): number {
  const shifted = ms + SHANGHAI_OFFSET_MS;
  return Math.floor(shifted / 86400000) * 86400000 - SHANGHAI_OFFSET_MS;
}

/** 上海日期 key（YYYY-MM-DD）。 */
export function shanghaiDateKey(ms: number): string {
  return new Date(shanghaiDayStart(ms) + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

/** 上海小时（0-23）。 */
export function shanghaiHour(ms: number): number {
  return (new Date(ms).getUTCHours() + 8) % 24;
}

/** 上海星期几（0=周日 … 6=周六；周一=1）。 */
export function shanghaiDayOfWeek(ms: number): number {
  return new Date(shanghaiDayStart(ms) + SHANGHAI_OFFSET_MS).getUTCDay();
}

/** 上海"本周一 00:00"（UTC ms）。 */
export function shanghaiWeekStart(ms: number): number {
  const dayStart = shanghaiDayStart(ms);
  const dow = shanghaiDayOfWeek(ms); // 0=Sun
  const sinceMonday = dow === 0 ? 6 : dow - 1;
  return dayStart - sinceMonday * 86400000;
}

/** 上海自然月 1 日 00:00（UTC ms）。 */
export function shanghaiMonthStart(ms: number): number {
  const d = new Date(shanghaiDayStart(ms) + SHANGHAI_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - SHANGHAI_OFFSET_MS;
}

/** 上海自然年 1 月 1 日 00:00（UTC ms）。 */
export function shanghaiYearStart(ms: number): number {
  const d = new Date(shanghaiDayStart(ms) + SHANGHAI_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), 0, 1) - SHANGHAI_OFFSET_MS;
}

/** 上海自然周 key（wk-YYYY-Wxx；与窗口同构，周一为起点）。 */
export function shanghaiWeekKey(ms: number): string {
  const monday = shanghaiWeekStart(ms) + SHANGHAI_OFFSET_MS;
  const d = new Date(monday);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.floor((monday - yearStart) / (7 * 86400000)) + 1;
  return `wk-${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** 上海自然月 key（mo-YYYY-MM）。 */
export function shanghaiMonthKey(ms: number): string {
  return `mo-${shanghaiDateKey(ms).slice(0, 7)}`;
}
