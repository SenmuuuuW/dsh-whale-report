/**
 * 协作复盘（COLLABORATION REVIEW）：人机协作模式的确定性观察。
 *
 * 回答："我和 Harness 是怎么一起工作的？我的沟通方式有没有导致返工？"
 * 语气是"观察协作模式 → 找可能的摩擦 → 给可尝试的优化"，绝不评价人格，
 * 也绝不把技术性 retry 归因为用户沟通问题（信号词表已排除重试语境）。
 *
 * 无 LLM、无随机：同一份数据 → 同一份结论。
 * 样本不足（会话 <5 或用户消息 <30）时不展示 —— 日报/24h 天然多数不触发。
 */
export type CollaborationCode = "REQUIREMENT-DRIFT" | "LATE-CONSTRAINT" | "CONTEXT-FRAGMENTATION";
export interface CollaborationInsight {
    code: CollaborationCode;
    title: string;
    observation: string;
    suggestion: string;
}
/** 长周期才展示：周报/月报/年报/custom。日报/24h 样本太少时规则门槛自然不触发。 */
export declare const COLLAB_MIN_SESSIONS = 5;
export declare const COLLAB_MIN_USER_MESSAGES = 30;
export declare const COLLAB_MAX_INSIGHTS = 3;
interface CollabInput {
    sessions: number;
    userMessages: number;
    revisions: number;
    lateConstraints: number;
    sessionsWithRevision: number;
    shortSessions: number;
}
export declare function computeCollaborationInsights(input: CollabInput): CollaborationInsight[];
export {};
//# sourceMappingURL=collaboration.d.ts.map