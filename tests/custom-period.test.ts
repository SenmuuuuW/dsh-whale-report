/**
 * v0.5.1 — custom period key 隔离：custom 报告不再污染 weekly period_stats。
 *
 * 验收：
 *  - custom key != weekly key；同区间稳定；不同区间不同；
 *  - custom 前缀不与任何自然周期前缀冲突；
 *  - custom 生成不写 weekly history point；weekly 生成正常写 weekly point；
 *  - custom + weekly 连续生成互不覆盖；
 *  - 读取侧过滤旧污染记录（preset=custom 且 key=wk-…，不迁移数据）。
 */
import { describe, expect, it } from "vitest";
import { customPeriodKey, isTrendRowIncluded, periodKey, previousPeriodKey } from "../src/insights.js";
import { generateReportData, toPeriodRecord, type ReportServices } from "../src/tools.js";
import type { PeriodStatsRecord } from "../src/state.js";

const TO = Date.parse("2026-08-14T12:00:00Z"); // wk-2026-W33
const FROM = TO - 7 * 86400000;

/** 零会话假 svc：只验证 key 语义与 period_stats 写入目标。 */
function makeSvc(store: Map<string, PeriodStatsRecord>): ReportServices {
  return {
    sessionQuery: {
      async listSessions() {
        return [];
      },
      async readSession() {
        throw new Error("unexpected read");
      },
    },
    index: {
      get: () => undefined,
      put: async () => {},
    },
    periodStats: {
      get: (k) => store.get(k),
      put: async (k, v) => {
        store.set(k, v);
      },
    },
  };
}

describe("customPeriodKey（纯函数）", () => {
  it("custom key != weekly key（不再落入 weekly 分支）", () => {
    expect(customPeriodKey(FROM, TO)).not.toBe(periodKey("weekly", TO));
    expect(customPeriodKey(FROM, TO)).not.toMatch(/^wk-/);
  });

  it("相同 from/to → 相同 key（稳定）", () => {
    expect(customPeriodKey(FROM, TO)).toBe(customPeriodKey(FROM, TO));
  });

  it("不同 from/to → 不同 key", () => {
    expect(customPeriodKey(FROM, TO)).not.toBe(customPeriodKey(FROM + 86400000, TO));
    expect(customPeriodKey(FROM, TO)).not.toBe(customPeriodKey(FROM, TO + 86400000));
  });

  it("前缀不与任何自然周期前缀冲突", () => {
    const key = customPeriodKey(FROM, TO);
    for (const prefix of ["day-", "24h-", "wk-", "mo-", "yr-"]) {
      expect(key.startsWith(prefix)).toBe(false);
    }
  });

  it("periodKey('custom') 抛错（防未来误用落入 weekly 分支）", () => {
    expect(() => periodKey("custom", TO)).toThrow(/customPeriodKey/);
  });

  it("previousPeriodKey('custom') → null（无自然上一周期，不读上周基线）", () => {
    expect(previousPeriodKey("custom", TO)).toBeNull();
  });
});

describe("生成写入目标（generateReportData + period_stats）", () => {
  it("custom 生成：key 独立，不产生 weekly history point", async () => {
    const store = new Map<string, PeriodStatsRecord>();
    const svc = makeSvc(store);
    const gen = await generateReportData(svc, "custom", { from: FROM, to: TO });
    expect(gen.key).toBe(customPeriodKey(FROM, TO));
    await svc.periodStats!.put(gen.key, toPeriodRecord(gen.key, "custom", { from: FROM, to: TO }, gen));
    // 只写了 custom key，没有任何 wk- 前缀的点
    expect([...store.keys()]).toEqual([gen.key]);
    expect(gen.key.startsWith("wk-")).toBe(false);
    // custom 无上一周期基线
    expect(gen.prev).toBeNull();
  });

  it("weekly 生成：正常产生 weekly point", async () => {
    const store = new Map<string, PeriodStatsRecord>();
    const svc = makeSvc(store);
    const gen = await generateReportData(svc, "weekly", { from: FROM, to: TO });
    expect(gen.key).toBe("wk-2026-W33");
    await svc.periodStats!.put(gen.key, toPeriodRecord(gen.key, "weekly", { from: FROM, to: TO }, gen));
    expect([...store.keys()]).toEqual(["wk-2026-W33"]);
  });

  it("custom + weekly 连续生成互不覆盖", async () => {
    const store = new Map<string, PeriodStatsRecord>();
    const svc = makeSvc(store);
    // custom 两次（同区间 → 同 key 原地更新）+ weekly 一次
    for (let i = 0; i < 2; i += 1) {
      const gen = await generateReportData(svc, "custom", { from: FROM, to: TO });
      await svc.periodStats!.put(gen.key, toPeriodRecord(gen.key, "custom", { from: FROM, to: TO }, gen));
    }
    const wk = await generateReportData(svc, "weekly", { from: FROM, to: TO });
    await svc.periodStats!.put(wk.key, toPeriodRecord(wk.key, "weekly", { from: FROM, to: TO }, wk));
    const keys = [...store.keys()].sort();
    expect(keys).toEqual([customPeriodKey(FROM, TO), "wk-2026-W33"].sort());
    expect(store.get("wk-2026-W33")?.preset).toBe("weekly");
    expect(store.get(customPeriodKey(FROM, TO))?.preset).toBe("custom");
  });

  it("不同 custom 区间互不覆盖（各自独立 point）", async () => {
    const store = new Map<string, PeriodStatsRecord>();
    const svc = makeSvc(store);
    const a = await generateReportData(svc, "custom", { from: FROM, to: TO });
    const b = await generateReportData(svc, "custom", { from: FROM - 86400000, to: TO - 86400000 });
    expect(a.key).not.toBe(b.key);
    await svc.periodStats!.put(a.key, toPeriodRecord(a.key, "custom", { from: FROM, to: TO }, a));
    await svc.periodStats!.put(b.key, toPeriodRecord(b.key, "custom", { from: FROM - 86400000, to: TO - 86400000 }, b));
    expect([...store.keys()].sort()).toEqual([a.key, b.key].sort());
  });
});

describe("读取侧兼容：旧污染记录不进入标准趋势", () => {
  it("标准周趋势排除 preset=custom 的旧污染记录（不迁移数据）", () => {
    const rows = [
      { key: "wk-2026-W33", preset: "weekly" },
      { key: "wk-2026-W33", preset: "custom" }, // 旧版 custom 污染点
      { key: "wk-2026-W32", preset: "weekly" },
      { key: customPeriodKey(FROM, TO), preset: "custom" }, // 新版 custom 点（前缀不匹配 wk-）
    ];
    const weekly = rows.filter((r) => isTrendRowIncluded(r.key, r.preset, "wk-"));
    expect(weekly.map((r) => r.preset)).toEqual(["weekly", "weekly"]);
    expect(weekly.some((r) => r.preset === "custom")).toBe(false);
  });

  it("标准周期前缀查询照常包含正常记录（daily/weekly）", () => {
    expect(isTrendRowIncluded("day-2026-08-14", "daily", "day-")).toBe(true);
    expect(isTrendRowIncluded("wk-2026-W33", "weekly", "wk-")).toBe(true);
    expect(isTrendRowIncluded("mo-2026-08", "monthly", "mo-")).toBe(true);
  });

  it("custom 查询（prefix ''）保持既有语义：全部纳入", () => {
    expect(isTrendRowIncluded("wk-2026-W33", "weekly", "")).toBe(true);
    expect(isTrendRowIncluded(customPeriodKey(FROM, TO), "custom", "")).toBe(true);
  });
});
