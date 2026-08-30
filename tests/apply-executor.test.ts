/**
 * APPLY EXECUTOR + ROLLBACK + CRASH（RFC §8/§9/§10/§16）:
 * - happy path（revision 前进、读回确认、verify observing 创建）
 * - stale revision → CONFIG_CHANGED（proposal conflicted）
 * - 外部编辑（revision 变化）→ CONFIG_CHANGED
 * - 同值写（revision 不增）不重复 mutation
 * - 双击/重放同一 applyId → IN_PROGRESS / 返回既有结果
 * - rollback happy / target changed / 二次回滚
 * - crash reconciliation 三态
 */
import { describe, expect, it } from "vitest";
import { ApplyError, APPLY_ERROR_CODES, type ApplyProposal } from "../src/apply/types.js";
import { SettingsAdapter } from "../src/apply/settings-adapter.js";
import { AuditLogger } from "../src/apply/audit.js";
import { approveAndApply, reconcilePendingApplies, type ApplyStore } from "../src/apply/executor.js";
import { rollbackApply } from "../src/apply/rollback.js";
import { FakeSettingsSeam, fakeDomain } from "./apply-harness.js";

function makeProposal(overrides: Partial<ApplyProposal> = {}): ApplyProposal {
  return {
    id: "apply-improve-tool-bash-bash-abc123",
    improvementId: "improve-tool-bash",
    kind: "settings",
    target: { type: "settings", ns: "shell", path: ["timeoutMs"] },
    expectedBefore: 60_000,
    proposedAfter: 120_000,
    diff: { op: "set", path: ["timeoutMs"], before: 60_000, after: 120_000 },
    reason: "bash 工具 8 次确定性 timeout（3 个会话）",
    evidence: { metrics: { timeoutCount: 8 }, affectedSessions: ["s1"], occurrences: 3, confidence: 0.8, timeoutCount: 8, shellInvocationCount: 100, timeoutSessions: ["s1", "s2", "s3"] },
    risk: "low",
    reversible: true,
    rollbackPlan: { op: "set", path: ["timeoutMs"], value: 60_000 },
    verificationPlan: {
      metric: "shell_timeout_rate",
      scope: { tools: ["bash"] },
      baseline: { value: 0.06, evidenceWindow: { from: 1, to: 2 }, sampleSize: 100, sessions: 3 },
      target: { operator: "<=", value: 0.03 },
      minimumEvidence: { observations: 10, sessions: 3 },
      cooldownMs: 600_000,
      maxObservationWindowMs: 604_800_000,
      baselineLookbackMs: 604_800_000,
    },
    revisionAtProposal: 0,
    createdAt: 1_789_000_000_000,
    status: "proposed",
    ...overrides,
  };
}

function setup(seamValue = { timeoutMs: 60_000, maxTimeoutMs: 600_000 }) {
  const domain = fakeDomain();
  const seam = new FakeSettingsSeam(seamValue);
  const adapter = new SettingsAdapter(() => seam);
  const audit = new AuditLogger(domain.table("audit_log"));
  const store: ApplyStore = {
    proposalTable: domain.table("apply_proposals"),
    recordTable: domain.table("apply_records"),
    verifyTable: domain.table("verify_records"),
  };
  let t = 1_789_000_000_000;
  const deps = { store, adapter, audit, now: () => t };
  return { seam, adapter, audit, store, deps, tick: (ms: number) => { t += ms; } };
}

const APPROVE = { expectedRevision: 0, expectedValue: 60_000 };
const APPLY_ID = "apply-improve-tool-bash-bash-abc123::nonce1";

