/**
 * P0/P1 usage accuracy — canonical 口径测试。
 *
 * 覆盖：totalTokens 不双计 reasoning / pricing miss+hit 独立计费 /
 * cacheRead >> input 真实样例 / official-only provider 聚合 / TODAY UTC+8 边界 /
 * 无 seq 事件（salvage 直读）双路径等价。
 */
import { describe, expect, it } from "vitest";
import { usageTotalTokens, billedInputTokens, buildProviderBreakdown } from "../src/usage.js";
import { modelCost } from "../src/pricing.js";
import { aggregate, aggregateBuckets, bucketizeOwnEvents } from "../src/stats.js";
import { presetRange } from "../src/report.js";
import { periodKey, shanghaiDayStart, shanghaiDateKey } from "../src/insights.js";

const FLASH = { cacheReadPerMillion: 0.1, inputPerMillion: 3, outputPerMillion: 9 };

describe("usageTotalTokens（P0：reasoning 是 output 子集，不双计）", () => {
  it("total = input + cacheRead + output；绝不再加 reasoning", () => {
    const usage = { input: 100, output: 500, cacheRead: 200, reasoning: 300 };
    expect(usageTotalTokens(usage)).toBe(800); // 100 + 200 + 500，不是 1100
    expect(usageTotalTokens({ input: 0, output: 0, cacheRead: 0, reasoning: 999 })).toBe(0);
  });

  it("billedInput = miss + hit（平台口径 prompt_tokens）", () => {
    expect(billedInputTokens({ input: 100, output: 0, cacheRead: 200 })).toBe(300);
  });
});

describe("modelCost（P0：miss/hit 独立计费，不 double-subtract）", () => {
  it("input 是 miss、cacheRead 是 hit：直接三桶计价", () => {
    const usage = { input: 1_000_000, output: 500_000, cacheRead: 300_000, reasoning: 100_000 };
    // miss 1M×3 + hit 0.3M×0.1 + out 0.5M×9 = 3 + 0.03 + 4.5 = 7.53
    expect(modelCost(usage, FLASH)).toBeCloseTo(7.53, 6);
  });

  it("cacheRead >> input 的真实样例：input 计费不被清零", () => {
    // 长会话：cache 远大于 miss（audit 实测 miss~0.5M vs hit~166M）
    const usage = { input: 1_000, output: 5_000, cacheRead: 100_000_000, reasoning: 2_000 };
    const cost = modelCost(usage, FLASH);
    // miss 1000×3/M = 0.003 · hit 100M×0.1/M = 10 · out 5000×9/M = 0.045
    expect(cost).toBeCloseTo(10.048, 6);
    expect(cost).toBeGreaterThan(10); // 旧公式 max(0, input-cacheRead)=0 → 只有 10.045，input 项被抹掉
  });

  it("reasoning 不单独重复收费（output 已含）", () => {
    const withReasoning = { input: 1, output: 100, cacheRead: 2, reasoning: 60 };
    const without = { input: 1, output: 100, cacheRead: 2, reasoning: 0 };
    expect(modelCost(withReasoning, FLASH)).toBe(modelCost(without, FLASH));
  });
});

describe("buildProviderBreakdown（P1：comparison scope）", () => {
  const models = {
    "deepseek-official/deepseek-v4-flash": { input: 100, output: 50, cacheRead: 200, reasoning: 20 },
    "opencode-go/deepseek-v4-flash": { input: 10, output: 5, cacheRead: 20, reasoning: 2 },
    "deepseek-v4-flash": { input: 1, output: 1, cacheRead: 1, reasoning: 0 }, // 无前缀 → deepseek
  };

  it("按 provider 拆分；deepseek-official only 可取", () => {
    const bd = buildProviderBreakdown(models);
    expect(Object.keys(bd).sort()).toEqual(["deepseek", "deepseek-official", "opencode-go"]);
    const official = bd["deepseek-official"];
    expect(official.total).toBe(usageTotalTokens(models["deepseek-official/deepseek-v4-flash"]));
    expect(official.requests).toBe(1);
    // 无前缀历史键归 deepseek（不与 official 混）
    expect(bd["deepseek"].input).toBe(1);
  });

  it("official-only 求和（对账用）", () => {
    const bd = buildProviderBreakdown(models);
    const o = bd["deepseek-official"] ?? { total: 0 };
    const other = Object.entries(bd).filter(([k]) => k !== "deepseek-official").reduce((s, [, v]) => s + v.total, 0);
    expect(o.total).toBe(350);
    expect(other).toBeGreaterThan(0); // 中转等不得混入 official 对账
  });
});

describe("TODAY UTC+8 边界（P1：Asia/Shanghai 自然日，不依赖机器时区）", () => {
  it("shanghaiDayStart：15:59:59.999Z 属于前一日，16:00:00Z 属于当日", () => {
    expect(shanghaiDayStart(Date.parse("2026-08-20T15:59:59.999Z"))).toBe(Date.parse("2026-08-19T16:00:00.000Z"));
    expect(shanghaiDayStart(Date.parse("2026-08-20T16:00:00.000Z"))).toBe(Date.parse("2026-08-20T16:00:00.000Z"));
    expect(shanghaiDayStart(Date.parse("2026-08-21T15:00:00.000Z"))).toBe(Date.parse("2026-08-20T16:00:00.000Z"));
  });

  it("shanghaiDateKey：UTC 日期 ≠ 上海日期时取上海日期", () => {
    expect(shanghaiDateKey(Date.parse("2026-08-20T15:59:59.999Z"))).toBe("2026-08-20");
    expect(shanghaiDateKey(Date.parse("2026-08-20T16:00:00.000Z"))).toBe("2026-08-21");
  });

  it("periodKey('daily') 用上海日期（不再 UTC 日期 key 对应本地自然日 range）", () => {
    expect(periodKey("daily", Date.parse("2026-08-20T15:59:59.999Z"))).toBe("day-2026-08-20");
    expect(periodKey("daily", Date.parse("2026-08-20T16:00:00.000Z"))).toBe("day-2026-08-21");
  });

  it("presetRange('daily')：from 为上海自然日 00:00，任何机器时区下一致", () => {
    const now = Date.parse("2026-08-20T20:00:00.000Z");
    const r = presetRange("daily", now);
    expect(r.from).toBe(Date.parse("2026-08-20T16:00:00.000Z")); // now+8h=8/21 04:00 → 上海自然日 8/21
    expect(r.to).toBe(now);
  });
});

describe("salvage 直读事件（无 seq）双路径等价", () => {
  it("无 seq 的完整记录经 bucketize + aggregateBuckets 与直算一致", () => {
    const base = Date.parse("2026-08-20T16:00:00.000Z");
    // salvage 直读的 record：无 seq 字段
    const events = [
      { type: "turn/start", time: base + 1 },
      { type: "assistant/message", time: base + 2, data: { usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 200, reasoningTokens: 20 } } },
      { type: "turn/start", time: base + 3600_000 },
    ];
    const period = { from: base, to: base + 2 * 3600_000 };
    const direct = aggregate(events, period, [{ id: "s1", createdAt: base }]);
    const built = bucketizeOwnEvents("s1", events, 0);
    const indexed = aggregateBuckets([{ sessionId: "s1", buckets: built.buckets, titles: [] }], period, [{ id: "s1", createdAt: base }]);
    expect(indexed.totalEvents).toBe(direct.totalEvents);
    expect(indexed.turns).toBe(direct.turns);
    expect(indexed.tokens).toEqual(direct.tokens);
    expect(usageTotalTokens(indexed.tokens)).toBe(350);
  });
});
