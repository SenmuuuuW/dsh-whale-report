/** 缓存命中率：缓存命中占输入+命中的比例。 */
export function cacheHitRate(stats) {
    const input = stats.tokens.input;
    const cache = stats.tokens.cacheRead;
    if (input + cache === 0)
        return 0;
    return Math.round((cache / (input + cache)) * 1000) / 10;
}
/** 凌晨（0-6 点）事件占比。 */
export function nightRatio(stats) {
    if (stats.totalEvents === 0)
        return 0;
    const night = stats.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0);
    return Math.round((night / stats.totalEvents) * 1000) / 10;
}
/** 费用涨跌（相对上一周期），百分比。prev 缺失时返回 null。 */
export function costDeltaPct(input) {
    if (input.prev === undefined || input.cost === undefined || input.prev.cost <= 0)
        return null;
    return Math.round(((input.cost.total - input.prev.cost) / input.prev.cost) * 100);
}
const RED_LABELS = ["删除根目录/家目录", "删库", "关机/重启", "格式化磁盘", "dd 写设备", "fork 炸弹"];
export function computeInsights(input) {
    const { stats, prev, cost, budgetWeeklyCny } = input;
    const insights = [];
    const totalCost = cost?.total ?? 0;
    const night = nightRatio(stats);
    const hitRate = cacheHitRate(stats);
    const redDanger = stats.dangerousCommands.filter((d) => d.sev === "red").length;
    const amberDanger = stats.dangerousCommands.filter((d) => d.sev === "amber").length;
    // ── 1. 深夜消耗 ──
    if (night >= 15 && totalCost >= 3) {
        const nightCost = totalCost * (night / 100);
        insights.push({
            id: "night-cost",
            level: night >= 30 ? "warning" : "tip",
            title: `深夜时段消耗 ¥${nightCost.toFixed(1)}（占 ${night}%）`,
            detail: `凌晨 0-6 点的活跃占全部 ${night}%。深夜通常意味着无人值守的长任务，出错重试的成本更高。`,
            action: "给长任务加预算上限，或把重活安排在白天窗口执行。",
            estimate: `参考：若一半深夜任务挪到白天，可省约 ¥${(nightCost * 0.5).toFixed(1)}/周期（估算）。`,
        });
    }
    // ── 2. 重试风暴 ──
    if (stats.retryBursts >= 3) {
        const repeatedShare = Math.min(100, Math.round(((stats.retryBursts * 3) / Math.max(1, stats.commands)) * 100));
        insights.push({
            id: "retry-storm",
            level: stats.retryBursts >= 10 ? "warning" : "tip",
            title: `检测到 ${stats.retryBursts} 次重试风暴`,
            detail: `同一命令连续重复执行 ≥3 次（共 ${stats.retryBursts} 次），占总命令约 ${repeatedShare}%。通常是前置条件没满足就盲目重跑。`,
            action: "检查这些命令失败的前置条件（路径、依赖、权限），一次修对而不是反复重试。",
            estimate: `参考：重复执行约占总命令 ${repeatedShare}%，对应估算 ¥${(totalCost * (repeatedShare / 100)).toFixed(1)}/周期（估算）。`,
        });
    }
    // ── 3. 缓存命中率 ──
    if (prev !== undefined && hitRate < 75 && prev.cacheHitRate - hitRate >= 5) {
        insights.push({
            id: "cache-drop",
            level: "warning",
            title: `缓存命中率下降 ${(prev.cacheHitRate - hitRate).toFixed(1)}pt`,
            detail: `本周命中率 ${hitRate}%，上一周期 ${prev.cacheHitRate}%。缓存清零通常来自：改了系统提示词/AGENTS.md、频繁重启会话、换模型。`,
            action: "减少会话重启，保持系统提示词稳定，长会话优先续聊而不是新开。",
            estimate: `参考：命中率每提升 10pt，约省 ¥${(totalCost * 0.1).toFixed(1)}/周期（估算）。`,
        });
    }
    else if (hitRate >= 85 && totalCost > 0) {
        insights.push({
            id: "cache-good",
            level: "info",
            title: `缓存命中率 ${hitRate}%，很健康`,
            detail: "输入主要由缓存命中承担，这是省钱的关键习惯。",
            action: "继续保持长会话与稳定的提示词基线。",
        });
    }
    // ── 4. 危险操作红色警报 ──
    if (redDanger > 0) {
        insights.push({
            id: "danger-red",
            level: "critical",
            title: `${redDanger} 条致命级操作`,
            detail: `包括：${RED_LABELS.filter((l) => stats.dangerousCommands.some((d) => d.label === l)).join("、")}。这类命令可能造成不可逆破坏。`,
            action: "在审批设置里对这些模式加二次确认；重要目录提前做备份。",
        });
    }
    else if (amberDanger > 0) {
        insights.push({
            id: "danger-amber",
            level: "tip",
            title: `${amberDanger} 条需留意操作`,
            detail: "均为常规开发清理（如 rm -rf 临时目录、force push），无致命级风险。",
            action: "无需处理；若想减少噪音，可在审批中给这类模式加白名单。",
        });
    }
    // ── 5. 预算护栏 ──
    if (budgetWeeklyCny !== undefined && budgetWeeklyCny > 0 && totalCost > 0) {
        const ratio = totalCost / budgetWeeklyCny;
        if (ratio >= 1) {
            insights.push({
                id: "budget-over",
                level: "critical",
                title: `预算已超支 ¥${(totalCost - budgetWeeklyCny).toFixed(2)}`,
                detail: `本周期费用 ¥${totalCost.toFixed(2)}，已超过周预算 ¥${budgetWeeklyCny.toFixed(2)}。`,
                action: "检查重试风暴与缓存命中率洞察，先处理最大的两个成本来源。",
            });
        }
        else if (ratio >= 0.8) {
            insights.push({
                id: "budget-near",
                level: "warning",
                title: `预算已用 ${(ratio * 100).toFixed(0)}%`,
                detail: `本周期费用 ¥${totalCost.toFixed(2)}，距周预算 ¥${budgetWeeklyCny.toFixed(2)} 还剩 ${(budgetWeeklyCny - totalCost).toFixed(2)}。`,
                action: "剩余几天给长任务设置单次上限，避免尾段超支。",
            });
        }
    }
    // ── 6. 会话碎片化 ──
    const avgTurns = stats.sessions > 0 ? stats.turns / stats.sessions : 0;
    if (stats.sessions >= 5 && avgTurns < 2) {
        insights.push({
            id: "session-fragmentation",
            level: "tip",
            title: `会话碎片化：平均每会话仅 ${avgTurns.toFixed(1)} 回合`,
            detail: `新开会话会清空上下文缓存，碎片化直接压低缓存命中率（当前 ${hitRate}%）。`,
            action: "同一主题尽量续聊；批量任务合并到一个会话里跑。",
        });
    }
    // ── 7. 费用趋势 ──
    const delta = costDeltaPct(input);
    if (delta !== null && Math.abs(delta) >= 20) {
        insights.push({
            id: "cost-trend",
            level: delta > 0 ? "warning" : "tip",
            title: `费用较上一周期${delta > 0 ? "上涨" : "下降"} ${Math.abs(delta)}%`,
            detail: `¥${prev.cost.toFixed(2)} → ¥${totalCost.toFixed(2)}。${delta > 0 ? "建议对照缓存命中率与重试洞察定位增量。" : "保持当前使用习惯。"}`,
            action: delta > 0 ? "先看本报告最上方的关键洞察，优先处理提醒项。" : "无需行动。",
        });
    }
    return insights;
}
// ─────────────────────────── 周期基线工具 ───────────────────────────
/** 周期 key：dy-YYYY-MM-DD / wk-YYYY-Www / mo-YYYY-MM / yr-YYYY（按"结束时刻"归属）。 */
export function periodKey(preset, toMs) {
    const d = new Date(toMs);
    const iso = d.toISOString();
    if (preset === "daily")
        return `dy-${iso.slice(0, 10)}`;
    if (preset === "monthly")
        return `mo-${iso.slice(0, 7)}`;
    if (preset === "yearly")
        return `yr-${iso.slice(0, 4)}`;
    // weekly：ISO 周（周一为一周起点）
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    day.setUTCDate(day.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `wk-${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
/** 上一周期 key（按 preset 回退一档）。 */
export function previousPeriodKey(preset, toMs) {
    const d = new Date(toMs);
    if (preset === "daily")
        return periodKey("daily", d.getTime() - 86400000);
    if (preset === "monthly") {
        const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
        return periodKey("monthly", p.getTime());
    }
    if (preset === "yearly") {
        const p = new Date(Date.UTC(d.getUTCFullYear() - 1, 0, 1));
        return periodKey("yearly", p.getTime());
    }
    return periodKey("weekly", d.getTime() - 7 * 86400000);
}
//# sourceMappingURL=insights.js.map