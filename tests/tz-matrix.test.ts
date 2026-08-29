/**
 * v0.5.x Phase 3 — Asia/Shanghai 时间口径矩阵。
 * 同一 fixture 在 TZ=UTC / Asia/Shanghai / America/New_York 下运行，
 * 以下结果必须完全一致（断言为固定期望值，与时区无关）：
 * daily / 24h / weekly / monthly / yearly 窗口、hourHistogram、dayHourDetail、
 * nightRatio、cost。
 * 运行方式：`TZ=UTC pnpm vitest run tests/tz-matrix.test.ts`（×3）。
 */
import { describe, expect, it } from "vitest";
import { aggregateBuckets, bucketizeOwnEvents, emptyPartial } from "../src/stats.js";
import { nightRatio } from "../src/insights.js";
import { resolvePeriod } from "../src/period.js";
import { pricingTierForTime, modelTier, PEAK_PRICES, OFFPEAK_PRICES } from "../src/pricing.js";
import { shanghaiHourStartOf } from "../src/shanghai.js";

// T = 2026-08-27T12:00:00+08:00（epoch 固定）
const T = Date.parse("2026-08-27T12:00:00+08:00");

interface Ev {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
}

/** 固定 fixture：5 个时间点（跨 CST 日界/峰谷时段/周末新规边界）的确定性用量。 */
function fixture(): Ev[] {
  const events: Ev[] = [];
  let seq = 0;
  // 2026-08-27 03:00 CST（= 08-26T19:00Z，凌晨 offpeak）
  const t1 = Date.parse("2026-08-27T03:00:00+08:00");
  // 2026-08-27 10:00 CST（peak 时段，周三）
  const t2 = Date.parse("2026-08-27T10:00:00+08:00");
  // 2026-08-27 15:00 CST（peak 时段，周三）
  const t3 = Date.parse("2026-08-27T15:00:00+08:00");
  // 2026-08-26 23:00 CST（昨日 23 点，offpeak）
  const t0 = Date.parse("2026-08-26T23:00:00+08:00");
  // 2026-08-23 10:00 CST（周日，周末全天谷时新规 → offpeak；旧规则会误判为 peak）
  const t4 = Date.parse("2026-08-23T10:00:00+08:00");
  for (const [t, input] of [
    [t0, 100_000],
    [t1, 200_000],
    [t2, 300_000],
    [t3, 400_000],
    [t4, 500_000],
  ] as const) {
    events.push({ type: "turn/start", seq: seq++, time: t, data: {} });
    events.push({ type: "assistant/message", seq: seq++, time: t, data: { usage: { inputTokens: input, outputTokens: 1000, cacheReadTokens: 500, reasoningTokens: 50 } } });
  }
  return events;
}

/** query engine 聚合 + 计价（生产同口径）。 */
function computeAll(): {
  daily: { from: number; to: number };
  h24: { from: number; to: number };
  weekly: { from: number; to: number };
  monthly: { from: number; to: number };
  yearly: { from: number; to: number };
  hourHistogram: number[];
  dayHourDetail: { date: string; hours: { tokens: number }[] }[];
  night: number;
  cost: number;
} {
  const events = fixture();
  const daily = resolvePeriod({ preset: "daily", now: T });
  const h24 = resolvePeriod({ preset: "24h", now: T });
  const weekly = resolvePeriod({ preset: "weekly", now: T });
  const monthly = resolvePeriod({ preset: "monthly", now: T });
  const yearly = resolvePeriod({ preset: "yearly", now: T });
  const built = bucketizeOwnEvents("s-tz", events, 0);
  const stats = aggregateBuckets([{ sessionId: "s-tz", buckets: built.buckets, titles: [] }], { from: yearly.from, to: yearly.to }, [], emptyPartial());
  let cost = 0;
  for (const day of stats.dayHourDetail) {
    for (let hour = 0; hour < 24; hour++) {
      const h = day.hours[hour];
      const priceSet = pricingTierForTime(shanghaiHourStartOf(day.date, hour)) === "peak" ? PEAK_PRICES : OFFPEAK_PRICES;
      for (const [model, usage] of Object.entries(h.modelTokens)) {
        const price = priceSet[modelTier(model)];
        cost += (usage.input / 1e6) * price.inputPerMillion + (usage.cacheRead / 1e6) * price.cacheReadPerMillion + (usage.output / 1e6) * price.outputPerMillion;
      }
    }
  }
  return {
    daily: { from: daily.from, to: daily.to },
    h24: { from: h24.from, to: h24.to },
    weekly: { from: weekly.from, to: weekly.to },
    monthly: { from: monthly.from, to: monthly.to },
    yearly: { from: yearly.from, to: yearly.to },
    hourHistogram: stats.hourHistogram.slice(),
    dayHourDetail: stats.dayHourDetail.map((d) => ({ date: d.date, hours: d.hours.map((h) => ({ tokens: h.tokens })) })),
    night: nightRatio(stats),
    cost,
  };
}

