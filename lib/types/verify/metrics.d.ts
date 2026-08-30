/**
 * Verify metric registry（RFC §12/§29）。
 * Phase 1 唯一启用: shell_timeout_rate = shell/bash timeout count / shell/bash invocation count。
 * 独立于 tool_failure_rate(§29-B: bash timeout 文本结果保持不计入 failure)。
 */
import type { ReportStats } from "../stats.js";
export declare const SHELL_TOOLS: ReadonlySet<string>;
export interface ShellTimeoutStats {
    timeouts: number;
    invocations: number;
    sessions: number;
    rate: number;
}
/** 从 ReportStats 提取 shell/bash 家族的超时统计。 */
export declare function shellTimeoutStats(stats: ReportStats): ShellTimeoutStats;
/** Verify 窗口查询注入(由 API 层用 queryPeriod 精确 [from,to) 实现)。 */
export interface ShellWindowQuery {
    (from: number, to: number): Promise<ShellTimeoutStats>;
}
//# sourceMappingURL=metrics.d.ts.map