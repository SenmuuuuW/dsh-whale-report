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

//#region src/insights.ts
/** 已知工具 → 归属映射（best-effort；未识别归"其他"）。 */
const TOOL_FAMILY = [
	[/^whale_/, "深迹"],
	[/^study_/, "dsh-study"],
	[/^todo_write$/, "todo 工具"],
	[/^web_search$/, "web 搜索"],
	[/^session_/, "会话工具"],
	[/^(bash|read|edit|write|glob|grep|web|fs|skill|subagent|goal|jobs|spill)/, "核心工具"]
];
/** 按工具调用数归族排序（面板与 markdown 共用）。 */
function toolFamilies(toolCalls) {
	const byFamily = new Map();
	for (const [name$1, count] of Object.entries(toolCalls)) {
		const family = TOOL_FAMILY.find(([re]) => re.test(name$1))?.[1] ?? "其他";
		byFamily.set(family, (byFamily.get(family) ?? 0) + count);
	}
	return [...byFamily.entries()].map(([family, count]) => ({
		family,
		count
	})).sort((a, b) => b.count - a.count);
}

//#endregion
//#region src/client/index.tsx
const name = "whale-report-client";
const inject = [];
const CSS = `
[data-whale-report-panel] { font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif; }
[data-whale-report-fab] {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  width: 52px; height: 52px; border-radius: 12px;
  background: #4d6bfe; color: #fff;
  border: none; cursor: pointer; box-shadow: 0 4px 14px rgba(77,107,254,.35);
  transition: transform .15s ease, background .15s ease;
  display: flex; align-items: center; justify-content: center;
}
[data-whale-report-fab]:hover { transform: translateY(-2px); background: #3e5bf5; }
[data-whale-report-drawer] {
  position: fixed; top: 0; right: 0; height: 100vh; width: 520px; max-width: 94vw;
  z-index: 2147482999; background: #f4f5f9; color: #111827;
  box-shadow: -12px 0 40px rgba(15,23,42,.12);
  display: flex; flex-direction: column;
  transform: translateX(0); transition: transform .22s ease;
  border-left: 1px solid #e5e7eb;
}
[data-whale-report-drawer][hidden] { transform: translateX(100%); pointer-events: none; }
[data-whale-report-head] {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid #e5e7eb; background: #fff;
}
[data-whale-report-title] { font-size: 16px; font-weight: 700; color: #111827; letter-spacing: .01em; }
[data-whale-report-close] { background: none; border: none; color: #6b7280; font-size: 18px; cursor: pointer; }
[data-whale-report-close]:hover { color: #111827; }
[data-whale-report-tabs] { display: flex; gap: 24px; padding: 0 16px; border-bottom: 1px solid #e5e7eb; background: #fff; }
[data-whale-report-tab] {
  padding: 13px 2px 11px; font-size: 14px; font-weight: 600; cursor: pointer;
  background: transparent; color: #6b7280; border: none; border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
[data-whale-report-tab][data-active="true"] { color: #4d6bfe; border-bottom-color: #4d6bfe; }
[data-whale-report-body] { flex: 1; overflow-y: auto; padding: 10px 16px 20px; background: #f4f5f9; }
[data-whale-report-chips] { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
[data-whale-report-chip] {
  padding: 5px 14px; border-radius: 7px; font-size: 13px; font-weight: 500; cursor: pointer;
  background: #fff; color: #374151; border: 1px solid #d1d5db;
}
[data-whale-report-chip]:hover { border-color: #4d6bfe; color: #4d6bfe; }
[data-whale-report-chip][data-active="true"] { background: #4d6bfe; border-color: #4d6bfe; color: #fff; }
[data-whale-report-inputs] { display: flex; gap: 8px; margin-bottom: 12px; }
[data-whale-report-inputs] input {
  flex: 1; background: #fff; color: #111827; border: 1px solid #d1d5db;
  border-radius: 8px; padding: 9px 12px; font-size: 13.5px;
}
[data-whale-report-inputs] input:focus { outline: none; border-color: #4d6bfe; box-shadow: 0 0 0 3px rgba(77,107,254,.12); }
[data-whale-report-actions] { display: flex; gap: 8px; }
[data-whale-report-btn] {
  padding: 9px 18px; border-radius: 8px; font-size: 13.5px; font-weight: 600; cursor: pointer;
  border: 1px solid transparent; background: #4d6bfe; color: #fff;
}
[data-whale-report-btn]:hover { background: #3e5bf5; }
[data-whale-report-btn][data-ghost="true"] { background: #fff; border-color: #d1d5db; color: #374151; }
[data-whale-report-btn][data-ghost="true"]:hover { border-color: #9ca3af; }

/* ── 品牌区 ── */
[data-whale-report-brand] { padding: 2px 2px 8px; }
[data-whale-report-brandname] { font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: .01em; line-height: 1.1; }
[data-whale-report-brandname] span { color: #4d6bfe; font-weight: 700; font-size: 17px; }
[data-whale-report-brandtag] { font-size: 12px; color: #a3aab8; margin-top: 3px; }
[data-whale-report-brandactions] { position: absolute; right: 18px; margin-top: -30px; }
[data-whale-report-link] { background: none; border: none; color: #64748b; font-size: 12.5px; cursor: pointer; padding: 5px 10px; border-radius: 7px; border: 1px solid #e5e7eb; background: #fff; }
[data-whale-report-link]:hover { border-color: #4d6bfe; color: #4d6bfe; }

/* ── toast ── */
[data-whale-report-toast] {
  position: fixed; top: 14px; right: 14px; z-index: 2147483001;
  background: #fff; border: 1px solid #fecaca; border-left: 4px solid #dc2626;
  color: #b91c1c; padding: 9px 14px; border-radius: 10px; font-size: 13px;
  box-shadow: 0 6px 18px rgba(15,23,42,.10); max-width: 300px;
}

/* ── 切换周期加载条 ── */
[data-whale-report-loadingbar] { display: flex; align-items: center; gap: 8px; margin: 0 2px 8px; font-size: 12px; color: #6b7280; }
[data-whale-report-loadingbar] i {
  flex: 1; height: 2px; border-radius: 1px; background: #e5e7eb; overflow: hidden; position: relative;
}
[data-whale-report-loadingbar] i::after {
  content: ""; position: absolute; inset: 0; width: 40%;
  background: #4d6bfe; border-radius: 1px;
  animation: dshload 1s ease-in-out infinite;
}
@keyframes dshload { 0% { left: -40%; } 100% { left: 100%; } }

/* ── 加载骨架 ── */
[data-whale-report-skeleton] { display: flex; flex-direction: column; gap: 8px; }
[data-whale-report-sk-hero] { height: 120px; border-radius: 14px; background: linear-gradient(90deg, #eef0f5 25%, #f7f8fb 50%, #eef0f5 75%); background-size: 200% 100%; animation: dshsk 1.2s infinite; }
[data-whale-report-sk-line] { height: 14px; border-radius: 6px; background: linear-gradient(90deg, #eef0f5 25%, #f7f8fb 50%, #eef0f5 75%); background-size: 200% 100%; animation: dshsk 1.2s infinite; }
@keyframes dshsk { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* ── 仪表盘 hero ── */
[data-whale-report-hero] {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 14px;
  padding: 16px 18px 14px; margin-bottom: 10px;
}
[data-whale-report-herolabel] { font-size: 13px; font-weight: 600; color: #0f172a; }
[data-whale-report-heroval] { font-size: 44px; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; line-height: 1.15; margin: 4px 0 2px; }
[data-whale-report-herodelta2] { font-size: 13px; display: flex; gap: 6px; align-items: baseline; }
[data-whale-report-herodelta2] em.up { color: #dc2626; font-style: normal; font-weight: 700; }
[data-whale-report-herodelta2] em.down { color: #16a34a; font-style: normal; font-weight: 700; }
[data-whale-report-herodelta2] span { color: #64748b; }
[data-whale-report-herodelta2] .muted { color: #9ca3af; }
[data-whale-report-herostat { }] { }
[data-whale-report-herostat] { display: flex; gap: 16px; margin-top: 12px; padding-top: 10px; border-top: 1px solid #f1f5f9; font-size: 12.5px; color: #64748b; }
[data-whale-report-herostat] b { color: #0f172a; font-weight: 800; font-variant-numeric: tabular-nums; }

/* ── 洞察 Feed ── */
[data-whale-report-feed] { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
[data-whale-report-feedrow] {
  display: flex; gap: 9px; align-items: flex-start; cursor: pointer;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 9px 12px;
}
[data-whale-report-feedrow]:hover { border-color: #c7d2fe; }
[data-whale-report-feeddot] { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
[data-whale-report-feedmain] { flex: 1; min-width: 0; }
[data-whale-report-feedtitle] { font-size: 13.5px; font-weight: 700; color: #0f172a; }
[data-whale-report-feedpreview] { font-size: 12.5px; color: #64748b; margin-top: 2px; font-family: ui-monospace, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-whale-report-feeddetail] { font-size: 13px; color: #374151; line-height: 1.7; margin-top: 5px; }
[data-whale-report-feedaction] { font-size: 13px; color: #4d6bfe; margin-top: 4px; }
[data-whale-report-feedestimate] { font-size: 12px; color: #6b7280; margin-top: 3px; }

[data-whale-report-feedmore] {
  width: 100%; background: none; border: 1px dashed #d1d5db; color: #4d6bfe;
  font-size: 12.5px; padding: 7px; border-radius: 8px; cursor: pointer; margin-bottom: 12px;
}
[data-whale-report-feedmore]:hover { border-color: #4d6bfe; background: #eef2ff; }

/* ── 完整报告按钮 ── */
[data-whale-report-fullbtn] { width: 100%; margin: 4px 0 12px; padding: 11px; font-size: 14px; }

/* ── 报告视图：紧凑头部 + 大数字统计条 ── */
[data-whale-report-headrow] {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 4px 2px 12px;
}
[data-whale-report-reptitle] { font-size: 18px; font-weight: 800; color: #111827; }
[data-whale-report-repsub] { font-size: 13px; color: #6b7280; margin-top: 3px; }
[data-whale-report-statgrid] {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px;
}
[data-whale-report-stat] {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 10px 12px 9px;
}
[data-whale-report-stat] b {
  display: block; font-size: 24px; font-weight: 800; color: #111827;
  font-variant-numeric: tabular-nums; line-height: 1.2;
}
[data-whale-report-stat] span { font-size: 11.5px; color: #6b7280; }
[data-whale-report-stat] em.delta-up { color: #dc2626; font-size: 12px; font-weight: 700; margin-left: 6px; font-style: normal; }
[data-whale-report-stat] em.delta-down { color: #16a34a; font-size: 12px; font-weight: 700; margin-left: 6px; font-style: normal; }
[data-whale-report-budget] { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 12px; color: #4b5563; }
[data-whale-report-budgetbar] { flex: 1; height: 8px; border-radius: 4px; background: #e5e7eb; overflow: hidden; }
[data-whale-report-budgetbar] i { display: block; height: 100%; }

/* ── 卡片 ── */
[data-whale-report-card] {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 12px 14px; margin-bottom: 10px;
}
[data-whale-report-h2] {
  font-size: 14px; font-weight: 700; color: #111827; margin: 0 0 8px;
  display: flex; align-items: center; gap: 7px;
}
[data-whale-report-h2]::before { content: ""; width: 3px; height: 14px; border-radius: 2px; background: #4d6bfe; }
[data-whale-report-tokenline] { font-size: 13.5px; color: #374151; line-height: 1.8; }
[data-whale-report-tokenline] .muted { color: #9ca3af; }

/* ── 洞察：告警条式（左色条 + 单行信息） ── */
[data-whale-report-insights] { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
[data-whale-report-insight] {
  background: #fff; border: 1px solid #e5e7eb; border-left: 4px solid #4d6bfe;
  border-radius: 8px; padding: 8px 12px; cursor: pointer;
}
[data-whale-report-insight][data-open="true"] { padding-bottom: 10px; }
[data-whale-report-insighthead] { display: flex; align-items: baseline; gap: 8px; }
[data-whale-report-insighthead] b { font-size: 13.5px; color: #111827; }
[data-whale-report-insighthead] span { font-size: 12.5px; color: #6b7280; }
[data-whale-report-insightdetail] { font-size: 13px; color: #374151; line-height: 1.7; margin-top: 5px; }
[data-whale-report-insightaction] { font-size: 13px; color: #4d6bfe; margin-top: 4px; }
[data-whale-report-insightestimate] { font-size: 12px; color: #6b7280; margin-top: 3px; }

/* 活动方块 */
[data-whale-report-weekrow] { display: flex; align-items: center; gap: 7px; margin-bottom: 4px; }
[data-whale-report-weekrowlabel] { width: 36px; flex-shrink: 0; font-size: 10.5px; color: #9ca3af; text-align: right; }
[data-whale-report-squares] { display: flex; gap: 3px; flex: 1; min-width: 0; }
[data-whale-report-squares] i { flex: 1 1 0; min-width: 0; aspect-ratio: 1; border-radius: 3px; display: block; }
[data-whale-report-legend] { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #9ca3af; margin-top: 7px; }
[data-whale-report-legend] i { display: inline-block; width: 11px; height: 11px; border-radius: 2px; }
[data-whale-report-gridempty] { font-size: 13px; color: #6b7280; padding: 6px 0; }

/* Token 构成 */
[data-whale-report-tokenbar] { display: flex; height: 16px; border-radius: 8px; overflow: hidden; background: #f3f4f6; margin: 6px 0 6px; }
[data-whale-report-tokenbar] i { display: block; height: 100%; }
[data-whale-report-tokenlegend] { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: #4b5563; }
[data-whale-report-tokenlegend] span { display: inline-flex; align-items: center; gap: 4px; }
[data-whale-report-tokenlegend] i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; }

/* 模型用量 */
[data-whale-report-modeltable] { display: flex; flex-direction: column; gap: 7px; }
[data-whale-report-modelrow] { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 9px 11px; }
[data-whale-report-modelhead] { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
[data-whale-report-modelhead] b { font-size: 13.5px; font-weight: 700; color: #111827; }
[data-whale-report-modelhead] span { font-size: 12.5px; font-weight: 700; color: #4d6bfe; font-variant-numeric: tabular-nums; }
[data-whale-report-modelbar] { display: flex; height: 9px; border-radius: 4px; overflow: hidden; background: #f3f4f6; }
[data-whale-report-modelbar] i { display: block; height: 100%; }
[data-whale-report-modelnums] { font-size: 12px; color: #6b7280; margin-top: 5px; font-variant-numeric: tabular-nums; }

/* 危险/敏感 */
[data-whale-report-dangersum] {
  background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 8px;
  padding: 9px 11px; font-size: 13px; color: #3730a3; line-height: 1.6; margin-bottom: 7px;
}
[data-whale-report-dangercats] { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 7px; }
[data-whale-report-dangercat] {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px;
  border-radius: 999px; font-size: 12px; background: #fef2f2; color: #b91c1c;
  border: 1px solid #fecaca;
}
[data-whale-report-dangercat] b { font-weight: 800; }
[data-whale-report-secretcat] {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px;
  border-radius: 999px; font-size: 12px; background: #f5f3ff; color: #6d28d9;
  border: 1px solid #ddd6fe;
}
[data-whale-report-secretcat] b { font-weight: 800; }
[data-whale-report-danger] {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px;
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
  padding: 8px 10px; margin: 5px 0; color: #b91c1c; word-break: break-all;
}
[data-whale-report-danger][data-sev="red"] { background: #fef2f2; border-color: #dc2626; color: #b91c1c; }
[data-whale-report-danger][data-sev="amber"] { background: #fffbeb; border-color: #f59e0b; color: #92400e; }
[data-whale-report-danger][data-sev="amber"] em { color: #b45309; }
[data-whale-report-danger] em { display: block; font-style: normal; font-size: 12px; color: #dc2626; opacity: .75; margin-top: 4px; }
[data-whale-report-samplesbtn] { margin-top: 4px; }
[data-whale-report-titles] li { font-size: 13px; color: #374151; margin: 4px 0; }
[data-whale-report-empty] { color: #6b7280; font-size: 13.5px; text-align: center; padding: 40px 0; }
[data-whale-report-hitem] {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 11px 13px; margin-bottom: 7px; cursor: pointer;
}
[data-whale-report-hitem]:hover { border-color: #4d6bfe; }
[data-whale-report-hitem] b { font-size: 13.5px; font-weight: 700; color: #111827; }
[data-whale-report-hitem] span { display: block; font-size: 12.5px; color: #6b7280; margin-top: 3px; }
[data-whale-report-loading] { color: #6b7280; font-size: 13px; padding: 20px 0; text-align: center; }
[data-whale-report-budgetedit] { display: flex; align-items: center; gap: 8px; margin: 12px 0 4px; font-size: 13px; color: #374151; }
[data-whale-report-budgetedit] input { width: 100px; background: #fff; border: 1px solid #d1d5db; border-radius: 8px; padding: 7px 10px; font-size: 13.5px; color: #111827; }
[data-whale-report-budgetedit] input:focus { outline: none; border-color: #4d6bfe; }

/* Tab 形态 */
[data-whale-report-tabhost] { height: 100%; overflow-y: auto; padding: 10px 16px 20px; color: #111827; background: #f4f5f9; }
[data-whale-report-tabhost] [data-whale-report-card] { background: #fff; }

@media print {
  body * { visibility: hidden; }
  [data-whale-report-drawer], [data-whale-report-drawer] * { visibility: visible; }
  [data-whale-report-drawer] {
    position: absolute; left: 0; top: 0; width: 100%; height: auto;
    box-shadow: none; border: none; background: #fff; color: #111;
  }
  [data-whale-report-fab], [data-whale-report-close], [data-whale-report-tabs],
  [data-whale-report-chips], [data-whale-report-inputs], [data-whale-report-actions] { display: none !important; }
  [data-whale-report-card] { box-shadow: none; break-inside: avoid; }
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
const HERO_LABEL = {
	daily: "今日 Agent 消耗",
	"24h": "近 24 小时消耗",
	weekly: "本周 Agent 消耗",
	monthly: "本月 Agent 消耗",
	yearly: "本年 Agent 消耗",
	custom: "区间 Agent 消耗"
};
const PRESETS = [
	{
		key: "daily",
		label: "日报"
	},
	{
		key: "24h",
		label: "24小时"
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
/** 每日事件趋势：纯 CSS 柱状图。 */
/** 四段式 token 构成条（输入/输出/缓存命中/思考）。 */
/** 绿色强度（越绿越活跃）。低值用幂放大：count 只是峰值 1% 的方块也要肉眼可见。 */
function green(level) {
	const boosted = Math.pow(Math.min(1, Math.max(0, level)), .4);
	return `rgba(34,197,94,${(.22 + boosted * .78).toFixed(2)})`;
}
/** 图例：少 → 多。 */
function Legend() {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		"data-whale-report-legend": true,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "少" }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: { background: green(0) } }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: { background: green(.3) } }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: { background: green(.6) } }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: { background: green(1) } }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "多" })
		]
	});
}
function EmptyActivity() {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		"data-whale-report-gridempty": true,
		children: "该报告生成于旧版本，无逐时数据。重新生成即可。"
	});
}
/** 一行小方格：左侧行标签 + 自适应宽度方块（每格随容器伸缩、保持正方形）。 */
function SquareRow({ label, cells }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		"data-whale-report-weekrow": true,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			"data-whale-report-weekrowlabel": true,
			children: label
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			"data-whale-report-squares": true,
			children: cells.map((c, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
				title: c.title,
				style: { background: c.level === 0 ? "#f1f5f9" : green(c.level) }
			}, i))
		})]
	});
}
/**
* 活动可视化：按报告周期自适应粒度。
*   日报 → 每格 30 分钟（48 格一行）
*   周报 → 每格 1 小时（24 行 × 7 天矩阵）
*   月报 → 每格 1 天（约 30 格一行）
*   年报 → 每格 1 周（约 52 格一行）
* 颜色越绿代表事件越多。
*/
function ActivityStrip({ report }) {
	const s = report.stats;
	const preset = report.preset;
	const cell = (count, max$1, title) => ({
		title,
		level: count === 0 ? 0 : count / max$1
	});
	if (preset === "daily") {
		const hist = s.halfHourHistogram ?? [];
		if (hist.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyActivity, {});
		const max$1 = Math.max(1, ...hist);
		const rows$1 = [
			{
				label: "00–06",
				cells: hist.slice(0, 12)
			},
			{
				label: "06–12",
				cells: hist.slice(12, 24)
			},
			{
				label: "12–18",
				cells: hist.slice(24, 36)
			},
			{
				label: "18–24",
				cells: hist.slice(36, 48)
			}
		];
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [rows$1.map((row, ri) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SquareRow, {
			label: row.label,
			cells: row.cells.map((count, i) => {
				const halfHour = ri * 360 + i * 30;
				const h = Math.floor(halfHour / 60);
				const m = halfHour % 60;
				return cell(count, max$1, `${String(h).padStart(2, "0")}:${m === 0 ? "00" : "30"} · ${count}`);
			})
		}, row.label)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Legend, {})] });
	}
	if (preset === "24h") {
		const hist = s.hourHistogram ?? [];
		if (hist.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyActivity, {});
		const max$1 = Math.max(1, ...hist);
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SquareRow, {
			label: "24h",
			cells: hist.map((count, h) => cell(count, max$1, `${String(h).padStart(2, "0")}:00 · ${count}`))
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Legend, {})] });
	}
	if (preset === "weekly" || preset === "custom") {
		const series$1 = s.dayHourSeries ?? [];
		if (series$1.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyActivity, {});
		const max$1 = Math.max(1, ...series$1.flatMap((d) => d.hours));
		const shown = series$1.slice(-30);
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [shown.map((day) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SquareRow, {
			label: day.date.slice(5),
			cells: day.hours.map((count, h) => cell(count, max$1, `${day.date} ${String(h).padStart(2, "0")}:00 · ${count}`))
		}, day.date)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Legend, {})] });
	}
	const series = s.dailySeries ?? [];
	if (series.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyActivity, {});
	const buckets = preset === "yearly" ? (() => {
		const weekly = [];
		const weekMs = 7 * 864e5;
		for (const day of series) {
			const t = Date.parse(day.date + "T00:00:00");
			const weekStart = new Date(Math.floor(t / weekMs) * weekMs);
			const label = weekStart.toISOString().slice(0, 10);
			const last = weekly[weekly.length - 1];
			if (last !== void 0 && last.label === label) last.count += day.count;
			else weekly.push({
				label,
				count: day.count
			});
		}
		return weekly;
	})() : series.map((d) => ({
		label: d.date,
		count: d.count
	}));
	const max = Math.max(1, ...buckets.map((b) => b.count));
	const perRow = preset === "yearly" ? 13 : 10;
	const rows = [];
	for (let i = 0; i < buckets.length; i += perRow) {
		const items = buckets.slice(i, i + perRow);
		const from = items[0].label.slice(5);
		const to = items[items.length - 1].label.slice(5);
		rows.push({
			label: preset === "yearly" ? `${items[0].label.slice(0, 4)}月` : `${from}–${to}`,
			items
		});
	}
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SquareRow, {
		label: row.label,
		cells: row.items.map((b) => cell(b.count, max, `${b.label} · ${b.count} 事件`))
	}, row.label)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Legend, {})] });
}
function TokenBar({ tokens }) {
	const total = tokens.input + tokens.output + tokens.cacheRead + tokens.reasoning;
	if (total === 0) return null;
	const seg = (value, color, name$1) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
		title: `${name$1} ${fmt(value)}`,
		style: {
			width: `${value / total * 100}%`,
			background: color
		}
	}, name$1);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		"data-whale-report-tokenbar": true,
		children: [
			seg(tokens.input, "#4d6bfe", "输入"),
			seg(tokens.output, "#38bdf8", "输出"),
			seg(tokens.cacheRead, "#94a3b8", "缓存命中"),
			seg(tokens.reasoning, "#c4b5fd", "思考")
		]
	}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		"data-whale-report-tokenlegend": true,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: { background: "#4d6bfe" } }),
				"输入 ",
				fmt(tokens.input)
			] }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: { background: "#38bdf8" } }),
				"输出 ",
				fmt(tokens.output)
			] }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: { background: "#94a3b8" } }),
				"缓存 ",
				fmt(tokens.cacheRead)
			] }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: { background: "#c4b5fd" } }),
				"思考 ",
				fmt(tokens.reasoning)
			] })
		]
	})] });
}
/** 模型用量表（对齐 DS 开放平台用量页的展示习惯）。 */
function ModelTable({ models, cost }) {
	const entries = Object.entries(models).sort((a, b) => b[1].input + b[1].output + b[1].cacheRead + b[1].reasoning - (a[1].input + a[1].output + a[1].cacheRead + a[1].reasoning));
	if (entries.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		"data-whale-report-tokenline": true,
		children: "（无模型用量数据）"
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		"data-whale-report-modeltable": true,
		children: entries.map(([model, u]) => {
			const total = u.input + u.output + u.cacheRead + u.reasoning;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-modelrow": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-whale-report-modelhead": true,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: model }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							fmt(total),
							" token",
							typeof cost?.perModel[model] === "number" ? ` · ¥${cost.perModel[model].toFixed(2)}` : ""
						] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-whale-report-modelbar": true,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
								title: `输入 ${fmt(u.input)}`,
								style: {
									width: `${u.input / total * 100}%`,
									background: "#4d6bfe"
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
								title: `输出 ${fmt(u.output)}`,
								style: {
									width: `${u.output / total * 100}%`,
									background: "#38bdf8"
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
								title: `缓存命中 ${fmt(u.cacheRead)}`,
								style: {
									width: `${u.cacheRead / total * 100}%`,
									background: "#94a3b8"
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
								title: `思考 ${fmt(u.reasoning)}`,
								style: {
									width: `${u.reasoning / total * 100}%`,
									background: "#c4b5fd"
								}
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-whale-report-modelnums": true,
						children: [
							"输入 ",
							fmt(u.input),
							" · 输出 ",
							fmt(u.output),
							" · 缓存 ",
							fmt(u.cacheRead),
							" · 思考 ",
							fmt(u.reasoning)
						]
					})
				]
			}, model);
		})
	});
}
const INSIGHT_META = {
	info: {
		color: "#4d6bfe",
		icon: "ℹ"
	},
	tip: {
		color: "#16a34a",
		icon: "✓"
	},
	warning: {
		color: "#d97706",
		icon: "!"
	},
	critical: {
		color: "#dc2626",
		icon: "×"
	}
};
function InsightsSection({ insights }) {
	const shown = insights.filter((i) => i.level !== "info");
	if (shown.length === 0) return null;
	const [openId, setOpenId] = (0, react.useState)(null);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		"data-whale-report-insights": true,
		children: shown.map((insight) => {
			const meta = INSIGHT_META[insight.level] ?? INSIGHT_META.warning;
			const open = openId === insight.id;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-insight": true,
				"data-open": open,
				style: { borderLeftColor: meta.color },
				onClick: () => setOpenId(open ? null : insight.id),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-insighthead": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: insight.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: open ? "收起" : "详情" })]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"data-whale-report-insightdetail": true,
						children: insight.detail
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"data-whale-report-insightaction": true,
						children: insight.action
					}),
					insight.estimate !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"data-whale-report-insightestimate": true,
						children: insight.estimate
					})
				] })]
			}, insight.id);
		})
	});
}
/** 危险操作自动总结（规则生成，不用 LLM）。 */
function dangerSummary(danger) {
	if (danger.length === 0) return "";
	danger = danger.map((d) => ({
		...d,
		label: d.label ?? "未分类"
	}));
	const byLabel = new Map();
	for (const d of danger) byLabel.set(d.label, (byLabel.get(d.label) ?? 0) + 1);
	const top = [...byLabel.entries()].sort((a, b) => b[1] - a[1])[0];
	const share = Math.round(top[1] / danger.length * 100);
	const night = danger.filter((d) => {
		const h = new Date(d.time).getHours();
		return h < 6 || h >= 23;
	}).length;
	return `共 ${danger.length} 条，以「${top[0]}」为主（${top[1]} 条，占 ${share}%）${night > 0 ? `，${night} 条在深夜时段` : ""}。`;
}
function ReportView({ report, onDelete }) {
	const s = report.stats;
	const night = s.totalEvents === 0 ? 0 : Math.round(s.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0) / s.totalEvents * 100);
	const topTools = Object.entries(s.toolCalls ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
	const totalTokens = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.reasoning;
	const [dangerExpanded, setDangerExpanded] = (0, react.useState)(false);
	const [samplesShown, setSamplesShown] = (0, react.useState)(false);
	const danger = (s.dangerousCommands ?? []).map((d) => ({
		...d,
		label: d.label ?? "未分类",
		sev: d.sev ?? "amber"
	}));
	const shownDanger = dangerExpanded ? danger.slice(0, 30) : danger.slice(0, 3);
	const summary = dangerSummary(danger);
	const exportPdf = () => {
		const url = `/whale/api/html?id=${encodeURIComponent(report.id)}`;
		window.open(url, "_blank");
	};
	const delta = report.prev !== void 0 && report.prev.cost > 0 && typeof report.cost?.total === "number" ? Math.round((report.cost.total - report.prev.cost) / report.prev.cost * 100) : null;
	const budgetUsed = typeof report.budget === "number" && report.budget > 0 && typeof report.cost?.total === "number" ? Math.min(1, report.cost.total / report.budget) : null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-headrow": true,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-reptitle": true,
				children: ["深迹 ", PRESETS.find((p) => p.key === report.preset)?.label ?? "报告"]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-repsub": true,
				children: [
					dateStr(report.from),
					" ~ ",
					dateStr(report.to)
				]
			})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-actions": true,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					"data-whale-report-btn": true,
					"data-ghost": "true",
					onClick: () => onDelete(report.id),
					children: "删除"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					"data-whale-report-btn": true,
					onClick: exportPdf,
					children: "导出 PDF"
				})]
			})]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-statgrid": true,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-stat": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: s.sessions }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "会话" })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-stat": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: s.turns }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "回合" })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-stat": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: fmt(s.toolCallsTotal) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "工具调用" })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-stat": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: fmt(s.commands) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "命令" })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-stat": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: fmt(totalTokens) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Token" })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-stat": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("b", { children: ["¥", typeof report.cost?.total === "number" ? report.cost.total.toFixed(2) : "—"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["预估费用", delta !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("em", {
						className: delta > 0 ? "delta-up" : "delta-down",
						children: [
							delta > 0 ? "▲" : "▼",
							" ",
							Math.abs(delta),
							"%"
						]
					})] })]
				})
			]
		}),
		budgetUsed !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-budget": true,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-budgetbar": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
					width: `${budgetUsed * 100}%`,
					background: budgetUsed >= 1 ? "#dc2626" : budgetUsed >= .8 ? "#d97706" : "#16a34a"
				} })
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
				"预算 ",
				budgetUsed >= 1 ? "超支" : `${(budgetUsed * 100).toFixed(0)}%`,
				" · ¥",
				report.cost.total.toFixed(2),
				" / ¥",
				report.budget.toFixed(2)
			] })]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)(InsightsSection, { insights: report.insights ?? [] }),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-card": true,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-h2": true,
					children: [
						"活跃时段（凌晨 ",
						night,
						"%）"
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActivityStrip, { report }),
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
				})
			]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-card": true,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-h2": true,
				children: "Token 构成"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TokenBar, { tokens: s.tokens })]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-card": true,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"data-whale-report-h2": true,
					children: "模型用量（DeepSeek 官方计价）"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelTable, {
					models: s.models ?? {},
					cost: report.cost
				}),
				typeof report.cost?.total === "number" && report.cost.total > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-tokenline": true,
					style: { marginTop: 8 },
					children: [
						"预估合计 ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("b", { children: ["¥", report.cost.total.toFixed(2)] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "muted",
							children: [
								" · ",
								report.cost.source === "official-page" ? "官方定价页实时价" : "内置价",
								" · 以平台账单为准"
							]
						})
					]
				})
			]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-card": true,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-h2": true,
				children: "工具使用（按族）"
			}), toolFamilies(s.toolCalls ?? {}).length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-tokenline": true,
				children: "（没有调用工具）"
			}) : toolFamilies(s.toolCalls ?? {}).map((fam) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-tokenline": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: fam.family }),
					" × ",
					fam.count
				]
			}, fam.family))]
		}),
		(s.burstSamples ?? []).length > 0 && (() => {
			const bursts = s.burstSamples ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-card": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-whale-report-h2": true,
						children: [
							"重试诊断（",
							bursts.length,
							"）"
						]
					}),
					bursts.slice(0, 3).map((b, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-whale-report-danger": true,
						"data-sev": "amber",
						children: [b.cmd, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("em", { children: [
							"重复 ",
							b.count,
							" 次 · ",
							new Date(b.time).toISOString().slice(0, 16).replace("T", " "),
							b.error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" · 错误：", b.error.slice(0, 90)] }) : null
						] })]
					}, i)),
					bursts.length > 3 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-whale-report-tokenline": true,
						children: [
							"……共 ",
							bursts.length,
							" 条，完整列表见导出 PDF"
						]
					})
				]
			});
		})(),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-card": true,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-h2": true,
				children: [
					"危险操作（",
					danger.length,
					"）"
				]
			}), danger.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-tokenline": true,
				children: "无危险操作"
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"data-whale-report-dangersum": true,
					children: summary
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"data-whale-report-dangercats": true,
					children: [...danger.reduce((m, d) => m.set(d.label, (m.get(d.label) ?? 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						"data-whale-report-dangercat": true,
						children: [
							label,
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: count })
						]
					}, label))
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					"data-whale-report-chip": true,
					"data-whale-report-samplesbtn": true,
					onClick: () => {
						setSamplesShown(!samplesShown);
						setDangerExpanded(false);
					},
					children: samplesShown ? "收起样本" : `查看样本（${danger.length}）`
				}),
				samplesShown && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [shownDanger.map((d, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-danger": true,
					children: [d.command.replace(/\s+/g, " ").slice(0, 64), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("em", { children: [
						d.label,
						" · ",
						new Date(d.time).toISOString().slice(0, 16).replace("T", " ")
					] })]
				}, i)), danger.length > 3 && !dangerExpanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					"data-whale-report-chip": true,
					onClick: () => setDangerExpanded(true),
					children: "展开更多"
				})] })
			] })]
		}),
		(s.secretHits ?? []).length > 0 && (() => {
			const hits = s.secretHits ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-card": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-whale-report-h2": true,
						children: [
							"敏感信息（",
							hits.length,
							"）"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"data-whale-report-tokenline": true,
						children: "疑似密钥/令牌出现在会话中，未展示原文。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"data-whale-report-dangercats": true,
						children: [...hits.reduce((m, h) => m.set(h.label, (m.get(h.label) ?? 0) + 1), new Map()).entries()].map(([label, count]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							"data-whale-report-secretcat": true,
							children: [
								label,
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: count })
							]
						}, label))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"data-whale-report-tokenline": true,
						style: { marginTop: 6 },
						children: "建议尽快轮换对应密钥。"
					})
				]
			});
		})(),
		(s.titles ?? []).length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-card": true,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-h2": true,
				children: "会话标题"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				"data-whale-report-titles": true,
				children: s.titles.slice(0, 8).map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t }, t))
			})]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-tokenline": true,
			style: { fontSize: 11 },
			className: "muted",
			children: [
				"基于 ",
				s.totalEvents,
				" 条会话事件 · 只读 · 生成于 ",
				dateStr(report.createdAt)
			]
		})
	] });
}
/** 洞察预览行（紧凑 Feed：标题 + 一行数据预览）。 */
function insightPreview(insight, s) {
	switch (insight.id) {
		case "danger-red":
		case "danger-amber": {
			const first = s.dangerousCommands?.[0]?.command ?? null;
			return first !== null ? first.replace(/\s+/g, " ").slice(0, 40) : null;
		}
		case "retry-storm": {
			const burst = s.burstSamples?.[0];
			return burst !== void 0 ? `连续 ${burst.count} 次：${burst.cmd.slice(0, 34)}` : null;
		}
		case "cache-drop":
		case "cache-good": return `命中率 ${Math.round(s.tokens.cacheRead / Math.max(1, s.tokens.input + s.tokens.cacheRead) * 1e3) / 10}%`;
		case "night-cost": return null;
		case "secret-hit": return s.secretHits?.map((h) => h.label).join("、") ?? null;
		case "budget-over":
		case "budget-near": return null;
		case "session-fragmentation": return `平均 ${s.sessions > 0 ? (s.turns / s.sessions).toFixed(1) : "0"} 回合/会话`;
		case "cost-trend": return null;
		default: return null;
	}
}
var WhaleContent = class extends react.Component {
	state = {
		toast: null,
		view: "dashboard",
		preset: "weekly",
		from: dateStr(Date.now() - 7 * 864e5),
		to: dateStr(Date.now()),
		loading: false,
		error: null,
		dashboard: null,
		current: null,
		history: null,
		budgetInput: "",
		showBudgetEdit: false
	};
	requestSeq = 0;
	componentDidMount() {
		this.loadDashboard(this.state.preset);
		this.loadBudget();
	}
	setToast(message) {
		this.setState({ toast: message });
		window.setTimeout(() => {
			this.setState((prev) => prev.toast === message ? {
				...prev,
				toast: null
			} : prev);
		}, 4e3);
	}
	async loadBudget() {
		try {
			const response = await fetch("/whale/api/settings");
			const body = await response.json();
			if (response.ok && body.ok && typeof body.settings === "number") this.setState({ budgetInput: String(body.settings) });
		} catch {}
	}
	async saveBudget() {
		const value = Number(this.state.budgetInput);
		const budget = Number.isFinite(value) && value > 0 ? value : void 0;
		try {
			const response = await fetch("/whale/api/settings", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ budgetWeeklyCny: budget })
			});
			const body = await response.json();
			if (!response.ok || body.ok === false) throw new Error(body.error?.message ?? "保存失败");
			this.setState({
				error: null,
				showBudgetEdit: false
			});
			this.setToast("预算已保存");
		} catch (error) {
			this.setToast(error instanceof Error ? error.message : String(error));
		}
	}
	/** 仪表盘：当前周期数据（有则复用，无则生成）。preset 显式传入，避免 setState 异步竞态。 */
	async loadDashboard(preset) {
		const seq = ++this.requestSeq;
		this.setState({
			loading: true,
			error: null
		});
		try {
			const payload = preset === "custom" ? {
				preset: "custom",
				from: this.state.from,
				to: this.state.to
			} : { preset };
			const response = await fetch("/whale/api/summary", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload)
			});
			const body = await response.json();
			if (!response.ok || body.ok === false) throw new Error(body.error?.message ?? "生成失败");
			if (seq !== this.requestSeq) return;
			this.setState({
				dashboard: body.report,
				current: body.report,
				loading: false,
				view: "dashboard"
			});
		} catch (error) {
			if (seq !== this.requestSeq) return;
			this.setState({ loading: false });
			this.setToast(error instanceof Error ? error.message : String(error));
		}
	}
	async loadHistory() {
		try {
			const body = await api("list");
			this.setState({ history: body.reports });
		} catch (error) {
			this.setToast(error instanceof Error ? error.message : String(error));
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
				view: "report"
			});
		} catch (error) {
			this.setState({ loading: false });
			this.setToast(error instanceof Error ? error.message : String(error));
		}
	}
	async deleteReport(id) {
		try {
			await api("delete", { id });
			this.setState({
				current: null,
				dashboard: null,
				history: null,
				view: "dashboard"
			});
		} catch (error) {
			this.setToast(error instanceof Error ? error.message : String(error));
		}
	}
	render() {
		const { view, preset, loading, error, dashboard, current, history } = this.state;
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-tabs": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						"data-whale-report-tab": true,
						"data-active": view === "dashboard",
						onClick: () => this.setState({ view: "dashboard" }),
						children: "概览"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						"data-whale-report-tab": true,
						"data-active": view === "report",
						onClick: () => this.setState({ view: "report" }),
						children: "报告"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						"data-whale-report-tab": true,
						"data-active": view === "history",
						onClick: () => {
							this.setState({ view: "history" });
							if (history === null) this.loadHistory();
						},
						children: "历史"
					})
				]
			}),
			this.state.toast !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-toast": true,
				children: this.state.toast
			}),
			view === "dashboard" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dashboard, {
				state: this.state,
				onPreset: (p) => {
					this.setState({ preset: p });
					this.loadDashboard(p);
				},
				onCustom: (from, to) => {
					this.setState({
						from,
						to
					});
					this.loadDashboard("custom");
				},
				onOpenReport: () => this.setState({ view: "report" }),
				onBudgetToggle: () => this.setState({ showBudgetEdit: !this.state.showBudgetEdit }),
				onBudgetInput: (v) => this.setState({ budgetInput: v }),
				onSaveBudget: () => void this.saveBudget()
			}),
			view === "report" && current !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-body": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReportView, {
					report: current,
					onDelete: (id) => void this.deleteReport(id)
				})
			}),
			view === "report" && current === null && !loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-body": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"data-whale-report-empty": true,
					children: "先回到概览生成一份报告"
				})
			}),
			view === "history" && history === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-loading": true,
				children: "加载中…"
			}),
			view === "history" && history !== null && history.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-empty": true,
				children: "暂无报告"
			}),
			view === "history" && history !== null && history.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-body": true,
				children: history.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
				}, item.id))
			})
		] });
	}
};
/** 概览（打开即报告）：Hero 大数字 + 洞察 Feed + 活跃 + 模型。 */
function Dashboard(props) {
	const { state, onPreset, onCustom, onOpenReport, onBudgetToggle, onBudgetInput, onSaveBudget } = props;
	const { preset, loading, error, dashboard, showBudgetEdit, budgetInput, from, to } = state;
	const report = dashboard;
	const s = report?.stats;
	const cost = report?.cost?.total;
	const delta = report?.prev !== void 0 && report.prev.cost > 0 && cost !== void 0 ? Math.round((cost - report.prev.cost) / report.prev.cost * 100) : null;
	const levelWeight = {
		critical: 0,
		warning: 1,
		tip: 2
	};
	const insights = (report?.insights ?? []).filter((i) => i.level !== "info").sort((a, b) => (levelWeight[a.level] ?? 3) - (levelWeight[b.level] ?? 3));
	const totalTokens = s !== void 0 ? s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.reasoning : 0;
	const modelRows = (() => {
		if (s === void 0) return [];
		const entries = Object.entries(s.models ?? {}).sort((a, b) => b[1].input + b[1].output + b[1].cacheRead + b[1].reasoning - (a[1].input + a[1].output + a[1].cacheRead + a[1].reasoning));
		const grand = entries.reduce((sum, [, u]) => sum + u.input + u.output + u.cacheRead + u.reasoning, 0);
		return entries.map(([model, u]) => {
			const t = u.input + u.output + u.cacheRead + u.reasoning;
			return {
				model,
				share: grand > 0 ? Math.round(t / grand * 100) : 0,
				cost: report?.cost?.perModel?.[model]
			};
		});
	})();
	const budgetUsed = typeof report?.budget === "number" && report.budget > 0 && cost !== void 0 ? Math.min(1, cost / report.budget) : null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		"data-whale-report-body": true,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-brand": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-whale-report-brandname": true,
						children: ["深迹 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "DeepTrace" })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"data-whale-report-brandtag": true,
						children: "Your Agent, in numbers."
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"data-whale-report-brandactions": true,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							"data-whale-report-link": true,
							onClick: onBudgetToggle,
							children: typeof cost === "number" && typeof report?.budget === "number" && report.budget > 0 && preset === "weekly" ? `¥${cost.toFixed(2)} / ¥${report.budget.toFixed(2)}` : "预算"
						})
					})
				]
			}),
			showBudgetEdit && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-budgetedit": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "周预算（¥）：" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "number",
						min: "0",
						step: "1",
						placeholder: "如 50",
						value: budgetInput,
						onChange: (e) => onBudgetInput(e.target.value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						"data-whale-report-btn": true,
						"data-ghost": "true",
						onClick: onSaveBudget,
						children: "保存"
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-chips": true,
				children: PRESETS.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					"data-whale-report-chip": true,
					"data-active": preset === p.key,
					onClick: () => onPreset(p.key),
					children: p.label
				}, p.key))
			}),
			preset === "custom" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-inputs": true,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "date",
					value: from,
					onChange: (e) => onCustom(e.target.value, to)
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "date",
					value: to,
					onChange: (e) => onCustom(from, e.target.value)
				})]
			}),
			loading && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-loadingbar": true,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "更新中…" })]
			}),
			loading && report === null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-skeleton": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { "data-whale-report-sk-hero": true }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { "data-whale-report-sk-line": true }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { "data-whale-report-sk-line": true }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { "data-whale-report-sk-line": true })
				]
			}),
			!loading && report === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-loading": true,
				children: "暂无数据，点击上方周期生成"
			}),
			report !== null && s !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-hero": true,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							"data-whale-report-herolabel": true,
							children: HERO_LABEL[preset] ?? "Agent 消耗"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							"data-whale-report-heroval": true,
							children: ["¥", typeof cost === "number" ? cost.toFixed(2) : "—"]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							"data-whale-report-herodelta2": true,
							children: delta === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "muted",
								children: "首次记录，下周起可对比"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("em", {
								className: delta > 0 ? "up" : "down",
								children: [
									delta > 0 ? "↑" : "↓",
									" ",
									Math.abs(delta),
									"%"
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: " vs 上周" })] })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							"data-whale-report-herostat": true,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: s.sessions }), " 会话"] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: fmt(s.toolCallsTotal) }), " 工具调用"] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: fmt(totalTokens) }), " Tokens"] })
							]
						})
					]
				}),
				budgetUsed !== null && preset === "weekly" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-budget": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"data-whale-report-budgetbar": true,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
							width: `${budgetUsed * 100}%`,
							background: budgetUsed >= 1 ? "#dc2626" : budgetUsed >= .8 ? "#d97706" : "#4d6bfe"
						} })
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						"¥",
						cost.toFixed(2),
						" / ¥",
						report.budget.toFixed(2),
						" ",
						budgetUsed >= 1 ? "超支" : ""
					] })]
				}),
				insights.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"data-whale-report-h2": true,
						children: "值得注意"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(InsightFeed, {
						insights: insights.slice(0, 3),
						stats: s
					}),
					insights.length > 3 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						"data-whale-report-feedmore": true,
						onClick: onOpenReport,
						children: [
							"还有 ",
							insights.length - 3,
							" 条洞察，见完整报告 →"
						]
					})
				] }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"data-whale-report-h2": true,
					children: "活跃"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"data-whale-report-card": true,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActivityStrip, { report })
				}),
				modelRows.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"data-whale-report-h2": true,
					children: "模型"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"data-whale-report-card": true,
					children: modelRows.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-whale-report-modelrow": true,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							"data-whale-report-modelhead": true,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: m.model }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								m.share,
								"% · ¥",
								typeof m.cost === "number" ? m.cost.toFixed(1) : "—"
							] })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							"data-whale-report-modelbar": true,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
								width: `${m.share}%`,
								background: "#4d6bfe"
							} })
						})]
					}, m.model))
				})] }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					"data-whale-report-btn": true,
					"data-whale-report-fullbtn": true,
					onClick: onOpenReport,
					children: "生成完整报告 →"
				})
			] })
		]
	});
}
/** 洞察紧凑 Feed：色点 + 单行标题 + 预览，点击展开。 */
function InsightFeed({ insights, stats }) {
	const [openId, setOpenId] = (0, react.useState)(null);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		"data-whale-report-feed": true,
		children: insights.map((insight) => {
			const meta = INSIGHT_META[insight.level] ?? INSIGHT_META.warning;
			const open = openId === insight.id;
			const preview = insightPreview(insight, stats);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-feedrow": true,
				onClick: () => setOpenId(open ? null : insight.id),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
					"data-whale-report-feeddot": true,
					style: { background: meta.color }
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-feedmain": true,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							"data-whale-report-feedtitle": true,
							children: insight.title
						}),
						preview !== null && !open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							"data-whale-report-feedpreview": true,
							children: preview
						}),
						open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								"data-whale-report-feeddetail": true,
								children: insight.detail
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								"data-whale-report-feedaction": true,
								children: insight.action
							}),
							insight.estimate !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								"data-whale-report-feedestimate": true,
								children: insight.estimate
							})
						] })
					]
				})]
			}, insight.id);
		})
	});
}
let tabRegistered = false;
const tabModeListeners = new Set();
function setTabRegistered(value) {
	if (tabRegistered === value) return;
	tabRegistered = value;
	for (const listener of tabModeListeners) listener();
}
function subscribeTabMode(listener) {
	tabModeListeners.add(listener);
	return () => tabModeListeners.delete(listener);
}
/** better-sidebar 里的深迹 Tab（与抽屉共用 WhaleContent）。 */
function SidebarTab() {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		"data-whale-report-tabhost": true,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WhaleContent, {})
	});
}
var DrawerPanel = class extends react.Component {
	state = { open: false };
	toggle = () => {
		this.setState((prev) => ({ open: !prev.open }));
	};
	render() {
		const { open } = this.state;
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			"data-whale-report-fab": true,
			onClick: this.toggle,
			title: "深迹 DeepTrace",
			"aria-label": "深迹 DeepTrace"
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-drawer": true,
			hidden: !open,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-head": true,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"data-whale-report-title": true,
					children: "深迹 DeepTrace"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					"data-whale-report-close": true,
					onClick: this.toggle,
					"aria-label": "关闭",
					children: "✕"
				})]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-body": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WhaleContent, {})
			})]
		})] });
	}
};
/** 函数包装：Tab 已注册时悬浮球整体退场（hooks 只能在函数组件里用）。 */
function FallbackDrawer() {
	const tabMode = (0, react.useSyncExternalStore)(subscribeTabMode, () => tabRegistered);
	if (tabMode) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DrawerPanel, {});
}
function apply(ctx) {
	injectStyle();
	ctx.effect(() => {
		const host = document.createElement("div");
		host.setAttribute("data-whale-report", "");
		document.body.appendChild(host);
		const root = (0, react_dom_client.createRoot)(host);
		root.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FallbackDrawer, {}));
		return () => {
			root.unmount();
			host.remove();
		};
	});
	ctx.inject(["betterSidebar"], (injected) => {
		const service = injected.betterSidebar;
		if (service === void 0) return;
		ctx.effect(() => service.registerTab({
			id: "dsh-whale-report:report",
			title: "深迹 DeepTrace",
			order: 90,
			single: true,
			component: () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SidebarTab, {})
		}));
		setTabRegistered(true);
	});
}

//#endregion
exports.apply = apply;
exports.inject = inject;
exports.name = name;
return module.exports; } });
//# sourceMappingURL=client.js.map