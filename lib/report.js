/**
 * 报告文案层：把统计数字变成"想发朋友圈"的中文报告。
 *
 * 文案是产品的一半。规则：
 * - 数字永远先说，金句永远在后；
 * - 危险命令原样列出（数据新闻官的可信度来自不美化）；
 * - 每个指标配一个"鲸鱼视角"的解读，而不是干巴巴的表格。
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
        return "（这段时间没有调用任何工具）";
    return entries.map(([name, count]) => `- \`${name}\` × ${count}`).join("\n");
}
/** 熬夜指数 → 人设评语。 */
function nightOwlVerdict(index) {
    if (index >= 30)
        return "守夜鲸 🌙 —— 你和它都是夜行动物";
    if (index >= 15)
        return "偶尔熬夜的鲸";
    if (index >= 5)
        return "作息健康的鲸";
    return "早睡早起的模范鲸 🌅";
}
export function renderReport(stats, preset) {
    const label = PRESET_LABELS[preset];
    const { from, to } = stats.period;
    const dateStr = (ms) => new Date(ms).toISOString().slice(0, 10);
    const night = nightOwlIndex(stats);
    const lines = [];
    lines.push(`# 深迹 ${label}`);
    lines.push("");
    lines.push(`> ${dateStr(from)} ~ ${dateStr(to)} · 共 ${formatSpan(from, to)}`);
    lines.push("");
    // —— 干了多少活
    lines.push("## ⚙️ 它干了多少活");
    lines.push("");
    lines.push(`- 会话 **${stats.sessions}** 次（其中子代理 ${stats.subagentSessions} 次）、回合 **${stats.turns}**、步骤 **${stats.steps}**`);
    lines.push(`- 收到你的消息 **${stats.userMessages}** 条，回你 **${stats.assistantMessages}** 条`);
    lines.push(`- 调用工具 **${stats.toolCallsTotal}** 次，失败 **${stats.toolErrors}** 次`);
    lines.push(`- 跑过 bash 命令 **${stats.commands}** 条`);
    lines.push("");
    lines.push("**最常用的工具：**");
    lines.push(topTools(stats));
    lines.push("");
    // —— 烧了多少 token
    const t = stats.tokens;
    lines.push("## 🔥 烧了多少 token");
    lines.push("");
    lines.push(`- 输入 ${formatTokens(t.input)} · 输出 ${formatTokens(t.output)} · 缓存命中 ${formatTokens(t.cacheRead)} · 思考 ${formatTokens(t.reasoning)}`);
    lines.push(`- 合计约 **${formatTokens(t.input + t.output + t.cacheRead + t.reasoning)}** token`);
    lines.push("");
    // —— 作息
    lines.push("## 🌙 作息画像");
    lines.push("");
    lines.push(hourBar(stats));
    lines.push("");
    lines.push(`- 活跃天数 **${stats.activeDays}**，凌晨活跃度 **${night}%**`);
    if (stats.busiestDay) {
        lines.push(`- 最忙的一天：**${stats.busiestDay.date}**（${stats.busiestDay.events} 条事件）`);
    }
    lines.push(`- 人设：**${nightOwlVerdict(night)}**`);
    lines.push("");
    // —— 惊魂时刻
    lines.push("## ⚠️ 惊魂时刻");
    lines.push("");
    if (stats.dangerousCommands.length === 0) {
        lines.push("这段时间很平静，没有危险操作。🎉");
    }
    else {
        lines.push(`一共 **${stats.dangerousCommands.length}** 次危险操作，需要你亲自过目：`);
        lines.push("");
        for (const d of stats.dangerousCommands.slice(0, 10)) {
            const short = d.command.replace(/\s+/g, " ").slice(0, 90);
            const when = new Date(d.time).toISOString().slice(0, 16).replace("T", " ");
            lines.push(`- \`${short}\` —— ${when}`);
        }
        if (stats.dangerousCommands.length > 10) {
            lines.push(`- ……还有 ${stats.dangerousCommands.length - 10} 条，见完整数据`);
        }
    }
    lines.push("");
    // —— 标题即记忆
    if (stats.titles.length > 0) {
        lines.push("## 🧵 这段日子的会话标题");
        lines.push("");
        for (const title of stats.titles.slice(0, 8)) {
            lines.push(`- ${title}`);
        }
        lines.push("");
    }
    lines.push("---");
    lines.push(`*数据来自 ${stats.totalEvents} 条会话事件。深迹 DeepTrace · 只读，不改写任何历史。*`);
    return lines.join("\n");
}
//# sourceMappingURL=report.js.map