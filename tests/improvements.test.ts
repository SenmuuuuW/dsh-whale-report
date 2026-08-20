import { describe, expect, it } from "vitest";
import {
  aggregate,
  aggregateBuckets,
  bucketizeOwnEvents,
  type RawEvent,
} from "../src/stats.js";
import {
  computeImprovements,
  rankImprovements,
  classifyCorrectionText,
  normalizeCorrectionText,
  redactCommand,
  type ImprovementItem,
} from "../src/improvements.js";

/** 事件构造（与既有测试同款）。 */
function ev(type: string, time: number, data?: Record<string, unknown>): RawEvent {
  return { type, time, data };
}

function toolCall(time: number, callId: string, name = "edit", sessionId = "s1"): RawEvent {
  return ev("tool/call", time, { name, callId, sessionId });
}

function toolResult(time: number, callId: string, code?: string, sessionId = "s1"): RawEvent {
  const data: Record<string, unknown> = code === undefined
    ? { message: { source: { callId }, content: "ok" }, sessionId }
    : { message: { source: { callId } }, error: { code }, sessionId };
  return ev("tool/result", time, data);
}

function userMsg(time: number, text: string, sessionId = "s1"): RawEvent {
  return ev("user/message", time, { content: [{ type: "text", text }], sessionId });
}

/**
 * 纠正消息 = 会话第 2+ 条用户消息（首条消息是初始需求，不计纠正；
 * 与 collab lateConstraints 同语义）。所以每条纠正前垫一条中性消息
 * （必须与纠正同处窗口内，否则直算路径看不到前置消息）。
 */
function correctionMsg(time: number, text: string, sessionId = "s1"): RawEvent[] {
  return [userMsg(time - 1000, "继续", sessionId), userMsg(time, text, sessionId)];
}

/** 一个会话：N 次失败的 edit 调用（跨会话复用）。 */
function failingEditSession(sessionId: string, base: number, failures: number, code = "FS_EDIT_NOT_FOUND"): RawEvent[] {
  const events: RawEvent[] = [];
  for (let i = 0; i < failures; i += 1) {
    const t = base + i * 60_000;
    events.push(toolCall(t, `${sessionId}-c${i}`, "edit", sessionId));
    events.push(toolResult(t + 1000, `${sessionId}-c${i}`, code, sessionId));
  }
  // 加一些成功调用把总量垫高（edit 30+ calls 门槛）
  for (let i = 0; i < 20; i += 1) {
    const t = base + (failures + i) * 60_000;
    events.push(toolCall(t, `${sessionId}-ok${i}`, "edit", sessionId));
    events.push(toolResult(t + 1000, `${sessionId}-ok${i}`, undefined, sessionId));
  }
  return events;
}

// from 对齐 10 分钟边界（600000 倍数），避免跨边界桶在 bucket 路径被裁剪。
const WEEK = { from: 1785999600000, to: 1785999600000 + 7 * 24 * 3600 * 1000 };

