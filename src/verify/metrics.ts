/**
 * Verify metric registry（RFC §12/§29）。
 * Phase 1 唯一启用: shell_timeout_rate = shell/bash timeout count / shell/bash invocation count。
 * 独立于 tool_failure_rate(§29-B: bash timeout 文本结果保持不计入 failure)。
 */
import type { ReportStats } from "../stats.js";

export const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash"]);

export interface ShellTimeoutStats {
  timeouts: number;
  invocations: number;
  sessions: number;
  rate: number;
}

/** 从 ReportStats 提取 shell/bash 家族的超时统计。sessions = 窗口内发起过调用的会话数（Verify ≥3 会话证据）。 */
export function shellTimeoutStats(stats: ReportStats): ShellTimeoutStats {
  let timeouts = 0;
  let invocations = 0;
  const sessions = new Set<string>();
  for (const tool of SHELL_TOOLS) {
    timeouts += stats.toolTimeouts[tool] ?? 0;
    invocations += stats.toolCalls[tool] ?? 0;
    for (const sid of stats.toolTimeoutSessions[tool] ?? []) sessions.add(sid);
    for (const sid of stats.toolInvocationSessions[tool] ?? []) sessions.add(sid);
  }
  return { timeouts, invocations, sessions: sessions.size, rate: invocations > 0 ? timeouts / invocations : 0 };
}

/** Verify 窗口查询注入(由 API 层用 queryPeriod 精确 [from,to) 实现)。 */
export interface ShellWindowQuery {
  (from: number, to: number): Promise<ShellTimeoutStats>;
}
