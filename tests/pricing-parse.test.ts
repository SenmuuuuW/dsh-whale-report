import { describe, expect, it } from "vitest";
import { parsePricingPage, PEAK_PRICES, OFFPEAK_PRICES } from "../src/pricing.js";

/** 官方定价页结构 fixture（2026-08-17 峰谷定价后：每类费用 空闲/高峰 两行 × flash/pro 两列）。 */
const PAGE_FIXTURE = `<html><body>
<table>
<tr><td>价格 (1)</td><td>百万tokens输入（缓存命中）</td><td>空闲时段</td><td>0.05元</td><td>0.15元</td></tr>
<tr><td></td><td></td><td>高峰时段</td><td>0.10元</td><td>0.30元</td></tr>
<tr><td></td><td>百万tokens输入（缓存未命中）</td><td>空闲时段</td><td>1.5元</td><td>4.5元</td></tr>
<tr><td></td><td></td><td>高峰时段</td><td>3.0元</td><td>9.0元</td></tr>
<tr><td></td><td>百万tokens输出</td><td>空闲时段</td><td>4.5元</td><td>13.5元</td></tr>
<tr><td></td><td></td><td>高峰时段</td><td>9.0元</td><td>27.0元</td></tr>
<tr><td>并发限制 (2)</td><td>2500</td><td>500</td></tr>
</table>
</body></html>`;

describe("官方峰谷定价页解析", () => {
  it("解析出与内置官方常量完全一致的峰谷两套价", () => {
    const r = parsePricingPage(PAGE_FIXTURE);
    expect(r.peak).toEqual(PEAK_PRICES);
    expect(r.offpeak).toEqual(OFFPEAK_PRICES);
  });

  it("解析结果四组价齐全且与已知官方值一致", () => {
    const r = parsePricingPage(PAGE_FIXTURE);
    expect(r.offpeak.flash.cacheReadPerMillion).toBe(0.05);
    expect(r.offpeak.flash.outputPerMillion).toBe(4.5);
    expect(r.offpeak.pro.outputPerMillion).toBe(13.5);
    expect(r.peak.flash.outputPerMillion).toBe(9.0);
    expect(r.peak.pro.outputPerMillion).toBe(27.0);
    expect(r.peak.pro.inputPerMillion).toBe(9.0);
  });

  it("页面无价格表时抛错（不静默回退）", () => {
    expect(() => parsePricingPage("<html><body>没有表格</body></html>")).toThrow("pricing table not found");
  });

  it("单元格缺失时抛错", () => {
    const broken = PAGE_FIXTURE.replace("0.05元", "—");
    expect(() => parsePricingPage(broken)).toThrow("pricing cells missing");
  });
});