describe("apply executor", () => {
  it("happy path: PREPARED→MUTATING→APPLIED, revision 前进, verify observing 创建, audit 完整", async () => {
    const h = setup();
    await h.store.proposalTable.put("p1", makeProposal({ id: "p1" }));
    const { record, already } = await approveAndApply(h.deps, { proposalId: "p1", applyId: APPLY_ID, ...APPROVE });
    expect(already).toBe(false);
    expect(record.status).toBe("applied");
    expect(record.revisionBefore).toBe(0);
    expect(record.revisionAfter).toBe(1);
    expect(record.appliedAt).toBeDefined();
    expect(record.rollback.available).toBe(true);
    expect(h.seam.revision).toBe(1);
    expect(h.seam.describe()[0].value.timeoutMs).toBe(120_000);
    const vr = h.store.verifyTable.get(APPLY_ID) as { status: string; appliedAt: number };
    expect(vr.status).toBe("observing");
    const proposal = h.store.proposalTable.get("p1") as ApplyProposal;
    expect(proposal.status).toBe("applied");
    const events = h.audit.list();
    expect(events.map((e) => e.action)).toEqual(["apply.prepared", "apply.attempted", "apply.succeeded", "verify.started"]);
  });

  it("双击/重放同一 applyId: 第二次返回既有结果, 不重复 mutation", async () => {
    const h = setup();
    await h.store.proposalTable.put("p1", makeProposal({ id: "p1" }));
    const first = await approveAndApply(h.deps, { proposalId: "p1", applyId: APPLY_ID, ...APPROVE });
    const second = await approveAndApply(h.deps, { proposalId: "p1", applyId: APPLY_ID, ...APPROVE });
    expect(second.already).toBe(true);
    expect(second.record.applyId).toBe(first.record.applyId);
    expect(h.seam.revision).toBe(1); // 只写了一次
  });

  it("并发双击: 第二个请求看到 PREPARED/MUTATING → IN_PROGRESS", async () => {
    const h = setup();
    await h.store.proposalTable.put("p1", makeProposal({ id: "p1" }));
    // 模拟第一个请求已落 PREPARED（尚未执行 mutation）
    await h.store.recordTable.put(APPLY_ID, { applyId: APPLY_ID, proposalId: "p1", improvementId: "improve-tool-bash", target: { type: "settings", ns: "shell", path: ["timeoutMs"] }, before: 60_000, after: 120_000, revisionBefore: 0, status: "prepared", idempotencyKey: APPLY_ID, rollback: { available: false, status: "none" } });
    await expect(approveAndApply(h.deps, { proposalId: "p1", applyId: APPLY_ID, ...APPROVE })).rejects.toMatchObject({ code: APPLY_ERROR_CODES.IN_PROGRESS });
  });

  it("stale revision: 外部把 revision 推到 2 → CONFIG_CHANGED, proposal conflicted, 不 mutation", async () => {
    const h = setup();
    await h.store.proposalTable.put("p1", makeProposal({ id: "p1" }));
    // 外部更新: value 60k → 90k (revision 0→1), 再 90k→95k (1→2)
    await h.seam.update("shell", { timeoutMs: 90_000 }, 0);
    await h.seam.update("shell", { timeoutMs: 95_000 }, 1);
    await expect(approveAndApply(h.deps, { proposalId: "p1", applyId: APPLY_ID, ...APPROVE })).rejects.toMatchObject({ code: APPLY_ERROR_CODES.CONFIG_CHANGED });
    expect(h.seam.describe()[0].value.timeoutMs).toBe(95_000); // 用户新配置未被覆盖
    expect((h.store.proposalTable.get("p1") as ApplyProposal).status).toBe("conflicted");
    const record = h.store.recordTable.get(APPLY_ID) as { status: string; lastErrorCode?: string };
    expect(record.status).toBe("failed");
    expect(record.lastErrorCode).toBe(APPLY_ERROR_CODES.CONFIG_CHANGED);
  });

  it("外部编辑（值变但 revision 相同语义由 seam 判定）: seam SETTINGS_CONFLICT → CONFIG_CHANGED", async () => {
    const h = setup();
    await h.store.proposalTable.put("p1", makeProposal({ id: "p1" }));
    // 模拟窗口期: 外部先写 (revision 0→1), approve 时仍用旧 expectedRevision 0
    await h.seam.update("shell", { timeoutMs: 80_000 }, 0);
    await expect(approveAndApply(h.deps, { proposalId: "p1", applyId: APPLY_ID, expectedRevision: 0, expectedValue: 60_000 })).rejects.toMatchObject({ code: APPLY_ERROR_CODES.CONFIG_CHANGED });
    expect(h.seam.describe()[0].value.timeoutMs).toBe(80_000);
  });

  it("同值写不推进 revision（幂等友好）, 后续 apply 仍正常", async () => {
    const h = setup();
    await h.store.proposalTable.put("p1", makeProposal({ id: "p1" }));
    // 同值写（用户手动把 timeoutMs 设成当前值）→ revision 不增
    await h.seam.update("shell", { timeoutMs: 60_000 }, 0);
    expect(h.seam.revision).toBe(0);
    const { record } = await approveAndApply(h.deps, { proposalId: "p1", applyId: APPLY_ID, ...APPROVE });
    expect(record.status).toBe("applied");
    expect(h.seam.revision).toBe(1);
  });

  it("expectedValue 不匹配（值已变）→ CONFIG_CHANGED", async () => {
    const h = setup();
    await h.store.proposalTable.put("p1", makeProposal({ id: "p1" }));
    await h.seam.update("shell", { timeoutMs: 70_000 }, 0); // revision 0→1
    // 调用方携带旧 expectedValue 60k 但 revision 已被 advance 到 1 → 自检层先拒绝
    await expect(approveAndApply(h.deps, { proposalId: "p1", applyId: APPLY_ID, expectedRevision: 0, expectedValue: 60_000 })).rejects.toMatchObject({ code: APPLY_ERROR_CODES.CONFIG_CHANGED });
  });

  it("proposal 不存在 → INVALID_PROPOSAL", async () => {
    const h = setup();
    await expect(approveAndApply(h.deps, { proposalId: "nope", applyId: "x::1", ...APPROVE })).rejects.toMatchObject({ code: APPLY_ERROR_CODES.INVALID_PROPOSAL });
  });
});

