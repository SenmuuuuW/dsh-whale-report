/**
 * Apply Executor（RFC §8/§9/§16）。
 * PREPARED → MUTATING → APPLIED;applyId 幂等;revision 双层防护;
 * crash 后由 reconcilePendingApplies 在启动时恢复(§16 三态)。
 */
import { ApplyError, APPLY_ERROR_CODES, } from "./types.js";
function nowOf(deps) {
    return deps.now === undefined ? Date.now() : deps.now();
}
/** 生成确定性 applyId(proposal.id + 单次 approval nonce)。 */
export function makeApplyId(proposalId, nonce) {
    return `${proposalId}::${nonce}`;
}
function verifyRecordOf(proposal, appliedAt, now) {
    return {
        applyId: makeApplyId(proposal.id, "pending"), // 占位; approve 后由正式 applyId 覆盖
        proposalId: proposal.id,
        metric: "shell_timeout_rate",
        status: "observing",
        baseline: {
            value: proposal.verificationPlan.baseline.value,
            sampleSize: proposal.verificationPlan.baseline.sampleSize,
            sessions: proposal.verificationPlan.baseline.sessions,
            window: { ...proposal.verificationPlan.baseline.evidenceWindow },
        },
        observed: null,
        targetValue: proposal.verificationPlan.target.value,
        minimumEvidence: { ...proposal.verificationPlan.minimumEvidence },
        cooldownMs: proposal.verificationPlan.cooldownMs,
        maxObservationWindowMs: proposal.verificationPlan.maxObservationWindowMs,
        appliedAt,
        createdAt: now,
        updatedAt: now,
    };
}
/**
 * 执行一次 user-approved Apply。
 * 安全契约（Phase 1.5 §5/§6）：mutation truth 全部来自 server-side stored proposal。
 * 请求只携带 applyId（幂等键 + 单次 approval 元数据）；namespace/path/before/after
 * 任何客户端字段都会被忽略（读取处只解构 applyId）。并发校验用 proposal 存储的
 * expectedBefore/revisionAtProposal 对照重读的当前值。
 * @returns 已持久化的 ApplyRecord(成功或失败终态)。
 */
