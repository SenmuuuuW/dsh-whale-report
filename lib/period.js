/**
 * Period 单一真相源（v0.5.x architecture repair）。
 *
 * 所有窗口计算（API / summary / overview / cache / period_stats / report /
 * client metadata）只允许消费 PeriodSpec，禁止各自再算时间窗口。
 *
 * 关键语义：
 * - 24h = rolling 查询：from = now - 86400000, to = now；queryId 包含实际
 *   from/to（绝不使用自然日 identity）；不写自然周期 period_stats。
 * - daily = Asia/Shanghai 自然日；weekly = 本周一 00:00（本地时区）；monthly /
 *   yearly = 自然月 / 自然年；custom = 精确 from/to。
 */
import { shanghaiDateKey, shanghaiDayStart, shanghaiMonthKey, shanghaiMonthStart, shanghaiWeekKey, shanghaiWeekStart, shanghaiYearStart } from "./shanghai.js";
export const PERIOD_LABELS = {
    daily: "日报",
    "24h": "近 24 小时",
    weekly: "周报",
    monthly: "月报",
    yearly: "年报",
    custom: "自定义",
};
const DAY_MS = 24 * 60 * 60 * 1000;
function parseInput(value, fallback) {
    if (typeof value === "number")
        return value;
    if (typeof value === "string" && value !== "") {
        const ms = Date.parse(value);
        if (!Number.isNaN(ms))
            return ms;
    }
    return fallback;
}
/** 自然周期 key（daily/weekly/monthly/yearly）。24h/custom 无自然 key → null。 */
export function naturalPeriodKey(preset, toMs) {
    if (preset === "daily")
        return `day-${shanghaiDateKey(toMs)}`;
    if (preset === "weekly")
        return shanghaiWeekKey(toMs);
    if (preset === "monthly")
        return shanghaiMonthKey(toMs);
    if (preset === "yearly")
        return `yr-${shanghaiDateKey(toMs).slice(0, 4)}`;
    return null;
}
/** custom 精确 identity。 */
export function customPeriodKey(from, to) {
    return `custom-${from}-${to}`;
}
/** 24h rolling identity：绝不使用自然日 key。 */
export function rolling24hKey(from, to) {
    return `24h-${from}-${to}`;
}
/** 唯一窗口真相源。 */
export function resolvePeriod(opts) {
    const { preset, now } = opts;
    if (preset === "custom") {
        const from = parseInput(opts.from, now - 7 * DAY_MS);
        const to = parseInput(opts.to, now);
        if (to <= from)
            throw new Error("时间区间无效：to 必须晚于 from");
        return { preset, from, to, queryId: customPeriodKey(from, to), label: PERIOD_LABELS.custom, rolling: false };
    }
    if (preset === "24h") {
        const from = now - DAY_MS;
        const to = now;
        return { preset, from, to, queryId: rolling24hKey(from, to), label: PERIOD_LABELS["24h"], rolling: true };
    }
    let from;
    if (preset === "daily") {
        from = shanghaiDayStart(now);
    }
    else if (preset === "weekly") {
        from = shanghaiWeekStart(now);
    }
    else if (preset === "monthly") {
        from = shanghaiMonthStart(now);
    }
    else {
        from = shanghaiYearStart(now);
    }
    return {
        preset,
        from,
        to: now,
        queryId: naturalPeriodKey(preset, now) ?? `period-${preset}-${from}-${now}`,
        label: PERIOD_LABELS[preset],
        rolling: false,
    };
}
//# sourceMappingURL=period.js.map