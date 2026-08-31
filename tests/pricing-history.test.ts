/**
 * v0.6.1 — DeepSeek 官方峰谷定价历史回溯（2026-08-17 00:00 CST 生效）。
 *
 * 背景：v0.5.4 只回溯了周末全天低谷规则（2026-08-23），
 * 但 8-17 的价格切换没有回溯 —— 8-17 前的 token 也被按 8-17 后的
 * 峰谷价计算（旧统一价 flash 输入 1 元 → 峰谷价 3 元，差 3 倍），
 * 导致覆盖 8-17 前的月报/历史报告与 DeepSeek platform 账单对不上。
 *
 * priceSetForTime / computeCostTimed({ time }) / PEAK_OFFPEAK_EFFECTIVE_AT
 * 是目标 API。所有判定基于 Asia/Shanghai，与机器本地 TZ 无关。
 */
import { describe, expect, it } from "vitest";
import {
  BUILTIN_PRICES,
  computeCostTimed,
  OFFPEAK_PRICES,
  PEAK_OFFPEAK_EFFECTIVE_AT,
  PEAK_PRICES,
  priceSetForTime,
} from "../src/pricing.js";

/** 显式 +08:00 解析：机器时区无关。 */
const at = (iso: string): number => Date.parse(iso);

describe("峰谷定价历史回溯（2026-08-17 00:00 CST 生效）", () => {
  it("生效边界常量正确", () => {
    expect(PEAK_OFFPEAK_EFFECTIVE_AT).toBe(at("2026-08-17T00:00:00+08:00"));
    expect(at("2026-08-16T23:59:59.999+08:00")).toBeLessThan(PEAK_OFFPEAK_EFFECTIVE_AT);
  });

  it("8-17 前：任何时刻都按旧统一价（BUILTIN，无峰谷）", () => {
    // 旧规则高峰窗口内（10:00）与低谷窗口内（22:00）都是统一旧价
    expect(priceSetForTime(at("2026-08-16T10:00:00+08:00"))).toBe(BUILTIN_PRICES);
    expect(priceSetForTime(at("2026-08-16T22:00:00+08:00"))).toBe(BUILTIN_PRICES);
    expect(priceSetForTime(at("2026-08-10T10:00:00+08:00"))).toBe(BUILTIN_PRICES);
    expect(priceSetForTime(at("2026-08-15T15:00:00+08:00"))).toBe(BUILTIN_PRICES);
  });

  it("8-17 起：按峰谷价（含周末规则叠加）", () => {
    // 周一高峰 / 周一低谷
    expect(priceSetForTime(at("2026-08-17T10:00:00+08:00"))).toBe(PEAK_PRICES);
    expect(priceSetForTime(at("2026-08-17T22:00:00+08:00"))).toBe(OFFPEAK_PRICES);
    // 8-22（周六）在 8-23 周末新规生效前：峰谷价已生效但周末仍按旧规则分峰谷 → 10:00 高峰
    expect(priceSetForTime(at("2026-08-22T10:00:00+08:00"))).toBe(PEAK_PRICES);
    // 8-29（周六）在 8-23 周末新规后：全天低谷
    expect(priceSetForTime(at("2026-08-29T15:00:00+08:00"))).toBe(OFFPEAK_PRICES);
  });

  it("computeCostTimed：8-17 前 token 按旧统一价，8-17 后按峰谷价（同量跨边界正确分段）", () => {
    const mk = (time: number, input: number) => [
      { time, modelTokens: { "deepseek-official/deepseek-v4-flash": { input, cacheRead: 0, output: 0 } as never } },
    ];
    // 1M 输入：8-16 高峰窗口内（旧价 1 元）vs 8-18 周一高峰（3 元）
    expect(computeCostTimed(mk(at("2026-08-16T10:00:00+08:00"), 1_000_000)).total).toBeCloseTo(1.0);
    expect(computeCostTimed(mk(at("2026-08-18T10:00:00+08:00"), 1_000_000)).total).toBeCloseTo(3.0);
    // 1M 输出：8-16（旧价 2 元）vs 8-18 高峰（9 元）
    const mkOut = (time: number) => [
      { time, modelTokens: { "deepseek-official/deepseek-v4-pro": { input: 0, cacheRead: 0, output: 1_000_000 } as never } },
    ];
    expect(computeCostTimed(mkOut(at("2026-08-16T12:00:00+08:00"))).total).toBeCloseTo(6.0); // pro 旧输出价 6
    expect(computeCostTimed(mkOut(at("2026-08-18T10:00:00+08:00"))).total).toBeCloseTo(27.0); // pro 高峰输出 27
  });

  it("computeCostTimed：跨边界两行分别计价（8-16 行旧价 + 8-17 行峰谷价）", () => {
    const r = computeCostTimed([
      { time: at("2026-08-16T10:00:00+08:00"), modelTokens: { flash: { input: 500_000, cacheRead: 0, output: 0 } as never } },
      { time: at("2026-08-17T10:00:00+08:00"), modelTokens: { flash: { input: 500_000, cacheRead: 0, output: 0 } as never } },
    ]);
    // 0.5 × 1（旧价）+ 0.5 × 3（峰谷高峰）= 2.0
    expect(r.total).toBeCloseTo(2.0);
  });

  it("8-17 前用量不计入 peakShare / peakRatio（旧统一价无峰谷语义）", () => {
    const r = computeCostTimed([
      { time: at("2026-08-16T10:00:00+08:00"), modelTokens: { flash: { input: 1_000_000, cacheRead: 0, output: 0 } as never } },
    ]);
    expect(r.peakShare).toBe(0);
    expect(r.peakRatio).toBe(0);
  });
});
