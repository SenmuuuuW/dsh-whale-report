/**
 * 历史趋势 / 活跃扫描（v2）测试：
 * - dayHourDetail 双路径等价（tokens/sessions/turns/toolCalls）
 * - activityLevel 固定阈值边界
 * - periodShortLabel 周期短标签（weekly/daily/monthly/yearly）
 */

import { describe, expect, it } from "vitest";
import { aggregate, aggregateBuckets, bucketizeOwnEvents, activityLevel, summarizeSessionEvents, type RawEvent } from "../src/stats.js";
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
