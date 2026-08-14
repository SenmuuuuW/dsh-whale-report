import { describe, expect, it } from "vitest";
import { aggregate, aggregateBuckets, bucketizeOwnEvents, emptyStats, nightOwlIndex, formatTokens, formatSpan } from "../src/stats.js";
import { renderReport, presetRange, PRESET_LABELS } from "../src/report.js";
import type { RawEvent, RawSessionHeader } from "../src/stats.js";

const T0 = Date.parse("2026-08-10T08:00:00Z");
const H = 60 * 60 * 1000;

function ev(type: string, time: number, data: unknown = {}): RawEvent {
  return { type, time, data: { ...(data as object), sessionId: "s1" } };
}

const PERIOD = { from: T0, to: T0 + 3 * 24 * H };

describe("aggregate — 基础计数", () => {
  it("统计回合、消息、步骤", () => {
    const events = [
      ev("turn/start", T0 + H),
      ev("step/start", T0 + H),
      ev("user/message", T0 + H, { content: [] }),
      ev("assistant/message", T0 + H, { usage: { inputTokens: 10, outputTokens: 5 } }),
    ];
    const stats = aggregate(events, PERIOD);
    expect(stats.turns).toBe(1);
    expect(stats.steps).toBe(1);
    expect(stats.userMessages).toBe(1);
    expect(stats.assistantMessages).toBe(1);
    expect(stats.tokens.input).toBe(10);
    expect(stats.tokens.output).toBe(5);
    expect(stats.sessions).toBe(1);
  });

  it("区间外的数据不计入", () => {
    const events = [
      ev("turn/start", T0 - 1000),
      ev("turn/start", T0 + H),
      ev("turn/start", T0 + 10 * 24 * H), // 超出区间
    ];
    const stats = aggregate(events, PERIOD);
    expect(stats.turns).toBe(1);
  });

  it("空输入返回全零统计（不抛错）", () => {
    const stats = aggregate([], PERIOD);
    expect(stats.totalEvents).toBe(0);
    expect(stats.turns).toBe(0);
    expect(stats.busiestDay).toBeNull();
  });
});

describe("aggregate — 工具与危险命令", () => {
  it("按名字统计工具调用，bash 计命令数", () => {
    const events = [
      ev("tool/call", T0 + H, { name: "bash", arguments: JSON.stringify({ command: "ls" }) }),
      ev("tool/call", T0 + 2 * H, { name: "bash", arguments: JSON.stringify({ command: "pwd" }) }),
      ev("tool/call", T0 + 3 * H, { name: "read" }),
    ];
    const stats = aggregate(events, PERIOD);
    expect(stats.toolCallsTotal).toBe(3);
    expect(stats.toolCalls.bash).toBe(2);
    expect(stats.toolCalls.read).toBe(1);
    expect(stats.commands).toBe(2);
  });

  it("识别 rm -rf 等危险命令", () => {
    const events = [
      ev("tool/call", T0 + H, {
        name: "bash",
        arguments: JSON.stringify({ command: "rm -rf node_modules && echo done" }),
      }),
      ev("tool/call", T0 + 2 * H, {
        name: "bash",
        arguments: JSON.stringify({ command: "git push origin main --force" }),
      }),
      ev("tool/call", T0 + 3 * H, {
        name: "bash",
        arguments: JSON.stringify({ command: "npm install" }),
      }),
    ];
    const stats = aggregate(events, PERIOD);
    expect(stats.dangerousCommands.length).toBe(2);
    expect(stats.dangerousCommands[0].command).toContain("rm -rf");
    expect(stats.dangerousCommands[1].command).toContain("--force");
  });

  it("统计 tool/result 失败（isError 与 error 两种形态）", () => {
    const events = [
      ev("tool/result", T0 + H, { message: { isError: true, content: [] } }),
      ev("tool/result", T0 + 2 * H, { error: { code: "EACCES" } }),
      ev("tool/result", T0 + 3 * H, { message: { content: [{ type: "text", text: "ok" }] } }),
    ];
    const stats = aggregate(events, PERIOD);
    expect(stats.toolErrors).toBe(2);
  });
});

describe("作息画像", () => {
  it("凌晨事件占比 = 熬夜指数", () => {
    // 用本地时区零点起算，避免测试随运行机器时区漂移。
    const localMidnight = new Date(2026, 7, 10).getTime();
    const events = [
      ev("step/start", localMidnight + 2 * H), // 凌晨 2 点
      ev("step/start", localMidnight + 3 * H), // 凌晨 3 点
      ev("step/start", localMidnight + 12 * H), // 中午
    ];
    const stats = aggregate(events, { from: localMidnight - H, to: localMidnight + 24 * H });
    expect(nightOwlIndex(stats)).toBe(67); // 2/3 ≈ 67%
    expect(stats.busiestDay).not.toBeNull();
  });

  it("直方图长度为 24", () => {
    expect(emptyStats(PERIOD).hourHistogram.length).toBe(24);
  });
});

describe("子代理会话统计", () => {
  it("delegationDepth >= 1 的头部计入 subagentSessions", () => {
    const headers: RawSessionHeader[] = [
      { id: "s1", createdAt: T0, delegationDepth: 0 },
      { id: "s2", createdAt: T0 + H, delegationDepth: 1 },
    ];
    const stats = aggregate([], PERIOD, headers);
    expect(stats.subagentSessions).toBe(1);
    expect(stats.sessions).toBe(2);
  });
});