describe("rollback", () => {
  it("happy path: current==after → 还原 before, revision 前进", async () => {
    const h = setup();
    await h.store.proposalTable.put("p1", makeProposal({ id: "p1" }));
    const { record } = await approveAndApply(h.deps, { proposalId: "p1", applyId: APPLY_ID, ...APPROVE });
    const rb = await rollbackApply(h.deps, { applyId: APPLY_ID, rollbackId: "rb1" });
    expect(rb.status).toBe("done");
    expect(rb.restoreTo).toBe(60_000);
    expect(h.seam.describe()[0].value.timeoutMs).toBe(60_000);
    expect(record.rollback.status).toBe("reverted");
    // 二次回滚 → ALREADY_REVERTED
    await expect(rollbackApply(h.deps, { applyId: APPLY_ID, rollbackId: "rb2" })).rejects.toMatchObject({ code: APPLY_ERROR_CODES.ALREADY_REVERTED });
  });

  it("用户改成了第三个值 → TARGET_CHANGED, 不覆盖", async () => {
    const h = setup();
    await h.store.proposalTable.put("p1", makeProposal({ id: "p1" }));
    await approveAndApply(h.deps, { proposalId: "p1", applyId: APPLY_ID, ...APPROVE });
    await h.seam.update("shell", { timeoutMs: 300_000 }, 1); // 用户手动改成 300s
    await expect(rollbackApply(h.deps, { applyId: APPLY_ID, rollbackId: "rb1" })).rejects.toMatchObject({ code: APPLY_ERROR_CODES.TARGET_CHANGED });
    expect(h.seam.describe()[0].value.timeoutMs).toBe(300_000); // 用户值保留
  });

  it("未 applied 的记录 → REVERT_FAILED", async () => {
    const h = setup();
    await h.store.recordTable.put("x::1", { applyId: "x::1", proposalId: "p1", improvementId: "i", target: { type: "settings", ns: "shell", path: ["timeoutMs"] }, before: 1, after: 2, revisionBefore: 0, status: "failed", idempotencyKey: "x::1", rollback: { available: false, status: "none" } });
    await expect(rollbackApply(h.deps, { applyId: "x::1", rollbackId: "rb1" })).rejects.toMatchObject({ code: APPLY_ERROR_CODES.REVERT_FAILED });
  });
});

