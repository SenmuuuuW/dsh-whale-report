/**
 * 报告历史的持久化：whale 存储域。
 * 面板的历史列表跨会话存在；每条记录存完整统计 + 渲染好的 markdown。
 */
import { z } from "zod";
export type ReportId = string;
/** 报告语义版本：语义变更（如 daily 改自然日、新增预设）时 +1，旧记录作废重建。 */
export declare const REPORT_SEM = 5;
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
}, z.core.$strip>;
export type SessionIndexRecord = z.infer<typeof SessionIndexSchema>;
/** 周期基线（compact 统计，供"对比上周"与洞察引擎用）。 */
export declare const PeriodStatsSchema: z.ZodObject<{
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
}, z.core.$strip>;
export type PeriodStatsRecord = z.infer<typeof PeriodStatsSchema>;
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
        }>;
    };
};
//# sourceMappingURL=state.d.ts.map