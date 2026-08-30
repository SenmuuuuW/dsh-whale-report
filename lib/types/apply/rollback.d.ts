/**
 * Rollback（RFC §9/§29-E）。
 * 只有 current == after 才允许自动回滚到 before;当前值已被改成第三个值
 * → TARGET_CHANGED,绝不覆盖用户修改。同样过 expectedRevision。
 */
import { type RollbackRecord } from "./types.js";
import { SettingsAdapter } from "./settings-adapter.js";
import type { AuditLogger } from "./audit.js";
import type { ApplyStore } from "./executor.js";
export interface RollbackDeps {
    store: ApplyStore;
    adapter: SettingsAdapter;
    audit: AuditLogger;
    now?: () => number;
}
export declare function rollbackApply(deps: RollbackDeps, input: {
    applyId: string;
    rollbackId: string;
    expectedRevision?: number;
}): Promise<RollbackRecord>;
//# sourceMappingURL=rollback.d.ts.map