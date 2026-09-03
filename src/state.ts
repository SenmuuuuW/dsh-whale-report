/**
 * 报告历史的持久化：whale 存储域。
 * 面板的历史列表跨会话存在；每条记录存完整统计 + 渲染好的 markdown。
 */
import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";

export type ReportId = string;

/**
 * 报告语义版本：语义变更（如 daily 改自然日、新增预设、新增 Improve 输出）时 +1，旧记录作废重建。
 * v0.6.1: 7 —— 历史计费回溯（8-17 峰谷生效日）与 ingest 完整性修复（headers 补录 / resume
 * 历史保留）后，旧 period_stats / reports 的 cost/token 不得继续展示为当前口径。
 */
export const REPORT_SEM = 7;
export type SessionIndexKey = string;
export type PeriodKey = string;

export const ReportRecordSchema = z.object({
  sem: z.number().int().optional(),
  id: z.string().min(1),
  preset: z.string(),
  from: z.number(),
  to: z.number(),
  createdAt: z.number(),
  sessions: z.number().int().min(0),
  turns: z.number().int().min(0),
  totalEvents: z.number().int().min(0),
  /** 结构化统计（客户端渲染用；结构由 stats.ts 定义，这里宽松存放）。 */
  stats: z.unknown(),
  /** 渲染好的 markdown 报告（聊天路径 / 复制分享用）。 */
  markdown: z.string(),
  /** 费用拆解（CostBreakdown，由 pricing.ts 计算；旧记录可缺省）。 */
  cost: z.unknown().optional(),
  /** 洞察卡片（Insight[]；旧记录可缺省）。 */
  insights: z.unknown().optional(),
  /** Improve 建议（ImprovementItem[]，v0.5；旧记录可缺省）。 */
  improvements: z.unknown().optional(),
  /** 生成本报告消耗（mode=local 时全 0；旧记录可缺省）。 */
  reportGeneration: z.unknown().optional(),
  /** 上一周期对比摘要（用于展示涨跌；旧记录可缺省）。 */
  prev: z.unknown().optional(),
});

export type ReportRecord = z.infer<typeof ReportRecordSchema>;

export const SessionIndexSchema = z.object({
  sessionId: z.string().min(1),
  v: z.number().int(),
  builtAt: z.number(),
  lastSeq: z.number().int().min(0),
  lastMs: z.number(),
  /** HourBucket[]（结构由 stats.ts 定义，这里宽松存放）。 */
  buckets: z.unknown(),
  titles: z.array(z.string()),
  /** 源文件指纹（P0.2）：mtime + size。文件未变 → 索引可复用；变化 → 失效重建。旧记录可缺省。 */
  src: z.object({ mtimeMs: z.number(), size: z.number() }).optional(),
  /** P0.1 salvage 缓存：索引来自只读恢复；复用时继续披露数据来源。 */
  salvaged: z.boolean().optional(),
  /** v0.5.x repair：live 会话增量索引标记（flush 落盘；恢复后由指纹/基线接管）。 */
  live: z.boolean().optional(),
  salvagedRecords: z.number().int().min(0).optional(),
  salvagedDropped: z.number().int().min(0).optional(),
});

export type SessionIndexRecord = z.infer<typeof SessionIndexSchema>;

/** 周期基线（compact 统计，供"对比上周"与洞察引擎用）。 */
export const PeriodStatsSchema = z.object({
  /** 语义版本（v0.6.1 起写入）：trends/prev 只采纳当前 REPORT_SEM 的记录。 */
  sem: z.number().int().optional(),
  key: z.string().min(1),
  preset: z.string(),
  from: z.number(),
  to: z.number(),
  createdAt: z.number(),
  sessions: z.number(),
  turns: z.number(),
  toolCallsTotal: z.number(),
  commands: z.number(),
  toolErrors: z.number(),
  totalEvents: z.number(),
  tokens: z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), reasoning: z.number() }),
  cost: z.number(),
  nightRatio: z.number(),
  cacheHitRate: z.number(),
  dangerCount: z.number(),
  redDanger: z.number(),
  retryBursts: z.number(),
  activeDays: z.number(),
  /** 数据完整性：被跳过（损坏/读取失败）的会话数（fault isolation；0 或缺失 = 完整）。 */
  skippedCount: z.number().int().min(0).optional(),
});

export type PeriodStatsRecord = z.infer<typeof PeriodStatsSchema>;

