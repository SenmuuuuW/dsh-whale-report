import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 「深迹 DeepTrace」客户端 half。
 *
 * 呈现形态两级：
 * 1. Tab 优先 —— 若装了 DSH-better-sidebar（ctx.betterSidebar 服务存在），
 *    就往它的工作台注册一个「深迹」Tab，报告面板成为侧栏的
 *    原生一员（第三方扩展的官方接缝 registerTab）。
 * 2. 悬浮球兜底 —— 没有 better-sidebar 时，右下角入口按钮 + 抽屉面板。
 *
 * 数据不经过聊天：面板直接 fetch /whale/api（宿主 half 的围栏路由）。
 * 客户端插件通过 window.__ModuleLoader__.load({id, factory}) 注册，
 * cordis 客户端内核负责装配；betterSidebar 服务用惰性注入消费
 * （服务缺失只跳过回调，绝不阻塞装配 —— 与宿主 half 的兼容策略一致）。
 */
import { Component, useState, useSyncExternalStore } from "react";
import { toolFamilies } from "../insights.js";
import { createRoot } from "react-dom/client";
export const name = "whale-report-client";
export const inject = [];
// ─────────────────────────── 样式（JS 注入，避免打包管线） ───────────────────────────
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
[data-whale-report-squares] { display: grid; grid-auto-rows: auto; gap: 3px; flex: 1; min-width: 0; }
[data-whale-report-squares] i { aspect-ratio: 1; border-radius: 3px; display: block; width: 100%; }
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
/** 柱状图小图标（FAB 与侧栏 Tab 共用，无 emoji）。 */
function ChartIcon({ size = 20 }) {
    return (_jsxs("svg", { width: size, height: size, viewBox: "0 0 20 20", fill: "none", "aria-hidden": "true", children: [_jsx("rect", { x: "2.5", y: "11", width: "3.6", height: "6.5", rx: "1.2", fill: "currentColor" }), _jsx("rect", { x: "8.2", y: "6.5", width: "3.6", height: "11", rx: "1.2", fill: "currentColor" }), _jsx("rect", { x: "13.9", y: "2.5", width: "3.6", height: "15", rx: "1.2", fill: "currentColor" })] }));
}
const HERO_LABEL = {
    daily: "今日 Agent 消耗",
    "24h": "近 24 小时消耗",
    weekly: "本周 Agent 消耗",
    monthly: "本月 Agent 消耗",
    yearly: "本年 Agent 消耗",
    custom: "区间 Agent 消耗",
};
const PRESETS = [
    { key: "daily", label: "日报" },
    { key: "24h", label: "24小时" },
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
        const a = 0.14 + level * 0.82;
        return `rgba(77,107,254,${a.toFixed(2)})`;
    };
    // 48 格 = 30 分钟粒度；每 4 格（2 小时）打一个轴标签
    const labels = ["00:00", "02:00", "04:00", "06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00", "24:00"];
    return (_jsxs("div", { children: [_jsx("div", { "data-whale-report-heat": true, children: histogram.map((count, idx) => (_jsx("i", { title: `${String(Math.floor(idx / 2)).padStart(2, "0")}:${idx % 2 === 0 ? "00" : "30"} · ${count}`, style: { background: hue(count / max) } }, idx))) }), _jsx("div", { "data-whale-report-heatlabels": true, children: labels.map((l) => (_jsx("span", { children: l }, l))) })] }));
}
/** 每日事件趋势：纯 CSS 柱状图。 */
/** 四段式 token 构成条（输入/输出/缓存命中/思考）。 */
/** 绿色强度（越绿越活跃）。 */
function green(level) {
    return `rgba(34,197,94,${(0.14 + level * 0.86).toFixed(2)})`;
}
/** 图例：少 → 多。 */
function Legend() {
    return (_jsxs("div", { "data-whale-report-legend": true, children: [_jsx("span", { children: "\u5C11" }), _jsx("i", { style: { background: green(0) } }), _jsx("i", { style: { background: green(0.3) } }), _jsx("i", { style: { background: green(0.6) } }), _jsx("i", { style: { background: green(1) } }), _jsx("span", { children: "\u591A" })] }));
}
function EmptyActivity() {
    return _jsx("div", { "data-whale-report-gridempty": true, children: "\u8BE5\u62A5\u544A\u751F\u6210\u4E8E\u65E7\u7248\u672C\uFF0C\u65E0\u9010\u65F6\u6570\u636E\u3002\u91CD\u65B0\u751F\u6210\u5373\u53EF\u3002" });
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
        if (hist.length === 0)
            return _jsx(EmptyActivity, {});
        const max = Math.max(1, ...hist);
        const labels = ["00:00", "06:00", "12:00", "18:00", "24:00"];
        return (_jsxs("div", { children: [_jsx("div", { "data-whale-report-strip": true, children: hist.map((count, idx) => (_jsx("i", { title: `${String(Math.floor(idx / 2)).padStart(2, "0")}:${idx % 2 ? "30" : "00"} · ${count}`, style: { background: count === 0 ? "#f1f5f9" : green(count / max) } }, idx))) }), _jsx("div", { "data-whale-report-striplabels": true, children: labels.map((l) => (_jsx("span", { children: l }, l))) }), _jsx(Legend, {})] }));
    }
    if (preset === "weekly" || preset === "custom") {
        const series = s.dayHourSeries ?? [];
        if (series.length === 0)
            return _jsx(EmptyActivity, {});
        const max = Math.max(1, ...series.flatMap((d) => d.hours));
        const hourLabels = ["00", "06", "12", "18", "23"];
        const shown = series.slice(-30);
        return (_jsxs("div", { children: [_jsxs("div", { "data-whale-report-gridwrap": true, children: [_jsxs("div", { "data-whale-report-grid": true, children: [_jsx("div", { "data-whale-report-gridhours": true, children: Array.from({ length: 24 }, (_, h) => (_jsx("span", { children: hourLabels.includes(String(h).padStart(2, "0")) ? String(h).padStart(2, "0") : "" }, h))) }), shown.map((day) => (_jsx("div", { "data-whale-report-gridcol": true, children: day.hours.map((count, h) => (_jsx("i", { title: `${day.date} ${String(h).padStart(2, "0")}:00 · ${count}`, style: { background: count === 0 ? "#f1f5f9" : green(count / max) } }, h))) }, day.date)))] }), _jsx("div", { "data-whale-report-griddates": true, children: shown.map((day) => (_jsx("span", { children: day.date.slice(5) }, day.date))) })] }), _jsx(Legend, {})] }));
    }
    // monthly：每格 1 天；yearly：每格 1 周
    const series = s.dailySeries ?? [];
    if (series.length === 0)
        return _jsx(EmptyActivity, {});
    const buckets = preset === "yearly"
        ? (() => {
            const weekly = [];
            const weekMs = 7 * 86400000;
            for (const day of series) {
                const t = Date.parse(day.date + "T00:00:00");
                const weekStart = new Date(Math.floor(t / weekMs) * weekMs);
                const label = weekStart.toISOString().slice(5, 10);
                const last = weekly[weekly.length - 1];
                if (last !== undefined && last.label === label)
                    last.count += day.count;
                else
                    weekly.push({ label, count: day.count });
            }
            return weekly;
        })()
        : series.map((d) => ({ label: d.date.slice(5), count: d.count }));
    const max = Math.max(1, ...buckets.map((b) => b.count));
    return (_jsxs("div", { children: [_jsx("div", { "data-whale-report-strip": true, children: buckets.map((b) => (_jsx("i", { title: `${b.label} · ${b.count} 事件`, style: { background: b.count === 0 ? "#f1f5f9" : green(b.count / max) } }, b.label))) }), _jsxs("div", { "data-whale-report-striplabels": true, children: [_jsx("span", { children: buckets[0]?.label }), _jsx("span", { children: buckets[Math.floor(buckets.length / 2)]?.label }), _jsx("span", { children: buckets[buckets.length - 1]?.label })] }), _jsx(Legend, {})] }));
}
function TokenBar({ tokens }) {
    const total = tokens.input + tokens.output + tokens.cacheRead + tokens.reasoning;
    if (total === 0)
        return null;
    const seg = (value, color, name) => (_jsx("i", { title: `${name} ${fmt(value)}`, style: { width: `${(value / total) * 100}%`, background: color } }, name));
    return (_jsxs("div", { children: [_jsxs("div", { "data-whale-report-tokenbar": true, children: [seg(tokens.input, "#4d6bfe", "输入"), seg(tokens.output, "#38bdf8", "输出"), seg(tokens.cacheRead, "#94a3b8", "缓存命中"), seg(tokens.reasoning, "#c4b5fd", "思考")] }), _jsxs("div", { "data-whale-report-tokenlegend": true, children: [_jsxs("span", { children: [_jsx("i", { style: { background: "#4d6bfe" } }), "\u8F93\u5165 ", fmt(tokens.input)] }), _jsxs("span", { children: [_jsx("i", { style: { background: "#38bdf8" } }), "\u8F93\u51FA ", fmt(tokens.output)] }), _jsxs("span", { children: [_jsx("i", { style: { background: "#94a3b8" } }), "\u7F13\u5B58 ", fmt(tokens.cacheRead)] }), _jsxs("span", { children: [_jsx("i", { style: { background: "#c4b5fd" } }), "\u601D\u8003 ", fmt(tokens.reasoning)] })] })] }));
}
/** 模型用量表（对齐 DS 开放平台用量页的展示习惯）。 */
function ModelTable({ models, cost }) {
    const entries = Object.entries(models).sort((a, b) => b[1].input + b[1].output + b[1].cacheRead + b[1].reasoning - (a[1].input + a[1].output + a[1].cacheRead + a[1].reasoning));
    if (entries.length === 0)
        return _jsx("div", { "data-whale-report-tokenline": true, children: "\uFF08\u65E0\u6A21\u578B\u7528\u91CF\u6570\u636E\uFF09" });
    return (_jsx("div", { "data-whale-report-modeltable": true, children: entries.map(([model, u]) => {
            const total = u.input + u.output + u.cacheRead + u.reasoning;
            return (_jsxs("div", { "data-whale-report-modelrow": true, children: [_jsxs("div", { "data-whale-report-modelhead": true, children: [_jsx("b", { children: model }), _jsxs("span", { children: [fmt(total), " token", typeof cost?.perModel[model] === "number" ? ` · ¥${cost.perModel[model].toFixed(2)}` : ""] })] }), _jsxs("div", { "data-whale-report-modelbar": true, children: [_jsx("i", { title: `输入 ${fmt(u.input)}`, style: { width: `${(u.input / total) * 100}%`, background: "#4d6bfe" } }), _jsx("i", { title: `输出 ${fmt(u.output)}`, style: { width: `${(u.output / total) * 100}%`, background: "#38bdf8" } }), _jsx("i", { title: `缓存命中 ${fmt(u.cacheRead)}`, style: { width: `${(u.cacheRead / total) * 100}%`, background: "#94a3b8" } }), _jsx("i", { title: `思考 ${fmt(u.reasoning)}`, style: { width: `${(u.reasoning / total) * 100}%`, background: "#c4b5fd" } })] }), _jsxs("div", { "data-whale-report-modelnums": true, children: ["\u8F93\u5165 ", fmt(u.input), " \u00B7 \u8F93\u51FA ", fmt(u.output), " \u00B7 \u7F13\u5B58 ", fmt(u.cacheRead), " \u00B7 \u601D\u8003 ", fmt(u.reasoning)] })] }, model));
        }) }));
}
const INSIGHT_META = {
    info: { color: "#4d6bfe", icon: "ℹ" },
    tip: { color: "#16a34a", icon: "✓" },
    warning: { color: "#d97706", icon: "!" },
    critical: { color: "#dc2626", icon: "×" },
};
function InsightsSection({ insights }) {
    const shown = insights.filter((i) => i.level !== "info");
    if (shown.length === 0)
        return null;
    const [openId, setOpenId] = useState(null);
    return (_jsx("div", { "data-whale-report-insights": true, children: shown.map((insight) => {
            const meta = INSIGHT_META[insight.level] ?? INSIGHT_META.warning;
            const open = openId === insight.id;
            return (_jsxs("div", { "data-whale-report-insight": true, "data-open": open, style: { borderLeftColor: meta.color }, onClick: () => setOpenId(open ? null : insight.id), children: [_jsxs("div", { "data-whale-report-insighthead": true, children: [_jsx("b", { children: insight.title }), _jsx("span", { children: open ? "收起" : "详情" })] }), open && (_jsxs(_Fragment, { children: [_jsx("div", { "data-whale-report-insightdetail": true, children: insight.detail }), _jsx("div", { "data-whale-report-insightaction": true, children: insight.action }), insight.estimate !== undefined && _jsx("div", { "data-whale-report-insightestimate": true, children: insight.estimate })] }))] }, insight.id));
        }) }));
}
/** 危险操作自动总结（规则生成，不用 LLM）。 */
function dangerSummary(danger) {
    if (danger.length === 0)
        return "";
    danger = danger.map((d) => ({ ...d, label: d.label ?? "未分类" }));
    const byLabel = new Map();
    for (const d of danger)
        byLabel.set(d.label, (byLabel.get(d.label) ?? 0) + 1);
    const top = [...byLabel.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = Math.round((top[1] / danger.length) * 100);
    const night = danger.filter((d) => {
        const h = new Date(d.time).getHours();
        return h < 6 || h >= 23;
    }).length;
    return `共 ${danger.length} 条，以「${top[0]}」为主（${top[1]} 条，占 ${share}%）${night > 0 ? `，${night} 条在深夜时段` : ""}。`;
}
function ReportView({ report, onDelete }) {
    const s = report.stats;
    const night = s.totalEvents === 0 ? 0 : Math.round((s.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0) / s.totalEvents) * 100);
    const topTools = Object.entries(s.toolCalls ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const totalTokens = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.reasoning;
    const [dangerExpanded, setDangerExpanded] = useState(false);
    const [samplesShown, setSamplesShown] = useState(false);
    const danger = (s.dangerousCommands ?? []).map((d) => ({ ...d, label: d.label ?? "未分类", sev: d.sev ?? "amber" }));
    const shownDanger = dangerExpanded ? danger.slice(0, 30) : danger.slice(0, 3);
    const summary = dangerSummary(danger);
    const exportPdf = () => {
        const url = `/whale/api/html?id=${encodeURIComponent(report.id)}`;
        window.open(url, "_blank");
    };
    const delta = report.prev !== undefined && report.prev.cost > 0 && typeof report.cost?.total === "number"
        ? Math.round(((report.cost.total - report.prev.cost) / report.prev.cost) * 100)
        : null;
    const budgetUsed = typeof report.budget === "number" && report.budget > 0 && typeof report.cost?.total === "number"
        ? Math.min(1, report.cost.total / report.budget)
        : null;
    return (_jsxs("div", { children: [_jsxs("div", { "data-whale-report-headrow": true, children: [_jsxs("div", { children: [_jsxs("div", { "data-whale-report-reptitle": true, children: ["\u6DF1\u8FF9 ", PRESETS.find((p) => p.key === report.preset)?.label ?? "报告"] }), _jsxs("div", { "data-whale-report-repsub": true, children: [dateStr(report.from), " ~ ", dateStr(report.to)] })] }), _jsxs("div", { "data-whale-report-actions": true, children: [_jsx("button", { "data-whale-report-btn": true, "data-ghost": "true", onClick: () => onDelete(report.id), children: "\u5220\u9664" }), _jsx("button", { "data-whale-report-btn": true, onClick: exportPdf, children: "\u5BFC\u51FA PDF" })] })] }), _jsxs("div", { "data-whale-report-statgrid": true, children: [_jsxs("div", { "data-whale-report-stat": true, children: [_jsx("b", { children: s.sessions }), _jsx("span", { children: "\u4F1A\u8BDD" })] }), _jsxs("div", { "data-whale-report-stat": true, children: [_jsx("b", { children: s.turns }), _jsx("span", { children: "\u56DE\u5408" })] }), _jsxs("div", { "data-whale-report-stat": true, children: [_jsx("b", { children: fmt(s.toolCallsTotal) }), _jsx("span", { children: "\u5DE5\u5177\u8C03\u7528" })] }), _jsxs("div", { "data-whale-report-stat": true, children: [_jsx("b", { children: fmt(s.commands) }), _jsx("span", { children: "\u547D\u4EE4" })] }), _jsxs("div", { "data-whale-report-stat": true, children: [_jsx("b", { children: fmt(totalTokens) }), _jsx("span", { children: "Token" })] }), _jsxs("div", { "data-whale-report-stat": true, children: [_jsxs("b", { children: ["\u00A5", typeof report.cost?.total === "number" ? report.cost.total.toFixed(2) : "—"] }), _jsxs("span", { children: ["\u9884\u4F30\u8D39\u7528", delta !== null && (_jsxs("em", { className: delta > 0 ? "delta-up" : "delta-down", children: [delta > 0 ? "▲" : "▼", " ", Math.abs(delta), "%"] }))] })] })] }), budgetUsed !== null && (_jsxs("div", { "data-whale-report-budget": true, children: [_jsx("div", { "data-whale-report-budgetbar": true, children: _jsx("i", { style: { width: `${budgetUsed * 100}%`, background: budgetUsed >= 1 ? "#dc2626" : budgetUsed >= 0.8 ? "#d97706" : "#16a34a" } }) }), _jsxs("span", { children: ["\u9884\u7B97 ", budgetUsed >= 1 ? "超支" : `${(budgetUsed * 100).toFixed(0)}%`, " \u00B7 \u00A5", report.cost.total.toFixed(2), " / \u00A5", report.budget.toFixed(2)] })] })), _jsx(InsightsSection, { insights: report.insights ?? [] }), _jsxs("div", { "data-whale-report-card": true, children: [_jsxs("div", { "data-whale-report-h2": true, children: ["\u6D3B\u8DC3\u65F6\u6BB5\uFF08\u51CC\u6668 ", night, "%\uFF09"] }), _jsx(ActivityStrip, { report: report }), _jsxs("div", { "data-whale-report-tokenline": true, children: ["\u6D3B\u8DC3 ", s.activeDays, " \u5929", s.busiestDay ? _jsxs(_Fragment, { children: [" \u00B7 \u6700\u5FD9 ", _jsx("b", { children: s.busiestDay.date }), "\uFF08", s.busiestDay.events, " \u6761\u4E8B\u4EF6\uFF09"] }) : null] })] }), _jsxs("div", { "data-whale-report-card": true, children: [_jsx("div", { "data-whale-report-h2": true, children: "Token \u6784\u6210" }), _jsx(TokenBar, { tokens: s.tokens })] }), _jsxs("div", { "data-whale-report-card": true, children: [_jsx("div", { "data-whale-report-h2": true, children: "\u6A21\u578B\u7528\u91CF\uFF08DeepSeek \u5B98\u65B9\u8BA1\u4EF7\uFF09" }), _jsx(ModelTable, { models: s.models ?? {}, cost: report.cost }), typeof report.cost?.total === "number" && report.cost.total > 0 && (_jsxs("div", { "data-whale-report-tokenline": true, style: { marginTop: 8 }, children: ["\u9884\u4F30\u5408\u8BA1 ", _jsxs("b", { children: ["\u00A5", report.cost.total.toFixed(2)] }), _jsxs("span", { className: "muted", children: [" \u00B7 ", report.cost.source === "official-page" ? "官方定价页实时价" : "内置价", " \u00B7 \u4EE5\u5E73\u53F0\u8D26\u5355\u4E3A\u51C6"] })] }))] }), _jsxs("div", { "data-whale-report-card": true, children: [_jsx("div", { "data-whale-report-h2": true, children: "\u5DE5\u5177\u4F7F\u7528\uFF08\u6309\u65CF\uFF09" }), toolFamilies(s.toolCalls ?? {}).length === 0 ? (_jsx("div", { "data-whale-report-tokenline": true, children: "\uFF08\u6CA1\u6709\u8C03\u7528\u5DE5\u5177\uFF09" })) : (toolFamilies(s.toolCalls ?? {}).map((fam) => (_jsxs("div", { "data-whale-report-tokenline": true, children: [_jsx("code", { children: fam.family }), " \u00D7 ", fam.count] }, fam.family))))] }), (s.burstSamples ?? []).length > 0 && (() => {
                const bursts = s.burstSamples ?? [];
                return (_jsxs("div", { "data-whale-report-card": true, children: [_jsxs("div", { "data-whale-report-h2": true, children: ["\u91CD\u8BD5\u8BCA\u65AD\uFF08", bursts.length, "\uFF09"] }), bursts.slice(0, 3).map((b, i) => (_jsxs("div", { "data-whale-report-danger": true, "data-sev": "amber", children: [b.cmd, _jsxs("em", { children: ["\u91CD\u590D ", b.count, " \u6B21 \u00B7 ", new Date(b.time).toISOString().slice(0, 16).replace("T", " "), b.error !== undefined ? _jsxs(_Fragment, { children: [" \u00B7 \u9519\u8BEF\uFF1A", b.error.slice(0, 90)] }) : null] })] }, i))), bursts.length > 3 && _jsxs("div", { "data-whale-report-tokenline": true, children: ["\u2026\u2026\u5171 ", bursts.length, " \u6761\uFF0C\u5B8C\u6574\u5217\u8868\u89C1\u5BFC\u51FA PDF"] })] }));
            })(), _jsxs("div", { "data-whale-report-card": true, children: [_jsxs("div", { "data-whale-report-h2": true, children: ["\u5371\u9669\u64CD\u4F5C\uFF08", danger.length, "\uFF09"] }), danger.length === 0 ? (_jsx("div", { "data-whale-report-tokenline": true, children: "\u65E0\u5371\u9669\u64CD\u4F5C" })) : (_jsxs(_Fragment, { children: [_jsx("div", { "data-whale-report-dangersum": true, children: summary }), _jsx("div", { "data-whale-report-dangercats": true, children: [...danger.reduce((m, d) => m.set(d.label, (m.get(d.label) ?? 0) + 1), new Map()).entries()]
                                    .sort((a, b) => b[1] - a[1])
                                    .map(([label, count]) => (_jsxs("span", { "data-whale-report-dangercat": true, children: [label, " ", _jsx("b", { children: count })] }, label))) }), _jsx("button", { "data-whale-report-chip": true, "data-whale-report-samplesbtn": true, onClick: () => {
                                    setSamplesShown(!samplesShown);
                                    setDangerExpanded(false);
                                }, children: samplesShown ? "收起样本" : `查看样本（${danger.length}）` }), samplesShown && (_jsxs(_Fragment, { children: [shownDanger.map((d, i) => (_jsxs("div", { "data-whale-report-danger": true, children: [d.command.replace(/\s+/g, " ").slice(0, 64), _jsxs("em", { children: [d.label, " \u00B7 ", new Date(d.time).toISOString().slice(0, 16).replace("T", " ")] })] }, i))), danger.length > 3 && !dangerExpanded && (_jsx("button", { "data-whale-report-chip": true, onClick: () => setDangerExpanded(true), children: "\u5C55\u5F00\u66F4\u591A" }))] }))] }))] }), (s.secretHits ?? []).length > 0 && (() => {
                const hits = s.secretHits ?? [];
                return (_jsxs("div", { "data-whale-report-card": true, children: [_jsxs("div", { "data-whale-report-h2": true, children: ["\u654F\u611F\u4FE1\u606F\uFF08", hits.length, "\uFF09"] }), _jsx("div", { "data-whale-report-tokenline": true, children: "\u7591\u4F3C\u5BC6\u94A5/\u4EE4\u724C\u51FA\u73B0\u5728\u4F1A\u8BDD\u4E2D\uFF0C\u672A\u5C55\u793A\u539F\u6587\u3002" }), _jsx("div", { "data-whale-report-dangercats": true, children: [...hits.reduce((m, h) => m.set(h.label, (m.get(h.label) ?? 0) + 1), new Map()).entries()].map(([label, count]) => (_jsxs("span", { "data-whale-report-secretcat": true, children: [label, " ", _jsx("b", { children: count })] }, label))) }), _jsx("div", { "data-whale-report-tokenline": true, style: { marginTop: 6 }, children: "\u5EFA\u8BAE\u5C3D\u5FEB\u8F6E\u6362\u5BF9\u5E94\u5BC6\u94A5\u3002" })] }));
            })(), (s.titles ?? []).length > 0 && (_jsxs("div", { "data-whale-report-card": true, children: [_jsx("div", { "data-whale-report-h2": true, children: "\u4F1A\u8BDD\u6807\u9898" }), _jsx("ul", { "data-whale-report-titles": true, children: s.titles.slice(0, 8).map((t) => (_jsx("li", { children: t }, t))) })] })), _jsxs("div", { "data-whale-report-tokenline": true, style: { fontSize: 11 }, className: "muted", children: ["\u57FA\u4E8E ", s.totalEvents, " \u6761\u4F1A\u8BDD\u4E8B\u4EF6 \u00B7 \u53EA\u8BFB \u00B7 \u751F\u6210\u4E8E ", dateStr(report.createdAt)] })] }));
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
            return burst !== undefined ? `连续 ${burst.count} 次：${burst.cmd.slice(0, 34)}` : null;
        }
        case "cache-drop":
        case "cache-good":
            return `命中率 ${Math.round((s.tokens.cacheRead / Math.max(1, s.tokens.input + s.tokens.cacheRead)) * 1000) / 10}%`;
        case "night-cost":
            return null;
        case "secret-hit":
            return s.secretHits?.map((h) => h.label).join("、") ?? null;
        case "budget-over":
        case "budget-near":
            return null;
        case "session-fragmentation":
            return `平均 ${s.sessions > 0 ? (s.turns / s.sessions).toFixed(1) : "0"} 回合/会话`;
        case "cost-trend":
            return null;
        default:
            return null;
    }
}
class WhaleContent extends Component {
    state = {
        toast: null,
        view: "dashboard",
        preset: "weekly",
        from: dateStr(Date.now() - 7 * 86400000),
        to: dateStr(Date.now()),
        loading: false,
        error: null,
        dashboard: null,
        current: null,
        history: null,
        budgetInput: "",
        showBudgetEdit: false,
    };
    componentDidMount() {
        void this.loadDashboard();
        void this.loadBudget();
    }
    setToast(message) {
        this.setState({ toast: message });
        window.setTimeout(() => {
            this.setState((prev) => (prev.toast === message ? { ...prev, toast: null } : prev));
        }, 4000);
    }
    async loadBudget() {
        try {
            const response = await fetch("/whale/api/settings");
            const body = (await response.json());
            if (response.ok && body.ok && typeof body.settings === "number") {
                this.setState({ budgetInput: String(body.settings) });
            }
        }
        catch {
            /* 忽略 */
        }
    }
    async saveBudget() {
        const value = Number(this.state.budgetInput);
        const budget = Number.isFinite(value) && value > 0 ? value : undefined;
        try {
            const response = await fetch("/whale/api/settings", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ budgetWeeklyCny: budget }),
            });
            const body = (await response.json());
            if (!response.ok || body.ok === false)
                throw new Error(body.error?.message ?? "保存失败");
            this.setState({ error: null, showBudgetEdit: false });
            this.setToast("预算已保存");
        }
        catch (error) {
            this.setToast(error instanceof Error ? error.message : String(error));
        }
    }
    /** 仪表盘：当前周期数据（有则复用，无则生成）。 */
    async loadDashboard() {
        this.setState({ loading: true, error: null });
        try {
            const payload = this.state.preset === "custom"
                ? { preset: "custom", from: this.state.from, to: this.state.to }
                : { preset: this.state.preset };
            const response = await fetch("/whale/api/summary", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
            });
            const body = (await response.json());
            if (!response.ok || body.ok === false)
                throw new Error(body.error?.message ?? "生成失败");
            this.setState({ dashboard: body.report, current: body.report, loading: false, view: "dashboard" });
        }
        catch (error) {
            this.setState({ loading: false });
            this.setToast(error instanceof Error ? error.message : String(error));
        }
    }
    async loadHistory() {
        try {
            const body = await api("list");
            this.setState({ history: body.reports });
        }
        catch (error) {
            this.setToast(error instanceof Error ? error.message : String(error));
        }
    }
    async openHistory(id) {
        this.setState({ loading: true, error: null });
        try {
            const response = await fetch(`/whale/api/get?id=${encodeURIComponent(id)}`);
            const json = (await response.json());
            if (!response.ok || json.ok === false)
                throw new Error("报告不存在");
            this.setState({ current: json.report, loading: false, view: "report" });
        }
        catch (error) {
            this.setState({ loading: false });
            this.setToast(error instanceof Error ? error.message : String(error));
        }
    }
    async deleteReport(id) {
        try {
            await api("delete", { id });
            this.setState({ current: null, dashboard: null, history: null, view: "dashboard" });
        }
        catch (error) {
            this.setToast(error instanceof Error ? error.message : String(error));
        }
    }
    render() {
        const { view, preset, loading, error, dashboard, current, history } = this.state;
        return (_jsxs(_Fragment, { children: [_jsxs("div", { "data-whale-report-tabs": true, children: [_jsx("button", { "data-whale-report-tab": true, "data-active": view === "dashboard", onClick: () => this.setState({ view: "dashboard" }), children: "\u6982\u89C8" }), _jsx("button", { "data-whale-report-tab": true, "data-active": view === "report", onClick: () => this.setState({ view: "report" }), children: "\u62A5\u544A" }), _jsx("button", { "data-whale-report-tab": true, "data-active": view === "history", onClick: () => {
                                this.setState({ view: "history" });
                                if (history === null)
                                    void this.loadHistory();
                            }, children: "\u5386\u53F2" })] }), this.state.toast !== null && (_jsx("div", { "data-whale-report-toast": true, children: this.state.toast })), view === "dashboard" && (_jsx(Dashboard, { state: this.state, onPreset: (p) => {
                        this.setState({ preset: p });
                        void this.loadDashboard();
                    }, onCustom: (from, to) => {
                        this.setState({ from, to });
                        void this.loadDashboard();
                    }, onOpenReport: () => this.setState({ view: "report" }), onBudgetToggle: () => this.setState({ showBudgetEdit: !this.state.showBudgetEdit }), onBudgetInput: (v) => this.setState({ budgetInput: v }), onSaveBudget: () => void this.saveBudget() })), view === "report" && current !== null && (_jsx("div", { "data-whale-report-body": true, children: _jsx(ReportView, { report: current, onDelete: (id) => void this.deleteReport(id) }) })), view === "report" && current === null && !loading && (_jsx("div", { "data-whale-report-body": true, children: _jsx("div", { "data-whale-report-empty": true, children: "\u5148\u56DE\u5230\u6982\u89C8\u751F\u6210\u4E00\u4EFD\u62A5\u544A" }) })), view === "history" && history === null && _jsx("div", { "data-whale-report-loading": true, children: "\u52A0\u8F7D\u4E2D\u2026" }), view === "history" && history !== null && history.length === 0 && (_jsx("div", { "data-whale-report-empty": true, children: "\u6682\u65E0\u62A5\u544A" })), view === "history" && history !== null && history.length > 0 && (_jsx("div", { "data-whale-report-body": true, children: history.map((item) => (_jsxs("div", { "data-whale-report-hitem": true, onClick: () => void this.openHistory(item.id), children: [_jsxs("b", { children: [PRESETS.find((p) => p.key === item.preset)?.label ?? item.preset, " \u00B7 ", dateStr(item.from), " ~ ", dateStr(item.to)] }), _jsxs("span", { children: [item.sessions, " \u4F1A\u8BDD \u00B7 ", item.turns, " \u56DE\u5408 \u00B7 ", fmt(item.totalEvents), " \u4E8B\u4EF6 \u00B7 ", dateStr(item.createdAt)] })] }, item.id))) }))] }));
    }
}
/** 概览（打开即报告）：Hero 大数字 + 洞察 Feed + 活跃 + 模型。 */
function Dashboard(props) {
    const { state, onPreset, onCustom, onOpenReport, onBudgetToggle, onBudgetInput, onSaveBudget } = props;
    const { preset, loading, error, dashboard, showBudgetEdit, budgetInput, from, to } = state;
    const report = dashboard;
    const s = report?.stats;
    const cost = report?.cost?.total;
    const delta = report?.prev !== undefined && report.prev.cost > 0 && cost !== undefined
        ? Math.round(((cost - report.prev.cost) / report.prev.cost) * 100)
        : null;
    const levelWeight = { critical: 0, warning: 1, tip: 2 };
    const insights = (report?.insights ?? [])
        .filter((i) => i.level !== "info")
        .sort((a, b) => (levelWeight[a.level] ?? 3) - (levelWeight[b.level] ?? 3));
    const totalTokens = s !== undefined ? s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.reasoning : 0;
    const modelRows = (() => {
        if (s === undefined)
            return [];
        const entries = Object.entries(s.models ?? {}).sort((a, b) => b[1].input + b[1].output + b[1].cacheRead + b[1].reasoning - (a[1].input + a[1].output + a[1].cacheRead + a[1].reasoning));
        const grand = entries.reduce((sum, [, u]) => sum + u.input + u.output + u.cacheRead + u.reasoning, 0);
        return entries.map(([model, u]) => {
            const t = u.input + u.output + u.cacheRead + u.reasoning;
            return { model, share: grand > 0 ? Math.round((t / grand) * 100) : 0, cost: report?.cost?.perModel?.[model] };
        });
    })();
    const budgetUsed = typeof report?.budget === "number" && report.budget > 0 && cost !== undefined
        ? Math.min(1, cost / report.budget)
        : null;
    return (_jsxs("div", { "data-whale-report-body": true, children: [_jsxs("div", { "data-whale-report-brand": true, children: [_jsxs("div", { "data-whale-report-brandname": true, children: ["\u6DF1\u8FF9 ", _jsx("span", { children: "DeepTrace" })] }), _jsx("div", { "data-whale-report-brandtag": true, children: "Your Agent, in numbers." }), _jsx("div", { "data-whale-report-brandactions": true, children: _jsx("button", { "data-whale-report-link": true, onClick: onBudgetToggle, children: typeof cost === "number" && typeof report?.budget === "number" && report.budget > 0 && preset === "weekly"
                                ? `¥${cost.toFixed(2)} / ¥${report.budget.toFixed(2)}`
                                : "预算" }) })] }), showBudgetEdit && (_jsxs("div", { "data-whale-report-budgetedit": true, children: [_jsx("span", { children: "\u5468\u9884\u7B97\uFF08\u00A5\uFF09\uFF1A" }), _jsx("input", { type: "number", min: "0", step: "1", placeholder: "\u5982 50", value: budgetInput, onChange: (e) => onBudgetInput(e.target.value) }), _jsx("button", { "data-whale-report-btn": true, "data-ghost": "true", onClick: onSaveBudget, children: "\u4FDD\u5B58" })] })), _jsx("div", { "data-whale-report-chips": true, children: PRESETS.map((p) => (_jsx("button", { "data-whale-report-chip": true, "data-active": preset === p.key, onClick: () => onPreset(p.key), children: p.label }, p.key))) }), preset === "custom" && (_jsxs("div", { "data-whale-report-inputs": true, children: [_jsx("input", { type: "date", value: from, onChange: (e) => onCustom(e.target.value, to) }), _jsx("input", { type: "date", value: to, onChange: (e) => onCustom(from, e.target.value) })] })), loading && report === null && (_jsxs("div", { "data-whale-report-skeleton": true, children: [_jsx("div", { "data-whale-report-sk-hero": true }), _jsx("div", { "data-whale-report-sk-line": true }), _jsx("div", { "data-whale-report-sk-line": true }), _jsx("div", { "data-whale-report-sk-line": true })] })), !loading && report === null && (_jsx("div", { "data-whale-report-loading": true, children: "\u6682\u65E0\u6570\u636E\uFF0C\u70B9\u51FB\u4E0A\u65B9\u5468\u671F\u751F\u6210" })), report !== null && s !== undefined && (_jsxs(_Fragment, { children: [_jsxs("div", { "data-whale-report-hero": true, children: [_jsx("div", { "data-whale-report-herolabel": true, children: HERO_LABEL[preset] ?? "Agent 消耗" }), _jsxs("div", { "data-whale-report-heroval": true, children: ["\u00A5", typeof cost === "number" ? cost.toFixed(2) : "—"] }), _jsx("div", { "data-whale-report-herodelta2": true, children: delta === null ? (_jsx("span", { className: "muted", children: "\u9996\u6B21\u8BB0\u5F55\uFF0C\u4E0B\u5468\u8D77\u53EF\u5BF9\u6BD4" })) : (_jsxs(_Fragment, { children: [_jsxs("em", { className: delta > 0 ? "up" : "down", children: [delta > 0 ? "↑" : "↓", " ", Math.abs(delta), "%"] }), _jsx("span", { children: " vs \u4E0A\u5468" })] })) }), _jsxs("div", { "data-whale-report-herostat": true, children: [_jsxs("span", { children: [_jsx("b", { children: s.sessions }), " \u4F1A\u8BDD"] }), _jsxs("span", { children: [_jsx("b", { children: fmt(s.toolCallsTotal) }), " \u5DE5\u5177\u8C03\u7528"] }), _jsxs("span", { children: [_jsx("b", { children: fmt(totalTokens) }), " Tokens"] })] })] }), budgetUsed !== null && preset === "weekly" && (_jsxs("div", { "data-whale-report-budget": true, children: [_jsx("div", { "data-whale-report-budgetbar": true, children: _jsx("i", { style: { width: `${budgetUsed * 100}%`, background: budgetUsed >= 1 ? "#dc2626" : budgetUsed >= 0.8 ? "#d97706" : "#4d6bfe" } }) }), _jsxs("span", { children: ["\u00A5", cost.toFixed(2), " / \u00A5", report.budget.toFixed(2), " ", budgetUsed >= 1 ? "超支" : ""] })] })), insights.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { "data-whale-report-h2": true, children: "\u503C\u5F97\u6CE8\u610F" }), _jsx(InsightFeed, { insights: insights.slice(0, 3), stats: s }), insights.length > 3 && (_jsxs("button", { "data-whale-report-feedmore": true, onClick: onOpenReport, children: ["\u8FD8\u6709 ", insights.length - 3, " \u6761\u6D1E\u5BDF\uFF0C\u89C1\u5B8C\u6574\u62A5\u544A \u2192"] }))] })), _jsx("div", { "data-whale-report-h2": true, children: "\u6D3B\u8DC3" }), _jsx("div", { "data-whale-report-card": true, children: _jsx(ActivityStrip, { report: report }) }), modelRows.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { "data-whale-report-h2": true, children: "\u6A21\u578B" }), _jsx("div", { "data-whale-report-card": true, children: modelRows.map((m) => (_jsxs("div", { "data-whale-report-modelrow": true, children: [_jsxs("div", { "data-whale-report-modelhead": true, children: [_jsx("b", { children: m.model }), _jsxs("span", { children: [m.share, "% \u00B7 \u00A5", typeof m.cost === "number" ? m.cost.toFixed(1) : "—"] })] }), _jsx("div", { "data-whale-report-modelbar": true, children: _jsx("i", { style: { width: `${m.share}%`, background: "#4d6bfe" } }) })] }, m.model))) })] })), _jsx("button", { "data-whale-report-btn": true, "data-whale-report-fullbtn": true, onClick: onOpenReport, children: "\u751F\u6210\u5B8C\u6574\u62A5\u544A \u2192" })] }))] }));
}
/** 洞察紧凑 Feed：色点 + 单行标题 + 预览，点击展开。 */
function InsightFeed({ insights, stats }) {
    const [openId, setOpenId] = useState(null);
    return (_jsx("div", { "data-whale-report-feed": true, children: insights.map((insight) => {
            const meta = INSIGHT_META[insight.level] ?? INSIGHT_META.warning;
            const open = openId === insight.id;
            const preview = insightPreview(insight, stats);
            return (_jsxs("div", { "data-whale-report-feedrow": true, onClick: () => setOpenId(open ? null : insight.id), children: [_jsx("i", { "data-whale-report-feeddot": true, style: { background: meta.color } }), _jsxs("div", { "data-whale-report-feedmain": true, children: [_jsx("div", { "data-whale-report-feedtitle": true, children: insight.title }), preview !== null && !open && _jsx("div", { "data-whale-report-feedpreview": true, children: preview }), open && (_jsxs(_Fragment, { children: [_jsx("div", { "data-whale-report-feeddetail": true, children: insight.detail }), _jsx("div", { "data-whale-report-feedaction": true, children: insight.action }), insight.estimate !== undefined && _jsx("div", { "data-whale-report-feedestimate": true, children: insight.estimate })] }))] })] }, insight.id));
        }) }));
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
/** better-sidebar 里的深迹 Tab（与抽屉共用 WhaleContent）。 */
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
        return (_jsxs(_Fragment, { children: [_jsx("button", { "data-whale-report-fab": true, onClick: this.toggle, title: "\u6DF1\u8FF9 DeepTrace", "aria-label": "\u6DF1\u8FF9 DeepTrace" }), _jsxs("div", { "data-whale-report-drawer": true, hidden: !open, children: [_jsxs("div", { "data-whale-report-head": true, children: [_jsx("span", { "data-whale-report-title": true, children: "\u6DF1\u8FF9 DeepTrace" }), _jsx("button", { "data-whale-report-close": true, onClick: this.toggle, "aria-label": "\u5173\u95ED", children: "\u2715" })] }), _jsx("div", { "data-whale-report-body": true, children: _jsx(WhaleContent, {}) })] })] }));
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
    // Tab 优先：better-sidebar 的注册服务存在时，把深迹做进它的工作台。
    // 惰性注入：服务缺失只跳过回调，绝不阻塞装配。
    ctx.inject(["betterSidebar"], (injected) => {
        const service = injected.betterSidebar;
        if (service === undefined)
            return;
        ctx.effect(() => service.registerTab({
            id: "dsh-whale-report:report",
            title: "深迹 DeepTrace",
            order: 90,
            single: true,
            component: () => _jsx(SidebarTab, {}),
        }));
        setTabRegistered(true);
    });
}
//# sourceMappingURL=index.js.map