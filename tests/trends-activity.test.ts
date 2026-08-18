/**
 * 历史趋势 / 活跃扫描（v2）测试：
 * - dayHourDetail 双路径等价（tokens/sessions/turns/toolCalls）
 * - activityLevel 固定阈值边界
 * - periodShortLabel 周期短标签（weekly/daily/monthly/yearly）
 */

import { describe, expect, it } from "vitest";
import { aggregate, aggregateBuckets, bucketizeOwnEvents, activityLevel, summarizeSessionEvents, type RawEvent } from "../src/stats.js";
import { isPeakHourCST, computeCostTimed, PEAK_PRICES, OFFPEAK_PRICES } from "../src/pricing.js";
import { periodShortLabel } from "../src/client/index.js";

function ev(type: string, time: number, data: Record<string, unknown> = {}): RawEvent {
  return { type, time, data: { ...data, sessionId: "s1" } };
}

describe("dayHourDetail 双路径等价", () => {
  it("aggregate 与 aggregateBuckets 的小时级明细完全一致", () => {
    const base = new Date(2026, 7, 10, 0, 0, 0).getTime(); // 本地零点
    const events: RawEvent[] = [
      ev("request/header", base + 1000, { header: { config: { model: "deepseek-v4-flash" } } }),
      ev("turn/start", base + 2000, {}),
      ev("tool/call", base + 3000, { callId: "c1", name: "bash" }),
      ev("tool/result", base + 4000, { message: { source: { callId: "c1" }, content: [] } }),
      ev("assistant/message", base + 5000, { usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, reasoningTokens: 5 } }),
      // 2 小时后（同一日期内）
      ev("turn/start", base + 7200_000 + 1000, {}),
      ev("assistant/message", base + 7200_000 + 2000, { usage: { inputTokens: 20, outputTokens: 10 } }),
    ];
    const period = { from: base - 60_000, to: base + 4 * 3600_000 };
    const direct = aggregate(events, period, [{ id: "s1", createdAt: base }]);
    const built = bucketizeOwnEvents("s1", events.map((e) => ({ ...e, seq: 0 })), 0);
    const indexed = aggregateBuckets(
      [{ sessionId: "s1", buckets: built.buckets, titles: built.titles }],
      period,
      [{ id: "s1", createdAt: base }],
    );

    expect(indexed.dayHourDetail).toEqual(direct.dayHourDetail);
    expect(direct.dayHourDetail.length).toBe(1); // 单日期
    const h0 = direct.dayHourDetail[0].hours[0];
    expect(h0.tokens).toBe(165); // 100+50+10+5
    expect(h0.turns).toBe(1);
    expect(h0.toolCalls).toBe(1);
    expect(h0.sessions).toBe(1);
    const h2 = direct.dayHourDetail[0].hours[2];
    expect(h2.tokens).toBe(30);
    expect(h2.turns).toBe(1);
  });

  it("空小时补零、固定 24 项", () => {
    const base = new Date(2026, 7, 10, 0, 0, 0).getTime();
    const stats = aggregate([ev("turn/start", base + 1000, {})], { from: base - 1, to: base + 2000 });
    expect(stats.dayHourDetail[0].hours.length).toBe(24);
    expect(stats.dayHourDetail[0].hours[23]).toEqual({ tokens: 0, sessions: 0, turns: 0, toolCalls: 0, modelTokens: {}, cost: 0 });
  });
});

describe("activityLevel（固定 log 阈值）", () => {
  it("边界值", () => {
    expect(activityLevel(0)).toBe(0);
    expect(activityLevel(1)).toBe(1);
    expect(activityLevel(999_999)).toBe(1);
    expect(activityLevel(1_000_000)).toBe(2);
    expect(activityLevel(9_999_999)).toBe(2);
    expect(activityLevel(10_000_000)).toBe(3);
    expect(activityLevel(29_999_999)).toBe(3);
    expect(activityLevel(30_000_000)).toBe(4);
    expect(activityLevel(79_999_999)).toBe(4);
    expect(activityLevel(80_000_000)).toBe(5);
    expect(activityLevel(1e9)).toBe(5);
  });
});

