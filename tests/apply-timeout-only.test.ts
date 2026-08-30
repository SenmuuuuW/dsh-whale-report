/**
 * P0 语义（Phase 1.5 §1/§2）：timeout-only 工具必须能进入 Improve → Proposal 链。
 * fixture：3 会话 × 2 次确定性 timeout，ZERO 硬失败（isError=0）。
 * 预期：
 * - computeImprovements 产生 improve-tool-bash（reasonKind="timeout"，稳定 id）
 * - buildShellTimeoutProposal 生成 eligible proposal
 * - Tool Health 语义不变（failureRate 仍为 0，dashboard 不重分类）
 */
import { describe, expect, it } from "vitest";
import { computeImprovements } from "../src/improvements.js";
import { buildShellTimeoutProposal } from "../src/apply/proposal.js";
import { aggregateBuckets, bucketizeOwnEvents, emptyPartial } from "../src/stats.js";
import { bashTimedOutResult, ev, toolPair } from "./apply-harness.js";

const NOW = Date.now();
const LOOKBACK = 7 * 24 * 60 * 60 * 1000;

/** 构造 timeout-only 会话事件（无任何硬失败）。 */
function timeoutOnlySession(sid: string, t0: number, timeouts: number, normalCalls: number): { type: string; seq: number; time: number; data: Record<string, unknown> }[] {
  const events: { type: string; seq: number; time: number; data: Record<string, unknown> }[] = [];
  let seq = 0;
  for (let i = 0; i < normalCalls; i++) {
    const t = t0 + i * 60_000;
    events.push(ev("turn/start", t, {}));
    events.push(...toolPair("bash", `n-${sid}-${i}`, t + 1000, { message: { source: { callId: `n-${sid}-${i}` }, content: [{ type: "text", text: "ok" }] } }));
    events.push(ev("assistant/message", t + 9000, { usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, reasoningTokens: 0 } }));
  }
  for (let i = 0; i < timeouts; i++) {
    const t = t0 + (normalCalls + i) * 60_000;
    events.push(ev("turn/start", t, {}));
    events.push(...toolPair("bash", `to-${sid}-${i}`, t + 1000, bashTimedOutResult(`to-${sid}-${i}`, 60_000)));
    events.push(ev("assistant/message", t + 61_000, { usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, reasoningTokens: 0 } }));
  }
  events.forEach((e, i) => { e.seq = i + 1; });
  return events;
}

function buildStats(sessions: { type: string; seq: number; time: number; data: Record<string, unknown> }[][]) {
  const period = { from: NOW - LOOKBACK, to: NOW + 3600_000 };
  const views = sessions.map((events, i) => {
    const built = bucketizeOwnEvents(`s${i + 1}`, events, 0);
    return { sessionId: `s${i + 1}`, buckets: built.buckets, titles: [] };
  });
  const headers = sessions.map((_, i) => ({ id: `s${i + 1}`, createdAt: NOW - LOOKBACK + 1000 }));
  return aggregateBuckets(views, period, headers, emptyPartial());
}