describe("报告文案", () => {
  it("渲染出 markdown 报告并包含关键数字", () => {
    const events = [
      ev("turn/start", T0 + H),
      ev("user/message", T0 + H),
      ev("assistant/message", T0 + H, { usage: { inputTokens: 1234, outputTokens: 567 } }),
      ev("tool/call", T0 + H, { name: "bash", arguments: JSON.stringify({ command: "rm -rf /tmp/x" }) }),
    ];
    const stats = aggregate(events, PERIOD);
    const md = renderReport(stats, "weekly");
    expect(md).toContain("深迹 周报");
    expect(md).toContain("rm -rf");
    expect(md).toContain("1.2K");
    expect(md).toContain("危险操作");
  });

  it("预设区间长度正确", () => {
    const now = T0;
    expect(presetRange("daily", now).from).toBe(now - 24 * H);
    expect(presetRange("weekly", now).from).toBe(now - 7 * 24 * H);
    expect(presetRange("monthly", now).from).toBe(now - 30 * 24 * H);
    expect(presetRange("yearly", now).from).toBe(now - 365 * 24 * H);
    expect(() => presetRange("custom", now)).toThrow();
  });
});

describe("工具函数", () => {
  it("formatTokens / formatSpan 可读", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1500)).toBe("1.5K");
    expect(formatTokens(2_500_000)).toBe("2.50M");
    expect(formatSpan(T0, T0 + 24 * H)).toBe("1 天");
    expect(formatSpan(T0, T0 + 60 * 24 * H)).toBe("2.0 个月");
  });
});

describe("索引层：bucketizeOwnEvents + aggregateBuckets 与 aggregate 等价", () => {
  it("同一批事件两条路径产出相同统计（事件对齐 10 分钟桶边界）", () => {
    const base = new Date(2026, 7, 10, 0, 0, 0).getTime(); // 本地零点，整桶对齐
    const events: RawEvent[] = [
      ev("turn/start", base + 1),
      ev("step/start", base + 2),
      ev("user/message", base + 3),
      ev("assistant/message", base + 4, { usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, reasoningTokens: 10 } }),
      ev("tool/call", base + 5, { name: "bash", arguments: JSON.stringify({ command: "ls" }) }),
      ev("tool/call", base + 6, { name: "bash", arguments: JSON.stringify({ command: "rm -rf /tmp/x" }) }),
      ev("tool/result", base + 7, { message: { isError: true, content: [] } }),
      ev("session/title", base + 8, { title: "测试会话" }),
      ev("reasoning-chunks", base + 9, {}),
      ev("turn/start", base + 3600_000),
    ];
    const period = { from: base - 60_000, to: base + 2 * 3600_000 };
    const direct = aggregate(events, period, [{ id: "s1", createdAt: base }]);
    const built = bucketizeOwnEvents("s1", events.map((e) => ({ ...e, seq: 0 })), 0);
    const indexed = aggregateBuckets([{ sessionId: "s1", buckets: built.buckets, titles: built.titles }], period, [
      { id: "s1", createdAt: base },
    ]);

    expect(indexed.totalEvents).toBe(direct.totalEvents);
    expect(indexed.turns).toBe(direct.turns);
    expect(indexed.userMessages).toBe(direct.userMessages);
    expect(indexed.assistantMessages).toBe(direct.assistantMessages);
    expect(indexed.tokens).toEqual(direct.tokens);
    expect(indexed.toolCallsTotal).toBe(direct.toolCallsTotal);
    expect(indexed.toolCalls.bash).toBe(direct.toolCalls.bash);
    expect(indexed.toolErrors).toBe(direct.toolErrors);
    expect(indexed.commands).toBe(direct.commands);
    expect(indexed.dangerousCommands.length).toBe(direct.dangerousCommands.length);
    expect(indexed.dangerousCommands[0].label).toBe(direct.dangerousCommands[0].label);
    expect(indexed.dayHourSeries).toEqual(direct.dayHourSeries);
    expect(indexed.titles).toEqual(direct.titles);
    expect(indexed.sessions).toBe(direct.sessions);
  });

  it("bucketizeOwnEvents 跳过继承种子事件（seq < ownStart）", () => {
    const base = new Date(2026, 7, 10, 0, 0, 0).getTime();
    const events = [
      { type: "turn/start", seq: 0, time: base + 1, data: {} },
      { type: "turn/start", seq: 1, time: base + 2, data: {} },
      { type: "turn/start", seq: 2, time: base + 3, data: {} },
    ];
    const built = bucketizeOwnEvents("s1", events, 2); // 前两条是种子
    const total = built.buckets.reduce((s, b) => s + b.turns, 0);
    expect(total).toBe(1);
    expect(built.lastSeq).toBe(2);
  });
});

describe("DeepSeek 计费（pricing）", () => {
  it("费用按三桶计算：缓存命中 + 未命中 + 输出", async () => {
    const { modelCost, modelTier } = await import("../src/pricing.js");
    const flash = {
      cacheReadPerMillion: 0.02,
      inputPerMillion: 1,
      outputPerMillion: 2,
    };
    const usage = { input: 3_000_000, output: 500_000, cacheRead: 2_000_000, reasoning: 100_000 };
    // 命中 2M×0.02 + 未命中 1M×1 + 输出 0.5M×2 = 0.04 + 1 + 1 = 2.04
    expect(modelCost(usage, flash)).toBeCloseTo(2.04, 4);
    expect(modelTier("deepseek-v4-pro")).toBe("pro");
    expect(modelTier("deepseek-v4-flash")).toBe("flash");
  });

  it("内置回退价存在且为正", async () => {
    const { BUILTIN_PRICES } = await import("../src/pricing.js");
    expect(BUILTIN_PRICES.flash.inputPerMillion).toBeGreaterThan(0);
    expect(BUILTIN_PRICES.pro.inputPerMillion).toBeGreaterThan(0);
  });
});
