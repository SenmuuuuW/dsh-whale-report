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

  it("预设区间：日报=今天、24h=滚动、周/月/年=自然周期", () => {
    const now = new Date(2026, 7, 10, 15, 30, 0).getTime(); // 本地 8/10 15:30（周一）
    const localMidnight = new Date(2026, 7, 10).getTime();
    expect(presetRange("daily", now).from).toBe(localMidnight);
    expect(presetRange("24h", now).from).toBe(now - 24 * H);
    // 自然周：8/10 是周一 → 周起点 = 当天 0:00
    expect(presetRange("weekly", now).from).toBe(localMidnight);
    // 自然月：8/1 0:00
    expect(presetRange("monthly", now).from).toBe(new Date(2026, 7, 1).getTime());
    // 自然年：1/1 0:00
    expect(presetRange("yearly", now).from).toBe(new Date(2026, 0, 1).getTime());
    expect(() => presetRange("custom", now)).toThrow();
  });

  it("自然周跨周一：周日落在本周起点", () => {
    const sunday = new Date(2026, 7, 9, 20, 0, 0).getTime(); // 本地 8/9 周日 20:00
    // 上周一 8/3 0:00
    expect(presetRange("weekly", sunday).from).toBe(new Date(2026, 7, 3).getTime());
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
    // 协作信号双路径等价（回归：aggregateBuckets 曾漏聚合 collab 字段）
    expect(indexed.collab).toEqual(direct.collab);
    expect(indexed.sessionsDetail[0].turns).toBe(direct.sessionsDetail[0].turns);
    expect(indexed.sessionsDetail[0].userMessages).toBe(direct.sessionsDetail[0].userMessages);
    expect(indexed.sessionsDetail[0].collabRevisions).toBe(direct.sessionsDetail[0].collabRevisions);
    expect(indexed.sessionsDetail[0].collabLateConstraints).toBe(direct.sessionsDetail[0].collabLateConstraints);
  });

  it("协作信号在两条路径都正确采集（修正/迟到约束/短会话）", () => {
    const base = new Date(2026, 7, 10, 0, 0, 0).getTime();
    const events: RawEvent[] = [
      ev("turn/start", base + 1),
      ev("user/message", base + 2, { content: [{ type: "text", text: "帮我写个排序" }] }),
      ev("assistant/message", base + 3, { usage: { inputTokens: 1, outputTokens: 1 } }),
      ev("turn/start", base + 4),
      ev("user/message", base + 5, { content: [{ type: "text", text: "不是这个，换一种方式" }] }),
      ev("assistant/message", base + 6, { usage: { inputTokens: 1, outputTokens: 1 } }),
      ev("turn/start", base + 7),
      ev("user/message", base + 8, { content: [{ type: "text", text: "千万不要改数据库" }] }),
    ];
    const period = { from: base - 60_000, to: base + 3600_000 };
    const direct = aggregate(events, period, [{ id: "s1", createdAt: base }]);
    const built = bucketizeOwnEvents("s1", events.map((e) => ({ ...e, seq: 0 })), 0);
    const indexed = aggregateBuckets([{ sessionId: "s1", buckets: built.buckets, titles: built.titles }], period, [
      { id: "s1", createdAt: base },
    ]);

    // 首条消息无信号；第二条"不是这个，换一种方式" → revision；第三条"千万不要改数据库" → 迟到约束
    expect(direct.collab.revisions).toBe(1);
    expect(direct.collab.lateConstraints).toBe(1);
    expect(direct.collab.sessionsWithRevision).toBe(1);
    expect(indexed.collab).toEqual(direct.collab);
    expect(indexed.sessionsDetail[0].collabRevisions).toBe(1);
    expect(indexed.sessionsDetail[0].collabLateConstraints).toBe(1);
    // 首条用户消息里的"约束"不计迟到：把"千万不要"放首条再验证
    const firstIsConstraint = [
      ev("user/message", base + 2, { content: [{ type: "text", text: "千万不要用 X" }] }),
      ev("turn/start", base + 4),
      ev("user/message", base + 5, { content: [{ type: "text", text: "再试一次" }] }),
    ];
    const d2 = aggregate(firstIsConstraint, period, [{ id: "s1", createdAt: base }]);
    expect(d2.collab.lateConstraints).toBe(0);
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

describe("洞察引擎", () => {
  const base = new Date(2026, 7, 10, 0, 0, 0).getTime();

  function makeStats(partial: Partial<ReturnType<typeof aggregate>> = {}): ReturnType<typeof aggregate> {
    const events = [
      ev("turn/start", base),
      ev("user/message", base),
      ev("assistant/message", base, { usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 800, reasoningTokens: 10 } }),
      ev("tool/call", base, { name: "bash", arguments: JSON.stringify({ command: "ls" }) }),
    ];
    return aggregate(events, { from: base - 1000, to: base + 3600000 }, [{ id: "s1", createdAt: base }]);
  }

  it("重试风暴规则：≥3 次触发", async () => {
    const { computeInsights } = await import("../src/insights.js");
    const stats = makeStats();
    stats.retryBursts = 4;
    const insights = computeInsights({ stats });
    expect(insights.some((i) => i.id === "retry-storm")).toBe(true);
  });

  it("深夜消耗规则：凌晨占比高且费用达标才触发", async () => {
    const { computeInsights } = await import("../src/insights.js");
    const stats = makeStats();
    stats.hourHistogram = new Array(24).fill(0);
    stats.hourHistogram[2] = 50;
    stats.hourHistogram[14] = 50;
    stats.totalEvents = 100;
    const insights = computeInsights({ stats, cost: { perModel: {}, total: 10, currency: "CNY", source: "builtin", fetchedAt: 0 } });
    expect(insights.some((i) => i.id === "night-cost")).toBe(true);
  });

  it("周期 key：day-/24h-/wk-/mo-/yr- 前缀互不冲突，24h 无上一周期", async () => {
    const { periodKey, previousPeriodKey } = await import("../src/insights.js");
    const to = Date.parse("2026-08-14T12:00:00Z"); // 周五
    expect(periodKey("daily", to)).toBe("day-2026-08-14");
    expect(periodKey("24h", to)).toBe("24h-2026-08-14");
    expect(periodKey("weekly", to)).toBe("wk-2026-W33");
    expect(periodKey("monthly", to)).toBe("mo-2026-08");
    expect(periodKey("yearly", to)).toBe("yr-2026");
    expect(previousPeriodKey("daily", to)).toBe("day-2026-08-13");
    expect(previousPeriodKey("24h", to)).toBeNull();
    expect(previousPeriodKey("weekly", to)).toBe("wk-2026-W32");
    expect(previousPeriodKey("monthly", to)).toBe("mo-2026-07");
  });

  it("危险操作分级：红色规则优先", async () => {
    const { DANGEROUS_PATTERNS } = await import("../src/stats.js");
    const red = DANGEROUS_PATTERNS.find((p) => p.label === "删除根目录/家目录");
    expect(red?.sev).toBe("red");
    expect(red!.pattern.test("rm -rf /tmp/x")).toBe(false);
    expect(red!.pattern.test("rm -rf ~/backups")).toBe(false);
    expect(red!.pattern.test("rm -rf / && echo done")).toBe(true);
    expect(red!.pattern.test("rm -rf ~/.dsh/profiles/node_modules")).toBe(false);
    // 引号内搜索模式不误报（需经引擎的 stripQuotes 路径验证）
    const grepCmd = ev("tool/call", 1786100000000 + 5000, { name: "bash", arguments: JSON.stringify({ command: 'grep -n "rm -rf / && echo done" x.ts' }) });
    const gstats = aggregate([grepCmd], { from: 1786100000000, to: 1786100000000 + 3600000 });
    expect(gstats.dangerousCommands.length).toBe(0);
    const shutdown = DANGEROUS_PATTERNS.find((p) => p.label === "关机/重启");
    expect(shutdown!.pattern.test("sed -n '1,60p' $SRC/process-shutdown.ts")).toBe(false);
    expect(shutdown!.pattern.test("shutdown -h now")).toBe(true);
    expect(shutdown!.pattern.test("sudo reboot")).toBe(true);
    expect(red!.pattern.test("rm -rf ~/ && echo done")).toBe(true);
    const amber = DANGEROUS_PATTERNS.find((p) => p.label === "rm -rf 删除");
    expect(amber?.sev).toBe("amber");
    expect(amber!.pattern.test("rm -rf /tmp/x")).toBe(true);
  });
});

describe("维护加固：边界与不误报", () => {
  it("周期 key 边界：月末/年末/周初周日", async () => {
    const { periodKey, previousPeriodKey } = await import("../src/insights.js");
    expect(periodKey("monthly", Date.parse("2026-08-31T23:00:00Z"))).toBe("mo-2026-08");
    expect(previousPeriodKey("monthly", Date.parse("2026-01-15T12:00:00Z"))).toBe("mo-2025-12");
    expect(periodKey("yearly", Date.parse("2026-12-31T23:59:00Z"))).toBe("yr-2026");
    expect(previousPeriodKey("yearly", Date.parse("2026-01-01T00:00:00Z"))).toBe("yr-2025");
    expect(previousPeriodKey("daily", Date.parse("2026-08-01T00:00:00Z"))).toBe("day-2026-07-31");
  });

  it("数据不足时不触发任何洞察（避免噪音）", async () => {
    const { computeInsights } = await import("../src/insights.js");
    const base = new Date(2026, 7, 10).getTime();
    const stats = aggregate([ev("turn/start", base)], { from: base - 1000, to: base + 3600000 });
    const insights = computeInsights({ stats, cost: { perModel: {}, total: 0.5, currency: "CNY", source: "builtin" as const, fetchedAt: 0 } });
    expect(insights.length).toBe(0);
  });
});

describe("自事件排除（深迹不污染自己的统计）", () => {
  it("whale/report 事件不计入统计", () => {
    const base = new Date(2026, 7, 10).getTime();
    const events = [
      ev("turn/start", base),
      { type: "whale/report", time: base + 500, data: { preset: "weekly" } },
      { type: "whale/report", time: base + 600, data: { preset: "daily" } },
    ];
    const stats = aggregate(events, { from: base - 1000, to: base + 3600000 });
    expect(stats.totalEvents).toBe(1);
    expect(stats.turns).toBe(1);
  });
});

describe("密钥扫描与重试诊断（只读安全）", () => {
  it("user/message 里的密钥被检出，且只存标签不存原文", () => {
    const base = new Date(2026, 7, 10).getTime();
    const events = [
      ev("user/message", base, { content: [{ type: "text", text: "用这个 key: sk-abc1234567890abcdefgh 调 API" }] }),
      ev("user/message", base + 1, { content: [{ type: "text", text: "普通消息" }] }),
    ];
    const stats = aggregate(events, { from: base - 1000, to: base + 3600000 });
    expect(stats.secretHits.length).toBe(1);
    expect(stats.secretHits[0].label).toContain("OpenAI");
    expect(JSON.stringify(stats.secretHits)).not.toContain("sk-abc");
  });

  it("重试风暴带错误摘要（诊断素材）", () => {
    const base = new Date(2026, 7, 10).getTime();
    const mkCmd = (n: number) => ev("tool/call", base + n * 1000, { name: "bash", arguments: JSON.stringify({ command: "pnpm install" }) });
    const events = [
      mkCmd(0),
      ev("tool/result", base + 1000, { message: { isError: true, content: "ELIFECYCLE: command failed" } }),
      mkCmd(2),
      ev("tool/result", base + 3000, { message: { isError: true, content: "ELIFECYCLE: command failed" } }),
      mkCmd(4),
      ev("tool/result", base + 5000, { message: { isError: true, content: "ELIFECYCLE: command failed" } }),
    ];
    const stats = aggregate(events, { from: base - 1000, to: base + 3600000 });
    expect(stats.retryBursts).toBe(1);
    expect(stats.burstSamples.length).toBe(1);
    expect(stats.burstSamples[0].count).toBe(3);
    expect(stats.burstSamples[0].error).toContain("ELIFECYCLE");
  });

  it("工具族排行：已知映射与未识别兜底", async () => {
    const { toolFamilies } = await import("../src/insights.js");
    const rows = toolFamilies({ bash: 10, whale_report: 3, todo_write: 2, xxx_custom: 1 });
    expect(rows[0]).toEqual({ family: "核心工具", count: 10 });
    expect(rows.some((r) => r.family === "深迹" && r.count === 3)).toBe(true);
    expect(rows.some((r) => r.family === "其他" && r.count === 1)).toBe(true);
  });
});

describe("会话钻取与插件环境", () => {
  it("会话级明细：直算与分桶两条路径的 top 会话一致", () => {
    const base = new Date(2026, 7, 10).getTime();
    const events = [
      ev("turn/start", base),
      ev("assistant/message", base + 1, { usage: { inputTokens: 2000, outputTokens: 500, cacheReadTokens: 1000, reasoningTokens: 100 } }),
      ev("tool/call", base + 2, { name: "bash", arguments: JSON.stringify({ command: "pnpm install" }) }),
      ev("tool/call", base + 3, { name: "bash", arguments: JSON.stringify({ command: "pnpm install" }) }),
      ev("tool/call", base + 4, { name: "bash", arguments: JSON.stringify({ command: "pnpm install" }) }),
    ];
    const period = { from: base - 1000, to: base + 3600000 };
    const direct = aggregate(events, period);
    const built = bucketizeOwnEvents("s1", events.map((e) => ({ ...e, seq: 0 })), 0);
    const indexed = aggregateBuckets([{ sessionId: "s1", buckets: built.buckets, titles: built.titles }], period);

    expect(direct.sessionsDetail.length).toBe(1);
    expect(direct.sessionsDetail[0].toolCalls).toBe(3);
    expect(direct.sessionsDetail[0].retryBursts).toBe(1);
    expect(indexed.sessionsDetail.length).toBe(1);
    expect(indexed.sessionsDetail[0].toolCalls).toBe(direct.sessionsDetail[0].toolCalls);
    expect(indexed.sessionsDetail[0].retryBursts).toBe(direct.sessionsDetail[0].retryBursts);
  });

  it("secretHits/burstSamples 携带 sessionId（洞察可定位会话）", () => {
    const base = new Date(2026, 7, 10).getTime();
    const events = [
      ev("user/message", base, { content: [{ type: "text", text: "key: sk-abcdefghijklmnopqrstuvwxyz123456" }] }),
      ev("tool/call", base + 1, { name: "bash", arguments: JSON.stringify({ command: "npm i" }) }),
      ev("tool/result", base + 2, { message: { isError: true, content: "ERESOLVE" } }),
      ev("tool/call", base + 3, { name: "bash", arguments: JSON.stringify({ command: "npm i" }) }),
      ev("tool/call", base + 4, { name: "bash", arguments: JSON.stringify({ command: "npm i" }) }),
    ];
    const stats = aggregate(events, { from: base - 1000, to: base + 3600000 });
    expect(stats.secretHits[0].sessionId).toBe("s1");
    expect(stats.burstSamples[0].sessionId).toBe("s1");
  });
});
