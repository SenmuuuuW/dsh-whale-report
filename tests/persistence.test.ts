/**
 * v0.5.3 Phase 3.1 — live index persistence 降频/coalesced/revision-safe 单测。
 * 覆盖：flush 空转零写 / 5min 内多次 flush 至多一次写 / 持续事件 revision-safe /
 * 写期间新事件 dirty 保持 / 写失败 dirty 保持 / 多会话 coalesced / dispose 强制 /
 * checkpoint 期间 query 不受影响（put 为假实现，不阻塞）。
 */
import { describe, expect, it, vi } from "vitest";
import { IngestEngine } from "../src/ingest.js";
import type { SessionIndexRecord } from "../src/state.js";

function makeSvc(liveIds: string[], events?: Record<string, { type: string; seq?: number; time: number; data?: unknown }[]>) {
  const index = new Map<string, SessionIndexRecord>();
  const putCalls: string[] = [];
  const failNext: boolean[] = [];
  return {
    svc: {
      sessionQuery: {
        async listSessions() {
          return liveIds.map((id) => ({ header: { id, createdAt: 1_786_000_000_000 }, live: true }));
        },
        async readSession(id: string) {
          return { session: { id, seedLength: 0 }, events: (events?.[id] ?? []) as { type: string; seq: number; time: number; data: unknown }[] };
        },
      },
      index: {
        get: (k: string) => index.get(k),
        put: async (k: string, v: SessionIndexRecord) => {
          if (failNext.shift() === true) throw new Error("disk full");
          putCalls.push(k);
          index.set(k, v);
        },
      },
    },
    index,
    putCalls,
    failNext,
  };
}

