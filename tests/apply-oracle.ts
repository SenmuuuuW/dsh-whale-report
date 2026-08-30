/**
 * Phase 1.6 — Exact Verify Gate oracle helper。
 * 独立 deterministic timeout oracle：直接从 RawEvent 逐条
 *   detectToolTimeout(event) + [from,to) 时间戳过滤 + callId 配对
 * 计算 calls / timeouts / timeoutSessions / invocationSessions。
 * 不做任何 bucket 聚合 —— 是 QUERY ENGINE 的对照真值。
 */
import { isTimeoutResult } from "../src/stats.js";

export interface TimeoutOracleResult {
  calls: Record<string, number>;
  timeouts: Record<string, number>;
  timeoutSessions: Record<string, string[]>;
  invocationSessions: Record<string, string[]>;
}

interface RawEv {
  type: string;
  time: number;
  data?: Record<string, unknown>;
}

export function timeoutOracle(
  sessions: { sid: string; events: RawEv[] }[],
  from: number,
  to: number,
): TimeoutOracleResult {
  const calls: Record<string, number> = {};
  const timeouts: Record<string, number> = {};
  const timeoutSessions: Record<string, string[]> = {};
  const invocationSessions: Record<string, string[]> = {};
  const addSession = (map: Record<string, string[]>, tool: string, sid: string) => {
    let list = map[tool];
    if (list === undefined) { list = []; map[tool] = list; }
    if (!list.includes(sid)) list.push(sid);
  };
  for (const { sid, events } of sessions) {
    const pending = new Map<string, string>();
    for (const e of events) {
      if (e.time < from || e.time >= to) {
        // 窗口外事件仍可配对（call 在窗外、result 在窗内，或反之），配对不裁剪。
        if (e.type === "tool/call") {
          const callId = e.data?.callId;
          if (typeof callId === "string") pending.set(callId, String(e.data?.name ?? "unknown"));
        }
        continue;
      }
      if (e.type === "tool/call") {
        const tool = String(e.data?.name ?? "unknown");
        calls[tool] = (calls[tool] ?? 0) + 1;
        addSession(invocationSessions, tool, sid);
        const callId = e.data?.callId;
        if (typeof callId === "string") pending.set(callId, tool);
      } else if (e.type === "tool/result") {
        const src = (e.data?.message as Record<string, unknown> | undefined)?.source as Record<string, unknown> | undefined;
        const callId = typeof src?.callId === "string" ? src.callId : "";
        const tool = callId !== "" ? (pending.get(callId) ?? "unknown") : "unknown";
        if (isTimeoutResult(e.data as Record<string, unknown> | undefined)) {
          timeouts[tool] = (timeouts[tool] ?? 0) + 1;
          addSession(timeoutSessions, tool, sid);
        }
      }
    }
  }
  return { calls, timeouts, timeoutSessions, invocationSessions };
}

/** 按 shell 家族聚合为 metric（与 src/verify/metrics.ts shellTimeoutStats 同口径）。 */
export function oracleShellRate(r: TimeoutOracleResult): { calls: number; timeouts: number; sessions: number; rate: number } {
  const tools = new Set([...Object.keys(r.calls), ...Object.keys(r.timeouts)]);
  let calls = 0;
  let timeouts = 0;
  const sessions = new Set<string>();
  for (const tool of tools) {
    if (tool !== "bash") continue;
    calls += r.calls[tool] ?? 0;
    timeouts += r.timeouts[tool] ?? 0;
    for (const s of r.invocationSessions[tool] ?? []) sessions.add(s);
    for (const s of r.timeoutSessions[tool] ?? []) sessions.add(s);
  }
  return { calls, timeouts, sessions: sessions.size, rate: calls > 0 ? timeouts / calls : 0 };
}
