/**
 * ApplyService —— v0.6 Phase 1 的编排面。
 * 职责分离: Improve Engine → Proposal Builder → Apply Engine → Verify Engine
 * (api.ts 只做 HTTP;本文件做编排;mutation 只经 SettingsAdapter allowlist)。
 */
import type { ReportStats } from "../stats.js";
import type { ImprovementItem } from "../improvements.js";
import { computeImprovements } from "../improvements.js";
import { periodKey } from "../insights.js";
import type { ApplyProposal, ApplyRecord, AuditEvent, RollbackRecord, VerifyRecord } from "./types.js";
import { SettingsAdapter, type SettingsSeam } from "./settings-adapter.js";
import { AuditLogger } from "./audit.js";
import { approveAndApply, makeApplyId, reconcilePendingApplies, rejectProposal, type ApplyStore } from "./executor.js";
import { rollbackApply } from "./rollback.js";
import { buildShellTimeoutProposal } from "./proposal.js";
import { shellTimeoutStats, type ShellWindowQuery } from "../verify/metrics.js";
import { evaluateVerify, type VerifyResult } from "../verify/verifier.js";

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

const LOOKBACK_PRESET = "weekly";

export class ApplyService {
  readonly adapter: SettingsAdapter;
  readonly audit: AuditLogger;
  private readonly store: ApplyStore;

  constructor(private readonly options: ApplyServiceOptions) {
    this.adapter = new SettingsAdapter(options.getSettings);
    this.store = {
      proposalTable: options.domain.table("apply_proposals"),
      recordTable: options.domain.table("apply_records"),
      verifyTable: options.domain.table("verify_records"),
    };
    this.audit = new AuditLogger(options.domain.table("audit_log"));
  }

  private now(): number {
    return this.options.now === undefined ? Date.now() : this.options.now();
  }

  /** 幂等助手: 确定性 applyId(proposal.id + 单次 approval nonce)。 */
  applyIdFor(proposalId: string, nonce: string): string {
    return makeApplyId(proposalId, nonce);
  }

  /**
   * 生成 shell.timeoutMs proposal(Improve 证据 + lookback 窗口 stats + resolved settings)。
   * 返回 null 表示 NOT_APPLICABLE(阈值/归属不满足)。
   */
  async createProposal(input: { improvementId?: string }): Promise<ApplyProposal | null> {
    const now = this.now();
    const from = now - 7 * 24 * 60 * 60 * 1000;
    const stats = await this.options.queryStats(from, now);
    const period = periodKey(LOOKBACK_PRESET, now);
    const improvements = computeImprovements({ stats, period, failedSessions: stats.toolFailedSessions, corrections: stats.correctionSignals });
    const wanted = input.improvementId;
    const item: ImprovementItem | null =
      wanted === undefined ? (improvements.find((i) => i.category === "TOOL") ?? null) : (improvements.find((i) => i.id === wanted) ?? null);
    const settings = this.adapter.readShellTimeout();
    const proposal = buildShellTimeoutProposal({ improvement: item, stats, settings, now });
    if (proposal === null) return null;
    const existing = this.store.proposalTable.get(proposal.id) as ApplyProposal | undefined;
    if (existing !== undefined && existing.status !== "superseded") {
      // conflicted / rejected 的旧提案 → 置 superseded 并重新生成（§29-E: 配置已变, 旧提案作废）。
      if (existing.status === "conflicted" || existing.status === "rejected") {
        existing.status = "superseded";
        await this.store.proposalTable.put(existing.id, existing);
        await this.audit.append({ applyId: undefined, improvementId: proposal.improvementId, target: { ns: proposal.target.ns, path: proposal.target.path }, action: "proposal.superseded", result: "ok" });
      } else {
        return existing;
      }
    }
    await this.store.proposalTable.put(proposal.id, proposal);
    await this.audit.append({ applyId: undefined, improvementId: proposal.improvementId, target: { ns: proposal.target.ns, path: proposal.target.path }, action: "proposal.created", result: "ok" });
    return proposal;
  }

  getProposal(id: string): ApplyProposal | undefined {
    return this.store.proposalTable.get(id) as ApplyProposal | undefined;
  }

  getRecord(applyId: string): ApplyRecord | undefined {
    return this.store.recordTable.get(applyId) as ApplyRecord | undefined;
  }

  getVerify(applyId: string): VerifyRecord | undefined {
    return this.store.verifyTable.get(applyId) as VerifyRecord | undefined;
  }

  async approve(input: { proposalId: string; applyId: string; expectedRevision: number; expectedValue: number }): Promise<{ record: ApplyRecord; already: boolean }> {
    return approveAndApply(
      { store: this.store, adapter: this.adapter, audit: this.audit, now: this.options.now },
      { proposalId: input.proposalId, applyId: input.applyId, expectedRevision: input.expectedRevision, expectedValue: input.expectedValue },
    );
  }

  async reject(proposalId: string): Promise<ApplyProposal> {
    return rejectProposal({ store: this.store, adapter: this.adapter, audit: this.audit }, proposalId);
  }

  async revert(input: { applyId: string; rollbackId: string }): Promise<RollbackRecord> {
    return rollbackApply(
      { store: this.store, adapter: this.adapter, audit: this.audit, now: this.options.now },
      { applyId: input.applyId, rollbackId: input.rollbackId },
    );
  }

  async verify(applyId: string): Promise<VerifyResult> {
    const windowQuery: ShellWindowQuery = async (from, to) => shellTimeoutStats(await this.options.queryStats(from, to));
    return evaluateVerify(
      { store: this.store, query: windowQuery, audit: this.audit, now: this.options.now },
      { applyId },
    );
  }

  async reconcile(): Promise<{ recovered: number }> {
    return reconcilePendingApplies({ store: this.store, adapter: this.adapter, audit: this.audit });
  }

  auditEvents(limit = 200): AuditEvent[] {
    return this.audit.list(limit);
  }
}
