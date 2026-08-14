/**
 * 工具层：whale_report —— 立即生成任意区间的鲸鱼报告。
 *
 * 数据来源是官方的会话查询服务（ctx.sessionQuery）：
 *   listSessions() → 全部会话头
 *   readSession(id) → 单会话完整事件日志（含 data 载荷）
 * 引擎只读，不写回任何会话数据。
 */
import { type ToolDefinition } from "@deepseek-ai/dsh-tools";
/**
 * 结构化类型：只依赖 sessionQuery 的行为面，不依赖具体类名。
 *
 * 为什么不用官方导出的类（SessionQueryEngine / SessionQueryService）：
 * DSH 处于 developer preview，同一个接缝在不同快照里改了类名
 * （npm 0.1.0-rc.6 是 SessionQueryEngine，source 快照是 SessionQueryService）。
 * 我们只用它的两个方法，结构兼容 = 两个快照都能编译、都能跑。
 */
export interface SessionQueryLike {
    listSessions(signal?: AbortSignal): Promise<{
        header: {
            id: string;
            createdAt: number;
            cwd?: string;
            delegationDepth?: number;
        };
    }[]>;
    readSession(sessionId: string): Promise<{
        session: {
            id: string;
        };
        events: {
            type: string;
            time: number;
            data: unknown;
        }[];
    }>;
}
/** 报告事件写回会话日志（声明合并进官方事件表）。 */
export interface WhaleReportEvent {
    preset: string;
    from: number;
    to: number;
    sessions: number;
    turns: number;
    totalEvents: number;
}
declare module "@deepseek-ai/dsh-session/types" {
    interface SessionEventMap {
        "whale/report": WhaleReportEvent;
    }
}
export interface ReportServices {
    sessionQuery: SessionQueryLike;
}
export interface ToolsHost {
    tools: {
        register(definition: ToolDefinition): unknown;
    };
}
export declare function registerReportTools(ctx: ToolsHost, svc: ReportServices): void;
//# sourceMappingURL=tools.d.ts.map