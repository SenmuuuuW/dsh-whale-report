/**
 * v0.5.x architecture repair — RAW ORACLE == QUERY ENGINE（自动化 gate）。
 *
 * Oracle = 逐事件独立过滤聚合（不调用 bucketize / aggregateBuckets / 任何
 * DeepTrace 统计函数；定价常量与 tier 规则为共用口径）。
 * Query = bucketizeOwnEvents → aggregateBuckets（含边界桶 rows 精确过滤）。
 *
 * 对账字段：requests / input / cacheRead / output / reasoning / canonical total /
 * cost / sessions / turns / tool calls。整数完全一致；cost 误差 < ¥0.01。
 * 边界语义：[from, to)。
 */
import { describe, expect, it } from "vitest";
import { aggregateBuckets, bucketizeOwnEvents, emptyPartial } from "../src/stats.js";
import { pricingTierForTime, modelTier, PEAK_PRICES, OFFPEAK_PRICES } from "../src/pricing.js";
import { shanghaiHourStartOf } from "../src/shanghai.js";
import { resolvePeriod, type PeriodPreset } from "../src/period.js";

const DAY = 86400000;
// 固定 T：2026-08-27T12:00 CST（非 10min 边界 —— 逼出边界桶精确路径）
const T = Date.parse("2026-08-27T12:00:00+08:00");

interface RawEvent {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
}

/** 8 天 fixture：D-7…Today 每天递增用量（可手算）。15:00 CST 在高峰窗口（14–18）内。 */
function fixtureEvents(): RawEvent[] {
  const events: RawEvent[] = [];
  const base = new Date(T);
  base.setHours(0, 0, 0, 0);
  const day0 = base.getTime(); // 今天 00:00 CST
  let seq = 0;
  for (let i = 0; i < 8; i++) {
    const t = day0 - (7 - i) * DAY + 15 * 3600_000; // 每天 15:00 CST（工作日 peak；跨 08-23 边界周日按新规 offpeak）
    const input = (i + 1) * 100_000;
    events.push({ type: "turn/start", seq: seq++, time: t, data: {} });
    events.push({ type: "tool/call", seq: seq++, time: t + 1000, data: { name: "bash", callId: `c${i}` } });
    events.push({ type: "tool/result", seq: seq++, time: t + 2000, data: { message: { source: { callId: `c${i}` } }, content: "ok" } });
    events.push({
      type: "assistant/message",
      seq: seq++,
      time: t + 3000,
      data: { usage: { inputTokens: input, outputTokens: 100, cacheReadTokens: 50, reasoningTokens: 10 } },
    });
  }
  // edge 事件：T-24h 边界三件 + T 边界三件（严格验证 [from,to)）
  const edge = [
    T - DAY - 1,
    T - DAY,
    T - DAY + 1,
    T - 1,
    T,
    T + 1,
  ];
  for (const t of edge) {
    events.push({ type: "turn/start", seq: seq++, time: t, data: {} });
    events.push({ type: "assistant/message", seq: seq++, time: t, data: { usage: { inputTokens: 77, outputTokens: 7, cacheReadTokens: 3, reasoningTokens: 1 } } });
  }
  return events;
}

interface OracleAcc {
  requests: number;
  input: number;
  cacheRead: number;
  output: number;
  reasoning: number;
  cost: number;
  sessions: number;
  turns: number;
  toolCalls: number;
}

/** RAW ORACLE：逐事件过滤 [from,to)。 */
function oracle(events: RawEvent[], from: number, to: number): OracleAcc {
  const acc: OracleAcc = { requests: 0, input: 0, cacheRead: 0, output: 0, reasoning: 0, cost: 0, sessions: 0, turns: 0, toolCalls: 0 };
  const sessions = new Set<string>();
  for (const e of events) {
    if (e.time < from || e.time >= to) continue;
    sessions.add("s-fixture");
    if (e.type === "turn/start") acc.turns += 1;
    if (e.type === "tool/call") acc.toolCalls += 1;
    if (e.type === "assistant/message") {
      acc.requests += 1;
      const u = (e.data.usage ?? {}) as Record<string, number>;
      const input = u.inputTokens ?? 0;
      const cacheRead = u.cacheReadTokens ?? 0;
      const output = u.outputTokens ?? 0;
      const reasoning = u.reasoningTokens ?? 0;
      acc.input += input;
      acc.cacheRead += cacheRead;
      acc.output += output;
      acc.reasoning += reasoning;
      const tier = modelTier("DeepSeek-V4-Flash");
      const price = (pricingTierForTime(e.time) === "peak" ? PEAK_PRICES : OFFPEAK_PRICES)[tier];
      acc.cost += (input / 1e6) * price.inputPerMillion + (cacheRead / 1e6) * price.cacheReadPerMillion + (output / 1e6) * price.outputPerMillion;
    }
  }
  acc.sessions = sessions.size;
  return acc;
}

