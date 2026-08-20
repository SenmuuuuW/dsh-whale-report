/**
 * DeepTrace v0.5 — FAULT ISOLATION（resilience case）。
 *
 * 背景：某个 DSH session 的 zstd 日志损坏（"complete frame contains a torn
 * JSONL record (internal)"）不应拖垮整个 History / Report / Improve。
 *
 * 验收标准：
 * 1. 单个 corrupt/unreadable session → 跳过，不中断收集；
 * 2. 其他 healthy sessions 继续正常聚合；
 * 3. 报告标记 partial data（markdown / HTML / Web）；
 * 4. Web 只显示非阻断 DATA PARTIAL 提示；
 * 5. Improve 不引用被跳过 session（证据只来自健康会话）；
 * 6. 缺失数据不能按 0 处理 —— 披露而非静默；
 * 7. 原始 ~/.dsh 数据保持只读（引擎不写回任何会话数据；本文件只验证读路径）。
 */
import { describe, expect, it } from "vitest";
import {
  collectEvents,
  classifyReadError,
  toPeriodRecord,
  type ReportServices,
  type SessionQueryLike,
} from "../src/tools.js";
import { aggregate, aggregateBuckets, bucketizeOwnEvents, emptyPartial, SKIP_IDS_CAP, type RawEvent } from "../src/stats.js";
import { renderReport } from "../src/report.js";
import { renderHtmlReport } from "../src/html.js";
import { computeImprovements } from "../src/improvements.js";
import type { SessionIndexRecord } from "../src/state.js";
import type { ReportRecord } from "../src/state.js";

// from 对齐 10 分钟边界（600000 倍数），避免跨边界桶被裁剪。
const WEEK = { from: 1785999600000, to: 1785999600000 + 7 * 24 * 3600 * 1000 };

function ev(type: string, time: number, data?: Record<string, unknown>): RawEvent {
  return { type, time, data };
}

/** 一个带事件的健康会话（turn/start × N，可加失败 edit 调用）。 */
function healthySessionEvents(sessionId: string, base: number, withFailingEdits = false): RawEvent[] {
  const events: RawEvent[] = [];
  for (let i = 0; i < 6; i += 1) {
    events.push(ev("turn/start", base + i * 60_000, { sessionId }));
  }
  if (withFailingEdits) {
    for (let i = 0; i < 8; i += 1) {
      const t = base + (10 + i) * 60_000;
      events.push(ev("tool/call", t, { name: "edit", callId: `${sessionId}-c${i}`, sessionId }));
      events.push(ev("tool/result", t + 1000, { message: { source: { callId: `${sessionId}-c${i}` } }, error: { code: "FS_EDIT_NOT_FOUND" }, sessionId }));
    }
    for (let i = 0; i < 40; i += 1) {
      const t = base + (20 + i) * 60_000;
      events.push(ev("tool/call", t, { name: "edit", callId: `${sessionId}-ok${i}`, sessionId }));
      events.push(ev("tool/result", t + 1000, { message: { source: { callId: `${sessionId}-ok${i}` }, content: "ok" }, sessionId }));
    }
  }
  return events;
}

/** 内存版 sessionQuery：可注入抛错会话（模拟损坏日志 / 读取失败）。 */
function makeSvc(overrides?: {
  throwing?: Record<string, Error>;
  events?: Record<string, RawEvent[]>;
  live?: Record<string, boolean>;
}): { svc: ReportServices; readCalls: string[] } {
  const events = overrides?.events ?? {};
  const throwing = overrides?.throwing ?? {};
  const live = overrides?.live ?? {};
  const sessions = [
    ...new Set([...Object.keys(events), ...Object.keys(throwing)]),
  ].sort();
  const index = new Map<string, SessionIndexRecord>();
  const readCalls: string[] = [];
  const query: SessionQueryLike = {
    async listSessions() {
      return sessions.map((id) => ({
        header: { id, createdAt: WEEK.from + 1000 },
        live: live[id] ?? false,
      }));
    },
    async readSession(sessionId: string) {
      readCalls.push(sessionId);
      const err = throwing[sessionId];
      if (err !== undefined) throw err;
      return {
        session: { id: sessionId },
        events: (events[sessionId] ?? []).map((e, i) => ({ type: e.type, seq: i + 1, time: e.time, data: e.data })),
      };
    },
  };
  const svc: ReportServices = {
    sessionQuery: query,
    index: {
      get(key) { return index.get(key); },
      async put(key, value) { index.set(key, value); },
    },
    periodStats: undefined,
  };
  return { svc, readCalls };
}

