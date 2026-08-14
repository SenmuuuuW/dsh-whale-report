import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 「鲸鱼记事本」客户端 half。
 *
 * 呈现形态两级：
 * 1. Tab 优先 —— 若装了 DSH-better-sidebar（ctx.betterSidebar 服务存在），
 *    就往它的工作台注册一个「🐋 鲸鱼记事本」Tab，报告面板成为侧栏的
 *    原生一员（第三方扩展的官方接缝 registerTab）。
 * 2. 悬浮球兜底 —— 没有 better-sidebar 时，右下角鲸鱼按钮 + 抽屉面板。
 *
 * 数据不经过聊天：面板直接 fetch /whale/api（宿主 half 的围栏路由）。
 * 客户端插件通过 window.__ModuleLoader__.load({id, factory}) 注册，
 * cordis 客户端内核负责装配；betterSidebar 服务用惰性注入消费
 * （服务缺失只跳过回调，绝不阻塞装配 —— 与宿主 half 的兼容策略一致）。
 */
import { Component, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
export const name = "whale-report-client";
export const inject = [];
// ─────────────────────────── 样式（JS 注入，避免打包管线） ───────────────────────────
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

/* Tab 形态：填满侧栏 pane，自带滚动 */
[data-whale-report-tabhost] {
  height: 100%; overflow-y: auto; padding: 12px 16px 24px;
  color: #e6e8f0; background: transparent;
}
[data-whale-report-tabhost] [data-whale-report-card] { background: rgba(255,255,255,.05); }
[data-whale-report-tabhost] [data-whale-report-hitem],
[data-whale-report-tabhost] [data-whale-report-chip],
[data-whale-report-tabhost] [data-whale-report-tab] { background: rgba(255,255,255,.06); }
[data-whale-report-tabhost] [data-whale-report-inputs] input { background: rgba(255,255,255,.07); }

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
    if (styleInjected || typeof document === "undefined")
        return;
    styleInjected = true;
    const tag = document.createElement("style");
    tag.setAttribute("data-plugin", "dsh-whale-report");
    tag.textContent = CSS;
    document.head.appendChild(tag);
}
async function api(method, payload) {
    const response = await fetch(`/whale/api/${method}`, {
        method: payload === undefined ? "GET" : "POST",
        headers: payload === undefined ? undefined : { "content-type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = (await response.json());
    if (!response.ok || body.ok === false) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
    }
    return body;
}
// ─────────────────────────── 小组件 ───────────────────────────
const PRESETS = [
    { key: "daily", label: "日报" },
    { key: "weekly", label: "周报" },
    { key: "monthly", label: "月报" },
    { key: "yearly", label: "年报" },
    { key: "custom", label: "自定义" },
];
function fmt(n) {
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)
        return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}
function dateStr(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}
function Heatmap({ histogram }) {
    const max = Math.max(1, ...histogram);
    const hue = (level) => {
        const a = 0.12 + level * 0.8;
        return `rgba(77,107,254,${a.toFixed(2)})`;
    };
    return (_jsx("div", { "data-whale-report-heat": true, children: histogram.map((count, hour) => (_jsx("i", { title: `${String(hour).padStart(2, "0")}:00 · ${count}`, style: { background: hue(count / max) } }, hour))) }));
}
function ReportView({ report, onDelete }) {
    const s = report.stats;
    const night = s.totalEvents === 0 ? 0 : Math.round((s.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0) / s.totalEvents) * 100);
    const topTools = Object.entries(s.toolCalls ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const totalTokens = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.reasoning;
    return (_jsxs("div", { children: [_jsxs("div", { "data-whale-report-actions": true, children: [_jsx("button", { "data-whale-report-btn": true, onClick: () => window.print(), children: "\u5BFC\u51FA PDF / \u6253\u5370" }), _jsx("button", { "data-whale-report-btn": true, "data-ghost": "true", onClick: () => onDelete(report.id), children: "\u5220\u9664" })] }), _jsx("div", { "data-whale-report-h2": true, children: "\u2699\uFE0F \u5E72\u4E86\u591A\u5C11\u6D3B" }), _jsxs("div", { "data-whale-report-cards": true, children: [_jsxs("div", { "data-whale-report-card": true, children: [_jsx("b", { children: s.sessions }), _jsxs("span", { children: ["\u4F1A\u8BDD\uFF08\u5B50\u4EE3\u7406 ", s.subagentSessions, "\uFF09"] })] }), _jsxs("div", { "data-whale-report-card": true, children: [_jsx("b", { children: s.turns }), _jsx("span", { children: "\u56DE\u5408" })] }), _jsxs("div", { "data-whale-report-card": true, children: [_jsx("b", { children: fmt(s.toolCallsTotal) }), _jsxs("span", { children: ["\u5DE5\u5177\u8C03\u7528\uFF08\u5931\u8D25 ", s.toolErrors, "\uFF09"] })] }), _jsxs("div", { "data-whale-report-card": true, children: [_jsx("b", { children: fmt(s.commands) }), _jsx("span", { children: "bash \u547D\u4EE4" })] }), _jsxs("div", { "data-whale-report-card": true, children: [_jsx("b", { children: s.userMessages }), _jsx("span", { children: "\u4F60\u7684\u6D88\u606F" })] }), _jsxs("div", { "data-whale-report-card": true, children: [_jsx("b", { children: fmt(s.assistantMessages) }), _jsx("span", { children: "\u5B83\u7684\u56DE\u590D" })] })] }), _jsx("div", { "data-whale-report-h2": true, children: "\u5E38\u7528\u5DE5\u5177" }), topTools.length === 0 ? (_jsx("div", { "data-whale-report-tokenline": true, children: "\uFF08\u6CA1\u6709\u8C03\u7528\u5DE5\u5177\uFF09" })) : (topTools.map(([toolName, count]) => (_jsxs("div", { "data-whale-report-tokenline": true, children: [_jsx("code", { children: toolName }), " \u00D7 ", count] }, toolName)))), _jsx("div", { "data-whale-report-h2": true, children: "\uD83D\uDD25 \u70E7\u4E86\u591A\u5C11 token" }), _jsxs("div", { "data-whale-report-tokenline": true, children: ["\u8F93\u5165 ", fmt(s.tokens.input), " \u00B7 \u8F93\u51FA ", fmt(s.tokens.output), " \u00B7 \u7F13\u5B58\u547D\u4E2D ", fmt(s.tokens.cacheRead), " \u00B7 \u601D\u8003 ", fmt(s.tokens.reasoning), _jsx("br", {}), "\u5408\u8BA1\u7EA6 ", _jsx("b", { children: fmt(totalTokens) }), " token"] }), _jsxs("div", { "data-whale-report-h2": true, children: ["\uD83C\uDF19 \u4F5C\u606F\u753B\u50CF\uFF08\u51CC\u6668\u6D3B\u8DC3 ", night, "%\uFF09"] }), _jsx(Heatmap, { histogram: s.hourHistogram ?? [] }), _jsxs("div", { "data-whale-report-tokenline": true, children: ["\u6D3B\u8DC3 ", s.activeDays, " \u5929", s.busiestDay ? _jsxs(_Fragment, { children: [" \u00B7 \u6700\u5FD9 ", _jsx("b", { children: s.busiestDay.date }), "\uFF08", s.busiestDay.events, " \u6761\u4E8B\u4EF6\uFF09"] }) : null] }), _jsxs("div", { "data-whale-report-h2": true, children: ["\u26A0\uFE0F \u60CA\u9B42\u65F6\u523B\uFF08", s.dangerousCommands?.length ?? 0, "\uFF09"] }), (s.dangerousCommands ?? []).length === 0 ? (_jsx("div", { "data-whale-report-tokenline": true, children: "\u8FD9\u6BB5\u65F6\u95F4\u5F88\u5E73\u9759 \uD83C\uDF89" })) : (s.dangerousCommands.slice(0, 10).map((d, i) => (_jsxs("div", { "data-whale-report-danger": true, children: [d.command.replace(/\s+/g, " "), _jsx("em", { children: new Date(d.time).toISOString().slice(0, 16).replace("T", " ") })] }, i)))), (s.titles ?? []).length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { "data-whale-report-h2": true, children: "\uD83E\uDDF5 \u4F1A\u8BDD\u6807\u9898" }), _jsx("ul", { "data-whale-report-titles": true, children: s.titles.slice(0, 8).map((t) => (_jsx("li", { children: t }, t))) })] })), _jsxs("div", { "data-whale-report-tokenline": true, style: { marginTop: 16, fontSize: 11 }, children: ["\u6570\u636E\u6765\u81EA ", s.totalEvents, " \u6761\u4F1A\u8BDD\u4E8B\u4EF6 \u00B7 \u53EA\u8BFB\uFF0C\u4E0D\u6539\u5199\u4EFB\u4F55\u5386\u53F2 \u00B7 ", dateStr(report.createdAt), " \u751F\u6210"] })] }));
}
class WhaleContent extends Component {
    state = {
        tab: "report",
        preset: "weekly",
        from: dateStr(Date.now() - 7 * 86400000),
        to: dateStr(Date.now()),
        loading: false,
        error: null,
        current: null,
        history: null,
    };
    async loadHistory() {
        try {
            const body = await api("list");
            this.setState({ history: body.reports, error: null });
        }
        catch (error) {
            this.setState({ error: error instanceof Error ? error.message : String(error) });
        }
    }
    async generate() {
        this.setState({ loading: true, error: null });
        try {
            const payload = this.state.preset === "custom"
                ? { preset: "custom", from: this.state.from, to: this.state.to }
                : { preset: this.state.preset };
            const body = await api("generate", payload);
            this.setState({ current: body.report, loading: false, tab: "report" });
        }
        catch (error) {
            this.setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
        }
    }
    async openHistory(id) {
        this.setState({ loading: true, error: null });
        try {
            const response = await fetch(`/whale/api/get?id=${encodeURIComponent(id)}`);
            const json = (await response.json());
            if (!response.ok || json.ok === false)
                throw new Error("报告不存在");
            this.setState({ current: json.report, loading: false, tab: "report" });
        }
        catch (error) {
            this.setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
        }
    }
    async deleteReport(id) {
        try {
            await api("delete", { id });
            this.setState({ current: null, history: null });
            if (this.state.tab === "history")
                void this.loadHistory();
        }
        catch (error) {
            this.setState({ error: error instanceof Error ? error.message : String(error) });
        }
    }
    render() {
        const { tab, preset, loading, error, current, history } = this.state;
        return (_jsxs(_Fragment, { children: [_jsxs("div", { "data-whale-report-tabs": true, children: [_jsx("button", { "data-whale-report-tab": true, "data-active": tab === "report", onClick: () => this.setState({ tab: "report" }), children: "\u65B0\u62A5\u544A" }), _jsx("button", { "data-whale-report-tab": true, "data-active": tab === "history", onClick: () => {
                                this.setState({ tab: "history" });
                                if (history === null)
                                    void this.loadHistory();
                            }, children: "\u5386\u53F2" })] }), error !== null && _jsxs("div", { "data-whale-report-danger": true, children: ["\u51FA\u9519\u4E86\uFF1A", error] }), tab === "history" && history === null && _jsx("div", { "data-whale-report-loading": true, children: "\u52A0\u8F7D\u4E2D\u2026" }), tab === "history" && history !== null && history.length === 0 && (_jsx("div", { "data-whale-report-empty": true, children: "\u8FD8\u6CA1\u6709\u62A5\u544A\u3002\u53BB\u300C\u65B0\u62A5\u544A\u300D\u751F\u6210\u7B2C\u4E00\u4EFD\u5427 \uD83D\uDC0B" })), tab === "history" && history !== null && history.length > 0 && (_jsx("div", { children: history.map((item) => (_jsxs("div", { "data-whale-report-hitem": true, onClick: () => void this.openHistory(item.id), children: [_jsxs("b", { children: [PRESETS.find((p) => p.key === item.preset)?.label ?? item.preset, " \u00B7 ", dateStr(item.from), " ~ ", dateStr(item.to)] }), _jsxs("span", { children: [item.sessions, " \u4F1A\u8BDD \u00B7 ", item.turns, " \u56DE\u5408 \u00B7 ", fmt(item.totalEvents), " \u4E8B\u4EF6 \u00B7 ", dateStr(item.createdAt)] })] }, item.id))) })), tab === "report" && (_jsxs(_Fragment, { children: [current === null && (_jsxs(_Fragment, { children: [_jsx("div", { "data-whale-report-chips": true, children: PRESETS.map((p) => (_jsx("button", { "data-whale-report-chip": true, "data-active": preset === p.key, onClick: () => this.setState({ preset: p.key }), children: p.label }, p.key))) }), preset === "custom" && (_jsxs("div", { "data-whale-report-inputs": true, children: [_jsx("input", { type: "date", value: this.state.from, onChange: (e) => this.setState({ from: e.target.value }) }), _jsx("input", { type: "date", value: this.state.to, onChange: (e) => this.setState({ to: e.target.value }) })] })), _jsx("div", { "data-whale-report-actions": true, children: _jsx("button", { "data-whale-report-btn": true, onClick: () => void this.generate(), disabled: loading, children: loading ? "生成中…" : "生成报告" }) }), loading && _jsx("div", { "data-whale-report-loading": true, children: "\u9CB8\u9C7C\u6B63\u5728\u7FFB\u4F60\u7684\u65E5\u5FD7\u2026" })] })), current !== null && _jsx(ReportView, { report: current, onDelete: (id) => void this.deleteReport(id) })] }))] }));
    }
}
// ─────────────────────────── Tab 模式标记（better-sidebar 存在时隐藏悬浮球） ───────────────────────────
let tabRegistered = false;
const tabModeListeners = new Set();
function setTabRegistered(value) {
    if (tabRegistered === value)
        return;
    tabRegistered = value;
    for (const listener of tabModeListeners)
        listener();
}
function subscribeTabMode(listener) {
    tabModeListeners.add(listener);
    return () => tabModeListeners.delete(listener);
}
/** better-sidebar 里的鲸鱼 Tab（与抽屉共用 WhaleContent）。 */
function SidebarTab() {
    return (_jsx("div", { "data-whale-report-tabhost": true, children: _jsx(WhaleContent, {}) }));
}
class DrawerPanel extends Component {
    state = { open: false };
    toggle = () => {
        this.setState((prev) => ({ open: !prev.open }));
    };
    render() {
        const { open } = this.state;
        return (_jsxs(_Fragment, { children: [_jsx("button", { "data-whale-report-fab": true, onClick: this.toggle, title: "\u9CB8\u9C7C\u8BB0\u4E8B\u672C", "aria-label": "\u9CB8\u9C7C\u8BB0\u4E8B\u672C", children: "\uD83D\uDC0B" }), _jsxs("div", { "data-whale-report-drawer": true, hidden: !open, children: [_jsxs("div", { "data-whale-report-head": true, children: [_jsx("span", { "data-whale-report-title": true, children: "\uD83D\uDC0B \u9CB8\u9C7C\u8BB0\u4E8B\u672C" }), _jsx("button", { "data-whale-report-close": true, onClick: this.toggle, "aria-label": "\u5173\u95ED", children: "\u2715" })] }), _jsx("div", { "data-whale-report-body": true, children: _jsx(WhaleContent, {}) })] })] }));
    }
}
/** 函数包装：Tab 已注册时悬浮球整体退场（hooks 只能在函数组件里用）。 */
function FallbackDrawer() {
    const tabMode = useSyncExternalStore(subscribeTabMode, () => tabRegistered);
    if (tabMode)
        return null; // 已在 better-sidebar 里，悬浮球退场
    return _jsx(DrawerPanel, {});
}
export function apply(ctx) {
    injectStyle();
    // 兜底 UI 永远挂载：better-sidebar 不存在时提供悬浮球抽屉；
    // 一旦 Tab 注册成功（tabRegistered 翻转），悬浮球自动隐藏。
    ctx.effect(() => {
        const host = document.createElement("div");
        host.setAttribute("data-whale-report", "");
        document.body.appendChild(host);
        const root = createRoot(host);
        root.render(_jsx(FallbackDrawer, {}));
        return () => {
            root.unmount();
            host.remove();
        };
    });
    // Tab 优先：better-sidebar 的注册服务存在时，把鲸鱼做进它的工作台。
    // 惰性注入：服务缺失只跳过回调，绝不阻塞装配。
    ctx.inject(["betterSidebar"], (injected) => {
        const service = injected.betterSidebar;
        if (service === undefined)
            return;
        ctx.effect(() => service.registerTab({
            id: "dsh-whale-report:report",
            title: "🐋 鲸鱼记事本",
            order: 90,
            single: true,
            component: () => _jsx(SidebarTab, {}),
        }));
        setTabRegistered(true);
    });
}
//# sourceMappingURL=index.js.map