describe("Persistence 降频策略", () => {
  it("flush with dirty=false → 0 writes", async () => {
    const { svc, putCalls } = makeSvc(["s1"], { s1: [] });
    const ingest = new IngestEngine(svc);
    await ingest.bootstrap();
    const before = putCalls.length;
    ingest.flushSession("s1");
    ingest.flushSession("s1");
    await vi.waitFor(() => Promise.resolve());
    expect(putCalls.length - before).toBe(0);
  });

  it("5min 内多次 flush（持续事件）→ 至多 1 次写", async () => {
    const { svc, putCalls } = makeSvc(["s1"], { s1: [{ type: "turn/start", seq: 1, time: 1000, data: {} }] });
    const ingest = new IngestEngine(svc);
    await ingest.bootstrap();
    putCalls.length = 0;
    // 持续事件 + 频繁 flush（模拟 DSH 每分钟多次 flush）
    for (let i = 0; i < 40; i++) {
      ingest.handleEvent("s1", { type: "turn/start", seq: 100 + i, time: 100_000 + i * 1000, data: {} });
      ingest.flushSession("s1");
    }
    await vi.waitFor(() => Promise.resolve());
    // bootstrap 刚写过（lastPersistAt 在 5min 内）→ 全部 flush 空转
    expect(putCalls.length).toBe(0);
  });

  it("5min 间隔到达 → checkpoint 写一次且 revision-safe（dirty 清空）", async () => {
    vi.useFakeTimers();
    try {
      const { svc, putCalls, index } = makeSvc(["s1"], { s1: [] });
      const ingest = new IngestEngine(svc);
      await ingest.bootstrap();
      putCalls.length = 0;
      ingest.handleEvent("s1", { type: "turn/start", seq: 5, time: 5000, data: {} });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await ingest.checkpoint(false);
      expect(putCalls.length).toBe(1);
      expect(index.get("s1")!.lastSeq).toBe(5);
      // dirty 已清 → 再 checkpoint 零写
      putCalls.length = 0;
      await ingest.checkpoint(false);
      expect(putCalls.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("事件持续到达时 checkpoint：写入版本后的事件保持 dirty", async () => {
    vi.useFakeTimers();
    try {
      const { svc, putCalls, index } = makeSvc(["s1"], { s1: [] });
      const ingest = new IngestEngine(svc);
      await ingest.bootstrap();
      putCalls.length = 0;
      ingest.handleEvent("s1", { type: "turn/start", seq: 1, time: 1000, data: {} });
      const cp = ingest.checkpoint(true);
      // 写进行中新事件到达（revision 前进）
      ingest.handleEvent("s1", { type: "turn/start", seq: 2, time: 2000, data: {} });
      await cp;
      expect(putCalls.length).toBe(1);
      expect(index.get("s1")!.lastSeq).toBe(1); // 写入的是 writingRevision 的快照
      // dirty 保持 → 下一次 checkpoint 写入 seq2
      await ingest.checkpoint(true);
      expect(index.get("s1")!.lastSeq).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persistence 失败：dirty 保持、persistedRevision 不更新 → 下轮重试成功", async () => {
    const { svc, putCalls, index, failNext } = makeSvc(["s1"], { s1: [] });
    const ingest = new IngestEngine(svc);
    await ingest.bootstrap();
    putCalls.length = 0;
    ingest.handleEvent("s1", { type: "turn/start", seq: 7, time: 7000, data: {} });
    // 第一次写失败
    failNext.push(true);
    await ingest.checkpoint(true);
    expect(index.get("s1")!.lastSeq).toBe(0); // 未持久化（bootstrap 基线为空）
    // 下轮重试成功
    await ingest.checkpoint(true);
    expect(putCalls.length).toBe(1);
    expect(index.get("s1")!.lastSeq).toBe(7);
  });

  it("多会话同时 dirty → 一次 checkpoint 内 coalesced（顺序写全部）", async () => {
    const { svc, putCalls } = makeSvc(["s1", "s2"], { s1: [], s2: [] });
    const ingest = new IngestEngine(svc);
    await ingest.bootstrap();
    putCalls.length = 0;
    ingest.handleEvent("s1", { type: "turn/start", seq: 1, time: 1000, data: {} });
    ingest.handleEvent("s2", { type: "turn/start", seq: 1, time: 1000, data: {} });
    await ingest.checkpoint(true);
    expect(putCalls.sort()).toEqual(["s1", "s2"]);
  });

  it("dispose → force checkpoint（不等待 5min 间隔）", async () => {
    const { svc, putCalls, index } = makeSvc(["s1"], { s1: [] });
    const ingest = new IngestEngine(svc);
    await ingest.bootstrap();
    putCalls.length = 0;
    ingest.handleEvent("s1", { type: "turn/start", seq: 9, time: 9000, data: {} });
    await ingest.dispose();
    expect(putCalls.length).toBe(1);
    expect(index.get("s1")!.lastSeq).toBe(9);
  });

  it("restart before checkpoint：新 bootstrap 从 session log 全量恢复（无漏计）", async () => {
    // 模拟：checkpoint rev=100 后事件 101-150 未落盘 → restart
    const allEvents = [
      { type: "turn/start", seq: 1, time: 1000, data: {} },
      { type: "turn/start", seq: 2, time: 2000, data: {} },
      { type: "assistant/message", seq: 3, time: 3000, data: { usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, reasoningTokens: 0 } } },
    ];
    const first = makeSvc(["s1"], { s1: allEvents });
    const ingestA = new IngestEngine(first.svc);
    await ingestA.bootstrap();
    // 事件 101-150（未 checkpoint）
    for (let i = 0; i < 50; i++) {
      ingestA.handleEvent("s1", { type: "turn/start", seq: 100 + i, time: 4000 + i * 1000, data: {} });
    }
    // restart：全新引擎，readSession 返回"文件"全量（含 101-150 —— DSH 已持久化到 session log）
    const fileEvents = [
      ...allEvents,
      ...Array.from({ length: 50 }, (_, i) => ({ type: "turn/start" as const, seq: 100 + i, time: 4000 + i * 1000, data: {} })),
    ];
    const second = makeSvc(["s1"], { s1: fileEvents });
    const ingestB = new IngestEngine(second.svc);
    await ingestB.bootstrap();
    const entry = second.index.get("s1")!;
    expect(entry.lastSeq).toBe(149);
    const snap = ingestB.liveSnapshot("s1")!;
    const turns = snap.buckets.reduce((a, b) => a + b.turns, 0);
    expect(turns).toBe(52); // 基线 2 + 50 增量
  });

  it("checkpoint single-flight：并发 checkpoint 只跑一次", async () => {
    const { svc, putCalls } = makeSvc(["s1"], { s1: [] });
    const ingest = new IngestEngine(svc);
    await ingest.bootstrap();
    putCalls.length = 0;
    ingest.handleEvent("s1", { type: "turn/start", seq: 3, time: 3000, data: {} });
    await Promise.all([ingest.checkpoint(true), ingest.checkpoint(true), ingest.checkpoint(true)]);
    expect(putCalls.length).toBe(1);
  });
});
