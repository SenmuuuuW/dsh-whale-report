/**
 * Apply Executor（RFC §8/§9/§16）。
 * PREPARED → MUTATING → APPLIED;applyId 幂等;revision 双层防护;
 * crash 后由 reconcilePendingApplies 在启动时恢复(§16 三态)。
 */
import { type ApplyProposal, type ApplyRecord, type AuditAction } from "./types.js";
import { SettingsAdapter } from "./settings-adapter.js";
import type { AuditLogger } from "./audit.js";
export interface ApplyStore {
    proposalTable: {
        put(key: string, value: unknown): Promise<void> | void;
        get(key: string): unknown | undefined;
        entries?(): IterableIterator<[string, unknown]> | [string, unknown][];
    };
    recordTable: {
        put(key: string, value: unknown): Promise<void> | void;
        get(key: string): unknown | undefined;
        entries?(): IterableIterator<[string, unknown]> | [string, unknown][];
    };
    verifyTable: {
        put(key: string, value: unknown): Promise<void> | void;
        get(key: string): unknown | undefined;
        entries?(): IterableIterator<[string, unknown]> | [string, unknown][];
    };
}
export interface ApplyExecutorDeps {
    store: ApplyStore;
    adapter: SettingsAdapter;
    audit: AuditLogger;
    now?: () => number;
}
/** 生成确定性 applyId(proposal.id + 单次 approval nonce)。 */
export declare function makeApplyId(proposalId: string, nonce: string): string;
/**
 * 执行一次 user-approved Apply。
 * 安全契约（Phase 1.5 §5/§6）：mutation truth 全部来自 server-side stored proposal。
 * 请求只携带 applyId（幂等键 + 单次 approval 元数据）；namespace/path/before/after
 * 任何客户端字段都会被忽略（读取处只解构 applyId）。并发校验用 proposal 存储的
 * expectedBefore/revisionAtProposal 对照重读的当前值。
 * @returns 已持久化的 ApplyRecord(成功或失败终态)。
 */
export declare function approveAndApply(deps: ApplyExecutorDeps, input: {
    proposalId: string;
    applyId: string;
}): Promise<{
    record: ApplyRecord;
    already: boolean;
}>;
/**
 * 启动 reconciliation(§16): 恢复 crash 遗留的 prepared/mutating 记录。
 * 锚点 = resolved VALUE(持久真相): settings revision 是进程内写计数,跨重启不持久,
 * 绝不能用 revision 算术跨重启判定(Phase 1.5 实测)。
 *   value == after  → 本次写入已落 → APPLIED
 *   value == before → 写入从未发生 → FAILED
 *   其他            → CONFLICTED(人工复核,绝不猜)
 */
export declare function reconcilePendingApplies(deps: ApplyExecutorDeps): Promise<{
    recovered: number;
}>;
/** 提案拒绝(只读面,无 mutation)。 */
export declare function rejectProposal(deps: ApplyExecutorDeps, proposalId: string): Promise<ApplyProposal>;
export type { AuditAction };
//# sourceMappingURL=executor.d.ts.map