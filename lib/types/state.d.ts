/**
 * 报告历史的持久化：whale 存储域。
 * 面板的历史列表跨会话存在；每条记录存完整统计 + 渲染好的 markdown。
 */
import { z } from "zod";
export type ReportId = string;
/**
 * 报告语义版本：语义变更（如 daily 改自然日、新增预设、新增 Improve 输出）时 +1，旧记录作废重建。
 * v0.6.1: 7 —— 历史计费回溯（8-17 峰谷生效日）与 ingest 完整性修复（headers 补录 / resume
 * 历史保留）后，旧 period_stats / reports 的 cost/token 不得继续展示为当前口径。
 */
export declare const REPORT_SEM = 7;
export type SessionIndexKey = string;
export type PeriodKey = string;
export declare const ReportRecordSchema: z.ZodObject<{
    sem: z.ZodOptional<z.ZodNumber>;
    id: z.ZodString;
    preset: z.ZodString;
    from: z.ZodNumber;
    to: z.ZodNumber;
    createdAt: z.ZodNumber;
    sessions: z.ZodNumber;
    turns: z.ZodNumber;
    totalEvents: z.ZodNumber;
    stats: z.ZodUnknown;
    markdown: z.ZodString;
    cost: z.ZodOptional<z.ZodUnknown>;
    insights: z.ZodOptional<z.ZodUnknown>;
    improvements: z.ZodOptional<z.ZodUnknown>;
    reportGeneration: z.ZodOptional<z.ZodUnknown>;
    prev: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strip>;
export type ReportRecord = z.infer<typeof ReportRecordSchema>;
export declare const SessionIndexSchema: z.ZodObject<{
    sessionId: z.ZodString;
    v: z.ZodNumber;
    builtAt: z.ZodNumber;
    lastSeq: z.ZodNumber;
    lastMs: z.ZodNumber;
    buckets: z.ZodUnknown;
    titles: z.ZodArray<z.ZodString>;
    src: z.ZodOptional<z.ZodObject<{
        mtimeMs: z.ZodNumber;
        size: z.ZodNumber;
    }, z.core.$strip>>;
    salvaged: z.ZodOptional<z.ZodBoolean>;
    live: z.ZodOptional<z.ZodBoolean>;
    salvagedRecords: z.ZodOptional<z.ZodNumber>;
    salvagedDropped: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type SessionIndexRecord = z.infer<typeof SessionIndexSchema>;
/** 周期基线（compact 统计，供"对比上周"与洞察引擎用）。 */
export declare const PeriodStatsSchema: z.ZodObject<{
    sem: z.ZodOptional<z.ZodNumber>;
    key: z.ZodString;
    preset: z.ZodString;
    from: z.ZodNumber;
    to: z.ZodNumber;
    createdAt: z.ZodNumber;
    sessions: z.ZodNumber;
    turns: z.ZodNumber;
    toolCallsTotal: z.ZodNumber;
    commands: z.ZodNumber;
    toolErrors: z.ZodNumber;
    totalEvents: z.ZodNumber;
    tokens: z.ZodObject<{
        input: z.ZodNumber;
        output: z.ZodNumber;
        cacheRead: z.ZodNumber;
        reasoning: z.ZodNumber;
    }, z.core.$strip>;
    cost: z.ZodNumber;
    nightRatio: z.ZodNumber;
    cacheHitRate: z.ZodNumber;
    dangerCount: z.ZodNumber;
    redDanger: z.ZodNumber;
    retryBursts: z.ZodNumber;
    activeDays: z.ZodNumber;
    skippedCount: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type PeriodStatsRecord = z.infer<typeof PeriodStatsSchema>;
/** v0.6 Apply（RFC §7）：只允许 settings shell.timeoutMs 单字段提案。 */
export declare const ApplyProposalSchema: z.ZodObject<{
    id: z.ZodString;
    improvementId: z.ZodString;
    kind: z.ZodLiteral<"settings">;
    target: z.ZodObject<{
        type: z.ZodLiteral<"settings">;
        ns: z.ZodLiteral<"shell">;
        path: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    expectedBefore: z.ZodNumber;
    proposedAfter: z.ZodNumber;
    diff: z.ZodObject<{
        op: z.ZodLiteral<"set">;
        path: z.ZodArray<z.ZodString>;
        before: z.ZodNumber;
        after: z.ZodNumber;
    }, z.core.$strip>;
    reason: z.ZodString;
    evidence: z.ZodObject<{
        metrics: z.ZodRecord<z.ZodString, z.ZodNumber>;
        affectedSessions: z.ZodArray<z.ZodString>;
        occurrences: z.ZodNumber;
        confidence: z.ZodNumber;
        timeoutCount: z.ZodNumber;
        shellInvocationCount: z.ZodNumber;
        timeoutSessions: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    risk: z.ZodEnum<{
        low: "low";
        medium: "medium";
        high: "high";
    }>;
    reversible: z.ZodLiteral<true>;
    rollbackPlan: z.ZodObject<{
        op: z.ZodLiteral<"set">;
        path: z.ZodArray<z.ZodString>;
        value: z.ZodNumber;
    }, z.core.$strip>;
    verificationPlan: z.ZodObject<{
        metric: z.ZodLiteral<"shell_timeout_rate">;
        scope: z.ZodObject<{
            tools: z.ZodArray<z.ZodString>;
        }, z.core.$strip>;
        baseline: z.ZodObject<{
            value: z.ZodNumber;
            evidenceWindow: z.ZodObject<{
                from: z.ZodNumber;
                to: z.ZodNumber;
            }, z.core.$strip>;
            sampleSize: z.ZodNumber;
            sessions: z.ZodNumber;
        }, z.core.$strip>;
        target: z.ZodObject<{
            operator: z.ZodLiteral<"<=">;
            value: z.ZodNumber;
        }, z.core.$strip>;
        minimumEvidence: z.ZodObject<{
            observations: z.ZodNumber;
            sessions: z.ZodNumber;
        }, z.core.$strip>;
        cooldownMs: z.ZodNumber;
        maxObservationWindowMs: z.ZodNumber;
        baselineLookbackMs: z.ZodNumber;
    }, z.core.$strip>;
    revisionAtProposal: z.ZodNumber;
    createdAt: z.ZodNumber;
    status: z.ZodEnum<{
        proposed: "proposed";
        approved: "approved";
        applied: "applied";
        rejected: "rejected";
        failed: "failed";
        conflicted: "conflicted";
        superseded: "superseded";
    }>;
}, z.core.$strip>;
export declare const ApplyRecordSchema: z.ZodObject<{
    applyId: z.ZodString;
    proposalId: z.ZodString;
    improvementId: z.ZodString;
    target: z.ZodObject<{
        type: z.ZodLiteral<"settings">;
        ns: z.ZodLiteral<"shell">;
        path: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    before: z.ZodNumber;
    after: z.ZodNumber;
    revisionBefore: z.ZodNumber;
    revisionAfter: z.ZodOptional<z.ZodNumber>;
    appliedAt: z.ZodOptional<z.ZodNumber>;
    status: z.ZodEnum<{
        applied: "applied";
        failed: "failed";
        conflicted: "conflicted";
        prepared: "prepared";
        mutating: "mutating";
    }>;
    idempotencyKey: z.ZodString;
    rollback: z.ZodObject<{
        available: z.ZodBoolean;
        status: z.ZodEnum<{
            conflicted: "conflicted";
            none: "none";
            reverted: "reverted";
        }>;
    }, z.core.$strip>;
    lastErrorCode: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const VerifyRecordSchema: z.ZodObject<{
    applyId: z.ZodString;
    proposalId: z.ZodString;
    metric: z.ZodLiteral<"shell_timeout_rate">;
    status: z.ZodEnum<{
        reverted: "reverted";
        observing: "observing";
        verified: "verified";
        not_improved: "not_improved";
        inconclusive: "inconclusive";
    }>;
    baseline: z.ZodNullable<z.ZodObject<{
        value: z.ZodNumber;
        sampleSize: z.ZodNumber;
        sessions: z.ZodNumber;
        window: z.ZodObject<{
            from: z.ZodNumber;
            to: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    observed: z.ZodNullable<z.ZodObject<{
        value: z.ZodNullable<z.ZodNumber>;
        sampleSize: z.ZodNumber;
        sessions: z.ZodNumber;
        window: z.ZodObject<{
            from: z.ZodNumber;
            to: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    targetValue: z.ZodNumber;
    minimumEvidence: z.ZodObject<{
        observations: z.ZodNumber;
        sessions: z.ZodNumber;
    }, z.core.$strip>;
    cooldownMs: z.ZodNumber;
    maxObservationWindowMs: z.ZodNumber;
    appliedAt: z.ZodNumber;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
    verdictAt: z.ZodOptional<z.ZodNumber>;
    verdict: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const AuditEventSchema: z.ZodObject<{
    id: z.ZodString;
    ts: z.ZodNumber;
    applyId: z.ZodOptional<z.ZodString>;
    improvementId: z.ZodOptional<z.ZodString>;
    target: z.ZodOptional<z.ZodObject<{
        ns: z.ZodString;
        path: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    action: z.ZodString;
    result: z.ZodEnum<{
        error: "error";
        ok: "ok";
    }>;
    code: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const whaleDomain: {
    name: string;
    version: number;
    tables: {
        reports: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            preset: string;
            from: number;
            to: number;
            createdAt: number;
            sessions: number;
            turns: number;
            totalEvents: number;
            stats: unknown;
            markdown: string;
            sem?: number | undefined;
            cost?: unknown;
            insights?: unknown;
            improvements?: unknown;
            reportGeneration?: unknown;
            prev?: unknown;
        }>;
        session_index: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            sessionId: string;
            v: number;
            builtAt: number;
            lastSeq: number;
            lastMs: number;
            buckets: unknown;
            titles: string[];
            src?: {
                mtimeMs: number;
                size: number;
            } | undefined;
            salvaged?: boolean | undefined;
            live?: boolean | undefined;
            salvagedRecords?: number | undefined;
            salvagedDropped?: number | undefined;
        }>;
        period_stats: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            key: string;
            preset: string;
            from: number;
            to: number;
            createdAt: number;
            sessions: number;
            turns: number;
            toolCallsTotal: number;
            commands: number;
            toolErrors: number;
            totalEvents: number;
            tokens: {
                input: number;
                output: number;
                cacheRead: number;
                reasoning: number;
            };
            cost: number;
            nightRatio: number;
            cacheHitRate: number;
            dangerCount: number;
            redDanger: number;
            retryBursts: number;
            activeDays: number;
            sem?: number | undefined;
            skippedCount?: number | undefined;
        }>;
        apply_proposals: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            improvementId: string;
            kind: "settings";
            target: {
                type: "settings";
                ns: "shell";
                path: string[];
            };
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
            risk: "low" | "medium" | "high";
            reversible: true;
            rollbackPlan: {
                op: "set";
                path: string[];
                value: number;
            };
            verificationPlan: {
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
            };
            revisionAtProposal: number;
            createdAt: number;
            status: "proposed" | "approved" | "applied" | "rejected" | "failed" | "conflicted" | "superseded";
        }>;
        apply_records: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            applyId: string;
            proposalId: string;
            improvementId: string;
            target: {
                type: "settings";
                ns: "shell";
                path: string[];
            };
            before: number;
            after: number;
            revisionBefore: number;
            status: "applied" | "failed" | "conflicted" | "prepared" | "mutating";
            idempotencyKey: string;
            rollback: {
                available: boolean;
                status: "conflicted" | "none" | "reverted";
            };
            revisionAfter?: number | undefined;
            appliedAt?: number | undefined;
            lastErrorCode?: string | undefined;
        }>;
        verify_records: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            applyId: string;
            proposalId: string;
            metric: "shell_timeout_rate";
            status: "reverted" | "observing" | "verified" | "not_improved" | "inconclusive";
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
            verdictAt?: number | undefined;
            verdict?: string | undefined;
        }>;
        audit_log: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            ts: number;
            action: string;
            result: "error" | "ok";
            applyId?: string | undefined;
            improvementId?: string | undefined;
            target?: {
                ns: string;
                path: string[];
            } | undefined;
            code?: string | undefined;
        }>;
    };
};
//# sourceMappingURL=state.d.ts.map