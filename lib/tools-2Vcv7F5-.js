import { defineTool } from "@deepseek-ai/dsh-tools";

//#region src/stats.ts
const HOUR_MS = 60 * 60 * 1e3;
const DAY_MS$1 = 24 * HOUR_MS;
/** 危险命令特征（正则，匹配 bash 命令字符串）。 */
const DANGEROUS_PATTERNS = [
	{
		pattern: /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/,
		label: "rm -rf 删除"
	},
	{
		pattern: /git\s+push\b[^\n]*--force/,
		label: "force push"
	},
	{
		pattern: /git\s+reset\s+--hard/,
		label: "硬重置 git"
	},
	{
		pattern: /DROP\s+(TABLE|DATABASE)/i,
		label: "删库"
	},
	{
		pattern: /shutdown|reboot|halt\b/,
		label: "关机/重启"
	},
	{
		pattern: /mkfs\./,
		label: "格式化磁盘"
	},
	{
		pattern: /dd\s+if=.*of=\/dev\//,
		label: "dd 写设备"
	},
	{
		pattern: /chmod\s+(-R\s+)?777/,
		label: "777 全开放"
	},
	{
		pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\};?\s*:/,
		label: "fork 炸弹"
	},
	{
		pattern: /curl\s+\S+\s*\|\s*(ba)?sh/,
		label: "curl|sh 远程执行"
	}
];
function emptyStats(period) {
	return {
		period,
		sessions: 0,
		subagentSessions: 0,
		turns: 0,
		steps: 0,
		userMessages: 0,
		assistantMessages: 0,
		tokens: {
			input: 0,
			output: 0,
			cacheRead: 0,
			reasoning: 0
		},
		toolCalls: {},
		toolCallsTotal: 0,
		toolErrors: 0,
		commands: 0,
		dangerousCommands: [],
		hourHistogram: new Array(24).fill(0),
		activeDays: 0,
		busiestDay: null,
		titles: [],
		totalEvents: 0
	};
}
function usageOf(data) {
	if (typeof data !== "object" || data === null) return null;
	const usage = data.usage;
	if (typeof usage !== "object" || usage === null) return null;
	const u = usage;
	const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
	return {
		input: num(u.inputTokens),
		output: num(u.outputTokens),
		cacheRead: num(u.cacheReadTokens),
		reasoning: num(u.reasoningTokens)
	};
}
/** 从 tool/call 的 arguments（JSON 字符串）里抽出 bash 命令本体。 */
function commandOf(data) {
	if (typeof data !== "object" || data === null) return null;
	const d = data;
	if (d.name !== "bash") return null;
	const args = typeof d.arguments === "string" ? d.arguments : null;
	if (!args) return null;
	try {
		const parsed = JSON.parse(args);
		return typeof parsed.command === "string" ? parsed.command : null;
	} catch {
		return null;
	}
}
/** tool/result 是否失败（兼容多种形态，宽容解析）。 */
function resultIsError(data) {
	if (typeof data !== "object" || data === null) return false;
	const d = data;
	if (d.error !== void 0 && d.error !== null) return true;
	const message = d.message;
	if (typeof message === "object" && message !== null) {
		const m = message;
		if (m.isError === true) return true;
		const content = m.content;
		if (Array.isArray(content)) return content.some((block) => typeof block === "object" && block !== null && block.type === "error");
		if (typeof content === "string") return /error|failed|EACCES|ENOENT|command not found/i.test(content);
	}
	return false;
}
/**
* 聚合一个时间区间内的事件。
* @param events - 任意顺序的原始事件（可以是多个 session 拼起来的）。
* @param period - 时间区间（半开区间 [from, to)）。
* @param headers - 可选：session 头部（按 id 匹配，用于统计子代理会话）。
*/
function aggregate(events, period, headers = []) {
	const stats = emptyStats(period);
	const seenSessions = new Set();
	const sessionIdsByEvent = [];
	const days = new Map();
	const headerById = new Map(headers.map((h) => [h.id, h]));
	const headerByCwd = new Map(headers.map((h) => [h.cwd ?? "", h]));
	let lastHeader = headers[0] ?? null;
	for (const event of events) {
		if (event.time < period.from || event.time >= period.to) continue;
		stats.totalEvents += 1;
		const hour = new Date(event.time).getHours();
		stats.hourHistogram[hour] = (stats.hourHistogram[hour] ?? 0) + 1;
		const day = new Date(event.time).toISOString().slice(0, 10);
		days.set(day, (days.get(day) ?? 0) + 1);
		const data = event.data;
		const sessionId = data?.sessionId ?? lastHeader?.id ?? "unknown";
		seenSessions.add(sessionId);
		switch (event.type) {
			case "turn/start":
				stats.turns += 1;
				break;
			case "step/start":
				stats.steps += 1;
				break;
			case "user/message":
				stats.userMessages += 1;
				break;
			case "assistant/message": {
				stats.assistantMessages += 1;
				const usage = usageOf(data);
				if (usage) {
					stats.tokens.input += usage.input ?? 0;
					stats.tokens.output += usage.output ?? 0;
					stats.tokens.cacheRead += usage.cacheRead ?? 0;
					stats.tokens.reasoning += usage.reasoning ?? 0;
				}
				break;
			}
			case "tool/call": {
				stats.toolCallsTotal += 1;
				const name = typeof data?.name === "string" ? data.name : "(unknown)";
				stats.toolCalls[name] = (stats.toolCalls[name] ?? 0) + 1;
				const command = commandOf(data);
				if (command) {
					stats.commands += 1;
					for (const { pattern, label } of DANGEROUS_PATTERNS) if (pattern.test(command)) {
						stats.dangerousCommands.push({
							command,
							time: event.time,
							sessionId
						});
						break;
					}
				}
				break;
			}
			case "tool/result":
				if (resultIsError(data)) stats.toolErrors += 1;
				break;
			case "session/title": {
				const title = typeof data?.title === "string" ? data.title : null;
				if (title && !stats.titles.includes(title)) stats.titles.push(title);
				break;
			}
			default: break;
		}
	}
	for (const header of headers) if (header.createdAt >= period.from && header.createdAt < period.to) {
		seenSessions.add(header.id);
		if ((header.delegationDepth ?? 0) >= 1) stats.subagentSessions += 1;
	}
	stats.sessions = seenSessions.size;
	stats.activeDays = days.size;
	let busiest = null;
	for (const [date, count] of days) if (busiest === null || count > busiest.events) busiest = {
		date,
		events: count
	};
	stats.busiestDay = busiest;
	return stats;
}
/** 凌晨（0-6 点）事件占比 —— "熬夜指数"。 */
function nightOwlIndex(stats) {
	const night = stats.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0);
	if (stats.totalEvents === 0) return 0;
	return Math.round(night / stats.totalEvents * 100);
}
/** 把 token 数转成人类可读文本。 */
function formatTokens(n) {
	if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
	return String(n);
}
/** 人类可读的时间跨度。 */
function formatSpan(from, to) {
	const days = Math.max(1, Math.round((to - from) / DAY_MS$1));
	if (days === 1) return "1 天";
	if (days < 30) return `${days} 天`;
	if (days < 365) return `${(days / 30).toFixed(1)} 个月`;
	return `${(days / 365).toFixed(1)} 年`;
}