describe("crash reconciliation（§16 三态）", () => {
  it("A: MUTATING + 实际 == after + revision == before+1 → 恢复 APPLIED", async () => {
    const h = setup({ timeoutMs: 60_000, maxTimeoutMs: 600_000 });
    // 模拟 crash 前 mutation 已落: 值已写为 after, revision 已 +1
    await h.seam.update("shell", { timeoutMs: 120_000 }, 0);
    expect(h.seam.revision).toBe(1);
    await h.store.recordTable.put("a::1", { applyId: "a::1", proposalId: "p1", improvementId: "i", target: { type: "settings", ns: "shell", path: ["timeoutMs"] }, before: 60_000, after: 120_000, revisionBefore: 0, revisionAfter: undefined, status: "mutating", idempotencyKey: "a::1", rollback: { available: false, status: "none" } });
    const { recovered } = await reconcilePendingApplies(h.deps);
    expect(recovered).toBe(1);
    const rec = h.store.recordTable.get("a::1") as { status: string; revisionAfter?: number; rollback: { available: boolean } };
    expect(rec.status).toBe("applied");
    expect(rec.revisionAfter).toBe(1);
    expect(rec.rollback.available).toBe(true);
  });

  it("B: MUTATING + 实际 == before + revision 未变 → FAILED（写入从未发生）", async () => {
    const h = setup(); // 仍是 before
    await h.store.recordTable.put("b::1", { applyId: "b::1", proposalId: "p1", improvementId: "i", target: { type: "settings", ns: "shell", path: ["timeoutMs"] }, before: 60_000, after: 120_000, revisionBefore: 0, status: "mutating", idempotencyKey: "b::1", rollback: { available: false, status: "none" } });
    await reconcilePendingApplies(h.deps);
    expect((h.store.recordTable.get("b::1") as { status: string }).status).toBe("failed");
  });

  it("C: 第三个值 → CONFLICTED（绝不自动猜）", async () => {
    const h = setup({ timeoutMs: 333_000, maxTimeoutMs: 600_000 }); // 既不是 before 也不是 after
    await h.store.recordTable.put("c::1", { applyId: "c::1", proposalId: "p1", improvementId: "i", target: { type: "settings", ns: "shell", path: ["timeoutMs"] }, before: 60_000, after: 120_000, revisionBefore: 0, status: "mutating", idempotencyKey: "c::1", rollback: { available: false, status: "none" } });
    await reconcilePendingApplies(h.deps);
    expect((h.store.recordTable.get("c::1") as { status: string }).status).toBe("conflicted");
  });

  it("settings 不可读 → CONFLICTED（人工复核）", async () => {
    const h = setup();
    h.deps.adapter = new SettingsAdapter(() => null);
    await h.store.recordTable.put("d::1", { applyId: "d::1", proposalId: "p1", improvementId: "i", target: { type: "settings", ns: "shell", path: ["timeoutMs"] }, before: 60_000, after: 120_000, revisionBefore: 0, status: "mutating", idempotencyKey: "d::1", rollback: { available: false, status: "none" } });
    await reconcilePendingApplies(h.deps);
    expect((h.store.recordTable.get("d::1") as { status: string }).status).toBe("conflicted");
  });
});

describe("audit append-only", () => {
  it("audit 只存路径与错误码, 不存 before/after 值", async () => {
    const h = setup();
    await h.store.proposalTable.put("p1", makeProposal({ id: "p1" }));
    await approveAndApply(h.deps, { proposalId: "p1", applyId: APPLY_ID, ...APPROVE });
    const events = h.audit.list();
    expect(events.length).toBeGreaterThan(0);
    const json = JSON.stringify(events);
    expect(json).not.toMatch(/60000|120000|"after"|"before"|secret|password|sk-/);
    expect(json).toMatch(/shell/);
  });
});

describe("settings adapter allowlist", () => {
  it("任意 namespace / 任意 patch 不可达: 只暴露 readShellTimeout / updateShellTimeout", async () => {
    const h = setup();
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(h.adapter));
    expect(proto.filter((k) => k.toLowerCase().includes("update"))).toEqual(["updateShellTimeout"]);
    expect(proto).not.toContain("update");
    expect(proto).not.toContain("describe");
    // adapter 实例上没有任何通用 update 入口
    expect(Object.getOwnPropertyNames(h.adapter)).not.toContain("update");
  });

  it("settings 不可用 → SETTINGS_UNAVAILABLE, 不 crash", async () => {
    const adapter = new SettingsAdapter(() => null);
    expect(adapter.readShellTimeout()).toBeNull();
    await expect(adapter.updateShellTimeout({ expectedRevision: 0, expectedValue: 1, nextValue: 2 })).rejects.toBeInstanceOf(ApplyError);
    await expect(adapter.updateShellTimeout({ expectedRevision: 0, expectedValue: 1, nextValue: 2 })).rejects.toMatchObject({ code: APPLY_ERROR_CODES.SETTINGS_UNAVAILABLE });
  });
});