/** v0.6 Apply（RFC §7）：只允许 settings shell.timeoutMs 单字段提案。 */
export const ApplyProposalSchema = z.object({
  id: z.string().min(1),
  improvementId: z.string(),
  kind: z.literal("settings"),
  target: z.object({ type: z.literal("settings"), ns: z.literal("shell"), path: z.array(z.string()) }),
  expectedBefore: z.number(),
  proposedAfter: z.number(),
  diff: z.object({ op: z.literal("set"), path: z.array(z.string()), before: z.number(), after: z.number() }),
  reason: z.string(),
  evidence: z.object({
    metrics: z.record(z.string(), z.number()),
    affectedSessions: z.array(z.string()),
    occurrences: z.number(),
    confidence: z.number(),
    timeoutCount: z.number(),
    shellInvocationCount: z.number(),
    timeoutSessions: z.array(z.string()),
  }),
  risk: z.enum(["low", "medium", "high"]),
  reversible: z.literal(true),
  rollbackPlan: z.object({ op: z.literal("set"), path: z.array(z.string()), value: z.number() }),
  verificationPlan: z.object({
    metric: z.literal("shell_timeout_rate"),
    scope: z.object({ tools: z.array(z.string()) }),
    baseline: z.object({ value: z.number(), evidenceWindow: z.object({ from: z.number(), to: z.number() }), sampleSize: z.number(), sessions: z.number() }),
    target: z.object({ operator: z.literal("<="), value: z.number() }),
    minimumEvidence: z.object({ observations: z.number(), sessions: z.number() }),
    cooldownMs: z.number(),
    maxObservationWindowMs: z.number(),
    baselineLookbackMs: z.number(),
  }),
  revisionAtProposal: z.number(),
  createdAt: z.number(),
  status: z.enum(["proposed", "approved", "applied", "rejected", "failed", "conflicted", "superseded"]),
});

export const ApplyRecordSchema = z.object({
  applyId: z.string().min(1),
  proposalId: z.string(),
  improvementId: z.string(),
  target: z.object({ type: z.literal("settings"), ns: z.literal("shell"), path: z.array(z.string()) }),
  before: z.number(),
  after: z.number(),
  revisionBefore: z.number(),
  revisionAfter: z.number().optional(),
  appliedAt: z.number().optional(),
  status: z.enum(["prepared", "mutating", "applied", "failed", "conflicted"]),
  idempotencyKey: z.string(),
  rollback: z.object({ available: z.boolean(), status: z.enum(["none", "reverted", "conflicted"]) }),
  lastErrorCode: z.string().optional(),
});

export const VerifyRecordSchema = z.object({
  applyId: z.string().min(1),
  proposalId: z.string(),
  metric: z.literal("shell_timeout_rate"),
  status: z.enum(["observing", "verified", "not_improved", "inconclusive", "reverted"]),
  baseline: z.object({ value: z.number(), sampleSize: z.number(), sessions: z.number(), window: z.object({ from: z.number(), to: z.number() }) }).nullable(),
  observed: z.object({ value: z.number().nullable(), sampleSize: z.number(), sessions: z.number(), window: z.object({ from: z.number(), to: z.number() }) }).nullable(),
  targetValue: z.number(),
  minimumEvidence: z.object({ observations: z.number(), sessions: z.number() }),
  cooldownMs: z.number(),
  maxObservationWindowMs: z.number(),
  appliedAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  verdictAt: z.number().optional(),
  verdict: z.string().optional(),
});

export const AuditEventSchema = z.object({
  id: z.string().min(1),
  ts: z.number(),
  applyId: z.string().optional(),
  improvementId: z.string().optional(),
  target: z.object({ ns: z.string(), path: z.array(z.string()) }).optional(),
  action: z.string(),
  result: z.enum(["ok", "error"]),
  code: z.string().optional(),
});

export const whaleDomain = defineDomain({
  name: "whale",
  version: 1,
  tables: {
    reports: domainTable<ReportId, ReportRecord>(ReportRecordSchema),
    session_index: domainTable<SessionIndexKey, SessionIndexRecord>(SessionIndexSchema),
    period_stats: domainTable<PeriodKey, PeriodStatsRecord>(PeriodStatsSchema),
    apply_proposals: domainTable<string, z.infer<typeof ApplyProposalSchema>>(ApplyProposalSchema),
    apply_records: domainTable<string, z.infer<typeof ApplyRecordSchema>>(ApplyRecordSchema),
    verify_records: domainTable<string, z.infer<typeof VerifyRecordSchema>>(VerifyRecordSchema),
    audit_log: domainTable<string, z.infer<typeof AuditEventSchema>>(AuditEventSchema),
  },
});
