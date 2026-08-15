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
/** 长周期才展示：周报/月报/年报/custom。日报/24h 样本太少时规则门槛自然不触发。 */
export const COLLAB_MIN_SESSIONS = 5;
export const COLLAB_MIN_USER_MESSAGES = 30;
export const COLLAB_MAX_INSIGHTS = 3;
export function computeCollaborationInsights(input) {
    if (input.sessions < COLLAB_MIN_SESSIONS || input.userMessages < COLLAB_MIN_USER_MESSAGES)
        return [];
    const insights = [];
    // 1. 需求漂移：多次方向修正 / 推翻先前要求。
    if (input.revisions >= 5 && input.sessionsWithRevision >= 3) {
        insights.push({
            code: "REQUIREMENT-DRIFT",
            title: `${input.sessionsWithRevision} 个会话在执行后出现方向修正（共 ${input.revisions} 次）`,
            observation: "多个任务在开始实现后才调整目标或推翻先前要求，容易产生返工。",
            suggestion: "复杂任务开工前先明确「目标 / 不要做什么 / 验收标准」，再让 Agent 动手。",
        });
    }
    // 2. 迟到约束：关键约束在任务开始后才补充。
    if (input.lateConstraints >= 3) {
        insights.push({
            code: "LATE-CONSTRAINT",
            title: `${input.lateConstraints} 条关键约束在任务开始后才补充`,
            observation: "重要限制（不要做什么、必须注意什么）出现在执行中途。",
            suggestion: "约束性要求尽量在第一次派发任务时一次给出，减少执行中反复。",
        });
    }
    // 3. 上下文碎片化：短会话占比过高（≤2 轮）。
    if (input.sessions > 0 && input.shortSessions >= 5 && input.shortSessions / input.sessions >= 0.4) {
        insights.push({
            code: "CONTEXT-FRAGMENTATION",
            title: `${input.shortSessions} 个短会话只持续 1–2 轮（占 ${Math.round((input.shortSessions / input.sessions) * 100)}%）`,
            observation: "部分任务可能在上下文建立前就重新开会话，缓存与上下文被浪费。",
            suggestion: "同一目标尽量继续原 session；只有任务真正分叉时才新开。",
        });
    }
    return insights.slice(0, COLLAB_MAX_INSIGHTS);
}
//# sourceMappingURL=collaboration.js.map