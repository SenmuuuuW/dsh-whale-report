/**
 * 报告历史的持久化：whale 存储域。
 * 面板的历史列表跨会话存在；每条记录存完整统计 + 渲染好的 markdown。
 */
import { z } from "zod";
export type ReportId = string;
export type SessionIndexKey = string;
export declare const ReportRecordSchema: z.ZodObject<{
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
    };
};
//# sourceMappingURL=state.d.ts.map