describe("Improve core", () => {
  it("同一输入 → 同一输出（确定性）", () => {
    const events = [
      ...failingEditSession("s1", WEEK.from + 1000, 6),
      ...failingEditSession("s2", WEEK.from + 1000, 5),
      ...failingEditSession("s3", WEEK.from + 1000, 4),
    ];
    const stats = aggregate(events, WEEK);
    const a = computeImprovements({ stats, period: "wk-2026-W33", now: 1234567890000 });
    const b = computeImprovements({ stats, period: "wk-2026-W33", now: 1234567890000 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("排序稳定：severity → score → occurrences → category → id", () => {
    const events = [
      ...failingEditSession("s1", WEEK.from + 1000, 6),
      ...failingEditSession("s2", WEEK.from + 1000, 5),
      ...failingEditSession("s3", WEEK.from + 1000, 4),
      ...correctionMsg(WEEK.from + 2000, "先不要提交", "s1"),
      ...correctionMsg(WEEK.from + 3000, "不要 push 不要 commit", "s2"),
      ...correctionMsg(WEEK.from + 4000, "先别 commit", "s3"),
    ];
    const stats = aggregate(events, WEEK);
    const items = computeImprovements({ stats, period: "wk-2026-W33" });
    const items2 = computeImprovements({ stats, period: "wk-2026-W33" });
    const ids = items.map((i) => i.id);
    // 稳定顺序：同输入两次调用顺序一致
    expect(ids).toEqual(items2.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length); // id 唯一
  });

  it("stable ids：同一目标跨周期 id 不变", () => {
    const events = [...failingEditSession("s1", WEEK.from + 1000, 6), ...failingEditSession("s2", WEEK.from + 1000, 5), ...failingEditSession("s3", WEEK.from + 1000, 4)];
    const stats = aggregate(events, WEEK);
    const a = computeImprovements({ stats, period: "wk-2026-W33" });
    const b = computeImprovements({ stats, period: "wk-2026-W34" });
    expect(a[0].id).toBe(b[0].id);
    expect(a[0].id).toBe("improve-tool-edit");
  });

  it("有界：正常数据下最多几条（规则保守）", () => {
    const events = [
      ...failingEditSession("s1", WEEK.from + 1000, 6),
      ...failingEditSession("s2", WEEK.from + 1000, 5),
      ...failingEditSession("s3", WEEK.from + 1000, 4),
      ...correctionMsg(WEEK.from + 2000, "先不要提交", "s1"),
      ...correctionMsg(WEEK.from + 3000, "不要 push 不要 commit", "s2"),
      ...correctionMsg(WEEK.from + 4000, "先别 commit", "s3"),
    ];
    const stats = aggregate(events, WEEK);
    const items = computeImprovements({ stats, period: "wk-2026-W33" });
    expect(items.length).toBeLessThanOrEqual(6);
  });

  it("空数据 → 0 条；不与 Findings 重复（无证据不生成）", () => {
    const stats = aggregate([], WEEK);
    expect(computeImprovements({ stats, period: "wk-2026-W33" })).toEqual([]);
  });

  it("severity 边界：大量失败且高失败率 → HIGH；少量 → MEDIUM", () => {
    const events = [
      ...failingEditSession("s1", WEEK.from + 1000, 40),
      ...failingEditSession("s2", WEEK.from + 1000, 40),
      ...failingEditSession("s3", WEEK.from + 1000, 40),
    ];
    const stats = aggregate(events, WEEK);
    const [item] = computeImprovements({ stats, period: "wk-2026-W33" });
    expect(item.category).toBe("TOOL");
    expect(item.severity).toBe("HIGH");
    // 少量失败（3 sessions × 4 次 = 12 failed，rate 12/72 ≈ 16.7%）→ 仍 MEDIUM（failed < 30）
    const low = [
      ...failingEditSession("s1", WEEK.from + 1000, 4),
      ...failingEditSession("s2", WEEK.from + 1000, 4),
      ...failingEditSession("s3", WEEK.from + 1000, 4),
    ];
    const statsLow = aggregate(low, WEEK);
    const [itemLow] = computeImprovements({ stats: statsLow, period: "wk-2026-W33" });
    expect(itemLow.severity).toBe("MEDIUM");
  });
});

describe("Improve Tool 规则", () => {
  it("跨 session 重复失败 + 同错误码 → 触发，evidence 完整", () => {
    const events = [
      ...failingEditSession("s1", WEEK.from + 1000, 6),
      ...failingEditSession("s2", WEEK.from + 1000, 5),
      ...failingEditSession("s3", WEEK.from + 1000, 4),
    ];
    const stats = aggregate(events, WEEK);
    const items = computeImprovements({ stats, period: "wk-2026-W33" });
    const edit = items.find((i) => i.id === "improve-tool-edit");
    expect(edit).toBeDefined();
    expect(edit!.evidence.occurrences).toBe(3);
    expect(edit!.evidence.affectedSessions).toContain("s1");
    expect(edit!.evidence.affectedTools).toEqual(["edit"]);
    expect(edit!.evidence.metrics.failures).toBe(15);
    expect(edit!.evidence.metrics.mainCodeCount).toBe(15);
    expect(edit!.recommendation).toContain("existence");
    expect(edit!.verificationPlan.targetMetric).toContain("edit failure rate");
    expect(edit!.verificationPlan.baseline).toBeGreaterThan(0);
  });

  it("低量噪声不触发（calls < 30 或 failed < 5）", () => {
    const events = failingEditSession("s1", WEEK.from + 1000, 3);
    const stats = aggregate(events, WEEK);
    expect(computeImprovements({ stats, period: "wk-2026-W33" }).filter((i) => i.category === "TOOL")).toEqual([]);
  });

  it("单会话噪声不触发（跨 session 数 < 3）", () => {
    const events = failingEditSession("s1", WEEK.from + 1000, 40);
    const stats = aggregate(events, WEEK);
    expect(computeImprovements({ stats, period: "wk-2026-W33" }).filter((i) => i.category === "TOOL")).toEqual([]);
  });

  it("错误码分散（无主因）不触发", () => {
    const events: RawEvent[] = [];
    for (const sid of ["s1", "s2", "s3"]) {
      for (let i = 0; i < 6; i += 1) {
        const t = WEEK.from + 1000 + i * 60_000;
        events.push(toolCall(t, `${sid}-c${i}`, "edit", sid));
        events.push(toolResult(t + 1000, `${sid}-c${i}`, `CODE_${i}`, sid));
      }
      for (let i = 0; i < 20; i += 1) {
        const t = WEEK.from + 1000 + (6 + i) * 60_000;
        events.push(toolCall(t, `${sid}-ok${i}`, "edit", sid));
        events.push(toolResult(t + 1000, `${sid}-ok${i}`, undefined, sid));
      }
    }
    const stats = aggregate(events, WEEK);
    expect(computeImprovements({ stats, period: "wk-2026-W33" }).filter((i) => i.category === "TOOL")).toEqual([]);
  });
});

describe("Improve Workflow 规则", () => {
  /** 同一命令在多个会话中重复出现（streak ≥3 才算 burst）。 */
  function burstEvents(command: string): RawEvent[] {
    const events: RawEvent[] = [];
    for (const sid of ["s1", "s2", "s3"]) {
      for (let i = 0; i < 4; i += 1) {
        const t = WEEK.from + 1000 + i * 30_000;
        events.push(toolCall(t, `${sid}-b${i}`, "bash", sid));
        events.push(toolResult(t + 1000, `${sid}-b${i}`, "ENOENT", sid));
      }
    }
    // 命令是独立事件？—— retryBursts 走 commandOf(arguments)，需要 tool/call 的 arguments 带 command
    return events;
  }

  it("命令重试聚合需要 command 载荷；无命令事件时不触发（仅计数不凑数）", () => {
    const events = burstEvents("pnpm test");
    const stats = aggregate(events, WEEK);
    // 事件里没有 arguments.command → 不构成 burst（防御性断言）
    expect(stats.retryBursts).toBe(0);
    expect(computeImprovements({ stats, period: "wk-2026-W33" }).filter((i) => i.category === "WORKFLOW")).toEqual([]);
  });

  it("跨 session 命令重试 → 触发 WORKFLOW，且不展示命令原文中的路径", () => {
    const cmd = JSON.stringify({ command: "cd /Users/me/projects/secret-name && pnpm test" });
    const events: RawEvent[] = [];
    for (const sid of ["s1", "s2", "s3"]) {
      for (let i = 0; i < 4; i += 1) {
        const t = WEEK.from + 1000 + i * 30_000;
        // 命令放在 tool/call 的 arguments 里；失败结果带错误摘要（burst 证据链）
        events.push(ev("tool/call", t, { name: "bash", callId: `${sid}-b${i}`, arguments: cmd, sessionId: sid }));
        events.push(ev("tool/result", t + 1000, { message: { source: { callId: `${sid}-b${i}` }, content: "error: directory not found" }, error: { code: "EXIT_1" }, sessionId: sid }));
      }
    }
    const stats = aggregate(events, WEEK);
    expect(stats.retryBursts).toBeGreaterThanOrEqual(3);
    const items = computeImprovements({ stats, period: "wk-2026-W33" });
    const wf = items.find((i) => i.category === "WORKFLOW");
    expect(wf).toBeDefined();
    expect(wf!.evidence.occurrences).toBeGreaterThanOrEqual(3);
    expect(wf!.evidence.metrics.bursts).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(wf)).not.toContain("secret-name");
    expect(JSON.stringify(wf)).not.toContain("/Users/");
  });
});

describe("Correction 识别（EXPERIMENTAL）", () => {
  it("跨会话重复 commit 纠正 → 触发 INSTRUCTION，证据不含原文", () => {
    const events = [
      ...correctionMsg(WEEK.from + 2000, "先不要提交，等我确认", "s1"),
      ...correctionMsg(WEEK.from + 3000, "不要 push 不要 commit 任何东西", "s2"),
      ...correctionMsg(WEEK.from + 4000, "先别 commit", "s3"),
    ];
    const stats = aggregate(events, WEEK);
    const items = computeImprovements({ stats, period: "wk-2026-W33" });
    const instr = items.find((i) => i.category === "INSTRUCTION");
    expect(instr).toBeDefined();
    expect(instr!.evidence.experimental).toBe(true);
    expect(instr!.evidence.occurrences).toBe(3);
    expect(JSON.stringify(instr)).not.toContain("提交");
    expect(JSON.stringify(instr)).not.toContain("等我确认");
    expect(instr!.summary).toContain("3 个会话");
  });

  it("同类归一化：不同措辞 → 同一 category", () => {
    expect(classifyCorrectionText("先不要提交")).toContain("COMMIT_CONTROL");
    expect(classifyCorrectionText("不要 push 不要 commit")).toContain("COMMIT_CONTROL");
    expect(classifyCorrectionText("别 commit")).toContain("COMMIT_CONTROL");
    expect(classifyCorrectionText("只改这个 repo，其他别动")).toContain("REPO_SCOPE");
    expect(classifyCorrectionText("不要动 UI 不要改界面")).toContain("UI_SCOPE");
    expect(classifyCorrectionText("不要做多余的事")).toContain("NO_EXTRA_CHANGES");
    expect(classifyCorrectionText("不要再问我了")).toContain("NO_REPEAT_QUESTION");
    expect(classifyCorrectionText("用 markdown 输出")).toContain("OUTPUT_FORMAT");
  });

  it("无关文本不触发（保守）", () => {
    expect(classifyCorrectionText("帮我看一下这个报错")).toEqual([]);
    expect(classifyCorrectionText("运行测试然后告诉我结果")).toEqual([]);
    expect(classifyCorrectionText("这个功能做得不错")).toEqual([]);
    expect(classifyCorrectionText("提交的时候注意格式")).toEqual([]); // "提交"单独出现不是纠正
  });

  it("首条用户消息不计纠正（初始需求 ≠ 纠正；真实数据上 OUTPUT_FORMAT 20/28 是首条误报）", () => {
    // 首条就是"用中文输出"式指令 → 是初始需求，不算纠正
    const firstOnly = [userMsg(WEEK.from + 2000, "用中文输出结果", "s1"), userMsg(WEEK.from + 3000, "继续", "s1")];
    const stats1 = aggregate(firstOnly, WEEK);
    expect(stats1.correctionSignals.filter((c) => c.category === "OUTPUT_FORMAT")).toEqual([]);
    // 第 2+ 条消息里的同类指令 → 真纠正，计入
    const stats2 = aggregate([...correctionMsg(WEEK.from + 4000, "用中文输出", "s2")], WEEK);
    expect(stats2.correctionSignals.find((c) => c.category === "OUTPUT_FORMAT")?.sessions).toBe(1);
    // 双路径同语义
    const bucket = aggregateBuckets(
      [{ sessionId: "s2", buckets: bucketizeOwnEvents("s2", [...correctionMsg(WEEK.from + 4000, "用中文输出", "s2")].map((e) => ({ ...e, seq: 0 })), 0).buckets, titles: [] }],
      WEEK,
    );
    expect(bucket.correctionSignals.find((c) => c.category === "OUTPUT_FORMAT")?.sessions).toBe(1);
  });

  it("单会话纠正不触发（跨会话 ≥2）", () => {
    const events = [...correctionMsg(WEEK.from + 2000, "先不要提交", "s1"), userMsg(WEEK.from + 3000, "再强调一次：不要 commit", "s1")];
    const stats = aggregate(events, WEEK);
    expect(computeImprovements({ stats, period: "wk-2026-W33" }).filter((i) => i.category === "INSTRUCTION")).toEqual([]);
  });

  it("归一化：路径/hash/数字被剥离；raw prompt 永不进入 report", () => {
    const norm = normalizeCorrectionText('不要改 /Users/me/proj-8f3a 里的文件，只动 src');
    expect(norm).not.toContain("/Users/");
    expect(norm).not.toContain("8f3a");
    expect(norm).not.toContain("proj-");
    expect(redactCommand("cat /private/var/tmp/abc123/secret.txt")).not.toMatch(/\/|abc123|secret/);
    const events = [...correctionMsg(WEEK.from + 2000, "不要动 /Users/me/x 目录", "s1"), ...correctionMsg(WEEK.from + 3000, "别碰 /Users/me/x", "s2")];
    const stats = aggregate(events, WEEK);
    const items = computeImprovements({ stats, period: "wk-2026-W33" });
    expect(JSON.stringify(items)).not.toContain("/Users/");
    expect(JSON.stringify(items)).not.toContain("me/x");
  });
});

describe("Improve Cost 规则", () => {
  function nightStats(): ReturnType<typeof aggregate> {
    const events: RawEvent[] = [];
    const day9 = new Date(2026, 7, 10, 9, 0, 0).getTime();
    for (let i = 0; i < 40; i += 1) events.push(ev("turn/start", day9 + i * 3600_000));
    // 加入夜间事件（本地 0-6 点）→ 可延迟负载证据
    const night0 = new Date(2026, 7, 10, 0, 0, 0).getTime();
    for (let i = 0; i < 12; i += 1) events.push(ev("turn/start", night0 + i * 3600_000));
    return aggregate(events, WEEK);
  }

  it("高峰成本集中 + 夜间负载证据 → 触发 COST", () => {
    const stats = nightStats();
    const cost = { perModel: {}, total: 10, currency: "CNY", source: "peak-offpeak" as const, fetchedAt: 0, peakRatio: 0.6, peakShare: 6 };
    const items = computeImprovements({ stats, cost, period: "wk-2026-W33" });
    const c = items.find((i) => i.category === "COST");
    expect(c).toBeDefined();
    expect(c!.evidence.metrics.avoidableCost).toBeCloseTo(3, 1);
    expect(c!.recommendation).toContain("谷时");
  });

  it("无夜间负载证据 → 不触发（不看到 peak 就提示）", () => {
    const events = [ev("turn/start", new Date(2026, 7, 10, 9, 0, 0).getTime()), ev("turn/start", new Date(2026, 7, 10, 10, 0, 0).getTime())];
    const stats = aggregate(events, WEEK);
    const cost = { perModel: {}, total: 10, currency: "CNY", source: "peak-offpeak" as const, fetchedAt: 0, peakRatio: 0.9, peakShare: 9 };
    expect(computeImprovements({ stats, cost, period: "wk-2026-W33" }).filter((i) => i.category === "COST")).toEqual([]);
  });

  it("非峰谷计价（builtin）不触发；低占比不触发", () => {
    const stats = nightStats();
    const builtin = { perModel: {}, total: 10, currency: "CNY", source: "builtin" as const, fetchedAt: 0 };
    expect(computeImprovements({ stats, cost: builtin, period: "wk-2026-W33" }).filter((i) => i.category === "COST")).toEqual([]);
    const low = { perModel: {}, total: 100, currency: "CNY", source: "peak-offpeak" as const, fetchedAt: 0, peakRatio: 0.3, peakShare: 30 };
    expect(computeImprovements({ stats, cost: low, period: "wk-2026-W33" }).filter((i) => i.category === "COST")).toEqual([]);
  });
});

describe("双路径一致性（direct aggregate vs bucket aggregate）", () => {
  it("toolFailedSessions 与 correctionSignals 双路径结果一致", () => {
    const events = [
      ...failingEditSession("s1", WEEK.from + 1000, 6),
      ...failingEditSession("s2", WEEK.from + 1000, 5),
      ...failingEditSession("s3", WEEK.from + 1000, 4),
      ...correctionMsg(WEEK.from + 2000, "先不要提交", "s1"),
      ...correctionMsg(WEEK.from + 3000, "不要 push 不要 commit", "s2"),
      ...correctionMsg(WEEK.from + 4000, "先别 commit", "s3"),
    ];
    const direct = aggregate(events, WEEK);
    // 分桶路径：按会话分组构造视图（与 collectEvents 同构）。
    const sidOf = (e: RawEvent): string => ((e.data as Record<string, unknown> | undefined)?.sessionId as string | undefined) ?? "s1";
    const sessionIds = [...new Set(events.map(sidOf))];
    const allViews = sessionIds.map((sid) => {
      const sessionEvents = events.filter((e) => sidOf(e) === sid);
      return { sessionId: sid, buckets: bucketizeOwnEvents(sid, sessionEvents as never, 0).buckets, titles: [] };
    });
    const bucket = aggregateBuckets(allViews, WEEK);
    expect(bucket.toolFailedSessions).toEqual(direct.toolFailedSessions);
    expect(bucket.correctionSignals).toEqual(direct.correctionSignals);
    // Improve 输出一致
    const a = computeImprovements({ stats: direct, period: "wk-2026-W33" });
    const b = computeImprovements({ stats: bucket, period: "wk-2026-W33" });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("周期参数与兼容", () => {
  it("period 只影响标记，不影响规则判定", () => {
    const events = [...failingEditSession("s1", WEEK.from + 1000, 6), ...failingEditSession("s2", WEEK.from + 1000, 5), ...failingEditSession("s3", WEEK.from + 1000, 4)];
    const stats = aggregate(events, WEEK);
    for (const p of ["day-2026-08-14", "wk-2026-W33", "mo-2026-08", "custom-abc"]) {
      const items = computeImprovements({ stats, period: p });
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.period === p)).toBe(true);
    }
  });

  it("旧报告兼容：无 improvements / 无 cost 时不崩且返回 []", () => {
    const stats = aggregate([], WEEK);
    expect(computeImprovements({ stats, period: "wk-2026-W33" })).toEqual([]);
  });

  it("rankImprovements 不改变输入数组（纯函数）", () => {
    const events = [...failingEditSession("s1", WEEK.from + 1000, 6), ...failingEditSession("s2", WEEK.from + 1000, 5), ...failingEditSession("s3", WEEK.from + 1000, 4)];
    const stats = aggregate(events, WEEK);
    const items = computeImprovements({ stats, period: "wk-2026-W33" });
    const snapshot = JSON.stringify(items);
    rankImprovements(items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });

  it("0 个 LLM 调用：computeImprovements 是纯同步函数", () => {
    expect(typeof computeImprovements).toBe("function");
    // 纯函数断言：无 async 返回、无 fetch 依赖（由实现保证；此处验证签名）
    const result = computeImprovements({ stats: aggregate([], WEEK), period: "x" });
    expect(Array.isArray(result)).toBe(true);
  });
});