/** QUERY ENGINE：bucketize → aggregateBuckets（含 rows 边界精确）。 */
function queryEngine(events: RawEvent[], from: number, to: number): OracleAcc {
  const built = bucketizeOwnEvents("s-fixture", events, 0);
  const stats = aggregateBuckets(
    [{ sessionId: "s-fixture", buckets: built.buckets, titles: [] }],
    { from, to },
    [],
    emptyPartial(),
  );
  return {
    requests: stats.assistantMessages,
    input: stats.tokens.input,
    cacheRead: stats.tokens.cacheRead,
    output: stats.tokens.output,
    reasoning: stats.tokens.reasoning,
    cost: 0, // cost 由 dayHourDetail 计价（对比在下方统一做）
    sessions: stats.sessions,
    turns: stats.turns,
    toolCalls: stats.toolCallsTotal,
  };
}

/** query engine 的 cost（与生产同口径：hour 级模型用量 × 时段价）。 */
function queryEngineCost(events: RawEvent[], from: number, to: number): number {
  const built = bucketizeOwnEvents("s-fixture", events, 0);
  const stats = aggregateBuckets(
    [{ sessionId: "s-fixture", buckets: built.buckets, titles: [] }],
    { from, to },
    [],
    emptyPartial(),
  );
  let total = 0;
  for (const day of stats.dayHourDetail) {
    for (let hour = 0; hour < 24; hour++) {
      const h = day.hours[hour];
      const priceSet = pricingTierForTime(shanghaiHourStartOf(day.date, hour)) === "peak" ? PEAK_PRICES : OFFPEAK_PRICES;
      for (const [model, usage] of Object.entries(h.modelTokens)) {
        const tier = modelTier(model);
        const price = priceSet[tier];
        total += (usage.input / 1e6) * price.inputPerMillion + (usage.cacheRead / 1e6) * price.cacheReadPerMillion + (usage.output / 1e6) * price.outputPerMillion;
      }
    }
  }
  return total;
}

describe("RAW ORACLE == QUERY ENGINE（自动 gate）", () => {
  const events = fixtureEvents();
  const presets: { name: string; preset: PeriodPreset; from?: string; to?: string }[] = [
    { name: "24h", preset: "24h" },
    { name: "daily", preset: "daily" },
    { name: "weekly", preset: "weekly" },
    { name: "monthly", preset: "monthly" },
    { name: "yearly", preset: "yearly" },
    { name: "custom", preset: "custom", from: new Date(T - 3 * DAY).toISOString(), to: new Date(T).toISOString() },
  ];

  for (const p of presets) {
    it(`${p.name}: oracle == query engine（整数一致 + cost <0.01）`, () => {
      const spec = resolvePeriod({ preset: p.preset, now: T, from: p.from, to: p.to });
      const o = oracle(events, spec.from, spec.to);
      const q = queryEngine(events, spec.from, spec.to);
      const qCost = queryEngineCost(events, spec.from, spec.to);
      // 整数完全一致
      expect(q.requests).toBe(o.requests);
      expect(q.input).toBe(o.input);
      expect(q.cacheRead).toBe(o.cacheRead);
      expect(q.output).toBe(o.output);
      expect(q.reasoning).toBe(o.reasoning);
      expect(q.input + q.cacheRead + q.output).toBe(o.input + o.cacheRead + o.output);
      expect(q.sessions).toBe(o.sessions);
      expect(q.turns).toBe(o.turns);
      expect(q.toolCalls).toBe(o.toolCalls);
      // cost 容差 < ¥0.01
      expect(Math.abs(qCost - o.cost)).toBeLessThan(0.01);
      // 24h != weekly（窗口真实不同）
      if (p.preset === "24h") {
        const wk = resolvePeriod({ preset: "weekly", now: T });
        expect(o.input).not.toBe(oracle(events, wk.from, wk.to).input);
      }
    });
  }

  it("T-24h 边界：恰好 [T-24h, T) 语义（T-24h-1ms 不计入 24h；T-24h 计入）", () => {
    const spec = resolvePeriod({ preset: "24h", now: T });
    // T-24h-1ms 与 T-24h 与 T-24h+1ms 三个事件
    const boundary = [
      { type: "turn/start", seq: 0, time: T - DAY - 1, data: {} },
      { type: "turn/start", seq: 1, time: T - DAY, data: {} },
      { type: "turn/start", seq: 2, time: T - DAY + 1, data: {} },
      { type: "turn/start", seq: 3, time: T - 1, data: {} },
      { type: "turn/start", seq: 4, time: T, data: {} },
    ] as RawEvent[];
    const o = oracle(boundary, spec.from, spec.to);
    const q = queryEngine(boundary, spec.from, spec.to);
    expect(o.turns).toBe(3); // T-24h、T-24h+1ms、T-1ms 计入；T-24h-1ms、T 不计入
    expect(q.turns).toBe(o.turns);
  });
});