describe("P0: timeout-only 语义（§1/§2）", () => {
  const t0 = NOW - 2 * 24 * 60 * 60 * 1000;
  const sessions = [
    timeoutOnlySession("a", t0, 2, 10),
    timeoutOnlySession("b", t0 + 3600_000, 2, 10),
    timeoutOnlySession("c", t0 + 7200_000, 2, 10),
  ];

  it("timeout-only（0 硬失败）能产生 improve-tool-bash, reasonKind=timeout, 稳定 id", () => {
    const stats = buildStats(sessions);
    // Tool Health 语义不变：failureRate = 0
    const bash = stats.toolHealth.find((h) => h.name === "bash");
    expect(bash?.failed).toBe(0);
    expect(bash?.failureRate).toBe(0);
    // Improve 链必须产生条目
    const items = computeImprovements({ stats, period: "wk-1", failedSessions: stats.toolFailedSessions, corrections: stats.correctionSignals });
    const item = items.find((i) => i.id === "improve-tool-bash");
    expect(item).toBeDefined();
    expect(item!.reasonKind).toBe("timeout");
    expect(item!.evidence.metrics.timeouts).toBe(6);
    expect(item!.evidence.metrics.hardFailures).toBe(0);
    expect(item!.title).toMatch(/超时/);
    expect(item!.title).not.toMatch(/失败/);
  });

  it("timeout-only 能生成 eligible shell.timeoutMs Proposal（不跳层）", () => {
    const stats = buildStats(sessions);
    const items = computeImprovements({ stats, period: "wk-1", failedSessions: stats.toolFailedSessions, corrections: stats.correctionSignals });
    const item = items.find((i) => i.id === "improve-tool-bash") ?? null;
    const p = buildShellTimeoutProposal({ improvement: item, stats, settings: { value: 60_000, maxTimeoutMs: 600_000, revision: 0 }, now: NOW });
    expect(p).not.toBeNull();
    expect(p!.expectedBefore).toBe(60_000);
    expect(p!.proposedAfter).toBe(120_000);
    expect(p!.evidence.timeoutCount).toBe(6);
    expect(p!.evidence.timeoutSessions.length).toBe(3);
  });

  it("timeout evidence 不足（<5 或 <3 会话）不产生 Improve 也不产生 Proposal", () => {
    const weak = [
      timeoutOnlySession("a", t0, 2, 10),
      timeoutOnlySession("b", t0 + 3600_000, 2, 10),
      timeoutOnlySession("c", t0 + 7200_000, 1, 10), // 总数 5 但... 5 达标; 改成 0 → 4
    ];
    weak[2] = timeoutOnlySession("c", t0 + 7200_000, 0, 10);
    const stats = buildStats(weak);
    const items = computeImprovements({ stats, period: "wk-1", failedSessions: stats.toolFailedSessions, corrections: stats.correctionSignals });
    expect(items.find((i) => i.id === "improve-tool-bash")).toBeUndefined();
    expect(buildShellTimeoutProposal({ improvement: null, stats, settings: { value: 60_000, maxTimeoutMs: 600_000, revision: 0 }, now: NOW })).toBeNull();
  });

  it("硬失败 + timeout 混合 → reasonKind=failure+timeout（一个条目, 不重复生成）", () => {
    const sessions2 = sessions.map((s, i) => {
      // 给每个会话加 8 个 ENOENT 硬失败（达到既有阈值）
      const extra = [];
      for (let k = 0; k < 8; k++) {
        const t = NOW - 3 * 24 * 60 * 60 * 1000 + i * 3600_000 + k * 60_000;
        extra.push(ev("turn/start", t, {}));
        extra.push(...toolPair("bash", `e-${i}-${k}`, t + 1000, { error: { code: "ENOENT", name: "FsError" }, message: { source: { callId: `e-${i}-${k}` }, content: [{ type: "text", text: "Error" }] } }));
      }
      return [...s, ...extra];
    });
    const stats = buildStats(sessions2);
    const items = computeImprovements({ stats, period: "wk-1", failedSessions: stats.toolFailedSessions, corrections: stats.correctionSignals });
    const bashItems = items.filter((i) => i.id === "improve-tool-bash");
    expect(bashItems.length).toBe(1); // 不重复
    expect(bashItems[0].reasonKind).toBe("failure+timeout");
    expect(bashItems[0].evidence.metrics.timeouts).toBe(6);
  });

  it("既有硬失败 Improve 语义不变（无 timeout 证据时 reasonKind 缺省/failure）", () => {
    const h = { name: "bash", calls: 300, completed: 260, failed: 40, incomplete: 0, successRate: 0.8667, failureRate: 0.1333, avgDurationMs: 5000, p50DurationMs: 4000, p95DurationMs: 12000, errorCodes: { ENOENT: 30 } };
    const stats = buildStats([]);
    stats.toolHealth = [h];
    stats.toolFailedSessions = { bash: ["s1", "s2", "s3", "s4"] };
    const items = computeImprovements({ stats, period: "wk-1", failedSessions: stats.toolFailedSessions, corrections: stats.correctionSignals });
    const item = items.find((i) => i.id === "improve-tool-bash");
    expect(item).toBeDefined();
    expect(item!.reasonKind).toBe("failure");
    expect(item!.title).toMatch(/失败/);
  });
});
