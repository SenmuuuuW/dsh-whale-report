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
  width: 48px; height: 48px; border-radius: 12px;
  background: #4d6bfe; color: #fff;
  border: none; cursor: pointer; box-shadow: 0 4px 14px rgba(77,107,254,.35);
  transition: transform .15s ease, background .15s ease;
  display: flex; align-items: center; justify-content: center;
}
[data-whale-report-fab]:hover { transform: translateY(-2px); background: #3e5bf5; }
[data-whale-report-drawer] {
  position: fixed; top: 0; right: 0; height: 100vh; width: 480px; max-width: 92vw;
  z-index: 2147482999; background: #f6f7fb; color: #111827;
  box-shadow: -12px 0 40px rgba(15,23,42,.12);
  display: flex; flex-direction: column;
  transform: translateX(0); transition: transform .22s ease;
  border-left: 1px solid #e5e7eb;
}
[data-whale-report-drawer][hidden] { transform: translateX(100%); pointer-events: none; }
[data-whale-report-head] {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; border-bottom: 1px solid #e5e7eb; background: #fff;
}
[data-whale-report-title] { font-size: 15px; font-weight: 700; color: #111827; letter-spacing: .01em; }
[data-whale-report-close] { background: none; border: none; color: #6b7280; font-size: 16px; cursor: pointer; }
[data-whale-report-close]:hover { color: #111827; }
[data-whale-report-tabs] { display: flex; gap: 22px; padding: 0 20px; border-bottom: 1px solid #e5e7eb; background: #fff; }
[data-whale-report-tab] {
  padding: 13px 2px 11px; font-size: 13.5px; font-weight: 600; cursor: pointer;
  background: transparent; color: #6b7280; border: none; border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
[data-whale-report-tab][data-active="true"] { color: #4d6bfe; border-bottom-color: #4d6bfe; }
[data-whale-report-body] { flex: 1; overflow-y: auto; padding: 16px; background: #f6f7fb; }
[data-whale-report-chips] { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
[data-whale-report-chip] {
  padding: 7px 16px; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer;
  background: #fff; color: #374151; border: 1px solid #d1d5db;
}
[data-whale-report-chip]:hover { border-color: #4d6bfe; color: #4d6bfe; }
[data-whale-report-chip][data-active="true"] { background: #4d6bfe; border-color: #4d6bfe; color: #fff; }
[data-whale-report-inputs] { display: flex; gap: 8px; margin-bottom: 16px; }
[data-whale-report-inputs] input {
  flex: 1; background: #fff; color: #111827; border: 1px solid #d1d5db;
  border-radius: 8px; padding: 8px 12px; font-size: 13px;
}
[data-whale-report-inputs] input:focus { outline: none; border-color: #4d6bfe; box-shadow: 0 0 0 3px rgba(77,107,254,.12); }
[data-whale-report-actions] { display: flex; gap: 8px; margin-bottom: 14px; }
[data-whale-report-btn] {
  padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  border: 1px solid transparent; background: #4d6bfe; color: #fff;
}
[data-whale-report-btn]:hover { background: #3e5bf5; }
[data-whale-report-btn][data-ghost="true"] { background: #fff; border-color: #d1d5db; color: #374151; }
[data-whale-report-btn][data-ghost="true"]:hover { border-color: #9ca3af; }

/* ── 报告视图：hero + 白卡片分区 ── */
[data-whale-report-hero] {
  border-radius: 14px; padding: 18px 20px; margin-bottom: 12px;
  background: #4d6bfe; color: #fff;
}
[data-whale-report-herotitle] { font-size: 16px; font-weight: 700; }
[data-whale-report-herosub] { font-size: 12px; opacity: .85; margin-top: 3px; }
[data-whale-report-herostat] { display: flex; gap: 18px; margin-top: 14px; flex-wrap: wrap; }
[data-whale-report-herostat] div { display: flex; flex-direction: column; }
[data-whale-report-herostat] b { font-size: 19px; font-weight: 800; }
[data-whale-report-herostat] span { font-size: 11px; opacity: .8; margin-top: 1px; }
[data-whale-report-card] {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  padding: 14px 16px; margin-bottom: 12px;
  box-shadow: 0 1px 2px rgba(16,24,40,.03);
}
[data-whale-report-h2] {
  font-size: 13.5px; font-weight: 700; color: #111827; margin: 0 0 10px;
  display: flex; align-items: center; gap: 7px;
}
[data-whale-report-h2]::before { content: ""; width: 3px; height: 13px; border-radius: 2px; background: #4d6bfe; }
[data-whale-report-tokenline] { font-size: 12.5px; color: #374151; line-height: 1.9; }
[data-whale-report-tokenline] .muted { color: #9ca3af; }

/* 方块活动图：固定尺寸方格 + 行前缀标签 */
[data-whale-report-weekrow] { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
[data-whale-report-weekrowlabel] { width: 34px; flex-shrink: 0; font-size: 9.5px; color: #9ca3af; text-align: right; }
[data-whale-report-squares] { display: grid; grid-auto-flow: column; grid-auto-columns: 13px; grid-auto-rows: 13px; gap: 3px; }
[data-whale-report-squares] i { width: 13px; height: 13px; border-radius: 3px; display: block; }
[data-whale-report-legend] { display: flex; align-items: center; gap: 4px; font-size: 10.5px; color: #9ca3af; margin-top: 8px; }
[data-whale-report-legend] i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }

/* 活动矩阵：行=24h 列=天 */
[data-whale-report-gridwrap] { margin: 6px 0 2px; }
[data-whale-report-grid] { display: flex; gap: 3px; align-items: stretch; }
[data-whale-report-gridhours] { display: flex; flex-direction: column; gap: 3px; margin-right: 5px; flex-shrink: 0; }
[data-whale-report-gridhours] span { height: 10px; font-size: 8.5px; color: #9ca3af; line-height: 10px; text-align: right; width: 22px; }
[data-whale-report-gridcol] { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
[data-whale-report-gridcol] i { height: 10px; border-radius: 2px; }
[data-whale-report-griddates] { display: flex; gap: 3px; margin: 6px 0 0 27px; }
[data-whale-report-griddates] span { flex: 1; min-width: 0; font-size: 8.5px; color: #9ca3af; text-align: center; overflow: hidden; white-space: nowrap; }
[data-whale-report-gridempty] { font-size: 12px; color: #6b7280; padding: 8px 0; }

/* 每日活跃柱状 */
[data-whale-report-daily] { display: flex; align-items: flex-end; gap: 3px; height: 88px; margin: 10px 0 4px; }
[data-whale-report-dailycol] { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; gap: 4px; min-width: 0; }
[data-whale-report-dailycol] i { display: block; width: 100%; max-width: 20px; border-radius: 3px 3px 0 0; background: #4d6bfe; }
[data-whale-report-dailycol] span { font-size: 9px; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }

/* Token 构成 */
[data-whale-report-tokenbar] { display: flex; height: 14px; border-radius: 7px; overflow: hidden; background: #f3f4f6; margin: 8px 0 6px; }
[data-whale-report-tokenbar] i { display: block; height: 100%; }
[data-whale-report-tokenlegend] { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11.5px; color: #4b5563; }
[data-whale-report-tokenlegend] span { display: inline-flex; align-items: center; gap: 4px; }
[data-whale-report-tokenlegend] i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }

/* 模型用量 */
[data-whale-report-modeltable] { display: flex; flex-direction: column; gap: 8px; }
[data-whale-report-modelrow] { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px; }
[data-whale-report-modelhead] { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
[data-whale-report-modelhead] b { font-size: 13px; font-weight: 700; color: #111827; }
[data-whale-report-modelhead] span { font-size: 12px; font-weight: 700; color: #4d6bfe; }
[data-whale-report-modelbar] { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: #f3f4f6; }
[data-whale-report-modelbar] i { display: block; height: 100%; }
[data-whale-report-modelnums] { font-size: 11px; color: #6b7280; margin-top: 6px; }

/* 危险操作 */
[data-whale-report-dangersum] {
  background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 10px;
  padding: 10px 12px; font-size: 12.5px; color: #3730a3; line-height: 1.7; margin-bottom: 8px;
}
[data-whale-report-dangercats] { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
[data-whale-report-dangercat] {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px;
  border-radius: 999px; font-size: 11.5px; background: #fef2f2; color: #b91c1c;
  border: 1px solid #fecaca;
}
[data-whale-report-dangercat] b { font-weight: 800; }
[data-whale-report-danger] {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
  padding: 8px 10px; margin: 6px 0; color: #b91c1c; word-break: break-all;
}
[data-whale-report-danger] em { display: block; font-style: normal; font-size: 11px; color: #dc2626; opacity: .75; margin-top: 4px; }
[data-whale-report-samplesbtn] { margin-top: 4px; }
[data-whale-report-titles] li { font-size: 12.5px; color: #374151; margin: 5px 0; }
[data-whale-report-empty] { color: #6b7280; font-size: 13.5px; text-align: center; padding: 48px 0; }
[data-whale-report-hitem] {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  padding: 12px 14px; margin-bottom: 8px; cursor: pointer;
}
[data-whale-report-hitem]:hover { border-color: #4d6bfe; box-shadow: 0 2px 8px rgba(77,107,254,.08); }
[data-whale-report-hitem] b { font-size: 13.5px; font-weight: 700; color: #111827; }
[data-whale-report-hitem] span { display: block; font-size: 12px; color: #6b7280; margin-top: 4px; }
[data-whale-report-loading] { color: #6b7280; font-size: 13px; padding: 24px 0; text-align: center; }
[data-whale-report-summary] { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 4px 0; }
[data-whale-report-sumitem] { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 14px; display: flex; flex-direction: column; gap: 2px; }
[data-whale-report-sumitem] b { font-size: 20px; font-weight: 800; color: #111827; }
[data-whale-report-sumitem] span { font-size: 11.5px; color: #6b7280; }

[data-whale-report-budgetedit] { display: flex; align-items: center; gap: 8px; margin: 14px 0 4px; font-size: 12px; color: #374151; }
[data-whale-report-budgetedit] input { width: 90px; background: #fff; border: 1px solid #d1d5db; border-radius: 8px; padding: 6px 10px; font-size: 12.5px; color: #111827; }
[data-whale-report-budgetedit] input:focus { outline: none; border-color: #4d6bfe; }
[data-whale-report-herodelta] { display: flex; align-items: baseline; gap: 8px; margin-top: 10px; font-size: 12px; }
[data-whale-report-herodelta] .muted { opacity: .8; }
[data-whale-report-budget] { margin-top: 10px; }
[data-whale-report-budgetbar] { height: 6px; border-radius: 3px; background: rgba(255,255,255,.2); overflow: hidden; margin-bottom: 5px; }
[data-whale-report-budgetbar] i { display: block; height: 100%; }
[data-whale-report-budget] span { font-size: 11px; opacity: .9; }
[data-whale-report-insights] { display: flex; flex-direction: column; gap: 8px; }
[data-whale-report-insight] { border: 1px solid; border-radius: 10px; padding: 10px 12px; }
[data-whale-report-insighthead] { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
[data-whale-report-insighticon] { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 800; flex-shrink: 0; }
[data-whale-report-insighthead] b { font-size: 12.5px; color: #111827; }
[data-whale-report-insightdetail] { font-size: 12px; color: #374151; line-height: 1.7; }
[data-whale-report-insightaction] { font-size: 12px; color: #4d6bfe; margin-top: 4px; line-height: 1.6; }
[data-whale-report-insightestimate] { font-size: 11px; color: #6b7280; margin-top: 4px; }
[data-whale-report-danger][data-sev="red"] { background: #fef2f2; border-color: #dc2626; color: #b91c1c; }
[data-whale-report-danger][data-sev="amber"] { background: #fffbeb; border-color: #f59e0b; color: #92400e; }
[data-whale-report-danger][data-sev="amber"] em { color: #b45309; }

/* Tab 形态 */
[data-whale-report-tabhost] { height: 100%; overflow-y: auto; padding: 14px 16px 24px; color: #111827; background: #f6f7fb; }
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
  [data-whale-report-hero] { background: #4d6bfe; color: #fff; }
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
/** 每日事件趋势：纯 CSS 柱状图。 */
/** 四段式 token 构成条（输入/输出/缓存命中/思考）。 */
/** 绿色强度（越绿越活跃）。 */
function green(level) {
	return `rgba(34,197,94,${(.14 + level * .86).toFixed(2)})`;
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
	if (preset === "daily") {
		const hist = s.halfHourHistogram ?? [];
		if (hist.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyActivity, {});
		const max$1 = Math.max(1, ...hist);
		const labels = [
			"00:00",
			"06:00",
			"12:00",
			"18:00",
			"24:00"
		];
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-strip": true,
				children: hist.map((count, idx) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
					title: `${String(Math.floor(idx / 2)).padStart(2, "0")}:${idx % 2 ? "30" : "00"} · ${count}`,
					style: { background: count === 0 ? "#f1f5f9" : green(count / max$1) }
				}, idx))
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-striplabels": true,
				children: labels.map((l) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: l }, l))
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Legend, {})
		] });
	}
	if (preset === "weekly" || preset === "custom") {
		const series$1 = s.dayHourSeries ?? [];
		if (series$1.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyActivity, {});
		const max$1 = Math.max(1, ...series$1.flatMap((d) => d.hours));
		const hourLabels = [
			"00",
			"06",
			"12",
			"18",
			"23"
		];
		const shown = series$1.slice(-30);
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-gridwrap": true,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-grid": true,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"data-whale-report-gridhours": true,
					children: Array.from({ length: 24 }, (_, h) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: hourLabels.includes(String(h).padStart(2, "0")) ? String(h).padStart(2, "0") : "" }, h))
				}), shown.map((day) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"data-whale-report-gridcol": true,
					children: day.hours.map((count, h) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
						title: `${day.date} ${String(h).padStart(2, "0")}:00 · ${count}`,
						style: { background: count === 0 ? "#f1f5f9" : green(count / max$1) }
					}, h))
				}, day.date))]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-griddates": true,
				children: shown.map((day) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: day.date.slice(5) }, day.date))
			})]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Legend, {})] });
	}
	const series = s.dailySeries ?? [];
	if (series.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyActivity, {});
	const buckets = preset === "yearly" ? (() => {
		const weekly = [];
		const weekMs = 7 * 864e5;
		for (const day of series) {
			const t = Date.parse(day.date + "T00:00:00");
			const weekStart = new Date(Math.floor(t / weekMs) * weekMs);
			const label = weekStart.toISOString().slice(5, 10);
			const last = weekly[weekly.length - 1];
			if (last !== void 0 && last.label === label) last.count += day.count;
			else weekly.push({
				label,
				count: day.count
			});
		}
		return weekly;
	})() : series.map((d) => ({
		label: d.date.slice(5),
		count: d.count
	}));
	const max = Math.max(1, ...buckets.map((b) => b.count));
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			"data-whale-report-strip": true,
			children: buckets.map((b) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
				title: `${b.label} · ${b.count} 事件`,
				style: { background: b.count === 0 ? "#f1f5f9" : green(b.count / max) }
			}, b.label))
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-striplabels": true,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: buckets[0]?.label }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: buckets[Math.floor(buckets.length / 2)]?.label }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: buckets[buckets.length - 1]?.label })
			]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Legend, {})
	] });
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
	if (insights.length === 0) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		"data-whale-report-card": true,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			"data-whale-report-h2": true,
			children: "洞察"
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			"data-whale-report-insights": true,
			children: insights.map((insight) => {
				const meta = INSIGHT_META[insight.level] ?? INSIGHT_META.info;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-insight": true,
					style: { borderColor: `${meta.color}55` },
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							"data-whale-report-insighthead": true,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"data-whale-report-insighticon": true,
								style: { background: meta.color },
								children: meta.icon
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: insight.title })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							"data-whale-report-insightdetail": true,
							children: insight.detail
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							"data-whale-report-insightaction": true,
							children: ["建议：", insight.action]
						}),
						insight.estimate !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							"data-whale-report-insightestimate": true,
							children: insight.estimate
						})
					]
				}, insight.id);
			})
		})]
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
	return `本报告期内共 ${danger.length} 条危险操作，以「${top[0]}」为主（${top[1]} 条，占 ${share}%）${night > 0 ? `，其中 ${night} 条发生在深夜时段，建议回顾审批习惯` : ""}。`;
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
			"data-whale-report-actions": true,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				"data-whale-report-btn": true,
				onClick: exportPdf,
				children: "导出 PDF"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				"data-whale-report-btn": true,
				"data-ghost": "true",
				onClick: () => onDelete(report.id),
				children: "删除"
			})]
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			"data-whale-report-hero": true,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-herotitle": true,
					children: ["深迹 ", PRESETS.find((p) => p.key === report.preset)?.label ?? "报告"]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-herosub": true,
					children: [
						dateStr(report.from),
						" ~ ",
						dateStr(report.to)
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-herostat": true,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: s.sessions }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "会话" })] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: s.turns }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "回合" })] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: fmt(s.toolCallsTotal) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "工具调用" })] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: fmt(s.commands) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "命令" })] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: fmt(totalTokens) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Token" })] }),
						typeof report.cost?.total === "number" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("b", { children: ["¥", report.cost.total.toFixed(2)] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "预估费用" })] })
					]
				}),
				delta !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-herodelta": true,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "较上周期费用" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("b", {
							style: { color: delta > 0 ? "#fca5a5" : "#86efac" },
							children: [
								delta > 0 ? "▲" : "▼",
								" ",
								Math.abs(delta),
								"%"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "muted",
							children: [
								"（¥",
								report.prev.cost.toFixed(2),
								" → ¥",
								report.cost.total.toFixed(2),
								"）"
							]
						})
					]
				}),
				budgetUsed !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-budget": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"data-whale-report-budgetbar": true,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
							width: `${budgetUsed * 100}%`,
							background: budgetUsed >= 1 ? "#dc2626" : budgetUsed >= .8 ? "#d97706" : "#86efac"
						} })
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						"周预算 ¥",
						report.budget.toFixed(2),
						" · 已用 ",
						(budgetUsed * 100).toFixed(0),
						"%",
						budgetUsed >= 1 ? "（已超支）" : ""
					] })]
				})
			]
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
				children: "常用工具"
			}), topTools.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-whale-report-tokenline": true,
				children: "（没有调用工具）"
			}) : topTools.map(([toolName, count]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-whale-report-tokenline": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: toolName }),
					" × ",
					count
				]
			}, toolName))]
		}),
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
var WhaleContent = class extends react.Component {
	state = {
		tab: "report",
		preset: "weekly",
		from: dateStr(Date.now() - 7 * 864e5),
		to: dateStr(Date.now()),
		loading: false,
		error: null,
		current: null,
		history: null,
		budgetInput: ""
	};
	componentDidMount() {
		(async () => {
			try {
				const response = await fetch("/whale/api/settings");
				const body = await response.json();
				if (response.ok && body.ok && typeof body.settings === "number") this.setState({ budgetInput: String(body.settings) });
			} catch {}
		})();
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
			this.setState({ error: null });
		} catch (error) {
			this.setState({ error: error instanceof Error ? error.message : String(error) });
		}
	}
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
		const { tab, preset, loading, error, current, history } = this.state;
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
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
				children: "暂无报告"
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
					children: "正在生成报告…"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-whale-report-budgetedit": true,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "每周预算（¥，可选）：" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "number",
							min: "0",
							step: "1",
							placeholder: "如 50",
							value: this.state.budgetInput,
							onChange: (e) => this.setState({ budgetInput: e.target.value })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							"data-whale-report-btn": true,
							"data-ghost": "true",
							onClick: () => void this.saveBudget(),
							children: "保存"
						})
					]
				})
			] }), current !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReportView, {
				report: current,
				onDelete: (id) => void this.deleteReport(id)
			})] })
		] });
	}
};
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