//#endregion
//#region src/report.ts
const PRESET_LABELS = {
	daily: "日报",
	weekly: "周报",
	monthly: "月报",
	yearly: "年报",
	custom: "自定义报告"
};
/** 预设区间 → [from, to) 毫秒。 */
function presetRange(preset, now) {
	const DAY = 24 * 60 * 60 * 1e3;
	switch (preset) {
		case "daily": return {
			from: now - 1 * DAY,
			to: now
		};
		case "weekly": return {
			from: now - 7 * DAY,
			to: now
		};
		case "monthly": return {
			from: now - 30 * DAY,
			to: now
		};
		case "yearly": return {
			from: now - 365 * DAY,
			to: now
		};
		case "custom": throw new Error("custom 需要显式 from/to");
	}
}
function hourLabel(hour) {
	return `${String(hour).padStart(2, "0")}:00`;
}
/** 24 小时直方图 → 一行 ASCII 热度条。 */
function hourBar(stats) {
	const max = Math.max(1, ...stats.hourHistogram);
	const bars = stats.hourHistogram.map((count, hour) => {
		const level = Math.round(count / max * 8);
		return level === 0 ? "·" : "▁▂▃▄▅▆▇█"[level];
	}).join("");
	return `\`${bars}\`\n> ${hourLabel(0)} ───────────────────────────── ${hourLabel(23)}`;
}
function topTools(stats) {
	const entries = Object.entries(stats.toolCalls).sort((a, b) => b[1] - a[1]).slice(0, 5);
	if (entries.length === 0) return "（这段时间没有调用任何工具）";
	return entries.map(([name, count]) => `- \`${name}\` × ${count}`).join("\n");
}
/** 熬夜指数 → 人设评语。 */
function nightOwlVerdict(index) {
	if (index >= 30) return "守夜鲸 🌙 —— 你和它都是夜行动物";
	if (index >= 15) return "偶尔熬夜的鲸";
	if (index >= 5) return "作息健康的鲸";
	return "早睡早起的模范鲸 🌅";
}
function renderReport(stats, preset) {
	const label = PRESET_LABELS[preset];
	const { from, to } = stats.period;
	const dateStr = (ms) => new Date(ms).toISOString().slice(0, 10);
	const night = nightOwlIndex(stats);
	const lines = [];
	lines.push(`# 🐋 鲸鱼${label}`);
	lines.push("");
	lines.push(`> ${dateStr(from)} ~ ${dateStr(to)} · 共 ${formatSpan(from, to)}`);
	lines.push("");
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
	const t = stats.tokens;
	lines.push("## 🔥 烧了多少 token");
	lines.push("");
	lines.push(`- 输入 ${formatTokens(t.input)} · 输出 ${formatTokens(t.output)} · 缓存命中 ${formatTokens(t.cacheRead)} · 思考 ${formatTokens(t.reasoning)}`);
	lines.push(`- 合计约 **${formatTokens(t.input + t.output + t.cacheRead + t.reasoning)}** token`);
	lines.push("");
	lines.push("## 🌙 作息画像");
	lines.push("");
	lines.push(hourBar(stats));
	lines.push("");
	lines.push(`- 活跃天数 **${stats.activeDays}**，凌晨活跃度 **${night}%**`);
	if (stats.busiestDay) lines.push(`- 最忙的一天：**${stats.busiestDay.date}**（${stats.busiestDay.events} 条事件）`);
	lines.push(`- 人设：**${nightOwlVerdict(night)}**`);
	lines.push("");
	lines.push("## ⚠️ 惊魂时刻");
	lines.push("");
	if (stats.dangerousCommands.length === 0) lines.push("这段时间很平静，没有危险操作。🎉");
	else {
		lines.push(`一共 **${stats.dangerousCommands.length}** 次危险操作，需要你亲自过目：`);
		lines.push("");
		for (const d of stats.dangerousCommands.slice(0, 10)) {
			const short = d.command.replace(/\s+/g, " ").slice(0, 90);
			const when = new Date(d.time).toISOString().slice(0, 16).replace("T", " ");
			lines.push(`- \`${short}\` —— ${when}`);
		}
		if (stats.dangerousCommands.length > 10) lines.push(`- ……还有 ${stats.dangerousCommands.length - 10} 条，见完整数据`);
	}
	lines.push("");
	if (stats.titles.length > 0) {
		lines.push("## 🧵 这段日子的会话标题");
		lines.push("");
		for (const title of stats.titles.slice(0, 8)) lines.push(`- ${title}`);
		lines.push("");
	}
	lines.push("---");
	lines.push(`*数据来自 ${stats.totalEvents} 条会话事件。鲸鱼记事本 · 只读，不改写任何历史。*`);
	return lines.join("\n");
}

