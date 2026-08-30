/**
 * TIMEOUT DETECTION（RFC §29-A）:
 * - TOOL_TIMEOUT exact code 命中
 * - bash 精确标记 [timed out after Nms] 命中
 * - 泛化 "timeout" 单词不命中
 * - 双路径(direct aggregate / bucketize)等价
 * - tool identity 保留
 */
import { describe, expect, it } from "vitest";
import { aggregate, aggregateBuckets, bucketizeOwnEvents, emptyPartial } from "../src/stats.js";
import { isTimeoutResult, TIMED_OUT_MARKER_RE } from "../src/stats.js";
import { bashTimedOutResult, codeTimedOutResult, ev, toolPair } from "./apply-harness.js";

const T = Date.parse("2026-08-25T10:00:00+08:00");

describe("timeout detector（§29-A 双路径）", () => {
  it("Path A: error.code === TOOL_TIMEOUT 精确命中", () => {
    expect(isTimeoutResult(codeTimedOutResult("c1"))).toBe(true);
  });

  it("Path B: [timed out after Nms] 精确标记命中（含被 text block 包裹）", () => {
    expect(TIMED_OUT_MARKER_RE.test("(no output)\n[timed out after 60000ms]\n[killed by signal: SIGTERM]")).toBe(true);
    expect(TIMED_OUT_MARKER_RE.test("(no output)\n[timed out after 0ms]")).toBe(true);
    expect(isTimeoutResult(bashTimedOutResult("c1", 60_000))).toBe(true);
    // string content 形态
    expect(isTimeoutResult({ message: { source: { callId: "c1" }, content: "[timed out after 120000ms]" } })).toBe(true);
  });

  it("泛化 'timeout' 单词 / 模糊语义不命中", () => {
    expect(isTimeoutResult({ error: { code: "ETIMEDOUT", message: "connection timed out" } })).toBe(false);
    expect(isTimeoutResult({ error: { code: "ABORTED", message: "aborted" } })).toBe(false);
    expect(isTimeoutResult({ message: { source: { callId: "c1" }, content: [{ type: "text", text: "connection timeout after retries, retrying..." }] } })).toBe(false);
    expect(isTimeoutResult({ message: { source: { callId: "c1" }, content: "the command timed out" } })).toBe(false);
    expect(isTimeoutResult({ message: { source: { callId: "c1" }, content: [{ type: "text", text: "timeout=10s flag parsed" }] } })).toBe(false);
  });

  it("非 tool/result 形态 / 空数据不命中", () => {
    expect(isTimeoutResult(undefined)).toBe(false);
    expect(isTimeoutResult({})).toBe(false);
    expect(isTimeoutResult({ message: { content: [] } })).toBe(false);
  });

  it("双路径等价: direct aggregate == bucketize（bash 标记 + web_search code + 泛化词）", () => {
    const events = [
      ...toolPair("bash", "c1", T, bashTimedOutResult("c1", 60_000)),
      ...toolPair("web_search", "c2", T + 5000, codeTimedOutResult("c2")),
      ...toolPair("bash", "c3", T + 10_000, { error: { code: "ENOENT" }, message: { source: { callId: "c3" }, content: "timeout after retry" } }),
      ...toolPair("edit", "c4", T + 15_000, { message: { source: { callId: "c4" }, content: [{ type: "text", text: "ok" }] } }),
    ];
    const period = { from: T - 3600_000, to: T + 3600_000 };
    const direct = aggregate(events, period, [{ id: "s1", createdAt: T }]);
    const built = bucketizeOwnEvents("s1", events, 0);
    const indexed = aggregateBuckets([{ sessionId: "s1", buckets: built.buckets, titles: built.titles }], period, [{ id: "s1", createdAt: T }], emptyPartial());
    expect(indexed.toolTimeouts).toEqual(direct.toolTimeouts);
    expect(indexed.toolTimeouts).toEqual({ bash: 1, web_search: 1 });
    // 泛化词 + 正常结果不计入
    expect(indexed.toolTimeouts.edit).toBeUndefined();
    // 会话证据
    expect(indexed.toolTimeoutSessions.bash).toEqual(["s1"]);
    expect(indexed.toolTimeoutSessions.web_search).toEqual(["s1"]);
  });

  it("tool identity 保留（绝不只存全局计数）", () => {
    const events = [
      ...toolPair("bash", "c1", T, bashTimedOutResult("c1", 60_000)),
      ...toolPair("web_search", "c2", T + 5000, codeTimedOutResult("c2")),
    ];
    const period = { from: T - 3600_000, to: T + 3600_000 };
    const built = bucketizeOwnEvents("s1", events, 0);
    const indexed = aggregateBuckets([{ sessionId: "s1", buckets: built.buckets, titles: [] }], period, [], emptyPartial());
    const bucket = built.buckets[0];
    expect(bucket.toolTimeouts).toEqual({ bash: 1, web_search: 1 });
    expect(indexed.toolTimeouts.bash).toBe(1);
    expect(indexed.toolTimeouts.web_search).toBe(1);
  });
});
