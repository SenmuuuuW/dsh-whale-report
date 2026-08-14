/**
 * 报告历史的持久化：whale 存储域。
 * 面板的历史列表跨会话存在；每条记录存完整统计 + 渲染好的 markdown。
 */
import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";

export type ReportId = string;
export type SessionIndexKey = string;

export const ReportRecordSchema = z.object({
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

export const whaleDomain = defineDomain({
  name: "whale",
  version: 1,
  tables: {
    reports: domainTable<ReportId, ReportRecord>(ReportRecordSchema),
    session_index: domainTable<SessionIndexKey, SessionIndexRecord>(SessionIndexSchema),
  },
});
