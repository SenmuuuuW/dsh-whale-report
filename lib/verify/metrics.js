export const SHELL_TOOLS = new Set(["bash"]);
/** 从 ReportStats 提取 shell/bash 家族的超时统计。sessions = 窗口内发起过调用的会话数（Verify ≥3 会话证据）。 */
export function shellTimeoutStats(stats) {
    let timeouts = 0;
    let invocations = 0;
    const sessions = new Set();
    for (const tool of SHELL_TOOLS) {
        timeouts += stats.toolTimeouts[tool] ?? 0;
        invocations += stats.toolCalls[tool] ?? 0;
        for (const sid of stats.toolTimeoutSessions[tool] ?? [])
            sessions.add(sid);
        for (const sid of stats.toolInvocationSessions[tool] ?? [])
            sessions.add(sid);
    }
    return { timeouts, invocations, sessions: sessions.size, rate: invocations > 0 ? timeouts / invocations : 0 };
}
//# sourceMappingURL=metrics.js.map