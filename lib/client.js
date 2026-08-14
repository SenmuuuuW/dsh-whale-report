window.__ModuleLoader__.load({ id: 'dsh-whale-report', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
const react = __toESM(require("react"));
const react_dom_client = __toESM(require("react-dom/client"));
const react_jsx_runtime = __toESM(require("react/jsx-runtime"));

//#region src/client/index.tsx
const name = "whale-report-client";
const inject = [];
const CSS = `
[data-whale-report-panel] { font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif; }
[data-whale-report-fab] {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  width: 52px; height: 52px; border-radius: 50%;
  background: linear-gradient(135deg, #4d6bfe, #8b5cf6);
  color: #fff; font-size: 26px; line-height: 1;
  border: none; cursor: pointer; box-shadow: 0 6px 20px rgba(77,107,254,.45);
  transition: transform .15s ease;
  display: flex; align-items: center; justify-content: center;
}
[data-whale-report-fab]:hover { transform: scale(1.08); }
[data-whale-report-drawer] {
  position: fixed; top: 0; right: 0; height: 100vh; width: 480px; max-width: 92vw;
  z-index: 2147482999; background: #14161d; color: #e6e8f0;
  box-shadow: -12px 0 40px rgba(0,0,0,.5);
  display: flex; flex-direction: column;
  transform: translateX(0); transition: transform .22s ease;
  border-left: 1px solid rgba(255,255,255,.08);
}
[data-whale-report-drawer][hidden] { transform: translateX(100%); pointer-events: none; }
[data-whale-report-head] {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,.08);
}
[data-whale-report-title] { font-size: 15px; font-weight: 600; }
[data-whale-report-close] { background: none; border: none; color: #9aa0b5; font-size: 18px; cursor: pointer; }
[data-whale-report-tabs] { display: flex; gap: 4px; padding: 10px 16px 0; }
[data-whale-report-tab] {
  padding: 6px 12px; border-radius: 8px 8px 0 0; font-size: 12.5px; cursor: pointer;
  background: transparent; color: #9aa0b5; border: none;
}
[data-whale-report-tab][data-active="true"] { background: #232734; color: #fff; }
[data-whale-report-body] { flex: 1; overflow-y: auto; padding: 14px 16px 24px; }
[data-whale-report-chips] { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
[data-whale-report-chip] {
  padding: 6px 14px; border-radius: 999px; font-size: 12.5px; cursor: pointer;
  background: #232734; color: #c3c8db; border: 1px solid transparent;
}
[data-whale-report-chip][data-active="true"] { background: #4d6bfe22; border-color: #4d6bfe; color: #93a7ff; }
[data-whale-report-inputs] { display: flex; gap: 8px; margin-bottom: 12px; }
[data-whale-report-inputs] input {
  flex: 1; background: #1c1f2a; color: #e6e8f0; border: 1px solid rgba(255,255,255,.12);
  border-radius: 8px; padding: 8px 10px; font-size: 12.5px;
}
[data-whale-report-actions] { display: flex; gap: 8px; margin-bottom: 16px; }
[data-whale-report-btn] {
  padding: 9px 16px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer;
  border: none; background: linear-gradient(135deg, #4d6bfe, #8b5cf6); color: #fff;
}
[data-whale-report-btn][data-ghost="true"] { background: #232734; color: #c3c8db; }
[data-whale-report-h2] { font-size: 14px; font-weight: 700; margin: 18px 0 8px; }
[data-whale-report-cards] { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
[data-whale-report-card] {
  background: #1c1f2a; border: 1px solid rgba(255,255,255,.07); border-radius: 10px;
  padding: 10px 12px;
}
[data-whale-report-card] b { display: block; font-size: 20px; color: #fff; }
[data-whale-report-card] span { font-size: 11.5px; color: #9aa0b5; }
[data-whale-report-tokenline] { font-size: 12.5px; color: #c3c8db; line-height: 1.9; }
[data-whale-report-heat] { display: flex; gap: 2px; margin: 8px 0 4px; }
[data-whale-report-heat] i { flex: 1; height: 34px; border-radius: 3px; background: #232734; }
[data-whale-report-danger] {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px;
  background: #2a1b1e; border: 1px solid rgba(244,114,114,.25); border-radius: 8px;
  padding: 7px 9px; margin: 6px 0; color: #f4b8b8; word-break: break-all;
}
[data-whale-report-danger] em { display: block; font-style: normal; font-size: 10.5px; color: #c98f8f; margin-top: 3px; }
[data-whale-report-titles] li { font-size: 12.5px; color: #c3c8db; margin: 4px 0; }
[data-whale-report-empty] { color: #6b7186; font-size: 13px; text-align: center; padding: 40px 0; }
[data-whale-report-hitem] {
  background: #1c1f2a; border: 1px solid rgba(255,255,255,.07); border-radius: 10px;
  padding: 10px 12px; margin-bottom: 8px; cursor: pointer;
}
[data-whale-report-hitem]:hover { border-color: #4d6bfe88; }
[data-whale-report-hitem] b { font-size: 13.5px; color: #fff; }
[data-whale-report-hitem] span { display: block; font-size: 11.5px; color: #9aa0b5; margin-top: 4px; }
[data-whale-report-loading] { color: #9aa0b5; font-size: 13px; padding: 20px 0; text-align: center; }

@media print {
  body * { visibility: hidden; }
  [data-whale-report-drawer], [data-whale-report-drawer] * { visibility: visible; }
  [data-whale-report-drawer] {
    position: absolute; left: 0; top: 0; width: 100%; height: auto;
    box-shadow: none; border: none; background: #fff; color: #111;
  }
  [data-whale-report-fab], [data-whale-report-close], [data-whale-report-tabs],
  [data-whale-report-chips], [data-whale-report-inputs], [data-whale-report-actions] { display: none !important; }
  [data-whale-report-card] { background: #f4f5f9; border-color: #e2e4ee; }
  [data-whale-report-card] b { color: #111; }
  [data-whale-report-card] span { color: #555; }
  [data-whale-report-tokenline] { color: #333; }
  [data-whale-report-danger] { background: #fdf0f0; color: #7f1d1d; border-color: #f5c6c6; }
  [data-whale-report-h2], [data-whale-report-titles] li { color: #111; }
}
`;
let styleInjected = false;
function injectStyle() {
	if (styleInjected || typeof document === "undefined") return;
	styleInjected = true;
	const tag = document.createElement("style");
	tag.setAttribute("data-plugin", "dsh-whale-report");
	tag.textContent = CSS;
	document.head.appendChild(tag);
}
async function api(method, payload) {
	const response = await fetch(`/whale/api/${method}`, {
		method: payload === void 0 ? "GET" : "POST",
		headers: payload === void 0 ? void 0 : { "content-type": "application/json" },
		body: payload === void 0 ? void 0 : JSON.stringify(payload)
	});
	const body = await response.json();
	if (!response.ok || body.ok === false) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
	return body;
}
const PRESETS = [
	{
		key: "daily",
		label: "日报"
	},
	{
		key: "weekly",
		label: "周报"
	},
	{
		key: "monthly",
		label: "月报"
	},
	{
		key: "yearly",
		label: "年报"
	},
	{
		key: "custom",
		label: "自定义"
	}
];
function fmt(n) {
	if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
	return String(n);
}
function dateStr(ms) {
	return new Date(ms).toISOString().slice(0, 10);
}
function Heatmap({ histogram }) {
	const max = Math.max(1, ...histogram);
	const hue = (level) => {
		const a = .12 + level * .8;
		return `rgba(77,107,254,${a.toFixed(2)})`;
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		"data-whale-report-heat": true,
		children: histogram.map((count, hour) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
			title: `${String(hour).padStart(2, "0")}:00 · ${count}`,
			style: { background: hue(count / max) }
		}, hour))
	});
}
function ReportView({ report, onDelete }) {
	const s = report.stats;
	const night = s.totalEvents === 0 ? 0 : Math.round(s.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0) / s.totalEvents * 100);
	const topTools = Object.entries(s.toolCalls ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
	const totalTokens = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.reasoning;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-actions": true,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				"data-whale-report-btn": true,
				onClick: () => window.print(),
				children: "导出 PDF / 打印"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				"data-whale-report-btndata-ghost": "true",
				onClick: () => onDelete(report.id),
				children: "删除"
			})]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			"data-whale-report-h2": true,
			children: "⚙️ 干了多少活"
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-cards": true,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-card": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: s.sessions }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						"会话（子代理 ",
						s.subagentSessions,
						"）"
					] })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-card": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: s.turns }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "回合" })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-card": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: fmt(s.toolCallsTotal) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						"工具调用（失败 ",
						s.toolErrors,
						"）"
					] })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-card": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: fmt(s.commands) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "bash 命令" })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-card": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: s.userMessages }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "你的消息" })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-card": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: fmt(s.assistantMessages) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "它的回复" })]
				})
			]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			"data-whale-report-h2": true,
			children: "常用工具"
		}),
		topTools.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			"data-whale-report-tokenline": true,
			children: "（没有调用工具）"
		}) : topTools.map(([toolName, count]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-tokenline": true,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: toolName }),
				" × ",
				count
			]
		}, toolName)),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			"data-whale-report-h2": true,
			children: "🔥 烧了多少 token"
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-tokenline": true,
			children: [
				"输入 ",
				fmt(s.tokens.input),
				" · 输出 ",
				fmt(s.tokens.output),
				" · 缓存命中 ",
				fmt(s.tokens.cacheRead),
				" · 思考 ",
				fmt(s.tokens.reasoning),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
				"合计约 ",
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: fmt(totalTokens) }),
				" token"
			]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-h2": true,
			children: [
				"🌙 作息画像（凌晨活跃 ",
				night,
				"%）"
			]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heatmap, { histogram: s.hourHistogram ?? [] }),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-tokenline": true,
			children: [
				"活跃 ",
				s.activeDays,
				" 天",
				s.busiestDay ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					" · 最忙 ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: s.busiestDay.date }),
					"（",
					s.busiestDay.events,
					" 条事件）"
				] }) : null
			]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-h2": true,
			children: [
				"⚠️ 惊魂时刻（",
				s.dangerousCommands?.length ?? 0,
				"）"
			]
		}),
		(s.dangerousCommands ?? []).length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			"data-whale-report-tokenline": true,
			children: "这段时间很平静 🎉"
		}) : s.dangerousCommands.slice(0, 10).map((d, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-danger": true,
			children: [d.command.replace(/\s+/g, " "), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", { children: new Date(d.time).toISOString().slice(0, 16).replace("T", " ") })]
		}, i)),
		(s.titles ?? []).length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			"data-whale-report-h2": true,
			children: "🧵 会话标题"
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
			"data-whale-report-titles": true,
			children: s.titles.slice(0, 8).map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t }, t))
		})] }),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-tokenline": true,
			style: {
				marginTop: 16,
				fontSize: 11
			},
			children: [
				"数据来自 ",
				s.totalEvents,
				" 条会话事件 · 只读，不改写任何历史 · ",
				dateStr(report.createdAt),
				" 生成"
			]
		})
	] });
}
var App = class extends react.Component {
	state = {
		open: false,
		tab: "report",
		preset: "weekly",
		from: dateStr(Date.now() - 7 * 864e5),
		to: dateStr(Date.now()),
		loading: false,
		error: null,
		current: null,
		history: null
	};
	toggle = () => {
		this.setState((prev) => ({ open: !prev.open }));
		if (!this.state.open && this.state.tab === "history" && this.state.history === null) this.loadHistory();
	};
	async loadHistory() {
		try {
			const body = await api("list");
			this.setState({
				history: body.reports,
				error: null
			});
		} catch (error) {
			this.setState({ error: error instanceof Error ? error.message : String(error) });
		}
	}
	async generate() {
		this.setState({
			loading: true,
			error: null
		});
		try {
			const payload = this.state.preset === "custom" ? {
				preset: "custom",
				from: this.state.from,
				to: this.state.to
			} : { preset: this.state.preset };
			const body = await api("generate", payload);
			this.setState({
				current: body.report,
				loading: false,
				tab: "report"
			});
		} catch (error) {
			this.setState({
				loading: false,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}
	async openHistory(id) {
		this.setState({
			loading: true,
			error: null
		});
		try {
			const response = await fetch(`/whale/api/get?id=${encodeURIComponent(id)}`);
			const json = await response.json();
			if (!response.ok || json.ok === false) throw new Error("报告不存在");
			this.setState({
				current: json.report,
				loading: false,
				tab: "report"
			});
		} catch (error) {
			this.setState({
				loading: false,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}
	async deleteReport(id) {
		try {
			await api("delete", { id });
			this.setState({
				current: null,
				history: null
			});
			if (this.state.tab === "history") this.loadHistory();
		} catch (error) {
			this.setState({ error: error instanceof Error ? error.message : String(error) });
		}
	}
	render() {
		const { open, tab, preset, loading, error, current, history } = this.state;
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			"data-whale-report-fab": true,
			onClick: this.toggle,
			title: "鲸鱼记事本",
			"aria-label": "鲸鱼记事本",
			children: "🐋"
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-drawer": true,
			hidden: !open,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-head": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"data-whale-report-title": true,
						children: "🐋 鲸鱼记事本"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						"data-whale-report-close": true,
						onClick: this.toggle,
						"aria-label": "关闭",
						children: "✕"
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-tabs": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						"data-whale-report-tab": true,
						"data-active": tab === "report",
						onClick: () => this.setState({ tab: "report" }),
						children: "新报告"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						"data-whale-report-tab": true,
						"data-active": tab === "history",
						onClick: () => {
							this.setState({ tab: "history" });
							if (history === null) this.loadHistory();
						},
						children: "历史"
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-body": true,
					children: [
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							"data-whale-report-danger": true,
							children: ["出错了：", error]
						}),
						tab === "history" && history === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							"data-whale-report-loading": true,
							children: "加载中…"
						}),
						tab === "history" && history !== null && history.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							"data-whale-report-empty": true,
							children: "还没有报告。去「新报告」生成第一份吧 🐋"
						}),
						tab === "history" && history !== null && history.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: history.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							"data-whale-report-hitem": true,
							onClick: () => void this.openHistory(item.id),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("b", { children: [
								PRESETS.find((p) => p.key === item.preset)?.label ?? item.preset,
								" · ",
								dateStr(item.from),
								" ~ ",
								dateStr(item.to)
							] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								item.sessions,
								" 会话 · ",
								item.turns,
								" 回合 · ",
								fmt(item.totalEvents),
								" 事件 · ",
								dateStr(item.createdAt)
							] })]
						}, item.id)) }),
						tab === "report" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [current === null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								"data-whale-report-chips": true,
								children: PRESETS.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									"data-whale-report-chip": true,
									"data-active": preset === p.key,
									onClick: () => this.setState({ preset: p.key }),
									children: p.label
								}, p.key))
							}),
							preset === "custom" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								"data-whale-report-inputs": true,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "date",
									value: this.state.from,
									onChange: (e) => this.setState({ from: e.target.value })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "date",
									value: this.state.to,
									onChange: (e) => this.setState({ to: e.target.value })
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								"data-whale-report-actions": true,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									"data-whale-report-btn": true,
									onClick: () => void this.generate(),
									disabled: loading,
									children: loading ? "生成中…" : "生成报告"
								})
							}),
							loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								"data-whale-report-loading": true,
								children: "鲸鱼正在翻你的日志…"
							})
						] }), current !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReportView, {
							report: current,
							onDelete: (id) => void this.deleteReport(id)
						})] })
					]
				})
			]
		})] });
	}
};
function apply(ctx) {
	injectStyle();
	ctx.effect(() => {
		const host = document.createElement("div");
		host.setAttribute("data-whale-report", "");
		document.body.appendChild(host);
		const root = (0, react_dom_client.createRoot)(host);
		root.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(App, {}));
		return () => {
			root.unmount();
			host.remove();
		};
	});
}

//#endregion
exports.apply = apply;
exports.inject = inject;
exports.name = name;
return module.exports; } });
//# sourceMappingURL=client.js.map