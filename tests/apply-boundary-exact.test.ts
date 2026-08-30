/**
 * Phase 1.6 — Exact Verify Gate（failing tests first）。
 * 目标：timeout 统计（toolTimeouts / toolTimeoutSessions / shell_timeout_rate）
 * 必须对任意 [from,to) 精确 —— edge bucket 内的事件按逐事件时间戳过滤，
 * 绝不允许整桶丢弃 / 比例估算 / 整桶计入。
 */
import { describe, expect, it } from "vitest";
import { aggregateBuckets, bucketizeOwnEvents, emptyPartial } from "../src/stats.js";
import { shellTimeoutStats } from "../src/verify/metrics.js";
import { buildShellTimeoutProposal, SHELL_TIMEOUT_MIN_EVENTS, SHELL_TIMEOUT_MIN_SESSIONS } from "../src/apply/proposal.js";
import { computeImprovements } from "../src/improvements.js";
import { bashTimedOutResult, codeTimedOutResult, ev, toolPair } from "./apply-harness.js";
import { timeoutOracle, oracleShellRate } from "./apply-oracle.js";

const DAY = 86_400_000;

/** 构造一个会话：在给定时间点放 bash timeout / web_search code-timeout / 正常调用。 */
function mkSession(sid: string, t0: number): { sid: string; events: { type: string; seq: number; time: number; data: Record<string, unknown> }[] } {
  const events: { type: string; seq: number; time: number; data: Record<string, unknown> }[] = [];
  let seq = 0;
  const add = (e: { type: string; time: number; data: Record<string, unknown> }) => {
    seq += 1;
    events.push({ ...e, seq });
  };
  // 正常 bash 调用
  for (let i = 0; i < 5; i++) {
    const t = t0 + i * 60_000;
    add(ev("turn/start", t, {}));
    events.push(...toolPair("bash", `n-${sid}-${i}`, t + 1000, { message: { source: { callId: `n-${sid}-${i}` }, content: [{ type: "text", text: "ok" }] } }).map((e, j) => ({ ...e, seq: seq + j })));
    seq += 2;
  }
  return { sid, events };
}

function mkTimeoutEvents(sid: string, time: number, kind: "bash" | "web_search", callId: string) {
  return toolPair(kind, callId, time - 1000, kind === "bash" ? bashTimedOutResult(callId, 60_000) : codeTimedOutResult(callId));
}

function queryEngineStats(sessions: { sid: string; events: { type: string; seq: number; time: number; data: Record<string, unknown> }[] }[], from: number, to: number) {
  const views = sessions.map((s) => {
    const built = bucketizeOwnEvents(s.sid, s.events, 0);
    return { sessionId: s.sid, buckets: built.buckets, titles: [] };
  });
  const headers = sessions.map((s) => ({ id: s.sid, createdAt: from + 1000 }));
  return aggregateBuckets(views, { from, to }, headers, emptyPartial());
}

