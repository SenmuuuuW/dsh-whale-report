/**
 * 导出高度预算（budgetExportHeight）回归测试：
 * canvas 长图导出按面板同款视觉完整绘制，高度预算必须随内容单调增长
 * （数据越多图越长），且任何周期/数据规模下都落在画布高度上限内 —— 不会裁切。
 */

import { describe, expect, it } from "vitest";
import { budgetExportHeight } from "../src/client/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeStats(days: number): any {
  return {
    tokens: { input: 1_000_000, output: 500_000, cacheRead: 300_000, reasoning: 200_000 },
    sessions: 8,
    turns: 30,
    toolCallsTotal: 42,
    commands: 20,
    toolErrors: 1,
    totalEvents: 500,
    activeDays: 5,
    busiestDay: { date: "2026-08-12", events: 120 },
    dayHourSeries: Array.from({ length: days }, (_, i) => ({
      date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
      hours: Array.from({ length: 24 }, (_, h) => (h + i) % 5),
    })),
    hourHistogram: Array.from({ length: 24 }, () => 10),
    models: { "model-alpha": { input: 600_000, output: 300_000, cacheRead: 200_000, reasoning: 100_000 } },
    toolCalls: { bash: 30, fetch: 12 },
    dangerousCommands: [],
    burstSamples: [],
    secretHits: [],
    sessionsDetail: [],
    titles: [],
  };
}

function makeReport(days: number, preset: string, extra: Record<string, unknown> = {}): never {
  return {
    preset,
    from: 0,
    to: Date.now(),
    createdAt: Date.now(),
    stats: makeStats(days),
    cost: { total: 9.99, perModel: {}, currency: "CNY", source: "official-page" },
    insights: [],
    ...extra,
  } as never;
}

describe("budgetExportHeight", () => {
  it("各周期均为正值且有限", () => {
    for (const preset of ["daily", "24h", "weekly", "monthly", "yearly", "custom"]) {
      const h = budgetExportHeight(makeReport(1, preset));
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThan(200);
    }
  });

  it("活跃区行数随数据增长：1 天 < 7 天，7 天与 40 天相同（都只画最近 7 天）", () => {
    const h1 = budgetExportHeight(makeReport(1, "daily"));
    const h7 = budgetExportHeight(makeReport(7, "weekly"));
    const h40 = budgetExportHeight(makeReport(40, "custom"));
    expect(h7).toBeGreaterThan(h1);
    expect(h40).toBe(h7);
  });

  it("内容越多高度越高：洞察 / 会话 / 危险操作 / 会话索引", () => {
    const base = budgetExportHeight(makeReport(7, "weekly"));
    const withInsights = budgetExportHeight(
      makeReport(7, "weekly", {
        insights: [
          { id: "retry-storm", level: "warning", title: "t", detail: "d", action: "a" },
          { id: "night-cost", level: "tip", title: "t", detail: "d", action: "a" },
          { id: "danger-red", level: "critical", title: "t", detail: "d", action: "a" },
        ],
      }),
    );
    const withSessions = budgetExportHeight(
      makeReport(7, "weekly", {
        stats: {
          ...makeStats(7),
          sessionsDetail: Array.from({ length: 12 }, (_, i) => ({
            title: `会话${i}`,
            cost: 1,
            sessionId: `s${i}`,
            redDanger: 0,
            retryBursts: 0,
            toolCalls: 3,
            modelTokens: {},
            firstTime: 0,
            lastTime: 1000,
            events: 5,
            commands: 2,
          })),
        },
      }),
    );
    const withDanger = budgetExportHeight(
      makeReport(7, "weekly", {
        stats: {
          ...makeStats(7),
          dangerousCommands: Array.from({ length: 6 }, (_, i) => ({
            command: "rm -rf /",
            time: 0,
            sessionId: "s",
            label: "删除根目录",
            sev: "red" as const,
          })),
        },
      }),
    );
    const withTitles = budgetExportHeight(
      makeReport(7, "weekly", { stats: { ...makeStats(7), titles: Array.from({ length: 15 }, (_, i) => `会话标题${i}`) } }),
    );
    expect(withInsights).toBeGreaterThan(base);
    expect(withSessions).toBeGreaterThan(base);
    expect(withDanger).toBeGreaterThan(base);
    expect(withTitles).toBeGreaterThan(base);
  });

  it("高度受画布上限约束（≤32000）", () => {
    const h = budgetExportHeight(
      makeReport(40, "custom", {
        stats: {
          ...makeStats(40),
          titles: Array.from({ length: 200 }, (_, i) => `会话标题${i}`),
          sessionsDetail: Array.from({ length: 200 }, (_, i) => ({
            title: `会话${i}`,
            cost: 1,
            sessionId: `s${i}`,
            redDanger: 1,
            retryBursts: 3,
            toolCalls: 3,
            modelTokens: {},
            firstTime: 0,
            lastTime: 1000,
            events: 5,
            commands: 2,
          })),
        },
      }),
    );
    expect(h).toBeLessThanOrEqual(32000);
    expect(h).toBeGreaterThan(1000);
  });
});