describe("Asia/Shanghai 时间口径矩阵（TZ 无关）", () => {
  it("窗口边界固定（CST 语义）", () => {
    const r = computeAll();
    // daily from = 2026-08-27 00:00 CST
    expect(r.daily.from).toBe(Date.parse("2026-08-26T16:00:00Z"));
    expect(r.daily.to).toBe(T);
    // 24h rolling
    expect(r.h24.from).toBe(T - 86400000);
    // weekly from = 本周一 2026-08-24 00:00 CST
    expect(r.weekly.from).toBe(Date.parse("2026-08-23T16:00:00Z"));
    // monthly from = 2026-08-01 00:00 CST
    expect(r.monthly.from).toBe(Date.parse("2026-07-31T16:00:00Z"));
    // yearly from = 2026-01-01 00:00 CST
    expect(r.yearly.from).toBe(Date.parse("2025-12-31T16:00:00Z"));
  });

  it("hourHistogram 固定（CST 小时桶）", () => {
    const r = computeAll();
    // T 之前的 4 个时间点（23:00 / 03:00 / 10:00 / 周日 10:00 CST），每个 2 个事件（turn + assistant）
    expect(r.hourHistogram[23]).toBe(2);
    expect(r.hourHistogram[3]).toBe(2);
    expect(r.hourHistogram[10]).toBe(4);
    // 15:00 CST 在 T 之后 → 窗口正确排除
    expect(r.hourHistogram[15]).toBe(0);
    const sum = r.hourHistogram.reduce((a, b) => a + b, 0);
    expect(sum).toBe(8);
  });

  it("dayHourDetail 固定（CST 日期 + 小时）", () => {
    const r = computeAll();
    // 23:00 CST 属于 08-26；10:00/03:00 属于 08-27；周日 10:00 属于 08-23
    const d26 = r.dayHourDetail.find((d) => d.date === "2026-08-26");
    const d27 = r.dayHourDetail.find((d) => d.date === "2026-08-27");
    const d23 = r.dayHourDetail.find((d) => d.date === "2026-08-23");
    expect(d26).toBeDefined();
    expect(d27).toBeDefined();
    expect(d23).toBeDefined();
    expect(d26!.hours[23].tokens).toBeGreaterThan(0);
    expect(d27!.hours[3].tokens).toBeGreaterThan(0);
    expect(d27!.hours[10].tokens).toBeGreaterThan(0);
    expect(d23!.hours[10].tokens).toBeGreaterThan(0);
    // 15:00 CST 事件在窗口外 → 0（正确排除）
    expect(d27!.hours[15].tokens).toBe(0);
  });

  it("nightRatio 固定（0-6 点 CST 占比）", () => {
    const r = computeAll();
    // 8 个事件中 2 个在 03:00 CST（0-6 点）→ 25%
    expect(Math.abs(r.night - 25)).toBeLessThan(1);
  });

  it("cost 固定（峰谷按 CST 日期+时段，周末新规 TZ 无关）", () => {
    const r = computeAll();
    // 10:00 CST（周三）是 peak（2 倍价）；23:00/03:00 与 周日 10:00（新规）offpeak
    // T 之前 4 个时间点：周三 10:00 peak；23:00/03:00 offpeak；周日 10:00 offpeak（15:00 在窗口外）
    const peak = (input: number) =>
      (input / 1e6) * PEAK_PRICES.flash.inputPerMillion + (1000 / 1e6) * PEAK_PRICES.flash.outputPerMillion + (500 / 1e6) * PEAK_PRICES.flash.cacheReadPerMillion;
    const off = (input: number) =>
      (input / 1e6) * OFFPEAK_PRICES.flash.inputPerMillion + (1000 / 1e6) * OFFPEAK_PRICES.flash.outputPerMillion + (500 / 1e6) * OFFPEAK_PRICES.flash.cacheReadPerMillion;
    const expectCost = peak(300_000) + off(100_000) + off(200_000) + off(500_000);
    expect(Math.abs(r.cost - expectCost)).toBeLessThan(0.001);
  });

  it("pricingTierForTime 固定（周末新规，TZ 无关）", () => {
    expect(pricingTierForTime(Date.parse("2026-08-29T10:00:00+08:00"))).toBe("offpeak"); // 周六 10:00
    expect(pricingTierForTime(Date.parse("2026-08-29T15:00:00+08:00"))).toBe("offpeak"); // 周六 15:00
    expect(pricingTierForTime(Date.parse("2026-08-30T10:00:00+08:00"))).toBe("offpeak"); // 周日 10:00
    expect(pricingTierForTime(Date.parse("2026-08-27T10:00:00+08:00"))).toBe("peak");    // 周三 10:00
    expect(pricingTierForTime(Date.parse("2026-08-27T13:00:00+08:00"))).toBe("offpeak"); // 周三 13:00
    expect(pricingTierForTime(Date.parse("2026-08-22T10:00:00+08:00"))).toBe("peak");    // 生效前周六 10:00（旧规则）
  });

  it("24h != weekly 窗口（真实不同）", () => {
    const r = computeAll();
    expect(r.h24.from).not.toBe(r.weekly.from);
  });
});