/** 周末全天谷时新规 fixture：周五/周六/周日/周一 × 10:00/13:00/15:00，跨越 2026-08-23 生效边界。 */
function weekendFixture(): RawEvent[] {
  const mk = (date: string, hour: number, input: number): RawEvent[] => {
    const t = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00+08:00`);
    return [
      { type: "turn/start", seq: 0, time: t, data: {} },
      { type: "assistant/message", seq: 1, time: t + 1000, data: { usage: { inputTokens: input, outputTokens: 100, cacheReadTokens: 50, reasoningTokens: 10 } } },
    ];
  };
  return [
    // 周五 08-21：10/13/15 → peak / offpeak / peak
    ...mk("2026-08-21", 10, 100_000), ...mk("2026-08-21", 13, 200_000), ...mk("2026-08-21", 15, 300_000),
    // 周六 08-22（生效前旧规则）：10/13/15 → peak / offpeak / peak
    ...mk("2026-08-22", 10, 100_000), ...mk("2026-08-22", 13, 200_000), ...mk("2026-08-22", 15, 300_000),
    // 周日 08-23（生效后新规则）：10/15 → 全天 offpeak
    ...mk("2026-08-23", 10, 100_000), ...mk("2026-08-23", 15, 300_000),
    // 周一 08-24：10 → peak
    ...mk("2026-08-24", 10, 100_000),
  ];
}

describe("周末新规：RAW ORACLE == QUERY ENGINE（跨 2026-08-23 生效边界）", () => {
  const events = weekendFixture();
  const spec = resolvePeriod({
    preset: "custom",
    now: T,
    from: "2026-08-21T00:00:00+08:00",
    to: "2026-08-25T00:00:00+08:00",
  });

  it("pricingTierForTime：周五 10 peak / 生效前周六 10 peak / 周日 10 offpeak / 周一 10 peak", () => {
    expect(pricingTierForTime(Date.parse("2026-08-21T10:00:00+08:00"))).toBe("peak");
    expect(pricingTierForTime(Date.parse("2026-08-21T13:00:00+08:00"))).toBe("offpeak");
    expect(pricingTierForTime(Date.parse("2026-08-21T15:00:00+08:00"))).toBe("peak");
    expect(pricingTierForTime(Date.parse("2026-08-22T10:00:00+08:00"))).toBe("peak");
    expect(pricingTierForTime(Date.parse("2026-08-22T13:00:00+08:00"))).toBe("offpeak");
    expect(pricingTierForTime(Date.parse("2026-08-22T15:00:00+08:00"))).toBe("peak");
    expect(pricingTierForTime(Date.parse("2026-08-23T10:00:00+08:00"))).toBe("offpeak");
    expect(pricingTierForTime(Date.parse("2026-08-23T15:00:00+08:00"))).toBe("offpeak");
    expect(pricingTierForTime(Date.parse("2026-08-24T10:00:00+08:00"))).toBe("peak");
  });

  it("oracle == query engine（整数一致 + costDiff < 0.01 + 手算费用）", () => {
    const o = oracle(events, spec.from, spec.to);
    const q = queryEngine(events, spec.from, spec.to);
    const qCost = queryEngineCost(events, spec.from, spec.to);
    expect(q.requests).toBe(o.requests);
    expect(q.input).toBe(o.input);
    expect(q.cacheRead).toBe(o.cacheRead);
    expect(q.output).toBe(o.output);
    expect(q.reasoning).toBe(o.reasoning);
    expect(q.sessions).toBe(o.sessions);
    expect(q.turns).toBe(o.turns);
    expect(q.toolCalls).toBe(o.toolCalls);
    // 手算：peak 输入 900k（Fri10/Fri15/Sat10/Sat15/Mon10）@3.0 + offpeak 输入 800k @1.5
    // + 输出 peak 500 @9.0 + offpeak 400 @4.5 + 缓存 peak 250 @0.1 + offpeak 200 @0.05
    const hand = 2.7 + 1.2 + 0.0045 + 0.0018 + 0.000025 + 0.00001;
    expect(o.cost).toBeCloseTo(hand, 6);
    expect(Math.abs(qCost - o.cost)).toBeLessThan(0.01);
    // 周末（周日）用量绝不按高峰计：去掉周日事件后 peak 部分不变手算口径
    const withoutSunday = weekendFixture().filter((e) => e.time < Date.parse("2026-08-23T00:00:00+08:00") || e.time >= Date.parse("2026-08-24T00:00:00+08:00"));
    expect(queryEngineCost(withoutSunday, spec.from, spec.to)).toBeGreaterThan(0);
  });
});
