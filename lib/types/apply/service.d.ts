/**
 * ApplyService —— v0.6 Phase 1 的编排面。
 * 职责分离: Improve Engine → Proposal Builder → Apply Engine → Verify Engine
 * (api.ts 只做 HTTP;本文件做编排;mutation 只经 SettingsAdapter allowlist)。
 */
import type { ReportStats } from "../stats.js";
import type { ApplyProposal, ApplyRecord, AuditEvent, RollbackRecord, VerifyRecord } from "./types.js";
import { SettingsAdapter, type SettingsSeam } from "./settings-adapter.js";
import { AuditLogger } from "./audit.js";
import { type VerifyResult } from "../verify/verifier.js";
export interface ApplyServiceOptions {
    domain: {
        table(name: string): {
            put(key: string, value: unknown): Promise<void> | void;
            get(key: string): unknown | undefined;
            entries?(): IterableIterator<[string, unknown]> | [string, unknown][];
        };
    };
    getSettings: () => SettingsSeam | null;
    /** 精确 [from,to) 窗口的完整 stats 查询(由 API/宿主层用 queryPeriod 提供)。 */
    queryStats: (from: number, to: number) => Promise<ReportStats>;
    now?: () => number;
}
export declare class ApplyService {
    private readonly options;
    readonly adapter: SettingsAdapter;
    readonly audit: AuditLogger;
    private readonly store;
    constructor(options: ApplyServiceOptions);
    private now;
    /** 幂等助手: 确定性 applyId(proposal.id + 单次 approval nonce)。 */
    applyIdFor(proposalId: string, nonce: string): string;
    /**
     * 生成 shell.timeoutMs proposal(Improve 证据 + lookback 窗口 stats + resolved settings)。
     * 返回 null 表示 NOT_APPLICABLE(阈值/归属不满足)。
     */
    createProposal(input: {
        improvementId?: string;
    }): Promise<ApplyProposal | null>;
    getProposal(id: string): ApplyProposal | undefined;
    getRecord(applyId: string): ApplyRecord | undefined;
    getVerify(applyId: string): VerifyRecord | undefined;
    approve(input: {
        proposalId: string;
        applyId: string;
        expectedRevision: number;
        expectedValue: number;
    }): Promise<{
        record: ApplyRecord;
        already: boolean;
    }>;
    reject(proposalId: string): Promise<ApplyProposal>;
    revert(input: {
        applyId: string;
        rollbackId: string;
    }): Promise<RollbackRecord>;
    verify(applyId: string): Promise<VerifyResult>;
    reconcile(): Promise<{
        recovered: number;
    }>;
    auditEvents(limit?: number): AuditEvent[];
}
//# sourceMappingURL=service.d.ts.map