describe("periodShortLabel", () => {
  it("weekly → W33；daily → 08/16；monthly → 2026-06；yearly → 2026", () => {
    expect(periodShortLabel("wk-2026-W33")).toBe("W33");
    expect(periodShortLabel("day-2026-08-16")).toBe("08/16");
    expect(periodShortLabel("mo-2026-06")).toBe("2026-06");
    expect(periodShortLabel("yr-2026")).toBe("2026");
    expect(periodShortLabel("24h-2026-08-16")).toBe("24h-2026-08-16");
  });
});

describe("summarizeSessionEvents（当前会话消耗）", () => {
  it("聚合 tokens / turns / toolCalls / title / lastTime", () => {
    const base = Date.parse("2026-08-18T02:00:00Z");
    const events = [
      { type: "session/title", time: base, data: { title: "调试当前会话" } },
      { type: "turn/start", time: base + 1, data: {} },
      { type: "tool/call", time: base + 2, data: { callId: "c1", name: "bash" } },
      { type: "tool/call", time: base + 3, data: { callId: "c2", name: "edit" } },
      { type: "assistant/message", time: base + 4, data: { usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, reasoningTokens: 5 } } },
      { type: "assistant/message", time: base + 5, data: { usage: { inputTokens: 20, outputTokens: 10 } } },
    ];
    const s = summarizeSessionEvents("s-live", events);
    expect(s.title).toBe("调试当前会话");
    expect(s.turns).toBe(1);
    expect(s.toolCalls).toBe(2);
    expect(s.tokens.input).toBe(120);
    expect(s.tokens.output).toBe(60);
    expect(s.tokens.cacheRead).toBe(10);
    expect(s.tokens.reasoning).toBe(5);
    expect(s.totalTokens).toBe(195);
    expect(s.lastTime).toBe(base + 5);
  });

  it("无 token 的空会话 totalTokens = 0；坏 time 事件跳过", () => {
    const s = summarizeSessionEvents("s", [
      { type: "turn/start", time: 1, data: {} },
      { type: "tool/call", time: Number.NaN, data: {} },
    ]);
    expect(s.totalTokens).toBe(0);
    expect(s.turns).toBe(1);
    expect(s.toolCalls).toBe(0);
  });
});

describe("峰谷定价", () => {
  it("isPeakHourCST 边界：9:00 高峰 / 12:00 空闲 / 14:00 高峰 / 18:00 空闲（北京时间）", () => {
    const at = (cstHour: number, minute = 0): number => {
      // 构造一个 UTC 时刻，其北京时间 = cstHour
      const d = new Date(Date.UTC(2026, 7, 18, (cstHour - 8 + 24) % 24, minute));
      return d.getTime();
    };
    expect(isPeakHourCST(at(8, 59))).toBe(false);
    expect(isPeakHourCST(at(9, 0))).toBe(true);
    expect(isPeakHourCST(at(11, 59))).toBe(true);
    expect(isPeakHourCST(at(12, 0))).toBe(false);
    expect(isPeakHourCST(at(13, 59))).toBe(false);
    expect(isPeakHourCST(at(14, 0))).toBe(true);
    expect(isPeakHourCST(at(17, 59))).toBe(true);
    expect(isPeakHourCST(at(18, 0))).toBe(false);
    expect(isPeakHourCST(at(2, 0))).toBe(false);
  });

  it("computeCostTimed：高峰小时按高峰价、空闲小时按空闲价", () => {
    const usage = { input: 1_000_000, output: 500_000, cacheRead: 0, reasoning: 0 };
    const r = computeCostTimed([
      { hour: 10, modelTokens: { "deepseek-v4-pro": usage } }, // 高峰
      { hour: 3, modelTokens: { "deepseek-v4-pro": usage } },  // 空闲
    ]);
    // 高峰 pro：miss 1M×9 + output 0.5M×27 = 22.5
    // 空闲 pro：miss 1M×4.5 + output 0.5M×13.5 = 11.25
    expect(r.total).toBeCloseTo(33.75, 6);
    expect(r.peakShare).toBeCloseTo(22.5, 6);
    expect(r.peakRatio).toBeCloseTo(0.5, 6);
  });

  it("内置峰谷价数值与官方一致", () => {
    expect(PEAK_PRICES.pro.outputPerMillion).toBe(27.0);
    expect(OFFPEAK_PRICES.pro.outputPerMillion).toBe(13.5);
    expect(PEAK_PRICES.flash.outputPerMillion).toBe(9.0);
    expect(OFFPEAK_PRICES.flash.outputPerMillion).toBe(4.5);
  });
});
