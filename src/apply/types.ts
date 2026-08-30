/**
 * v0.6 Apply & Verify — 共享类型（RFC §7-§13 + §29 修订）。
 * 只允许一种 mutation：settings `shell.timeoutMs`（allowlist 单字段）。
 */

export type ApplyRisk = "low" | "medium" | "high";

export type ApplyProposalStatus =
  | "proposed" | "approved" | "applied" | "rejected" | "failed"
  | "conflicted"   // 配置在提案后被外部改动 → 需重新生成
  | "superseded";  // 同目标新提案取代旧提案

export type ApplyExecutionStatus =
  | "prepared"   // 幂等行已落盘,尚未写 settings
  | "mutating"   // settings.update 已发出
  | "applied"
  | "failed"     // 确定未发生写入(revision 未变)
  | "conflicted"; // 外部改动竞态,无法判断归属 → 人工复核

export type VerifyStatus =
  | "observing" | "verified" | "not_improved" | "inconclusive" | "reverted";

export type RollbackStatus = "requested" | "done" | "failed" | "target-changed";

/** settings 单字段 target（Phase 1 唯一形态）。 */
export interface SettingsTarget {
  type: "settings";
  ns: "shell";
  path: string[];
}

/** 提案时的完整验证计划（RFC §11；Apply 前必须完整）。 */
export interface VerificationPlan {
  metric: "shell_timeout_rate";
  scope: { tools: string[] };
  baseline: {
    value: number;
    evidenceWindow: { from: number; to: number };
    sampleSize: number;
    sessions: number;
  };
  target: { operator: "<="; value: number };
  minimumEvidence: { observations: number; sessions: number };
  cooldownMs: number;
  maxObservationWindowMs: number;
  baselineLookbackMs: number;
}

export interface ApplyProposal {
  id: string;                 // `apply-<improvementId>-<hash>` 稳定可寻址
  improvementId: string;
  kind: "settings";
  target: SettingsTarget;
  expectedBefore: number;     // 提案时读到的当前值(数值,绝不存 secret)
  proposedAfter: number;
  diff: { op: "set"; path: string[]; before: number; after: number };
  reason: string;
  evidence: {
    metrics: Record<string, number>;
    affectedSessions: string[];
    occurrences: number;
    confidence: number;
    timeoutCount: number;
    shellInvocationCount: number;
    timeoutSessions: string[];
  };
  risk: ApplyRisk;            // v0.6 只生成 "low"
  reversible: true;
  rollbackPlan: { op: "set"; path: string[]; value: number };
  verificationPlan: VerificationPlan;
  revisionAtProposal: number; // settings namespace revision(乐观并发锚点)
  createdAt: number;
  status: ApplyProposalStatus;
}

export interface ApplyRecord {
  applyId: string;            // = proposal.id + 单次 approval nonce(幂等键)
  proposalId: string;
  improvementId: string;
  target: SettingsTarget;
  before: number;
  after: number;
  revisionBefore: number;     // 写入前的 namespace revision
  revisionAfter?: number;     // 写入后的 revision(成功后由 update 返回/describe 回读)
  appliedAt?: number;
  status: ApplyExecutionStatus;
  idempotencyKey: string;
  rollback: { available: boolean; status: "none" | "reverted" | "conflicted" };
  lastErrorCode?: string;
}

export interface RollbackRecord {
  rollbackId: string;
  applyId: string;
  target: SettingsTarget;
  expectedCurrent: number;    // 必须是 after(current == after 才允许回滚)
  restoreTo: number;          // before
  revisionBefore: number;     // 回滚写入前的 revision
  rolledBackAt?: number;
  status: RollbackStatus;
}

export type AuditAction =
  | "proposal.created" | "proposal.approved" | "proposal.rejected"
  | "proposal.conflicted" | "proposal.superseded"
  | "apply.prepared" | "apply.attempted" | "apply.succeeded" | "apply.failed" | "apply.recovered"
  | "verify.started" | "verify.result"
  | "rollback.attempted" | "rollback.succeeded" | "rollback.failed";

export interface AuditEvent {
  id: string;          // 单调(时间 + 序列)
  ts: number;
  applyId?: string;
  improvementId?: string;
  target?: { ns: string; path: string[] };  // 只记路径,不记值
  action: AuditAction;
  result: "ok" | "error";
  code?: string;       // 错误码(如 CONFIG_CHANGED),不存错误正文
}

/** Verify 快照(verify_records 表)。 */
export interface VerifyRecord {
  applyId: string;
  proposalId: string;
  metric: "shell_timeout_rate";
  status: VerifyStatus;
  baseline: { value: number; sampleSize: number; sessions: number; window: { from: number; to: number } } | null;
  observed: { value: number | null; sampleSize: number; sessions: number; window: { from: number; to: number } } | null;
  targetValue: number;
  minimumEvidence: { observations: number; sessions: number };
  cooldownMs: number;
  maxObservationWindowMs: number;
  appliedAt: number;
  createdAt: number;
  updatedAt: number;
  verdictAt?: number;
  verdict?: string;
}

/** Apply/Verify 结构化错误(不把 raw DSH error 抛给前端)。 */
export class ApplyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ApplyError";
  }
}

export const APPLY_ERROR_CODES = {
  CONFIG_CHANGED: "CONFIG_CHANGED",
  IN_PROGRESS: "IN_PROGRESS",
  INVALID_PROPOSAL: "INVALID_PROPOSAL",
  TARGET_CHANGED: "TARGET_CHANGED",
  SETTINGS_CONFLICT: "SETTINGS_CONFLICT",
  APPLY_FAILED: "APPLY_FAILED",
  REVERT_FAILED: "REVERT_FAILED",
  SETTINGS_UNAVAILABLE: "SETTINGS_UNAVAILABLE",
  NOT_APPLICABLE: "NOT_APPLICABLE",
  ALREADY_APPLIED: "ALREADY_APPLIED",
  ALREADY_REVERTED: "ALREADY_REVERTED",
} as const;
