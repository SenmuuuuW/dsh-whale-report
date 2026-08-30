/** shell/bash 工具家族(Phase 1 唯一: bash 工具注册名)。 */
export const SHELL_TOOLS = new Set(["bash"]);
/** Proposal eligibility 阈值(§29-C,真实数据校准: 41 例/6 会话)。 */
export const SHELL_TIMEOUT_MIN_EVENTS = 5;
export const SHELL_TIMEOUT_MIN_SESSIONS = 3;
/** DeepTrace 自身 safety cap(不是 DSH 官方 hard cap;DSH 仅 positive-finite 校验 + clampTimeout)。 */
export const DEEPTRACE_SAFETY_CAP_MS = 600_000;
/** Verify 默认参数。 */
export const VERIFY_COOLDOWN_MS = 10 * 60 * 1000;
export const VERIFY_MAX_OBSERVATION_MS = 7 * 24 * 60 * 60 * 1000;
export const VERIFY_BASELINE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const VERIFY_MIN_OBSERVATIONS = 10;
export const VERIFY_MIN_SESSIONS = 3;
export const VERIFY_TARGET_ABSOLUTE_CAP = 0.08;
export function buildShellTimeoutProposal(input) {
    const { improvement, stats, settings, now } = input;
    if (improvement === null)
        return null;
    // 必须命中 Repeated Tool Failure 且工具属于 shell/bash 家族。
    if (improvement.category !== "TOOL")
        return null;
    const tool = improvement.evidence.affectedTools[0];
    if (tool === undefined || !SHELL_TOOLS.has(tool))
        return null;
    if (improvement.id !== `improve-tool-${tool.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`)
        return null;
    const timeoutCount = stats.toolTimeouts[tool] ?? 0;
    const invocationCount = stats.toolCalls[tool] ?? 0;
    const timeoutSessions = stats.toolTimeoutSessions[tool] ?? [];
    // §29-C 阈值: ≥5 timeout 事件 且 ≥3 会话。
    if (timeoutCount < SHELL_TIMEOUT_MIN_EVENTS)
        return null;
    if (timeoutSessions.length < SHELL_TIMEOUT_MIN_SESSIONS)
        return null;
    // settings 可读 + before 合法。
    if (settings === null)
        return null;
    const before = settings.value;
    if (!Number.isFinite(before) || before <= 0)
        return null;
    if (before >= DEEPTRACE_SAFETY_CAP_MS)
        return null;
    const runtimeCap = Math.min(settings.maxTimeoutMs, DEEPTRACE_SAFETY_CAP_MS);
    const after = Math.min(before * 2, runtimeCap);
    if (!(after > before))
        return null;
    if (!(after <= runtimeCap))
        return null;
    const baselineRate = invocationCount > 0 ? timeoutCount / invocationCount : 0;
    const targetValue = Math.min(baselineRate * 0.5, VERIFY_TARGET_ABSOLUTE_CAP);
    const plan = {
        metric: "shell_timeout_rate",
        scope: { tools: [tool] },
        baseline: {
            value: Math.round(baselineRate * 10000) / 10000,
            evidenceWindow: { from: now - VERIFY_BASELINE_LOOKBACK_MS, to: now },
            sampleSize: invocationCount,
            sessions: timeoutSessions.length,
        },
        target: { operator: "<=", value: Math.round(targetValue * 10000) / 10000 },
        minimumEvidence: { observations: VERIFY_MIN_OBSERVATIONS, sessions: VERIFY_MIN_SESSIONS },
        cooldownMs: VERIFY_COOLDOWN_MS,
        maxObservationWindowMs: VERIFY_MAX_OBSERVATION_MS,
        baselineLookbackMs: VERIFY_BASELINE_LOOKBACK_MS,
    };
    const idBase = `${improvement.id}-${tool}`;
    let hash = 0;
    for (let i = 0; i < idBase.length; i++)
        hash = (hash * 31 + idBase.charCodeAt(i)) >>> 0;
    return {
        id: `apply-${idBase}-${hash.toString(36)}`,
        improvementId: improvement.id,
        kind: "settings",
        target: { type: "settings", ns: "shell", path: ["timeoutMs"] },
        expectedBefore: before,
        proposedAfter: after,
        diff: { op: "set", path: ["timeoutMs"], before, after },
        reason: `${tool} 工具 ${timeoutCount} 次确定性 timeout（${timeoutSessions.length} 个会话），预算 ${before}ms 不足，建议 ${after}ms。`,
        evidence: {
            metrics: {
                timeoutCount,
                shellInvocationCount: invocationCount,
                baselineRate: Math.round(baselineRate * 10000) / 10000,
            },
            affectedSessions: timeoutSessions.slice(0, 12),
            occurrences: timeoutSessions.length,
            confidence: Math.min(0.9, 0.5 + 0.1 * Math.min(4, timeoutSessions.length - 2)),
            timeoutCount,
            shellInvocationCount: invocationCount,
            timeoutSessions: timeoutSessions.slice(0, 32),
        },
        risk: "low",
        reversible: true,
        rollbackPlan: { op: "set", path: ["timeoutMs"], value: before },
        verificationPlan: plan,
        revisionAtProposal: settings.revision,
        createdAt: now,
        status: "proposed",
    };
}
//# sourceMappingURL=proposal.js.map