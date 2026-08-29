/**
 * v0.5.4 — DeepSeek 官方周末全天低谷计费新规。
 *
 * 生效时间：北京时间 2026-08-23 00:00:00（含）。
 * - 生效前：旧规则（不分周末，北京 9–12 / 14–18 高峰，其余低谷）
 * - 生效后：工作日保持旧窗口；周六/周日全天低谷
 *
 * 本文件在实现前即为 failing tests：pricingTierForTime /
 * computeCostTimed({ time }) / shanghaiHourStart* 是目标 API。
 * 所有 weekday/hour 判定必须基于 Asia/Shanghai，与机器本地 TZ 无关。
 */
import { describe, expect, it } from "vitest";
import {
  computeCostTimed,
  OFFPEAK_PRICES,
  PEAK_PRICES,
  pricingTierForTime,
  WEEKEND_OFFPEAK_EFFECTIVE_AT,
} from "../src/pricing.js";
import { shanghaiHourStart, shanghaiHourStartOf } from "../src/shanghai.js";

/** 显式 +08:00 解析：机器时区无关。 */
const at = (iso: string): number => Date.parse(iso);

describe("周末全天谷时定价（2026-08-23 00:00 CST 生效）", () => {
  it("生效前按旧规则：周末照常分峰谷（hour 窗口 + 星期几无关）", () => {
    expect(at("2026-08-22T23:59:59.999+08:00")).toBeLessThan(WEEKEND_OFFPEAK_EFFECTIVE_AT);
    // 2026-08-22 是周六：旧规则下 10:00 / 15:00 仍是高峰
    expect(pricingTierForTime(at("2026-08-22T10:00:00+08:00"))).toBe("peak");
    expect(pricingTierForTime(at("2026-08-22T15:00:00+08:00"))).toBe("peak");
    // 23 点本就低谷（旧规则口径）
    expect(pricingTierForTime(at("2026-08-22T23:59:59.999+08:00"))).toBe("offpeak");
  });

  it("生效边界：2026-08-23 00:00:00.000 CST 起周末全天低谷（当天为周日）", () => {
    expect(WEEKEND_OFFPEAK_EFFECTIVE_AT).toBe(at("2026-08-23T00:00:00+08:00"));
    expect(pricingTierForTime(WEEKEND_OFFPEAK_EFFECTIVE_AT)).toBe("offpeak");
    expect(pricingTierForTime(at("2026-08-23T10:00:00+08:00"))).toBe("offpeak");
    expect(pricingTierForTime(at("2026-08-23T15:00:00+08:00"))).toBe("offpeak");
    // 生效后第一个周六 08-29
    expect(pricingTierForTime(at("2026-08-29T10:00:00+08:00"))).toBe("offpeak");
    expect(pricingTierForTime(at("2026-08-29T15:00:00+08:00"))).toBe("offpeak");
    // 生效后周日 08-30
    expect(pricingTierForTime(at("2026-08-30T10:00:00+08:00"))).toBe("offpeak");
    expect(pricingTierForTime(at("2026-08-30T15:00:00+08:00"))).toBe("offpeak");
  });

  it("生效后工作日保持原窗口（周一 08-24 / 周五 08-21）", () => {
    expect(pricingTierForTime(at("2026-08-24T10:00:00+08:00"))).toBe("peak");
    expect(pricingTierForTime(at("2026-08-24T13:00:00+08:00"))).toBe("offpeak");
    expect(pricingTierForTime(at("2026-08-24T15:00:00+08:00"))).toBe("peak");
    expect(pricingTierForTime(at("2026-08-21T10:00:00+08:00"))).toBe("peak");
    expect(pricingTierForTime(at("2026-08-21T13:00:00+08:00"))).toBe("offpeak");
    expect(pricingTierForTime(at("2026-08-21T15:00:00+08:00"))).toBe("peak");
  });

  it("computeCostTimed：time 行按所属真实日期定价（同小时不同天必须分别计价）", () => {
    const usage = { input: 1_000_000, output: 0, cacheRead: 0, reasoning: 0 };
    const r = computeCostTimed([
      // 周五 10:00 → peak
      { time: at("2026-08-21T10:00:00+08:00"), modelTokens: { "deepseek-v4-pro": usage } },
      // 周六 10:00（生效前旧规则）→ peak
      { time: at("2026-08-22T10:00:00+08:00"), modelTokens: { "deepseek-v4-pro": usage } },
      // 周六 10:00（生效后新规则）→ offpeak
      { time: at("2026-08-29T10:00:00+08:00"), modelTokens: { "deepseek-v4-pro": usage } },
      // 周日 15:00（生效后新规则）→ offpeak
      { time: at("2026-08-30T15:00:00+08:00"), modelTokens: { "deepseek-v4-pro": usage } },
    ]);
    // pro miss 1M：peak ¥9.0；offpeak ¥4.5
    expect(r.total).toBeCloseTo(9.0 + 9.0 + 4.5 + 4.5, 6);
    expect(r.peakShare).toBeCloseTo(18.0, 6);
    expect(r.peakRatio).toBeCloseTo(0.5, 6);
  });

  it("computeCostTimed：生效后周末用量不计入 peakShare / peakRatio", () => {
    const usage = { input: 1_000_000, output: 0, cacheRead: 0, reasoning: 0 };
    const r = computeCostTimed([
      { time: at("2026-08-29T10:00:00+08:00"), modelTokens: { "deepseek-v4-pro": usage } },
      { time: at("2026-08-29T15:00:00+08:00"), modelTokens: { "deepseek-v4-pro": usage } },
      { time: at("2026-08-30T10:00:00+08:00"), modelTokens: { "deepseek-v4-pro": usage } },
    ]);
    expect(r.total).toBeCloseTo(4.5 * 3, 6);
    expect(r.peakShare).toBe(0);
    expect(r.peakRatio).toBe(0);
    // 价格常量 sanity：peak 是 offpeak 的 2 倍（官方 2:1）
    expect(PEAK_PRICES.pro.inputPerMillion).toBe(OFFPEAK_PRICES.pro.inputPerMillion * 2);
  });

  it("shanghaiHourStart / shanghaiHourStartOf：小时起点 epoch ms（显式 +08:00，TZ 无关）", () => {
    expect(shanghaiHourStart(at("2026-08-29T10:42:33+08:00"))).toBe(at("2026-08-29T10:00:00+08:00"));
    expect(shanghaiHourStartOf("2026-08-29", 10)).toBe(at("2026-08-29T10:00:00+08:00"));
    expect(shanghaiHourStartOf("2026-08-23", 0)).toBe(WEEKEND_OFFPEAK_EFFECTIVE_AT);
    // 跨日：23:59 与次日 00:00 分属两个小时起点
    expect(shanghaiHourStart(at("2026-08-29T23:59:59+08:00"))).toBe(shanghaiHourStartOf("2026-08-29", 23));
    expect(shanghaiHourStart(at("2026-08-30T00:00:00+08:00"))).toBe(shanghaiHourStartOf("2026-08-30", 0));
  });
});