describe("Phase 1.6: timeout 精确边界（failing tests first）", () => {
  // T = 某 10 分钟分桶起点 + 2 分钟（from 切在桶中间, 逼出 edge bucket）
  const T = Date.parse("2026-08-25T10:02:00+08:00");
  const FROM = T;
  const TO = T + 30 * 60_000;

  function fixture() {
    const s1 = mkSession("s1", FROM - DAY);
    // 边界事件: T-1ms(外) T(内) T+1ms(内) T+9m59s(内) T+10m(内) TO-1ms(内) TO(外) TO+1ms(外)
    const bashEdges: [string, number][] = [
      ["to-out-pre", T - 1],
      ["to-in-0", T],
      ["to-in-1", T + 1],
      ["to-in-959", T + 9 * 60_000 + 59_000],
      ["to-in-10m", T + 10 * 60_000],
      ["to-in-to-1", TO - 1],
      ["to-out-to", TO],
      ["to-out-post", TO + 1],
    ];
    for (const [cid, t] of bashEdges) s1.events.push(...mkTimeoutEvents("s1", t, "bash", cid));
    const s2 = mkSession("s2", FROM - DAY);
    const wsEdges: [string, number][] = [
      ["ws-out-pre", T - 1],
      ["ws-in-0", T],
      ["ws-in-to-1", TO - 1],
      ["ws-out-to", TO],
    ];
    for (const [cid, t] of wsEdges) s2.events.push(...mkTimeoutEvents("s2", t, "web_search", cid));
    return [s1, s2];
  }

  it("toolTimeouts 精确 [from,to)：bash 4 个在内、4 个在外；web_search 2 内 2 外", () => {
    const sessions = fixture();
    const stats = queryEngineStats(sessions, FROM, TO);
    // 期望: bash 在内 = T, T+1ms, T+9m59s, T+10m, TO-1ms → 5? 不: T-1ms 外, T 内, T+1ms 内, T+9m59s 内, T+10m 内, TO-1ms 内 = 5 内; TO/TO+1ms 外
    expect(stats.toolTimeouts.bash).toBe(5);
    expect(stats.toolTimeouts.web_search).toBe(2);
    // 总桶计数（全量）应等于 5+3=8 bash 事件
    const all = queryEngineStats(sessions, FROM - DAY, TO + DAY);
    expect(all.toolTimeouts.bash).toBe(8);
    expect(all.toolTimeouts.web_search).toBe(4);
  });

  it("RAW TIMEOUT ORACLE == QUERY ENGINE（custom [from,to) 整数完全一致）", () => {
    const sessions = fixture();
    const oracle = timeoutOracle(sessions, FROM, TO);
    const stats = queryEngineStats(sessions, FROM, TO);
    expect(stats.toolTimeouts).toEqual(oracle.timeouts);
    expect(stats.toolCalls).toEqual(oracle.calls);
    expect(stats.toolTimeoutSessions).toEqual(oracle.timeoutSessions);
    expect(stats.toolInvocationSessions).toEqual(oracle.invocationSessions);
  });

  it("RAW TIMEOUT ORACLE == QUERY ENGINE（daily / 24h / weekly）", () => {
    const sessions = fixture();
    const now = TO + DAY;
    const windows: [string, number, number][] = [
      ["daily", Date.parse("2026-08-25T00:00:00+08:00"), now],
      ["24h", now - DAY, now],
      ["weekly", Date.parse("2026-08-24T00:00:00+08:00"), now],
    ];
    for (const [name, from, to] of windows) {
      const oracle = timeoutOracle(sessions, from, to);
      const stats = queryEngineStats(sessions, from, to);
      expect(stats.toolTimeouts, `${name} timeouts`).toEqual(oracle.timeouts);
      expect(stats.toolTimeoutSessions, `${name} timeoutSessions`).toEqual(oracle.timeoutSessions);
      expect(stats.toolInvocationSessions, `${name} invSessions`).toEqual(oracle.invocationSessions);
      expect(stats.toolCalls, `${name} calls`).toEqual(oracle.calls);
    }
  });

  it("toolTimeoutSessions 精确：窗口外 timeout 的会话绝不被带入", () => {
    // Session A: 只有窗口外 timeout（T-1ms）
    // Session B: 窗口内 timeout（T+1ms）
    const T2 = T;
    const sA = mkSession("A", FROM - DAY);
    sA.events.push(...mkTimeoutEvents("A", T2 - 1, "bash", "A-out"));
    const sB = mkSession("B", FROM - DAY);
    sB.events.push(...mkTimeoutEvents("B", T2 + 1, "bash", "B-in"));
    const stats = queryEngineStats([sA, sB], FROM, TO);
    expect(stats.toolTimeoutSessions.bash).toEqual(["B"]);
    expect(stats.toolTimeouts.bash).toBe(1);
  });

  it("false-VERIFIED sentinel：observation 窗口内 1 个 timeout 在 from edge bucket → 必须计入 numerator", () => {
    // baseline 高 timeout rate；observation 窗口 [FROM, TO) 内只有一个 timeout（恰在 from edge bucket 内）
    const baselineSessions = [mkSession("base1", FROM - 3 * DAY), mkSession("base2", FROM - 3 * DAY), mkSession("base3", FROM - 3 * DAY)];
    for (let i = 0; i < 3; i++) {
      const s = baselineSessions[i];
      for (let k = 0; k < 3; k++) s.events.push(...mkTimeoutEvents(s.sid, FROM - 3 * DAY + (i * 3 + k) * 60_000, "bash", `${s.sid}-t${k}`));
    }
    const obs = [mkSession("o1", FROM), mkSession("o2", FROM + 60_000), mkSession("o3", FROM + 120_000)];
    // 唯一观察窗口 timeout：FROM + 1ms（from edge bucket 的有效区间内）
    obs[0].events.push(...mkTimeoutEvents("o1", FROM + 1, "bash", "o1-edge"));
    const all = [...baselineSessions, ...obs];
    const stats = queryEngineStats(all, FROM, TO);
    const metric = shellTimeoutStats(stats);
    // 如果边缘 timeout 被漏掉: timeouts=0 → rate=0 → 会错误 VERIFIED；
    // 精确实现: timeouts=1, calls=15, rate=6.67% > target(基线 9/15=60% → min(30%,8%)=8%… 此处直接断言计数)
    expect(metric.timeouts).toBe(1);
    expect(metric.invocations).toBe(15);
    expect(metric.sessions).toBe(3);
  });

  it("Proposal eligibility 边界：5 timeout / 3 sessions 含 edge bucket 事件仍 eligible", () => {
    // 5 个 bash timeout 跨 3 会话，其中 2 个在 edge bucket
    const sessions = [mkSession("p1", FROM - DAY), mkSession("p2", FROM - DAY), mkSession("p3", FROM - DAY)];
    const times = [T - 1, T + 1, T + 5 * 60_000, TO - 1, TO + 1]; // 2 个窗口外、3 个窗口内 → 需要 ≥5 窗口内
    // 调整为: 5 个窗口内, 部分落在 edge bucket
    const times2 = [T, T + 1, T + 5 * 60_000, TO - 1, T + 10 * 60_000];
    for (let i = 0; i < 5; i++) sessions[i % 3].events.push(...mkTimeoutEvents(sessions[i % 3].sid, times2[i], "bash", `p-${i}`));
    const stats = queryEngineStats(sessions, FROM, TO);
    expect(stats.toolTimeouts.bash).toBe(5);
    expect(stats.toolTimeoutSessions.bash.length).toBe(3);
    // Improve + Proposal 链
    const items = computeImprovements({ stats, period: "wk-1", failedSessions: stats.toolFailedSessions, corrections: stats.correctionSignals });
    const item = items.find((i) => i.id === "improve-tool-bash") ?? null;
    expect(item).toBeDefined();
    const p = buildShellTimeoutProposal({ improvement: item, stats, settings: { value: 60_000, maxTimeoutMs: 600_000, revision: 0 }, now: TO + DAY });
    expect(p).not.toBeNull();
    expect(p!.evidence.timeoutCount).toBe(5);
    expect(p!.evidence.timeoutSessions.length).toBe(3);
  });

  it("阈值常量自检: ≥5 事件 / ≥3 会话", () => {
    expect(SHELL_TIMEOUT_MIN_EVENTS).toBe(5);
    expect(SHELL_TIMEOUT_MIN_SESSIONS).toBe(3);
  });
});
