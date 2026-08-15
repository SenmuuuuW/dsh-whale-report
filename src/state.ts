/**
 * 报告历史的持久化：whale 存储域。
 * 面板的历史列表跨会话存在；每条记录存完整统计 + 渲染好的 markdown。
 */
import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";

export type ReportId = string;

/** 报告语义版本：语义变更（如 daily 改自然日、新增预设）时 +1，旧记录作废重建。 */
export const REPORT_SEM = 3;
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
});

export type SessionIndexRecord = z.infer<typeof SessionIndexSchema>;

/** 周期基线（compact 统计，供"对比上周"与洞察引擎用）。 */
export const PeriodStatsSchema = z.object({
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
});

export type PeriodStatsRecord = z.infer<typeof PeriodStatsSchema>;

export const whaleDomain = defineDomain({
  name: "whale",
  version: 1,
  tables: {
    reports: domainTable<ReportId, ReportRecord>(ReportRecordSchema),
    session_index: domainTable<SessionIndexKey, SessionIndexRecord>(SessionIndexSchema),
    period_stats: domainTable<PeriodKey, PeriodStatsRecord>(PeriodStatsSchema),
  },
});