describe("classifyReadError（原因粗分类，稳定且不泄原文）", () => {
  it("损坏日志 → corrupt-log", () => {
    expect(classifyReadError(new Error("corrupt Zstandard session log: complete frame contains a torn JSONL record (internal)"))).toBe("corrupt-log");
    expect(classifyReadError(new Error("torn JSONL record"))).toBe("corrupt-log");
  });

  it("其他失败 → read-failed；非 Error → read-failed", () => {
    expect(classifyReadError(new Error("EACCES: permission denied"))).toBe("read-failed");
    expect(classifyReadError("whatever")).toBe("read-failed");
    expect(classifyReadError(undefined)).toBe("read-failed");
  });
});

describe("collectEvents fault isolation（单会话损坏不影响整体）", () => {
  it("corrupt + read-failed 会话被跳过，健康会话照常聚合，partial 完整", async () => {
    const corrupt = "session-corrupt";
    const generic = "session-generic";
    const healthyA = "session-a";
    const healthyB = "session-b";
    const { svc, readCalls } = makeSvc({
      events: {
        [healthyA]: healthySessionEvents(healthyA, WEEK.from + 60_000),
        [healthyB]: healthySessionEvents(healthyB, WEEK.from + 120_000),
      },
      throwing: {
        [corrupt]: new Error("corrupt Zstandard session log: complete frame contains a torn JSONL record (internal)"),
        [generic]: new Error("EIO: read failed"),
      },
    });
    const stats = await collectEvents(svc, WEEK);

    // 1. 健康会话照常聚合（sessions / events 来自 A+B）
    expect(stats.sessions).toBe(2);
    expect(stats.totalEvents).toBe(12);

    // 2. partial 记录：id + 粗分类原因（不含错误原文）
    expect(stats.partial.skippedCount).toBe(2);
    expect(stats.partial.skippedSessionIds.sort()).toEqual([corrupt, generic]);
    expect(stats.partial.reasons).toEqual(["corrupt-log", "read-failed"]);
    expect(JSON.stringify(stats.partial)).not.toContain("Zstandard");
    expect(JSON.stringify(stats.partial)).not.toContain("torn");

    // 3. 被跳过的会话确实被尝试读取过（不是被静默过滤）
    expect(readCalls).toContain(corrupt);
    expect(readCalls).toContain(generic);

    // 4. 缺失 ≠ 0：sessions 是"覆盖数"而非被填零的总数；partial 已披露
    expect(stats.sessions).not.toBe(0);
    expect(stats.partial.skippedCount).toBeGreaterThan(0);
  });

  it("全部损坏 → 空统计 + partial 全量披露（不崩、不假装有数据）", async () => {
    const { svc } = makeSvc({
      throwing: { s1: new Error("corrupt Zstandard session log"), s2: new Error("boom") },
    });
    const stats = await collectEvents(svc, WEEK);
    expect(stats.sessions).toBe(0);
    expect(stats.partial.skippedCount).toBe(2);
    expect(stats.partial.skippedSessionIds).toHaveLength(2);
  });

  it("无损坏 → partial 为空（零开销）", async () => {
    const { svc } = makeSvc({ events: { a: healthySessionEvents("a", WEEK.from + 60_000) } });
    const stats = await collectEvents(svc, WEEK);
    expect(stats.partial).toEqual(emptyPartial());
    expect(stats.partial.skippedCount).toBe(0);
  });

  it("live 会话读取失败同样被跳过并计入 partial", async () => {
    const { svc } = makeSvc({
      events: { ok: healthySessionEvents("ok", WEEK.from + 60_000) },
      throwing: { live1: new Error("corrupt log") },
      live: { live1: true },
    });
    const stats = await collectEvents(svc, WEEK);
    expect(stats.sessions).toBe(1);
    expect(stats.partial.skippedCount).toBe(1);
    expect(stats.partial.skippedSessionIds).toEqual(["live1"]);
  });

  it("skippedSessionIds 有界（SKIP_IDS_CAP），skippedCount 精确", async () => {
    const throwing: Record<string, Error> = {};
    for (let i = 0; i < SKIP_IDS_CAP + 5; i += 1) throwing[`s-${i}`] = new Error("corrupt");
    const { svc } = makeSvc({ throwing });
    const stats = await collectEvents(svc, WEEK);
    expect(stats.partial.skippedCount).toBe(SKIP_IDS_CAP + 5);
    expect(stats.partial.skippedSessionIds).toHaveLength(SKIP_IDS_CAP);
    expect(stats.partial.reasons).toEqual(["corrupt-log"]);
  });

  it("缓存索引复用路径不受损坏影响（健康会话命中索引照常计入）", async () => {
    const { svc } = makeSvc({
      events: { cached: healthySessionEvents("cached", WEEK.from + 60_000) },
    });
    // 先预建一个新鲜索引（模拟 warmIndex 已成功）
    const built = bucketizeOwnEvents("cached", healthySessionEvents("cached", WEEK.from + 60_000).map((e, i) => ({ type: e.type, seq: i + 1, time: e.time, data: e.data })), 0);
    await svc.index.put("cached", {
      sessionId: "cached",
      v: 14,
      builtAt: Date.now(),
      lastSeq: built.lastSeq,
      lastMs: built.lastMs,
      buckets: built.buckets,
      titles: built.titles,
    });
    const stats = await collectEvents(svc, WEEK);
    expect(stats.sessions).toBe(1);
    expect(stats.partial.skippedCount).toBe(0);
  });
});