export async function approveAndApply(deps, input) {
    const { store, adapter, audit } = deps;
    const now = nowOf(deps);
    const proposal = store.proposalTable.get(input.proposalId);
    if (proposal === undefined)
        throw new ApplyError(APPLY_ERROR_CODES.INVALID_PROPOSAL, "proposal not found");
    // applyId 必须属于该 proposal（跨提案重放/混淆防护）。
    if (!input.applyId.startsWith(`${proposal.id}::`)) {
        throw new ApplyError(APPLY_ERROR_CODES.INVALID_PROPOSAL, "applyId does not belong to this proposal");
    }
    if (proposal.status !== "proposed") {
        // 幂等: 已成功的 Apply 返回既有结果; 已失败/冲突的提案拒绝重复执行。
        const existing = store.recordTable.get(input.applyId);
        if (existing !== undefined && (existing.status === "applied" || existing.status === "failed" || existing.status === "conflicted")) {
            return { record: existing, already: true };
        }
        throw new ApplyError(APPLY_ERROR_CODES.INVALID_PROPOSAL, `proposal status ${proposal.status}`);
    }
    // 幂等行: 先落 PREPARED(防双击/重放),同一 applyId 至多执行一次。
    const existing = store.recordTable.get(input.applyId);
    if (existing !== undefined) {
        if (existing.status === "prepared" || existing.status === "mutating") {
            throw new ApplyError(APPLY_ERROR_CODES.IN_PROGRESS, "apply already in progress");
        }
        if (existing.status === "applied")
            return { record: existing, already: true };
        if (existing.status === "failed" || existing.status === "conflicted") {
            throw new ApplyError(APPLY_ERROR_CODES.ALREADY_APPLIED, `apply already settled as ${existing.status}`);
        }
    }
    const record = {
        applyId: input.applyId,
        proposalId: proposal.id,
        improvementId: proposal.improvementId,
        target: { ...proposal.target },
        before: proposal.expectedBefore,
        after: proposal.proposedAfter,
        revisionBefore: proposal.revisionAtProposal,
        status: "prepared",
        idempotencyKey: input.applyId,
        rollback: { available: false, status: "none" },
    };
    await store.recordTable.put(input.applyId, record);
    await audit.append({ applyId: input.applyId, improvementId: proposal.improvementId, target: { ns: proposal.target.ns, path: proposal.target.path }, action: "apply.prepared", result: "ok" });
    // 乐观并发: 重读当前值 + revision（对照 proposal 存储值——客户端无法影响校验）。
    const current = adapter.readShellTimeout();
    if (current === null) {
        record.status = "failed";
        record.lastErrorCode = APPLY_ERROR_CODES.SETTINGS_UNAVAILABLE;
        await store.recordTable.put(input.applyId, record);
        await audit.append({ applyId: input.applyId, improvementId: proposal.improvementId, target: { ns: proposal.target.ns, path: proposal.target.path }, action: "apply.failed", result: "error", code: record.lastErrorCode });
        throw new ApplyError(APPLY_ERROR_CODES.SETTINGS_UNAVAILABLE, "shell settings unavailable");
    }
    if (current.revision !== proposal.revisionAtProposal || current.value !== proposal.expectedBefore) {
        record.status = "failed";
        record.lastErrorCode = APPLY_ERROR_CODES.CONFIG_CHANGED;
        proposal.status = "conflicted";
        await store.proposalTable.put(proposal.id, proposal);
        await store.recordTable.put(input.applyId, record);
        await audit.append({ applyId: input.applyId, improvementId: proposal.improvementId, target: { ns: proposal.target.ns, path: proposal.target.path }, action: "proposal.conflicted", result: "error", code: APPLY_ERROR_CODES.CONFIG_CHANGED });
        await audit.append({ applyId: input.applyId, improvementId: proposal.improvementId, target: { ns: proposal.target.ns, path: proposal.target.path }, action: "apply.failed", result: "error", code: APPLY_ERROR_CODES.CONFIG_CHANGED });
        throw new ApplyError(APPLY_ERROR_CODES.CONFIG_CHANGED, `config changed since proposal (value ${current.value} / revision ${current.revision})`);
    }
    // MUTATING → 写 settings(seam 原生 fence 第二层)。
    record.status = "mutating";
    await store.recordTable.put(input.applyId, record);
    await audit.append({ applyId: input.applyId, improvementId: proposal.improvementId, target: { ns: proposal.target.ns, path: proposal.target.path }, action: "apply.attempted", result: "ok" });
    let written;
    try {
        written = await adapter.updateShellTimeout({ expectedRevision: current.revision, expectedValue: current.value, nextValue: proposal.proposedAfter });
    }
    catch (error) {
        const code = error instanceof ApplyError ? error.code : APPLY_ERROR_CODES.APPLY_FAILED;
        record.status = "failed";
        record.lastErrorCode = code;
        if (code === APPLY_ERROR_CODES.CONFIG_CHANGED)
            proposal.status = "conflicted";
        await store.proposalTable.put(proposal.id, proposal);
        await store.recordTable.put(input.applyId, record);
        await audit.append({ applyId: input.applyId, improvementId: proposal.improvementId, target: { ns: proposal.target.ns, path: proposal.target.path }, action: "apply.failed", result: "error", code });
        throw error;
    }
    // 成功 → 回读确认 value == after。
    if (written.value !== proposal.proposedAfter) {
        record.status = "conflicted";
        record.lastErrorCode = APPLY_ERROR_CODES.TARGET_CHANGED;
        await store.recordTable.put(input.applyId, record);
        await audit.append({ applyId: input.applyId, improvementId: proposal.improvementId, target: { ns: proposal.target.ns, path: proposal.target.path }, action: "apply.failed", result: "error", code: APPLY_ERROR_CODES.TARGET_CHANGED });
        throw new ApplyError(APPLY_ERROR_CODES.TARGET_CHANGED, "value mismatch after write");
    }
    record.status = "applied";
    record.revisionAfter = written.revision;
    record.appliedAt = now;
    record.rollback.available = true;
    proposal.status = "applied";
    await store.proposalTable.put(proposal.id, proposal);
    await store.recordTable.put(input.applyId, record);
    // Verify 记录进入 OBSERVING。
    const vr = verifyRecordOf(proposal, now, now);
    vr.applyId = input.applyId;
    await store.verifyTable.put(input.applyId, vr);
    await audit.append({ applyId: input.applyId, improvementId: proposal.improvementId, target: { ns: proposal.target.ns, path: proposal.target.path }, action: "apply.succeeded", result: "ok" });
    await audit.append({ applyId: input.applyId, improvementId: proposal.improvementId, target: { ns: proposal.target.ns, path: proposal.target.path }, action: "verify.started", result: "ok" });
    return { record, already: false };
}
/**
 * 启动 reconciliation(§16): 恢复 crash 遗留的 prepared/mutating 记录。
 * 锚点 = resolved VALUE(持久真相): settings revision 是进程内写计数,跨重启不持久,
 * 绝不能用 revision 算术跨重启判定(Phase 1.5 实测)。
 *   value == after  → 本次写入已落 → APPLIED
 *   value == before → 写入从未发生 → FAILED
 *   其他            → CONFLICTED(人工复核,绝不猜)
 */
export async function reconcilePendingApplies(deps) {
    const { store, adapter, audit } = deps;
    const entries = store.recordTable.entries?.() ?? [];
    let recovered = 0;
    for (const [, raw] of entries) {
        const rec = raw;
        if (rec.status !== "prepared" && rec.status !== "mutating")
            continue;
        const current = adapter.readShellTimeout();
        let next;
        if (current === null) {
            next = "conflicted"; // 无法判断 → 人工复核
        }
        else if (current.value === rec.after) {
            next = "applied";
            rec.revisionAfter = current.revision;
            rec.appliedAt = rec.appliedAt ?? Date.now();
            rec.rollback.available = true;
        }
        else if (current.value === rec.before) {
            next = "failed";
        }
        else {
            next = "conflicted";
        }
        rec.status = next;
        await store.recordTable.put(rec.applyId, rec);
        await audit.append({ applyId: rec.applyId, improvementId: rec.improvementId, target: { ns: rec.target.ns, path: rec.target.path }, action: "apply.recovered", result: next === "applied" ? "ok" : "error", code: next === "conflicted" ? "RECONCILE_CONFLICTED" : next });
        recovered += 1;
    }
    return { recovered };
}
/** 提案拒绝(只读面,无 mutation)。 */
export async function rejectProposal(deps, proposalId) {
    const { store, audit } = deps;
    const proposal = store.proposalTable.get(proposalId);
    if (proposal === undefined)
        throw new ApplyError(APPLY_ERROR_CODES.INVALID_PROPOSAL, "proposal not found");
    if (proposal.status === "proposed" || proposal.status === "conflicted") {
        proposal.status = "rejected";
        await store.proposalTable.put(proposalId, proposal);
        await audit.append({ applyId: undefined, improvementId: proposal.improvementId, target: { ns: proposal.target.ns, path: proposal.target.path }, action: "proposal.rejected", result: "ok" });
    }
    return proposal;
}
//# sourceMappingURL=executor.js.map