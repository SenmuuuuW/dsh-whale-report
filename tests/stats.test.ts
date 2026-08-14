import { describe, expect, it } from "vitest";
import { aggregate, emptyStats, nightOwlIndex, formatTokens, formatSpan } from "../src/stats.js";
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
    expect(md).toContain("惊魂时刻");
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
