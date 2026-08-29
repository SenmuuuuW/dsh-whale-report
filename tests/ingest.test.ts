/**
 * v0.5.x Phase 3 — IngestEngine firehose 语义单测：
 * seq dedupe / buffering race（event 先于基线到达）/ steady-state 增量 /
 * 无 seq 事件 / disposed 落盘 / 未知会话忽略（silent miss 防护 = fingerprint reconcile 兜底）。
 */
import { describe, expect, it } from "vitest";
import { IngestEngine } from "../src/ingest.js";
import type { SessionIndexRecord } from "../src/state.js";

function makeSvc(events?: Record<string, { type: string; seq?: number; time: number; data?: unknown }[]>) {
  const index = new Map<string, SessionIndexRecord>();
  return {
    svc: {
      sessionQuery: {
        async listSessions() {
          return [{ header: { id: "s-live", createdAt: 1_786_000_000_000 }, live: true }];
        },
        async readSession(id: string) {
          return { session: { id, seedLength: 0 }, events: (events?.[id] ?? []) as { type: string; seq: number; time: number; data: unknown }[] };
        },
      },
      index: {
        get: (k: string) => index.get(k),
        put: async (k: string, v: SessionIndexRecord) => {
          index.set(k, v);
        },
      },
    },
    index,
  };
}

describe("IngestEngine firehose", () => {
  it("bootstrap 基线 + buffered event seq 去重（event 先于基线到达）", async () => {
    const baseline = [
      { type: "turn/start", seq: 1, time: 1000, data: {} },
      { type: "assistant/message", seq: 2, time: 2000, data: { usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, reasoningTokens: 0 } } },
    ];
    const { svc, index } = makeSvc({ "s-live": baseline });
    const ingest = new IngestEngine(svc);
    const boot = ingest.bootstrap();
    // bootstrap 中：event 先到 → buffering
    ingest.handleEvent("s-live", { type: "turn/start", seq: 3, time: 3000, data: {} });
    ingest.handleEvent("s-live", { type: "turn/start", seq: 2, time: 2000, data: {} }); // 与基线重复 → 去重
    ingest.handleEvent("s-live", { type: "turn/start", seq: 1, time: 1000, data: {} }); // 重复 → 去重
    await boot;
    const entry = index.get("s-live")!;
    // 基线 2 事件 + buffered seq 3（seq 1/2 去重）
    expect(entry.v).toBe(16);
    expect(entry.lastSeq).toBe(3);
    // steady-state：seq 4 增量
    ingest.handleEvent("s-live", { type: "turn/start", seq: 4, time: 4000, data: {} });
    ingest.handleEvent("s-live", { type: "turn/start", seq: 4, time: 4000, data: {} }); // 重复 → 忽略
    const snap = ingest.liveSnapshot("s-live")!;
    // turns: 基线 1 + seq3 + seq4 = 3
    expect(snap.buckets.reduce((a, b) => a + b.turns, 0)).toBe(3);
  });

  it("无 seq 事件（salvage 语义）按时间序应用且不 crash", async () => {
    const { svc } = makeSvc({ "s-live": [] });
    const ingest = new IngestEngine(svc);
    await ingest.bootstrap();
    ingest.handleEvent("s-live", { type: "turn/start", time: 5000, data: {} });
    ingest.handleEvent("s-live", { type: "turn/start", time: 4000, data: {} });
    const snap = ingest.liveSnapshot("s-live")!;
    expect(snap.buckets.reduce((a, b) => a + b.turns, 0)).toBe(2);
  });

  it("disposed：落盘最终态并移除内存态", async () => {
    const { svc, index } = makeSvc({ "s-live": [{ type: "turn/start", seq: 1, time: 1000, data: {} }] });
    const ingest = new IngestEngine(svc);
    await ingest.bootstrap();
    ingest.handleEvent("s-live", { type: "turn/start", seq: 2, time: 2000, data: {} });
    await ingest.handleDisposed("s-live");
    expect(ingest.liveSnapshot("s-live")).toBeNull();
    expect(index.get("s-live")!.lastSeq).toBe(2);
  });

  it("未知会话事件被忽略（firehose 之外由 fingerprint reconcile 兜底，不静默丢）", async () => {
    const { svc, index } = makeSvc({ "s-live": [] });
    const ingest = new IngestEngine(svc);
    await ingest.bootstrap();
    ingest.handleEvent("s-unknown", { type: "turn/start", seq: 1, time: 1000, data: {} });
    expect(index.has("s-unknown")).toBe(false);
  });
});
