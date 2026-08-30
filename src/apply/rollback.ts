/**
 * Rollback（RFC §9/§29-E）。
 * 只有 current == after 才允许自动回滚到 before;当前值已被改成第三个值
 * → TARGET_CHANGED,绝不覆盖用户修改。同样过 expectedRevision。
 */
import { ApplyError, APPLY_ERROR_CODES, type ApplyRecord, type RollbackRecord } from "./types.js";
import { SettingsAdapter } from "./settings-adapter.js";
import type { AuditLogger } from "./audit.js";
import type { ApplyStore } from "./executor.js";

export interface RollbackDeps {
  store: ApplyStore;
  adapter: SettingsAdapter;
  audit: AuditLogger;
  now?: () => number;
}

export async function rollbackApply(
  deps: RollbackDeps,
  input: { applyId: string; rollbackId: string; expectedRevision?: number },
): Promise<RollbackRecord> {
  const { store, adapter, audit } = deps;
  const now = deps.now === undefined ? Date.now() : deps.now();
  const record = store.recordTable.get(input.applyId) as ApplyRecord | undefined;
  if (record === undefined) throw new ApplyError(APPLY_ERROR_CODES.INVALID_PROPOSAL, "apply record not found");
  if (record.status !== "applied") throw new ApplyError(APPLY_ERROR_CODES.REVERT_FAILED, `apply status ${record.status}`);
  if (record.rollback.status === "reverted") throw new ApplyError(APPLY_ERROR_CODES.ALREADY_REVERTED, "already reverted");

  // 重读当前值: 只有 current == after 才允许回滚。
  const current = adapter.readShellTimeout();
  if (current === null) throw new ApplyError(APPLY_ERROR_CODES.SETTINGS_UNAVAILABLE, "shell settings unavailable");
  if (current.value !== record.after) {
    record.rollback.status = "conflicted";
    record.rollback.available = false;
    await store.recordTable.put(record.applyId, record);
    await audit.append({ applyId: record.applyId, improvementId: record.improvementId, target: { ns: record.target.ns, path: record.target.path }, action: "rollback.failed", result: "error", code: APPLY_ERROR_CODES.TARGET_CHANGED });
    throw new ApplyError(APPLY_ERROR_CODES.TARGET_CHANGED, `target changed after apply (current ${current.value}, applied ${record.after}); manual review required`);
  }

  const rollback: RollbackRecord = {
    rollbackId: input.rollbackId,
    applyId: record.applyId,
    target: { ...record.target },
    expectedCurrent: record.after,
    restoreTo: record.before,
    revisionBefore: current.revision,
    status: "requested",
  };
  await audit.append({ applyId: record.applyId, improvementId: record.improvementId, target: { ns: record.target.ns, path: record.target.path }, action: "rollback.attempted", result: "ok" });

  try {
    const written = await adapter.updateShellTimeout({
      expectedRevision: current.revision,
      expectedValue: current.value,
      nextValue: record.before,
    });
    if (written.value !== record.before) {
      rollback.status = "failed";
      throw new ApplyError(APPLY_ERROR_CODES.REVERT_FAILED, "value mismatch after rollback write");
    }
    rollback.status = "done";
    rollback.rolledBackAt = now;
    record.rollback.status = "reverted";
    record.rollback.available = false;
    record.status = "applied"; // 保持 applied 历史; rollback 状态独立
    await store.recordTable.put(record.applyId, record);
    await audit.append({ applyId: record.applyId, improvementId: record.improvementId, target: { ns: record.target.ns, path: record.target.path }, action: "rollback.succeeded", result: "ok" });
    return rollback;
  } catch (error) {
    if (error instanceof ApplyError && error.code === APPLY_ERROR_CODES.CONFIG_CHANGED) {
      rollback.status = "target-changed";
      record.rollback.status = "conflicted";
      await store.recordTable.put(record.applyId, record);
      await audit.append({ applyId: record.applyId, improvementId: record.improvementId, target: { ns: record.target.ns, path: record.target.path }, action: "rollback.failed", result: "error", code: APPLY_ERROR_CODES.TARGET_CHANGED });
      throw new ApplyError(APPLY_ERROR_CODES.TARGET_CHANGED, "revision changed during rollback; manual review required");
    }
    rollback.status = "failed";
    await audit.append({ applyId: record.applyId, improvementId: record.improvementId, target: { ns: record.target.ns, path: record.target.path }, action: "rollback.failed", result: "error", code: APPLY_ERROR_CODES.REVERT_FAILED });
    throw error;
  }
}
