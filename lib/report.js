/**
 * 报告文案层：把统计数字变成干净、写实的 markdown 报告。
 *
 * 文案规则：数字先说、事实直陈、不加装饰。
 */
import { formatSpan, formatTokens, nightOwlIndex, } from "./stats.js";
import { toolFamilies } from "./insights.js";
export const PRESET_LABELS = {
    daily: "日报",
    "24h": "24小时",
    weekly: "周报",
    monthly: "月报",
    yearly: "年报",
    custom: "自定义报告",
};
/**
 * 预设区间。周/月/年 = 自然周期（与 period key 同语义，统计口径干净）：
 *   日报 = 今天 0:00 → 现在
 *   24h  = 滚动过去 24 小时
 *   周报 = 本自然周（周一 0:00）→ 现在
 *   月报 = 本自然月 1 日 0:00 → 现在
 *   年报 = 本自然年 1 月 1 日 0:00 → 现在
 */
export function presetRange(preset, now) {
    const DAY = 24 * 60 * 60 * 1000;
    const d = new Date(now);
    switch (preset) {
        case "daily": {
            d.setHours(0, 0, 0, 0);
            return { from: d.getTime(), to: now };
        }
        case "24h":
            return { from: now - 1 * DAY, to: now };
        case "weekly": {
            // 本自然周：周一 0:00 起（getDay() 0=周日 → 归到上周一）。
            const day = d.getDay() === 0 ? 7 : d.getDay();
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() - (day - 1));
            return { from: d.getTime(), to: now };
        }
        case "monthly": {
            d.setDate(1);
            d.setHours(0, 0, 0, 0);
            return { from: d.getTime(), to: now };
        }
        case "yearly": {
            d.setMonth(0, 1);
            d.setHours(0, 0, 0, 0);
            return { from: d.getTime(), to: now };
        }
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
function levelLabel(level) {
    return level === "critical" ? "严重" : level === "warning" ? "警告" : level === "tip" ? "提示" : "信息";
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
export function renderReport(stats, preset, cost, prev, insights) {
    const label = PRESET_LABELS[preset];
    const { from, to } = stats.period;
    const dateStr = (ms) => new Date(ms).toISOString().slice(0, 10);
    const night = nightOwlIndex(stats);
    const t = stats.tokens;
    const totalTokens = t.input + t.output + t.cacheRead + t.reasoning;
    const totalCost = cost?.total ?? 0;
    const deltaPct = prev !== undefined && prev !== null && prev.cost > 0
        ? Math.round(((totalCost - prev.cost) / prev.cost) * 100)
        : null;
    const lines = [];
    lines.push(`# 深迹 ${label}`);
    lines.push("");
    lines.push(`> ${dateStr(from)} ~ ${dateStr(to)} · 共 ${formatSpan(from, to)}`);
    lines.push("");
    lines.push(`> 总计：会话 ${stats.sessions} · 回合 ${stats.turns} · 工具调用 ${stats.toolCallsTotal} · 命令 ${stats.commands} · Token ${formatTokens(totalTokens)}`);
    if (prev !== undefined && prev !== null) {
        lines.push(`> 对比上一周期：费用 ${deltaPct === null ? "—" : `${deltaPct > 0 ? "▲" : "▼"} ${Math.abs(deltaPct)}%`} · 会话 ${prev.sessions === 0 ? "—" : `${stats.sessions - prev.sessions > 0 ? "+" : ""}${stats.sessions - prev.sessions}`} · 命中率 ${prev.cacheHitRate}% → ${Math.round((stats.tokens.cacheRead / Math.max(1, stats.tokens.input + stats.tokens.cacheRead)) * 1000) / 10}%`);
    }
    lines.push("");
    if (insights !== undefined && insights.length > 0) {
        lines.push("## 洞察");
        lines.push("");
        for (const insight of insights.slice(0, 6)) {
            lines.push(`- **[${levelLabel(insight.level)}] ${insight.title}**`);
            lines.push(`  ${insight.detail}`);
            lines.push(`  建议：${insight.action}`);
            if (insight.estimate !== undefined)
                lines.push(`  ${insight.estimate}`);
            lines.push("");
        }
    }
    // —— 工作量
    lines.push("## 工作量");
    lines.push("");
    lines.push(`- 会话 **${stats.sessions}** 次（子代理 ${stats.subagentSessions} 次）、回合 **${stats.turns}**、步骤 **${stats.steps}**`);
    lines.push(`- 用户消息 **${stats.userMessages}** 条，助手消息 **${stats.assistantMessages}** 条`);
    lines.push(`- 工具调用 **${stats.toolCallsTotal}** 次（失败 ${stats.toolErrors} 次）、bash 命令 **${stats.commands}** 条`);
    lines.push("");
    const families = toolFamilies(stats.toolCalls).slice(0, 5);
    if (families.length > 0) {
        lines.push("**工具使用（按族）：**");
        lines.push(families.map((f) => `- ${f.family} × ${f.count}`).join("\n"));
        lines.push("");
    }
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
        lines.push("| 来源 | 模型 | 输入 | 输出 | 缓存命中 | 思考 |");
        lines.push("| --- | --- | --- | --- | --- | --- |");
        for (const [key, usage] of modelEntries.slice(0, 8)) {
            const idx = key.indexOf("/");
            const provider = idx >= 0 ? key.slice(0, idx) : "deepseek";
            const model = idx >= 0 ? key.slice(idx + 1) : key;
            lines.push(`| ${provider} | ${model} | ${formatTokens(usage.input)} | ${formatTokens(usage.output)} | ${formatTokens(usage.cacheRead)} | ${formatTokens(usage.reasoning)} |`);
        }
        lines.push("");
    }
    // —— 活跃时段
    lines.push("## 活跃时段");
    lines.push("");
    lines.push(hourBar(stats));
    lines.push("");
    lines.push(`- 活跃天数 **${stats.activeDays}**，凌晨活跃度 **${night}%**（${nightLabel(night)}）`);
    if (cost !== undefined && cost.total > 0) {
        lines.push(`- 预估费用约 **¥${cost.total.toFixed(2)}**（${cost.source === "official-page" ? "官方定价页实时价" : "内置价"}）`);
        const byProvider = {};
        for (const [key, c] of Object.entries(cost.perModel ?? {})) {
            const idx = key.indexOf("/");
            const p = idx >= 0 ? key.slice(0, idx) : "deepseek";
            byProvider[p] = (byProvider[p] ?? 0) + c;
        }
        const providerEntries = Object.entries(byProvider).sort((a, b) => b[1] - a[1]);
        if (providerEntries.length > 0) {
            lines.push("");
            lines.push("**费用按来源：**");
            for (const [p, c] of providerEntries) {
                lines.push(`- ${p}：¥${c.toFixed(2)}`);
            }
        }
    }
    if (stats.busiestDay) {
        lines.push(`- 最忙的一天：**${stats.busiestDay.date}**（${stats.busiestDay.events} 条事件）`);
    }
    lines.push("");
    if (stats.secretHits.length > 0) {
        lines.push("## 敏感信息");
        lines.push("");
        const byLabel = new Map();
        for (const hit of stats.secretHits)
            byLabel.set(hit.label, (byLabel.get(hit.label) ?? 0) + 1);
        lines.push(`检测到 **${stats.secretHits.length}** 处疑似密钥/令牌（未展示原文）：`);
        lines.push("");
        for (const [label, count] of byLabel)
            lines.push(`- ${label} × ${count}`);
        lines.push("");
        lines.push("建议尽快轮换对应密钥。");
        lines.push("");
    }
    if (stats.burstSamples.length > 0) {
        lines.push("## 重试诊断");
        lines.push("");
        for (const sample of stats.burstSamples.slice(0, 5)) {
            const when = new Date(sample.time).toISOString().slice(0, 16).replace("T", " ");
            lines.push(`- \`${sample.cmd}\` 重复 ${sample.count} 次 · ${when}`);
            if (sample.error !== undefined)
                lines.push(`  ${sample.error.slice(0, 100)}`);
        }
        lines.push("");
    }
    // —— 危险操作：分类分析 + 少量样本
    lines.push("## 危险操作");
    lines.push("");
    if (stats.dangerousCommands.length === 0) {
        lines.push("无危险操作。");
    }
    else {
        const byLabel = new Map();
        for (const d of stats.dangerousCommands) {
            byLabel.set(d.label, (byLabel.get(d.label) ?? 0) + 1);
        }
        lines.push(`共 **${stats.dangerousCommands.length}** 条，分类如下：`);
        lines.push("");
        for (const [label, count] of [...byLabel.entries()].sort((a, b) => b[1] - a[1])) {
            lines.push(`- ${label} × ${count}`);
        }
        lines.push("");
        lines.push("最近样本：");
        for (const d of stats.dangerousCommands.slice(0, 3)) {
            const short = d.command.replace(/\s+/g, " ").slice(0, 64);
            const when = new Date(d.time).toISOString().slice(0, 16).replace("T", " ");
            lines.push(`- \`${short}\` —— ${when}`);
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