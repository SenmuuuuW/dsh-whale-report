/**
 * 报告文案层：把统计数字变成干净、写实的 markdown 报告。
 *
 * 文案规则：数字先说、事实直陈、不加装饰。
 */
import { formatSpan, formatTokens, nightOwlIndex, } from "./stats.js";
export const PRESET_LABELS = {
    daily: "日报",
    weekly: "周报",
    monthly: "月报",
    yearly: "年报",
    custom: "自定义报告",
};
/** 预设区间 → [from, to) 毫秒。 */
export function presetRange(preset, now) {
    const DAY = 24 * 60 * 60 * 1000;
    switch (preset) {
        case "daily":
            return { from: now - 1 * DAY, to: now };
        case "weekly":
            return { from: now - 7 * DAY, to: now };
        case "monthly":
            return { from: now - 30 * DAY, to: now };
        case "yearly":
            return { from: now - 365 * DAY, to: now };
        case "custom":
            throw new Error("custom 需要显式 from/to");
    }
}
function hourLabel(hour) {
    return `${String(hour).padStart(2, "0")}:00`;
}
/** 24 小时直方图 → 一行 ASCII 热度条。 */
function hourBar(stats) {
    const max = Math.max(1, ...stats.hourHistogram);
    const bars = stats.hourHistogram
        .map((count, hour) => {
        const level = Math.round((count / max) * 8);
        return level === 0 ? "·" : "▁▂▃▄▅▆▇█"[level];
    })
        .join("");
    return `\`${bars}\`\n> ${hourLabel(0)} ───────────────────────────── ${hourLabel(23)}`;
}
function topTools(stats) {
    const entries = Object.entries(stats.toolCalls).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (entries.length === 0)
        return "（没有调用任何工具）";
    return entries.map(([name, count]) => `- \`${name}\` × ${count}`).join("\n");
}
/** 熬夜指数 → 写实分级标签。 */
function nightLabel(index) {
    if (index >= 30)
        return "高";
    if (index >= 15)
        return "中";
    if (index >= 5)
        return "低";
    return "极低";
}
export function renderReport(stats, preset) {
    const label = PRESET_LABELS[preset];
    const { from, to } = stats.period;
    const dateStr = (ms) => new Date(ms).toISOString().slice(0, 10);
    const night = nightOwlIndex(stats);
    const t = stats.tokens;
    const totalTokens = t.input + t.output + t.cacheRead + t.reasoning;
    const lines = [];
    lines.push(`# 深迹 ${label}`);
    lines.push("");
    lines.push(`> ${dateStr(from)} ~ ${dateStr(to)} · 共 ${formatSpan(from, to)}`);
    lines.push("");
    lines.push(`> 总计：会话 ${stats.sessions} · 回合 ${stats.turns} · 工具调用 ${stats.toolCallsTotal} · 命令 ${stats.commands} · Token ${formatTokens(totalTokens)}`);
    lines.push("");
    // —— 工作量
    lines.push("## 工作量");
    lines.push("");
    lines.push(`- 会话 **${stats.sessions}** 次（子代理 ${stats.subagentSessions} 次）、回合 **${stats.turns}**、步骤 **${stats.steps}**`);
    lines.push(`- 用户消息 **${stats.userMessages}** 条，助手消息 **${stats.assistantMessages}** 条`);
    lines.push(`- 工具调用 **${stats.toolCallsTotal}** 次（失败 ${stats.toolErrors} 次）、bash 命令 **${stats.commands}** 条`);
    lines.push("");
    lines.push("**常用工具：**");
    lines.push(topTools(stats));
    lines.push("");
    // —— Token 消耗与模型用量
    lines.push("## Token 消耗");
    lines.push("");
    lines.push(`- 输入 ${formatTokens(t.input)} · 输出 ${formatTokens(t.output)} · 缓存命中 ${formatTokens(t.cacheRead)} · 思考 ${formatTokens(t.reasoning)}`);
    lines.push(`- 合计约 **${formatTokens(totalTokens)}** token`);
    lines.push("");
    const modelEntries = Object.entries(stats.models).sort((a, b) => b[1].input + b[1].output + b[1].cacheRead + b[1].reasoning -
        (a[1].input + a[1].output + a[1].cacheRead + a[1].reasoning));
    if (modelEntries.length > 0) {
        lines.push("## 模型用量");
        lines.push("");
        lines.push("| 模型 | 输入 | 输出 | 缓存命中 | 思考 |");
        lines.push("| --- | --- | --- | --- | --- |");
        for (const [model, usage] of modelEntries.slice(0, 8)) {
            lines.push(`| ${model} | ${formatTokens(usage.input)} | ${formatTokens(usage.output)} | ${formatTokens(usage.cacheRead)} | ${formatTokens(usage.reasoning)} |`);
        }
        lines.push("");
    }
    // —— 活跃时段
    lines.push("## 活跃时段");
    lines.push("");
    lines.push(hourBar(stats));
    lines.push("");
    lines.push(`- 活跃天数 **${stats.activeDays}**，凌晨活跃度 **${night}%**（${nightLabel(night)}）`);
    if (stats.busiestDay) {
        lines.push(`- 最忙的一天：**${stats.busiestDay.date}**（${stats.busiestDay.events} 条事件）`);
    }
    lines.push("");
    // —— 危险操作
    lines.push("## 危险操作");
    lines.push("");
    if (stats.dangerousCommands.length === 0) {
        lines.push("无危险操作。");
    }
    else {
        lines.push(`共 **${stats.dangerousCommands.length}** 条：`);
        lines.push("");
        for (const d of stats.dangerousCommands.slice(0, 5)) {
            const short = d.command.replace(/\s+/g, " ").slice(0, 64);
            const when = new Date(d.time).toISOString().slice(0, 16).replace("T", " ");
            lines.push(`- \`${short}\` —— ${when}`);
        }
        if (stats.dangerousCommands.length > 5) {
            lines.push(`- ……仅列前 5 条`);
        }
    }
    lines.push("");
    // —— 会话标题
    if (stats.titles.length > 0) {
        lines.push("## 会话标题");
        lines.push("");
        for (const title of stats.titles.slice(0, 8)) {
            lines.push(`- ${title}`);
        }
        lines.push("");
    }
    lines.push("---");
    lines.push(`*基于 ${stats.totalEvents} 条会话事件 · 只读 · 深迹 DeepTrace*`);
    return lines.join("\n");
}
//# sourceMappingURL=report.js.map