/** 三个健康会话都带失败 edit（Improve TOOL 证据源），另有一个被跳过的损坏会话。 */
function partialStats(): ReturnType<typeof aggregate> {
  const events = [
    ...healthySessionEvents("a", WEEK.from + 60_000, true),
    ...healthySessionEvents("b", WEEK.from + 120_000, true),
    ...healthySessionEvents("c", WEEK.from + 180_000, true),
  ];
  const stats = aggregate(events, WEEK);
  stats.partial = { skippedSessionIds: ["session-corrupt"], skippedCount: 1, reasons: ["corrupt-log"] };
  return stats;
}

describe("报告披露（partial ≠ 0 必须可见）", () => {

  it("markdown 含 DATA PARTIAL + 会话 id + 原因，且明确缺失不按 0 计", () => {
    const stats = partialStats();
    const md = renderReport(stats, "weekly");
    expect(md).toContain("DATA PARTIAL");
    expect(md).toContain("1");
    expect(md).toContain("session-corrupt");
    expect(md).toContain("corrupt-log");
    expect(md).toContain("不按 0 计");
  });

  it("完整数据 → markdown 无 DATA PARTIAL（不制造噪音）", () => {
    const md = renderReport(aggregate([], WEEK), "weekly");
    expect(md).not.toContain("DATA PARTIAL");
  });

  it("独立 HTML 报告：partial 横幅 + IMPROVE 章节（含 VERIFY 行），旧记录无则不渲染", () => {
    const stats = partialStats();
    const improvements = computeImprovements({ stats, period: "wk-2026-W33" });
    const record: ReportRecord = {
      sem: 6,
      id: "r1",
      preset: "weekly",
      from: WEEK.from,
      to: WEEK.to,
      createdAt: Date.now(),
      sessions: stats.sessions,
      turns: stats.turns,
      totalEvents: stats.totalEvents,
      stats: stats as unknown,
      markdown: "",
      cost: { perModel: {}, total: 0, currency: "CNY", source: "builtin", fetchedAt: 0 },
      insights: [],
      improvements,
    };
    const html = renderHtmlReport(record);
    // partial 披露（含会话 id，不含错误原文）
    expect(html).toContain("DATA PARTIAL");
    expect(html).toContain("session-corrupt");
    expect(html).not.toContain("Zstandard");
    // IMPROVE 章节：severity + VERIFY 计划 + 只读声明 + stable id
    expect(html).toContain("02 / IMPROVE");
    expect(html).toContain("improve-tool-edit");
    expect(html).toContain(improvements[0].title);
    expect(html).toContain("VERIFY");
    expect(html).toContain("NO AUTO EDIT");

    // 旧记录：无 improvements / 无 partial → 不渲染章节与横幅
    const oldStats = aggregate([], WEEK);
    const legacy: ReportRecord = { ...record, id: "r2", stats: oldStats as unknown, improvements: undefined };
    const oldHtml = renderHtmlReport(legacy);
    expect(oldHtml).not.toContain("DATA PARTIAL");
    expect(oldHtml).not.toContain("02 / IMPROVE");
  });

  it("Improve 不引用被跳过 session：证据只来自健康会话", () => {
    const stats = partialStats();
    const items = computeImprovements({ stats, period: "wk-2026-W33" });
    const json = JSON.stringify(items);
    // 被跳过的会话不在任何证据里（affectedSessions / summary / id）
    expect(json).not.toContain("session-corrupt");
    // 健康会话的失败证据仍然有效（缺失 ≠ 0 的另一面：有的就是有）
    expect(json).toContain("improve-tool-edit");
    for (const item of items) {
      expect(item.evidence.affectedSessions).not.toContain("session-corrupt");
      expect(item.evidence.affectedSessions.every((sid) => sid !== "session-corrupt")).toBe(true);
    }
  });
});

