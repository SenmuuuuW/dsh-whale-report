/**
 * v0.6 Apply & Verify — 共享类型（RFC §7-§13 + §29 修订）。
 * 只允许一种 mutation：settings `shell.timeoutMs`（allowlist 单字段）。
 */
export type ApplyRisk = "low" | "medium" | "high";
export type ApplyProposalStatus = "proposed" | "approved" | "applied" | "rejected" | "failed" | "conflicted" | "superseded";
export type ApplyExecutionStatus = "prepared" | "mutating" | "applied" | "failed" | "conflicted";
export type VerifyStatus = "observing" | "verified" | "not_improved" | "inconclusive" | "reverted";
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
    scope: {
        tools: string[];
    };
    baseline: {
        value: number;
        evidenceWindow: {
            from: number;
            to: number;
        };
        sampleSize: number;
        sessions: number;
    };
    target: {
        operator: "<=";
        value: number;
    };
    minimumEvidence: {
        observations: number;
        sessions: number;
    };
    cooldownMs: number;
    maxObservationWindowMs: number;
    baselineLookbackMs: number;
}
export interface ApplyProposal {
    id: string;
    improvementId: string;
    kind: "settings";
    target: SettingsTarget;
    expectedBefore: number;
    proposedAfter: number;
    diff: {
        op: "set";
        path: string[];
        before: number;
        after: number;
    };
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
    risk: ApplyRisk;
    reversible: true;
    rollbackPlan: {
        op: "set";
        path: string[];
        value: number;
    };
    verificationPlan: VerificationPlan;
    revisionAtProposal: number;
    createdAt: number;
    status: ApplyProposalStatus;
}
export interface ApplyRecord {
    applyId: string;
    proposalId: string;
    improvementId: string;
    target: SettingsTarget;
    before: number;
    after: number;
    revisionBefore: number;
    revisionAfter?: number;
    appliedAt?: number;
    status: ApplyExecutionStatus;
    idempotencyKey: string;
    rollback: {
        available: boolean;
        status: "none" | "reverted" | "conflicted";
    };
    lastErrorCode?: string;
}
export interface RollbackRecord {
    rollbackId: string;
    applyId: string;
    target: SettingsTarget;
    expectedCurrent: number;
    restoreTo: number;
    revisionBefore: number;
    rolledBackAt?: number;
    status: RollbackStatus;
}
export type AuditAction = "proposal.created" | "proposal.approved" | "proposal.rejected" | "proposal.conflicted" | "proposal.superseded" | "apply.prepared" | "apply.attempted" | "apply.succeeded" | "apply.failed" | "apply.recovered" | "verify.started" | "verify.result" | "rollback.attempted" | "rollback.succeeded" | "rollback.failed";
export interface AuditEvent {
    id: string;
    ts: number;
    applyId?: string;
    improvementId?: string;
    target?: {
        ns: string;
        path: string[];
    };
    action: AuditAction;
    result: "ok" | "error";
    code?: string;
}
/** Verify 快照(verify_records 表)。 */
export interface VerifyRecord {
    applyId: string;
    proposalId: string;
    metric: "shell_timeout_rate";
    status: VerifyStatus;
    baseline: {
        value: number;
        sampleSize: number;
        sessions: number;
        window: {
            from: number;
            to: number;
        };
    } | null;
    observed: {
        value: number | null;
        sampleSize: number;
        sessions: number;
        window: {
            from: number;
            to: number;
        };
    } | null;
    targetValue: number;
    minimumEvidence: {
        observations: number;
        sessions: number;
    };
    cooldownMs: number;
    maxObservationWindowMs: number;
    appliedAt: number;
    createdAt: number;
    updatedAt: number;
    verdictAt?: number;
    verdict?: string;
}
/** Apply/Verify 结构化错误(不把 raw DSH error 抛给前端)。 */
export declare class ApplyError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare const APPLY_ERROR_CODES: {
    readonly CONFIG_CHANGED: "CONFIG_CHANGED";
    readonly IN_PROGRESS: "IN_PROGRESS";
    readonly INVALID_PROPOSAL: "INVALID_PROPOSAL";
    readonly TARGET_CHANGED: "TARGET_CHANGED";
    readonly SETTINGS_CONFLICT: "SETTINGS_CONFLICT";
    readonly APPLY_FAILED: "APPLY_FAILED";
    readonly REVERT_FAILED: "REVERT_FAILED";
    readonly SETTINGS_UNAVAILABLE: "SETTINGS_UNAVAILABLE";
    readonly NOT_APPLICABLE: "NOT_APPLICABLE";
    readonly ALREADY_APPLIED: "ALREADY_APPLIED";
    readonly ALREADY_REVERTED: "ALREADY_REVERTED";
};
//# sourceMappingURL=types.d.ts.map