/**
 * Verify 引擎（RFC §10-§13）。
 * 窗口语义:
 *   baseline = [proposalCreatedAt - baselineLookbackMs, appliedAt)  —— 提案时固定
 *   after    = [appliedAt + cooldownMs, now)                        —— appliedAt 精确切点
 * 绝不把 Apply 前后事件混在一个窗口(§29-E/§12)。
 * NOT_IMPROVED 只输出 REVERT RECOMMENDED,绝不自动 rollback(§19)。
 */
import { type VerifyRecord, type VerifyStatus } from "../apply/types.js";
import { shellTimeoutStats, type ShellWindowQuery } from "./metrics.js";
import type { ApplyStore } from "../apply/executor.js";
import type { AuditLogger } from "../apply/audit.js";
export interface VerifyDeps {
    store: ApplyStore;
    query: ShellWindowQuery;
    audit: AuditLogger;
    now?: () => number;
}
export interface VerifyResult {
    record: VerifyRecord;
    status: VerifyStatus;
    progress: {
        observations: number;
        sessions: number;
        window: {
            from: number;
            to: number;
        } | null;
    };
    verdictNote?: string;
}
export declare function evaluateVerify(deps: VerifyDeps, input: {
    applyId: string;
    force?: boolean;
}): Promise<VerifyResult>;
/** 提案基线窗口查询(提案时固定,供 baseline 展示;数值以提案时 stats 为准)。 */
export { shellTimeoutStats };
//# sourceMappingURL=verifier.d.ts.map