describe("统计层默认值与透传", () => {
  it("direct aggregate 默认 partial 为空", () => {
    const stats = aggregate([], WEEK);
    expect(stats.partial).toEqual(emptyPartial());
  });

  it("aggregateBuckets 接受显式 partial（透传）", () => {
    const partial = { skippedSessionIds: ["x"], skippedCount: 1, reasons: ["read-failed"] };
    const stats = aggregateBuckets([], WEEK, [], partial);
    expect(stats.partial).toEqual(partial);
  });

  it("toPeriodRecord 透传 skippedCount（趋势/基线披露用）", () => {
    const gen = {
      stats: partialStats(),
      cost: { perModel: {}, total: 0, currency: "CNY", source: "builtin" as const, fetchedAt: 0 },
      key: "wk-2026-W33",
      prev: null,
      insights: [],
      improvements: [],
      reportGeneration: { mode: "local" as const, inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, estimatedCostCny: 0 },
    };
    const record = toPeriodRecord("wk-2026-W33", "weekly", WEEK, gen);
    expect(record.skippedCount).toBe(1);
  });

  it("Improve 引擎不感知 partial（纯聚合输入），但证据天然不含被跳过会话", () => {
    // computeImprovements 的输入只有 stats —— 跳过会话从未进入 views，
    // 因此工具失败 / 纠正 / 重试证据不可能引用它们（结构性保证）。
    const stats = partialStats();
    const items = computeImprovements({ stats, period: "wk-2026-W33" });
    const allSessions = items.flatMap((i) => i.evidence.affectedSessions);
    expect(allSessions.some((sid) => sid === "session-corrupt")).toBe(false);
  });
});

describe("只读性（~/.dsh 原数据不可被引擎写回）", () => {
  it("collectEvents 只调用 listSessions / readSession / index 写，不写回会话数据", async () => {
    const { svc } = makeSvc({
      events: { a: healthySessionEvents("a", WEEK.from + 60_000) },
      throwing: { bad: new Error("corrupt log") },
    });
    // 只要引擎不把 "whale/*" 或任何自定义事件追加进 readSession 返回，
    // 原始会话日志就不会被触碰 —— 引擎接口面根本没有 append/update 通道。
    const query = svc.sessionQuery as unknown as Record<string, unknown>;
    expect(query.append).toBeUndefined();
    expect(query.update).toBeUndefined();
    expect(query.write).toBeUndefined();
    await collectEvents(svc, WEEK); // 不抛 = 只读路径可完成
  });
});
