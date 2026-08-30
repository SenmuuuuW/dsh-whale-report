/**
 * 工具层：whale_report —— 立即生成任意区间的鲸鱼报告。
 *
 * 数据来源是官方的会话查询服务（ctx.sessionQuery）：
 *   listSessions() → 全部会话头
 *   readSession(id) → 单会话完整事件日志（含 data 载荷）
 * 引擎只读，不写回任何会话数据。
 */
import { type ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { SessionIndexRecord, PeriodStatsRecord } from "./state.js";
import { type CostBreakdown } from "./pricing.js";
import { type Insight } from "./insights.js";
import { type ImprovementItem } from "./improvements.js";
import { type ReportStats } from "./stats.js";
import { type SessionFileStat } from "./salvage.js";
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
        live: boolean;
    }[]>;
    readSession(sessionId: string): Promise<{
        session: {
            id: string;
            seedLength?: number;
        };
        events: {
            type: string;
            seq: number;
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
/** 会话索引表（whale 存储域 sessionIndex 的最小结构视图）。 */
export interface IndexTable {
    get(key: string): SessionIndexRecord | undefined;
    put(key: string, value: SessionIndexRecord): Promise<void>;
}
export interface ReportServices {
    sessionQuery: SessionQueryLike;
    index: IndexTable;
    /** 已安装插件名列表（loader 枚举，供"插件真实归属"展示）。 */
    plugins?: string[];
    periodStats?: {
        get(key: string): PeriodStatsRecord | undefined;
        put(key: string, value: PeriodStatsRecord): Promise<void>;
    };
}
export interface ToolsHost {
    tools: {
        register(definition: ToolDefinition): unknown;
    };
}
/** 有限并发映射：报告生成要读几十个会话的完整日志，串行太慢。 */
export declare function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]>;
/** 索引结构版本：结构变更（如新增 modelUsage）时递增，旧记录自然失效重建。 */
export declare const INDEX_VERSION = 17;
/**
 * 索引新鲜度（P0.2）：不再用"缓存年龄 TTL"判定 —— 历史会话在文件未变化时
 * 必须复用索引，避免每 10 分钟全量重放。
 *
 * 判定规则（保守方向 = 重建）：
 *   - 条目带指纹（src）：文件 mtime + size 完全一致 → 复用；否则失效重建。
 *   - 旧条目（无指纹）：文件最后写入时间不晚于最后一条已索引事件
 *     （或建索引时刻）→ 索引完整可复用（并回填指纹）；否则重建。
 *   - 无法 stat 源文件（非常规宿主/测试）：无法证明未变 → 重建。
 * 追加事件必然改变文件 mtime/size → 任何缓存（含 salvage 缓存）都不会漏新事件。
 */
export declare function isIndexFresh(entry: SessionIndexRecord | undefined, stat: SessionFileStat | null): entry is SessionIndexRecord;
/** 生成性能细账（P0 验收计时；随 /summary 响应透出，前端不消费）。 */
export interface GenerationPerf {
    listSessionsMs: number;
    indexHits: number;
    /** 已有索引条目但源文件已变化（或无法验证）而被重建的会话数。 */
    invalidations: number;
    reads: number;
    readMs: number;
    salvages: number;
    salvageMs: number;
    aggregateMs: number;
    improveMs: number;
}
export declare function newGenerationPerf(): GenerationPerf;
/**
 * 读取失败原因粗分类（fault isolation）。
 *
 * 原则：只产出**有界、稳定、非敏感**的类别（如 "corrupt-log"），
 * 绝不把错误消息 / 堆栈原文存进报告 —— 日志损坏原因属于技术诊断，
 * 报告只声明"哪类失败、多少会话"，细节留给用户自己看 ~/.dsh。
 */
export declare function classifyReadError(error: unknown): string;
/**
 * 收集区间统计。两条数据路径：
 * - live 会话：readSession 走内存快照，直接分桶；
 * - 持久化会话：优先读 whale 域的会话索引（10 分钟新鲜度窗口），
 *   过期才读完整日志（zstd 解压重放，实测 60s+）并回写索引。
 * 返回与 aggregate(events, …) 等价的 ReportStats。
 *
 * Fault isolation：单个会话损坏 / 读取失败 → 跳过该会话并记入
 * stats.partial（id + 粗分类原因），其余健康会话照常聚合；
 * 缺失数据不按 0 处理 —— 报告与 UI 必须披露 partial。
 */
export declare function collectEvents(svc: ReportServices, period: {
    from: number;
    to: number;
}, perf?: GenerationPerf): Promise<ReportStats>;
/**
 * 后台预热：为缺失/失效索引的持久化会话预建索引（无时间上限）。
 * 首次生成报告的 50s 成本移到启动后的一次性后台任务里，
 * 之后的每次生成都命中索引（实测 0.1-0.3s）。
 * P0.2：只重建"无索引 / 源文件已变化"的会话 —— 已按指纹验证未变的直接跳过。
 */
export declare function warmIndex(svc: ReportServices): Promise<void>;
/** 一次完整生成：统计 + 费用 + 基线对比 + 洞察。工具与 API 共用同一管线。 */
/** 生成本报告消耗：mode=local 表示纯本地确定性生成（0 token）；未来若接入模型渲染再扩展。 */
export interface ReportGenerationMeta {
    mode: "local" | "model";
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    totalTokens: number;
    estimatedCostCny: number;
    model?: string;
}
export interface ReportGeneration {
    stats: ReturnType<typeof collectEvents> extends Promise<infer S> ? S : never;
    cost: CostBreakdown;
    key: string;
    prev: PeriodStatsRecord | null;
    insights: Insight[];
    /** Improve 建议（v0.5；确定性规则，旧报告可缺省）。 */
    improvements: ImprovementItem[];
    reportGeneration: ReportGenerationMeta;
}
export declare function generateReportData(svc: ReportServices, preset: string, range: {
    from: number;
    to: number;
}, perf?: GenerationPerf): Promise<ReportGeneration>;
/**
 * v0.5.x repair：由「已索引查询出的 stats」构建完整报告（无任何 session IO）。
 * summary/overview 的 query 路径与工具路径共用这一段，保证口径单一。
 */
export declare function buildReportFromStats(svc: ReportServices, preset: string, from: number, to: number, stats: ReportStats, perf?: GenerationPerf): Promise<ReportGeneration>;
export declare function toPeriodRecord(key: string, preset: string, range: {
    from: number;
    to: number;
}, gen: ReportGeneration): PeriodStatsRecord;
export declare function registerReportTools(ctx: ToolsHost, svc: ReportServices): void;
export declare function whaleReportTool(svc: ReportServices): ToolDefinition;
//# sourceMappingURL=tools.d.ts.map