//#endregion
//#region src/tools.ts
const DAY_MS = 24 * 60 * 60 * 1e3;
function parseTime(value, fallback) {
	if (value === void 0 || value === "") return fallback;
	const ms = Date.parse(value);
	if (Number.isNaN(ms)) throw new Error(`无法解析时间：${value}（请用 ISO 格式，如 2026-08-14）`);
	return ms;
}
/** 从会话查询服务收集区间内的所有事件（宽容模式：单会话失败不阻塞整体）。 */
async function collectEvents(svc, period) {
	const sessions = await svc.sessionQuery.listSessions();
	const headers = sessions.map((record) => ({
		id: record.header.id,
		createdAt: record.header.createdAt,
		cwd: record.header.cwd,
		delegationDepth: record.header.delegationDepth
	}));
	const events = [];
	let failed = 0;
	for (const record of sessions) try {
		const snapshot = await svc.sessionQuery.readSession(record.header.id);
		for (const event of snapshot.events) {
			if (event.time < period.from || event.time >= period.to) continue;
			events.push({
				type: event.type,
				time: event.time,
				data: {
					...event.data,
					sessionId: snapshot.session.id
				}
			});
		}
	} catch {
		failed += 1;
	}
	return {
		events,
		headers
	};
}
function registerReportTools(ctx, svc) {
	ctx.tools.register(whaleReportTool(svc));
}
function whaleReportTool(svc) {
	return defineTool({
		name: "whale_report",
		description: "Generate a whale report (鲸鱼日报/周报/月报/年报) from the user's session event history over any time range. Presets: daily (last 1 day), weekly (7 days), monthly (30 days), yearly (365 days), or custom with explicit from/to dates. The report is read-only and covers: activity volume, token burn, work-hours profile, dangerous commands, and session titles. Call this when the user asks for a report of their agent usage ('给我一份周报', '这个月我干了啥', '年报'). After receiving the result, present the markdown report to the user with light commentary — do not fabricate numbers.",
		parameters: {
			preset: {
				type: "string",
				required: true,
				enum: [
					"daily",
					"weekly",
					"monthly",
					"yearly",
					"custom"
				],
				description: "Report period preset. Use custom for arbitrary ranges."
			},
			from: {
				type: "string",
				description: "Start time in ISO format (e.g. 2026-08-01). Required when preset is custom."
			},
			to: {
				type: "string",
				description: "End time in ISO format (e.g. 2026-08-14). Required when preset is custom. Defaults to now."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					preset: {
						type: "string",
						required: true
					},
					label: {
						type: "string",
						required: true
					},
					from: {
						type: "string",
						required: true
					},
					to: {
						type: "string",
						required: true
					},
					sessions: {
						type: "integer",
						required: true
					},
					turns: {
						type: "integer",
						required: true
					},
					totalEvents: {
						type: "integer",
						required: true
					},
					report: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.report
			}]
		},
		execute: async (args, exec) => {
			const { preset, from, to } = args;
			const now = Date.now();
			const range = preset === "custom" ? {
				from: parseTime(from, now - 7 * DAY_MS),
				to: parseTime(to, now)
			} : presetRange(preset, now);
			if (range.to <= range.from) throw new Error("时间区间无效：to 必须晚于 from");
			const { events, headers } = await collectEvents(svc, range);
			const stats = aggregate(events, range, headers);
			const report = renderReport(stats, preset);
			if (exec.agent) exec.agent.session.append("whale/report", {
				preset,
				from: range.from,
				to: range.to,
				sessions: stats.sessions,
				turns: stats.turns,
				totalEvents: stats.totalEvents
			});
			return {
				preset,
				label: PRESET_LABELS[preset],
				from: new Date(range.from).toISOString(),
				to: new Date(range.to).toISOString(),
				sessions: stats.sessions,
				turns: stats.turns,
				totalEvents: stats.totalEvents,
				report
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: `生成鲸鱼${PRESET_LABELS[args.preset] ?? "报告"}`,
			kind: "other",
			rawInput: args
		})
	});
}

//#endregion
export { aggregate, collectEvents, presetRange, registerReportTools, renderReport };