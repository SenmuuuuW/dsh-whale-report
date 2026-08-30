import { computeImprovements } from "../improvements.js";
import { periodKey } from "../insights.js";
import { SettingsAdapter } from "./settings-adapter.js";
import { AuditLogger } from "./audit.js";
import { approveAndApply, makeApplyId, reconcilePendingApplies, rejectProposal } from "./executor.js";
import { rollbackApply } from "./rollback.js";
import { buildShellTimeoutProposal } from "./proposal.js";
import { shellTimeoutStats } from "../verify/metrics.js";
import { evaluateVerify } from "../verify/verifier.js";
const LOOKBACK_PRESET = "weekly";
export class ApplyService {
    options;
    adapter;
    audit;
    store;
    constructor(options) {
        this.options = options;
        this.adapter = new SettingsAdapter(options.getSettings);
        this.store = {
            proposalTable: options.domain.table("apply_proposals"),
            recordTable: options.domain.table("apply_records"),
            verifyTable: options.domain.table("verify_records"),
        };
        this.audit = new AuditLogger(options.domain.table("audit_log"));
    }
    now() {
        return this.options.now === undefined ? Date.now() : this.options.now();
    }
    /** 幂等助手: 确定性 applyId(proposal.id + 单次 approval nonce)。 */
    applyIdFor(proposalId, nonce) {
        return makeApplyId(proposalId, nonce);
    }
    /**
     * 生成 shell.timeoutMs proposal(Improve 证据 + lookback 窗口 stats + resolved settings)。
     * 返回 null 表示 NOT_APPLICABLE(阈值/归属不满足)。
     */
    async createProposal(input) {
        const now = this.now();
        const from = now - 7 * 24 * 60 * 60 * 1000;
        const stats = await this.options.queryStats(from, now);
        const period = periodKey(LOOKBACK_PRESET, now);
        const improvements = computeImprovements({ stats, period, failedSessions: stats.toolFailedSessions, corrections: stats.correctionSignals });
        const wanted = input.improvementId;
        const item = wanted === undefined ? (improvements.find((i) => i.category === "TOOL") ?? null) : (improvements.find((i) => i.id === wanted) ?? null);
        const settings = this.adapter.readShellTimeout();
        const proposal = buildShellTimeoutProposal({ improvement: item, stats, settings, now });
        if (proposal === null)
            return null;
        const existing = this.store.proposalTable.get(proposal.id);
        if (existing !== undefined && existing.status !== "superseded") {
            // conflicted / rejected 的旧提案 → 置 superseded 并重新生成（§29-E: 配置已变, 旧提案作废）。
            if (existing.status === "conflicted" || existing.status === "rejected") {
                existing.status = "superseded";
                await this.store.proposalTable.put(existing.id, existing);
                await this.audit.append({ applyId: undefined, improvementId: proposal.improvementId, target: { ns: proposal.target.ns, path: proposal.target.path }, action: "proposal.superseded", result: "ok" });
            }
            else {
                return existing;
            }
        }
        await this.store.proposalTable.put(proposal.id, proposal);
        await this.audit.append({ applyId: undefined, improvementId: proposal.improvementId, target: { ns: proposal.target.ns, path: proposal.target.path }, action: "proposal.created", result: "ok" });
        return proposal;
    }
    getProposal(id) {
        return this.store.proposalTable.get(id);
    }
    getRecord(applyId) {
        return this.store.recordTable.get(applyId);
    }
    getVerify(applyId) {
        return this.store.verifyTable.get(applyId);
    }
    async approve(input) {
        return approveAndApply({ store: this.store, adapter: this.adapter, audit: this.audit, now: this.options.now }, { proposalId: input.proposalId, applyId: input.applyId, expectedRevision: input.expectedRevision, expectedValue: input.expectedValue });
    }
    async reject(proposalId) {
        return rejectProposal({ store: this.store, adapter: this.adapter, audit: this.audit }, proposalId);
    }
    async revert(input) {
        return rollbackApply({ store: this.store, adapter: this.adapter, audit: this.audit, now: this.options.now }, { applyId: input.applyId, rollbackId: input.rollbackId });
    }
    async verify(applyId) {
        const windowQuery = async (from, to) => shellTimeoutStats(await this.options.queryStats(from, to));
        return evaluateVerify({ store: this.store, query: windowQuery, audit: this.audit, now: this.options.now }, { applyId });
    }
    async reconcile() {
        return reconcilePendingApplies({ store: this.store, adapter: this.adapter, audit: this.audit });
    }
    auditEvents(limit = 200) {
        return this.audit.list(limit);
    }
}
//# sourceMappingURL=service.js.map