/**
 * Verify 引擎（RFC §10-§13）。
 * 窗口语义:
 *   baseline = [proposalCreatedAt - baselineLookbackMs, appliedAt)  —— 提案时固定
 *   after    = [appliedAt + cooldownMs, now)                        —— appliedAt 精确切点
 * 绝不把 Apply 前后事件混在一个窗口(§29-E/§12)。
 * NOT_IMPROVED 只输出 REVERT RECOMMENDED,绝不自动 rollback(§19)。
 */
import { ApplyError, APPLY_ERROR_CODES, } from "../apply/types.js";
import { shellTimeoutStats } from "./metrics.js";
export async function evaluateVerify(deps, input) {
    const { store, query, audit } = deps;
    const now = deps.now === undefined ? Date.now() : deps.now();
    const vr = store.verifyTable.get(input.applyId);
    if (vr === undefined)
        throw new ApplyError(APPLY_ERROR_CODES.INVALID_PROPOSAL, "verify record not found");
    // Phase 1.6：终态不可变 —— VERIFIED / NOT_IMPROVED / INCONCLUSIVE / REVERTED 为 terminal，
    // 重复 verify 不得重算窗口、不得改写历史 verdict（重新评估 = 新 cycle / 新记录）。
    if (vr.status === "verified" || vr.status === "not_improved" || vr.status === "inconclusive" || vr.status === "reverted") {
        return { record: vr, status: vr.status, progress: { observations: 0, sessions: 0, window: null } };
    }
    // After 窗口: [appliedAt + cooldown, now)。
    const afterFrom = vr.appliedAt + vr.cooldownMs;
    const afterStats = await query(afterFrom, now);
    const observed = {
        value: Math.round(afterStats.rate * 10000) / 10000,
        sampleSize: afterStats.invocations,
        sessions: afterStats.sessions,
        window: { from: afterFrom, to: now },
    };
    vr.observed = observed;
    vr.updatedAt = now;
    const minObs = vr.minimumEvidence.observations;
    const minSess = vr.minimumEvidence.sessions;
    let next;
    let note;
    if (afterStats.invocations < minObs || afterStats.sessions < minSess) {
        if (now - vr.appliedAt >= vr.maxObservationWindowMs) {
            next = "inconclusive";
            note = `样本不足: ${afterStats.invocations} 次调用 / ${afterStats.sessions} 个会话(需 ≥${minObs} / ≥${minSess})`;
        }
        else {
            next = "observing";
            note = `观察中: ${afterStats.invocations}/${minObs} 次调用, ${afterStats.sessions}/${minSess} 个会话`;
        }
    }
    else {
        next = afterStats.rate <= vr.targetValue ? "verified" : "not_improved";
        note = next === "verified" ? `shell_timeout_rate ${(afterStats.rate * 100).toFixed(2)}% ≤ 目标 ${(vr.targetValue * 100).toFixed(2)}%` : `shell_timeout_rate ${(afterStats.rate * 100).toFixed(2)}% > 目标 ${(vr.targetValue * 100).toFixed(2)}% — REVERT RECOMMENDED`;
    }
    vr.status = next;
    if (next === "verified" || next === "not_improved" || next === "inconclusive") {
        vr.verdictAt = now;
        vr.verdict = note;
        await audit.append({ applyId: vr.applyId, improvementId: vr.proposalId, target: { ns: "shell", path: ["timeoutMs"] }, action: "verify.result", result: next === "verified" ? "ok" : "error", code: next });
    }
    await store.verifyTable.put(vr.applyId, vr);
    return { record: vr, status: next, progress: { observations: afterStats.invocations, sessions: afterStats.sessions, window: observed.window }, verdictNote: note };
}
/** 提案基线窗口查询(提案时固定,供 baseline 展示;数值以提案时 stats 为准)。 */
export { shellTimeoutStats };
//# sourceMappingURL=verifier.js.map