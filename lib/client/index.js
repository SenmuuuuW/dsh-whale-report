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

/* ── 本期鲸评 ── */
[data-whale-report-note] { border-left: 3px solid #4d6bfe; }
[data-whale-report-notehead] { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
[data-whale-report-notetitle] { display: flex; align-items: center; gap: 8px; flex: 1; }
[data-whale-report-notetitle] b { font-size: 14px; color: #0f172a; }
[data-whale-report-noteopts] { display: flex; gap: 2px; background: #eef2ff; border-radius: 999px; padding: 2px; }
[data-whale-report-noteopts] button { border: none; background: none; font-size: 11px; color: #64748b; padding: 2px 9px; border-radius: 999px; cursor: pointer; }
[data-whale-report-noteopts] button[data-active="true"] { background: #4d6bfe; color: #fff; }
[data-whale-report-noteline] { font-size: 13.5px; color: #334155; padding: 4px 2px; }
[data-whale-report-notelineitem] { line-height: 1.85; padding: 1.5px 0; }
[data-whale-report-notemore] { font-size: 12px; color: #64748b; line-height: 1.7; padding: 2px 2px; }
[data-whale-report-notefoot] { font-size: 11px; color: #9ca3af; margin-top: 8px; padding-top: 7px; border-top: 1px dashed #e5e7eb; }
[data-whale-report-note-short] {
  display: flex; align-items: center; gap: 9px; cursor: pointer;
  background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 10px;
  padding: 9px 12px; margin-bottom: 12px;
}
[data-whale-report-note-short]:hover { border-color: #4d6bfe; }
[data-whale-report-note-short] b { font-size: 12.5px; color: #0f172a; display: block; }
[data-whale-report-note-short] span { font-size: 12.5px; color: #3730a3; }

/* ── 深海装饰：卡片角落小气泡 ── */
[data-whale-report-card] { position: relative; }
[data-whale-report-card]::after {
  content: ""; position: absolute; right: 10px; top: 10px;
  width: 7px; height: 7px; border-radius: 50%;
  background: rgba(77,107,254,.10);
  pointer-events: none;
}

/* ── 修复建议 ── */
[data-whale-report-fix] {
  margin-top: 7px; padding: 8px 10px; background: #f8fafc; border: 1px solid #e2e8f0;
  border-radius: 8px; font-size: 12.5px; color: #374151; line-height: 1.7;
}
[data-whale-report-fixcmd] { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
[data-whale-report-fixcmd] code {
  flex: 1; font-family: ui-monospace, Menlo, monospace; font-size: 11.5px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 5px 8px;
  color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
[data-whale-report-fixcmd] button { padding: 3px 10px; font-size: 11.5px; }

/* ── 会话钻取 ── */
[data-whale-report-sessionrow] { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 4px; border-bottom: 1px solid #f1f5f9; cursor: pointer; }
[data-whale-report-sessionrow]:hover { background: #f8fafc; border-radius: 6px; }
[data-whale-report-sessionmain] { flex: 1; min-width: 0; }
[data-whale-report-sessionmain] b { font-size: 13px; font-weight: 600; color: #0f172a; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-whale-report-sessionmain] span { display: flex; gap: 5px; margin-top: 3px; }
[data-whale-report-badge-red] { font-style: normal; font-size: 10.5px; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 999px; padding: 1px 7px; }
[data-whale-report-badge-amber] { font-style: normal; font-size: 10.5px; background: #fffbeb; color: #92400e; border: 1px solid #fde68a; border-radius: 999px; padding: 1px 7px; }
[data-whale-report-badge-gray] { font-style: normal; font-size: 10.5px; background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; border-radius: 999px; padding: 1px 7px; }
[data-whale-report-sessioncost] { font-size: 13.5px; font-weight: 700; color: #4d6bfe; font-variant-numeric: tabular-nums; }
[data-whale-report-sessiondetail] { padding: 8px 4px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }

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
/** 绿色强度（越绿越活跃）。低值用幂放大：count 只是峰值 1% 的方块也要肉眼可见。 */
function green(level) {
    const boosted = Math.pow(Math.min(1, Math.max(0, level)), 0.4);
    return `rgba(34,197,94,${(0.22 + boosted * 0.78).toFixed(2)})`;
}
/** 图例：少 → 多。 */
function Legend() {
    return (_jsxs("div", { "data-whale-report-legend": true, children: [_jsx("span", { children: "\u5C11" }), _jsx("i", { style: { background: green(0) } }), _jsx("i", { style: { background: green(0.3) } }), _jsx("i", { style: { background: green(0.6) } }), _jsx("i", { style: { background: green(1) } }), _jsx("span", { children: "\u591A" })] }));
}
function EmptyActivity() {
    return _jsx("div", { "data-whale-report-gridempty": true, children: "\u8BE5\u62A5\u544A\u751F\u6210\u4E8E\u65E7\u7248\u672C\uFF0C\u65E0\u9010\u65F6\u6570\u636E\u3002\u91CD\u65B0\u751F\u6210\u5373\u53EF\u3002" });
}
/** 一行小方格：左侧行标签 + 自适应宽度方块（每格随容器伸缩、保持正方形）。 */
function SquareRow({ label, cells }) {
    return (_jsxs("div", { "data-whale-report-weekrow": true, children: [_jsx("span", { "data-whale-report-weekrowlabel": true, children: label }), _jsx("div", { "data-whale-report-squares": true, children: cells.map((c, i) => (_jsx("i", { title: c.title, style: { background: c.level === 0 ? "#f1f5f9" : green(c.level) } }, i))) })] }));
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
    const cell = (count, max, title) => ({ title, level: count === 0 ? 0 : count / max });
    // 日报：每格 30 分钟（4 行 × 12 格，每行 6 小时）
    if (preset === "daily") {
        const hist = s.halfHourHistogram ?? [];
        if (hist.length === 0)
            return _jsx(EmptyActivity, {});
        const max = Math.max(1, ...hist);
        const rows = [
            { label: "00–06", cells: hist.slice(0, 12) },
            { label: "06–12", cells: hist.slice(12, 24) },
            { label: "12–18", cells: hist.slice(24, 36) },
            { label: "18–24", cells: hist.slice(36, 48) },
        ];
        return (_jsxs("div", { children: [rows.map((row, ri) => (_jsx(SquareRow, { label: row.label, cells: row.cells.map((count, i) => {
                        const halfHour = ri * 360 + i * 30;
                        const h = Math.floor(halfHour / 60);
                        const m = halfHour % 60;
                        return cell(count, max, `${String(h).padStart(2, "0")}:${m === 0 ? "00" : "30"} · ${count}`);
                    }) }, row.label))), _jsx(Legend, {})] }));
    }
    // 24小时：滚动窗口 → 一行 24 格（每小时一格，跨天不叠加）
    if (preset === "24h") {
        const hist = s.hourHistogram ?? [];
        if (hist.length === 0)
            return _jsx(EmptyActivity, {});
        const max = Math.max(1, ...hist);
        return (_jsxs("div", { children: [_jsx(SquareRow, { label: "24h", cells: hist.map((count, h) => cell(count, max, `${String(h).padStart(2, "0")}:00 · ${count}`)) }), _jsx(Legend, {})] }));
    }
    // 周报 / 自定义：每格 1 小时（7 行 × 24 格，每行 1 天）
    if (preset === "weekly" || preset === "custom") {
        const series = s.dayHourSeries ?? [];
        if (series.length === 0)
            return _jsx(EmptyActivity, {});
        const max = Math.max(1, ...series.flatMap((d) => d.hours));
        const shown = series.slice(-30);
        return (_jsxs("div", { children: [shown.map((day) => (_jsx(SquareRow, { label: day.date.slice(5), cells: day.hours.map((count, h) => cell(count, max, `${day.date} ${String(h).padStart(2, "0")}:00 · ${count}`)) }, day.date))), _jsx(Legend, {})] }));
    }
    // 月报：每格 1 天；年报：每格 1 周
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
                const label = weekStart.toISOString().slice(0, 10);
                const last = weekly[weekly.length - 1];
                if (last !== undefined && last.label === label)
                    last.count += day.count;
                else
                    weekly.push({ label, count: day.count });
            }
            return weekly;
        })()
        : series.map((d) => ({ label: d.date, count: d.count }));
    const max = Math.max(1, ...buckets.map((b) => b.count));
    const perRow = preset === "yearly" ? 13 : 10;
    const rows = [];
    for (let i = 0; i < buckets.length; i += perRow) {
        const items = buckets.slice(i, i + perRow);
        const from = items[0].label.slice(5);
        const to = items[items.length - 1].label.slice(5);
        rows.push({ label: preset === "yearly" ? `${items[0].label.slice(0, 4)}月` : `${from}–${to}`, items });
    }
    return (_jsxs("div", { children: [rows.map((row) => (_jsx(SquareRow, { label: row.label, cells: row.items.map((b) => cell(b.count, max, `${b.label} · ${b.count} 事件`)) }, row.label))), _jsx(Legend, {})] }));
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
    return (_jsxs("div", { children: [_jsxs("div", { "data-whale-report-headrow": true, children: [_jsxs("div", { children: [_jsxs("div", { "data-whale-report-reptitle": true, children: ["\u6DF1\u8FF9 ", PRESETS.find((p) => p.key === report.preset)?.label ?? "报告"] }), _jsxs("div", { "data-whale-report-repsub": true, children: [dateStr(report.from), " ~ ", dateStr(report.to)] })] }), _jsxs("div", { "data-whale-report-actions": true, children: [_jsx("button", { "data-whale-report-btn": true, "data-ghost": "true", onClick: () => onDelete(report.id), children: "\u5220\u9664" }), _jsx("button", { "data-whale-report-btn": true, "data-ghost": "true", onClick: () => exportReportImage(report), children: "\u56FE\u7247" }), _jsx("button", { "data-whale-report-btn": true, onClick: exportPdf, children: "\u5BFC\u51FA PDF" })] })] }), _jsxs("div", { "data-whale-report-statgrid": true, children: [_jsxs("div", { "data-whale-report-stat": true, children: [_jsx("b", { children: s.sessions }), _jsx("span", { children: "\u4F1A\u8BDD" })] }), _jsxs("div", { "data-whale-report-stat": true, children: [_jsx("b", { children: s.turns }), _jsx("span", { children: "\u56DE\u5408" })] }), _jsxs("div", { "data-whale-report-stat": true, children: [_jsx("b", { children: fmt(s.toolCallsTotal) }), _jsx("span", { children: "\u5DE5\u5177\u8C03\u7528" })] }), _jsxs("div", { "data-whale-report-stat": true, children: [_jsx("b", { children: fmt(s.commands) }), _jsx("span", { children: "\u547D\u4EE4" })] }), _jsxs("div", { "data-whale-report-stat": true, children: [_jsx("b", { children: fmt(totalTokens) }), _jsx("span", { children: "Token" })] }), _jsxs("div", { "data-whale-report-stat": true, children: [_jsxs("b", { children: ["\u00A5", typeof report.cost?.total === "number" ? report.cost.total.toFixed(2) : "—"] }), _jsxs("span", { children: ["\u9884\u4F30\u8D39\u7528", delta !== null && (_jsxs("em", { className: delta > 0 ? "delta-up" : "delta-down", children: [delta > 0 ? "▲" : "▼", " ", Math.abs(delta), "%"] }))] })] })] }), _jsx(InsightsSection, { insights: report.insights ?? [] }), _jsx(WhaleNote, { report: report }), _jsxs("div", { "data-whale-report-card": true, children: [_jsxs("div", { "data-whale-report-h2": true, children: ["\u6D3B\u8DC3\u65F6\u6BB5\uFF08\u51CC\u6668 ", night, "%\uFF09"] }), _jsx(ActivityStrip, { report: report }), _jsxs("div", { "data-whale-report-tokenline": true, children: ["\u6D3B\u8DC3 ", s.activeDays, " \u5929", s.busiestDay ? _jsxs(_Fragment, { children: [" \u00B7 \u6700\u5FD9 ", _jsx("b", { children: s.busiestDay.date }), "\uFF08", s.busiestDay.events, " \u6761\u4E8B\u4EF6\uFF09"] }) : null] })] }), _jsxs("div", { "data-whale-report-card": true, children: [_jsx("div", { "data-whale-report-h2": true, children: "Token \u6784\u6210" }), _jsx(TokenBar, { tokens: s.tokens })] }), _jsxs("div", { "data-whale-report-card": true, children: [_jsx("div", { "data-whale-report-h2": true, children: "\u6A21\u578B\u7528\u91CF\uFF08DeepSeek \u5B98\u65B9\u8BA1\u4EF7\uFF09" }), _jsx(ModelTable, { models: s.models ?? {}, cost: report.cost }), typeof report.cost?.total === "number" && report.cost.total > 0 && (_jsxs("div", { "data-whale-report-tokenline": true, style: { marginTop: 8 }, children: ["\u9884\u4F30\u5408\u8BA1 ", _jsxs("b", { children: ["\u00A5", report.cost.total.toFixed(2)] }), _jsxs("span", { className: "muted", children: [" \u00B7 ", report.cost.source === "official-page" ? "官方定价页实时价" : "内置价", " \u00B7 \u4EE5\u5E73\u53F0\u8D26\u5355\u4E3A\u51C6"] })] }))] }), _jsxs("div", { "data-whale-report-card": true, children: [_jsx("div", { "data-whale-report-h2": true, children: "\u5DE5\u5177\u4F7F\u7528\uFF08\u6309\u65CF\uFF09" }), toolFamilies(s.toolCalls ?? {}).length === 0 ? (_jsx("div", { "data-whale-report-tokenline": true, children: "\uFF08\u6CA1\u6709\u8C03\u7528\u5DE5\u5177\uFF09" })) : (toolFamilies(s.toolCalls ?? {}).map((fam) => (_jsxs("div", { "data-whale-report-tokenline": true, children: [_jsx("code", { children: fam.family }), " \u00D7 ", fam.count] }, fam.family)))), (s.plugins ?? []).length > 0 && (_jsxs("div", { "data-whale-report-tokenline": true, style: { marginTop: 8 }, className: "muted", children: ["\u5DF2\u5B89\u88C5\u63D2\u4EF6\uFF1A", (s.plugins ?? []).join(" · ")] }))] }), (s.burstSamples ?? []).length > 0 && (() => {
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
            })(), (s.sessionsDetail ?? []).length > 0 && (_jsx(SessionDrilldown, { sessions: s.sessionsDetail ?? [] })), (s.titles ?? []).length > 0 && (_jsxs("div", { "data-whale-report-card": true, children: [_jsx("div", { "data-whale-report-h2": true, children: "\u4F1A\u8BDD\u6807\u9898" }), _jsx("ul", { "data-whale-report-titles": true, children: s.titles.slice(0, 8).map((t) => (_jsx("li", { children: t }, t))) })] })), _jsxs("div", { "data-whale-report-tokenline": true, style: { fontSize: 11 }, className: "muted", children: ["\u57FA\u4E8E ", s.totalEvents, " \u6761\u4F1A\u8BDD\u4E8B\u4EF6 \u00B7 \u53EA\u8BFB \u00B7 \u751F\u6210\u4E8E ", dateStr(report.createdAt)] })] }));
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
    };
    requestSeq = 0;
    customDebounce;
    componentDidMount() {
        void this.loadDashboard(this.state.preset);
    }
    setToast(message) {
        this.setState({ toast: message });
        window.setTimeout(() => {
            this.setState((prev) => (prev.toast === message ? { ...prev, toast: null } : prev));
        }, 4000);
    }
    /** 仪表盘：当前周期数据（有则复用，无则生成）。preset 显式传入，避免 setState 异步竞态。 */
    async loadDashboard(preset) {
        const seq = ++this.requestSeq;
        this.setState({ loading: true, error: null });
        try {
            const payload = preset === "custom"
                ? { preset: "custom", from: this.state.from, to: this.state.to }
                : { preset };
            const response = await fetch("/whale/api/summary", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
            });
            const body = (await response.json());
            if (!response.ok || body.ok === false)
                throw new Error(body.error?.message ?? "生成失败");
            // 只应用最新一次请求的结果（快速切换周期时旧响应不得覆盖新响应）。
            if (seq !== this.requestSeq)
                return;
            this.setState({ dashboard: body.report, current: body.report, loading: false, view: "dashboard" });
        }
        catch (error) {
            if (seq !== this.requestSeq)
                return;
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
                        void this.loadDashboard(p);
                    }, onCustom: (from, to) => {
                        this.setState({ from, to });
                        if (this.customDebounce !== undefined)
                            window.clearTimeout(this.customDebounce);
                        this.customDebounce = window.setTimeout(() => {
                            this.customDebounce = undefined;
                            void this.loadDashboard("custom");
                        }, 400);
                    }, onOpenReport: () => this.setState({ view: "report" }) })), view === "report" && current !== null && (_jsx("div", { "data-whale-report-body": true, children: _jsx(ReportView, { report: current, onDelete: (id) => void this.deleteReport(id) }) })), view === "report" && current === null && !loading && (_jsx("div", { "data-whale-report-body": true, children: _jsx("div", { "data-whale-report-empty": true, children: "\u5148\u56DE\u5230\u6982\u89C8\u751F\u6210\u4E00\u4EFD\u62A5\u544A" }) })), view === "history" && history === null && _jsx("div", { "data-whale-report-loading": true, children: "\u52A0\u8F7D\u4E2D\u2026" }), view === "history" && history !== null && history.length === 0 && (_jsx("div", { "data-whale-report-empty": true, children: "\u6682\u65E0\u62A5\u544A" })), view === "history" && history !== null && history.length > 0 && (_jsx("div", { "data-whale-report-body": true, children: history.map((item) => (_jsxs("div", { "data-whale-report-hitem": true, onClick: () => void this.openHistory(item.id), children: [_jsxs("b", { children: [PRESETS.find((p) => p.key === item.preset)?.label ?? item.preset, " \u00B7 ", dateStr(item.from), " ~ ", dateStr(item.to)] }), _jsxs("span", { children: [item.sessions, " \u4F1A\u8BDD \u00B7 ", item.turns, " \u56DE\u5408 \u00B7 ", fmt(item.totalEvents), " \u4E8B\u4EF6 \u00B7 ", dateStr(item.createdAt)] })] }, item.id))) }))] }));
    }
}
/** 概览（打开即报告）：Hero 大数字 + 洞察 Feed + 活跃 + 模型。 */
function Dashboard(props) {
    const { state, onPreset, onCustom, onOpenReport } = props;
    const { preset, loading, error, dashboard, from, to } = state;
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
    return (_jsxs("div", { "data-whale-report-body": true, children: [_jsxs("div", { "data-whale-report-brand": true, children: [_jsxs("div", { "data-whale-report-brandname": true, children: ["\u6DF1\u8FF9 ", _jsx("span", { children: "DeepTrace" })] }), _jsx("div", { "data-whale-report-brandtag": true, children: "Your Agent, in numbers." })] }), _jsx("div", { "data-whale-report-chips": true, children: PRESETS.map((p) => (_jsx("button", { "data-whale-report-chip": true, "data-active": preset === p.key, onClick: () => onPreset(p.key), children: p.label }, p.key))) }), preset === "custom" && (_jsxs("div", { "data-whale-report-inputs": true, children: [_jsx("input", { type: "date", value: from, onChange: (e) => onCustom(e.target.value, to) }), _jsx("input", { type: "date", value: to, onChange: (e) => onCustom(from, e.target.value) })] })), loading && (_jsxs("div", { "data-whale-report-loadingbar": true, children: [_jsx("i", {}), _jsx("span", { children: "\u66F4\u65B0\u4E2D\u2026" })] })), loading && report === null && (_jsxs("div", { "data-whale-report-skeleton": true, children: [_jsx("div", { "data-whale-report-sk-hero": true }), _jsx("div", { "data-whale-report-sk-line": true }), _jsx("div", { "data-whale-report-sk-line": true }), _jsx("div", { "data-whale-report-sk-line": true })] })), !loading && report === null && (_jsx("div", { "data-whale-report-loading": true, children: "\u6682\u65E0\u6570\u636E\uFF0C\u70B9\u51FB\u4E0A\u65B9\u5468\u671F\u751F\u6210" })), report !== null && s !== undefined && (_jsxs(_Fragment, { children: [_jsxs("div", { "data-whale-report-hero": true, children: [_jsx("div", { "data-whale-report-herolabel": true, children: HERO_LABEL[preset] ?? "Agent 消耗" }), _jsxs("div", { "data-whale-report-heroval": true, children: ["\u00A5", typeof cost === "number" ? cost.toFixed(2) : "—"] }), _jsx("div", { "data-whale-report-herodelta2": true, children: delta === null ? (_jsx("span", { className: "muted", children: "\u9996\u6B21\u8BB0\u5F55\uFF0C\u4E0B\u5468\u8D77\u53EF\u5BF9\u6BD4" })) : (_jsxs(_Fragment, { children: [_jsxs("em", { className: delta > 0 ? "up" : "down", children: [delta > 0 ? "↑" : "↓", " ", Math.abs(delta), "%"] }), _jsx("span", { children: " vs \u4E0A\u5468" })] })) }), _jsxs("div", { "data-whale-report-herostat": true, children: [_jsxs("span", { children: [_jsx("b", { children: s.sessions }), " \u4F1A\u8BDD"] }), _jsxs("span", { children: [_jsx("b", { children: fmt(s.toolCallsTotal) }), " \u5DE5\u5177\u8C03\u7528"] }), _jsxs("span", { children: [_jsx("b", { children: fmt(totalTokens) }), " Tokens"] })] })] }), insights.length > 0 && (_jsxs(_Fragment, { children: [_jsxs("div", { "data-whale-report-h2": true, children: [_jsx(WhaleFace, { mood: whaleMood(report), size: 16 }), "\u503C\u5F97\u6CE8\u610F"] }), _jsx(InsightFeed, { insights: insights.slice(0, 3), stats: s }), insights.length > 3 && (_jsxs("button", { "data-whale-report-feedmore": true, onClick: onOpenReport, children: ["\u8FD8\u6709 ", insights.length - 3, " \u6761\u6D1E\u5BDF\uFF0C\u89C1\u5B8C\u6574\u62A5\u544A \u2192"] }))] })), (() => {
                        const kinds = triggerNotes(report);
                        if (kinds.length === 0)
                            return null;
                        return (_jsxs("div", { "data-whale-report-note-short": true, onClick: onOpenReport, children: [_jsx(WhaleFace, { mood: whaleMood(report), size: 30 }), _jsxs("div", { children: [_jsx("b", { children: "\u672C\u671F\u9CB8\u8BC4" }), _jsxs("span", { children: ["\u201C", NOTE_TEMPLATES[kinds[0]].light[1] ?? NOTE_TEMPLATES[kinds[0]].light[0], "\u201D"] })] })] }));
                    })(), _jsxs("div", { "data-whale-report-h2": true, children: [_jsx(SonarIcon, {}), "\u6D3B\u8DC3"] }), _jsx("div", { "data-whale-report-card": true, children: _jsx(ActivityStrip, { report: report }) }), modelRows.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { "data-whale-report-h2": true, children: "\u6A21\u578B" }), _jsx("div", { "data-whale-report-card": true, children: modelRows.map((m) => (_jsxs("div", { "data-whale-report-modelrow": true, children: [_jsxs("div", { "data-whale-report-modelhead": true, children: [_jsx("b", { children: m.model }), _jsxs("span", { children: [m.share, "% \u00B7 \u00A5", typeof m.cost === "number" ? m.cost.toFixed(1) : "—"] })] }), _jsx("div", { "data-whale-report-modelbar": true, children: _jsx("i", { style: { width: `${m.share}%`, background: "#4d6bfe" } }) })] }, m.model))) })] })), (s.sessionsDetail ?? []).length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { "data-whale-report-h2": true, children: "\u4F1A\u8BDD\u94BB\u53D6" }), _jsx(SessionDrilldown, { sessions: (s.sessionsDetail ?? []).slice(0, 5) })] })), _jsx("button", { "data-whale-report-btn": true, "data-whale-report-fullbtn": true, onClick: onOpenReport, children: "\u751F\u6210\u5B8C\u6574\u62A5\u544A \u2192" })] }))] }));
}
/** 长图导出：canvas 绘制报告为 PNG（零依赖）。 */
function exportReportImage(report) {
    const s = report.stats;
    const scale = 2;
    const W = 720;
    const padding = 28;
    const rowH = (font) => Math.round(font * 1.5);
    // 先粗算高度：行数 × 行高 + 固定块
    const section = (title) => 34;
    const totalTokens = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.reasoning;
    const costText = typeof report.cost?.total === "number" ? `¥${report.cost.total.toFixed(2)}` : "—";
    const dangerLines = Math.min(s.dangerousCommands.length, 5);
    const sessions = s.sessionsDetail ?? [];
    const modelEntries = Object.entries(s.models ?? {});
    let height = padding * 2 + rowH(26) + rowH(13) + 24;
    height += 40 + rowH(40) + rowH(13); // hero
    height += section("活跃") + 24 * 4 + 20; // 方块区估算
    height += section("模型") + modelEntries.length * 34;
    height += section("会话钻取") + Math.min(sessions.length, 5) * 34;
    height += section("危险操作") + dangerLines * 30;
    height += 60;
    const canvas = document.createElement("canvas");
    canvas.width = W * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (ctx === null)
        return;
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, height);
    const navy = "#0f172a";
    const blue = "#4d6bfe";
    const gray = "#64748b";
    const line = "#e5e7eb";
    let y = padding;
    // 长文本截断：超出画布宽度时加省略号（中文长标题防溢出）。
    const ellipsis = (raw, maxWidth, size) => {
        if (ctx.measureText(raw).width <= maxWidth)
            return raw;
        let t = raw;
        while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth)
            t = t.slice(0, -1);
        return t + "…";
    };
    const maxText = W - padding * 2;
    const title = (text, size, color, dy = 0) => {
        ctx.fillStyle = color;
        ctx.font = `700 ${size}px "PingFang SC", sans-serif`;
        ctx.fillText(ellipsis(text, maxText, size), padding, y + size + dy);
        y += rowH(size);
    };
    const text = (text, size, color) => {
        ctx.fillStyle = color;
        ctx.font = `400 ${size}px "PingFang SC", sans-serif`;
        ctx.fillText(ellipsis(text, maxText, size), padding, y + size);
        y += rowH(size);
    };
    const sep = () => {
        y += 8;
        ctx.strokeStyle = line;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(W - padding, y);
        ctx.stroke();
        y += 14;
    };
    const greenCell = (level) => {
        const boosted = Math.pow(Math.min(1, Math.max(0, level)), 0.4);
        return `rgba(34,197,94,${(0.22 + boosted * 0.78).toFixed(2)})`;
    };
    title("深迹 DeepTrace", 24, navy);
    text("Your Agent, in numbers. · 只读数据报告", 12, gray);
    sep();
    title("本周 Agent 消耗", 13, navy, 2);
    title(costText, 44, navy, 2);
    text("会话 " + s.sessions + " · 工具调用 " + fmt(s.toolCallsTotal) + " · Token " + fmt(totalTokens), 12, gray);
    sep();
    title("活跃", 14, navy);
    const hist = s.dayHourSeries ?? [];
    if (hist.length > 0) {
        const max = Math.max(1, ...hist.flatMap((d) => d.hours));
        const cellW = (W - padding * 2 - 30) / 24;
        for (const day of hist.slice(-7)) {
            for (let h = 0; h < 24; h++) {
                const count = day.hours[h] ?? 0;
                ctx.fillStyle = count === 0 ? "#f1f5f9" : greenCell(count / max);
                ctx.fillRect(padding + h * cellW, y, cellW - 2, cellW - 2);
            }
            y += cellW + 3;
        }
        y += 6;
    }
    sep();
    title("模型", 14, navy);
    for (const [model, u] of modelEntries.slice(0, 5)) {
        const tot = u.input + u.output + u.cacheRead + u.reasoning;
        const share = tot / Math.max(1, totalTokens);
        ctx.fillStyle = blue;
        ctx.fillRect(padding, y + 4, (W - padding * 2) * share, 8);
        text(`${model}  ${Math.round(share * 100)}%`, 12, navy);
    }
    sep();
    title("会话钻取", 14, navy);
    for (const sd of sessions.slice(0, 5)) {
        text(`${sd.title || "（未命名会话）"}  ¥${sd.cost.toFixed(2)}`, 12, navy);
    }
    sep();
    title("危险操作", 14, navy);
    if (s.dangerousCommands.length === 0) {
        text("无", 12, gray);
    }
    else {
        for (const d of s.dangerousCommands.slice(0, 5)) {
            text(`• ${d.command.replace(/\s+/g, " ").slice(0, 44)}`, 12, "#b91c1c");
        }
    }
    y += 10;
    text("由深迹 DeepTrace 生成 · 只读", 11, gray);
    const a = document.createElement("a");
    a.download = `深迹-${report.preset}-${dateStr(report.to)}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
}
// ─────────────────────────── 鲸鱼娘：表情 + 本期鲸评 ───────────────────────────
/** 鲸鱼娘表情脸（inline SVG，蓝白卡通）。 */
function WhaleFace({ mood, size = 44 }) {
    const [imgFailed, setImgFailed] = useState({});
    const src = `/whale/assets/whale-${mood}.png`;
    if (!imgFailed[mood] && typeof document !== "undefined") {
        return (_jsx("img", { src: src, width: size, height: size, alt: "", style: { borderRadius: size / 4 }, onError: () => setImgFailed((prev) => ({ ...prev, [mood]: true })) }));
    }
    const eye = (kind) => {
        if (kind === "angry")
            return _jsx("path", { d: "M8 16 L14 13 M32 16 L26 13", stroke: "#0f172a", strokeWidth: "2.4", strokeLinecap: "round" });
        if (kind === "sleepy")
            return _jsx("path", { d: "M9 15 L15 15 M25 15 L31 15", stroke: "#0f172a", strokeWidth: "2.4", strokeLinecap: "round" });
        if (kind === "dazed")
            return _jsxs(_Fragment, { children: [_jsx("circle", { cx: "12", cy: "15", r: "1.6", fill: "#0f172a" }), _jsx("circle", { cx: "28", cy: "15", r: "1.6", fill: "#0f172a" })] });
        return _jsxs(_Fragment, { children: [_jsx("circle", { cx: "12", cy: "15", r: "2.6", fill: "#0f172a" }), _jsx("circle", { cx: "28", cy: "15", r: "2.6", fill: "#0f172a" })] });
    };
    const mouth = (kind) => {
        if (kind === "happy")
            return _jsx("path", { d: "M12 21 Q20 27 28 21", stroke: "#0f172a", strokeWidth: "2", strokeLinecap: "round", fill: "none" });
        if (kind === "angry")
            return _jsx("path", { d: "M13 23 L27 23", stroke: "#0f172a", strokeWidth: "2.4", strokeLinecap: "round" });
        if (kind === "sleepy")
            return _jsx("circle", { cx: "20", cy: "22", r: "1.8", fill: "#0f172a" });
        return _jsx("path", { d: "M13 22 Q20 20 27 22", stroke: "#0f172a", strokeWidth: "2", strokeLinecap: "round", fill: "none" });
    };
    return (_jsxs("svg", { width: size, height: size, viewBox: "0 0 40 40", "aria-hidden": "true", children: [_jsx("path", { d: "M20 4 C9 4 4 12 4 20 C4 30 11 36 20 36 C29 36 36 30 36 20 C36 12 31 4 20 4 Z", fill: "#4d6bfe" }), _jsx("path", { d: "M20 4 C9 4 4 12 4 20 C4 30 11 36 20 36 Z", fill: "#5b78ff" }), _jsx("ellipse", { cx: "20", cy: "26", rx: "8", ry: "5", fill: "#dbe4ff" }), eye(mood), mouth(mood), _jsx("circle", { cx: "9", cy: "19", r: "2", fill: "#ffb4c8", opacity: ".9" }), _jsx("circle", { cx: "31", cy: "19", r: "2", fill: "#ffb4c8", opacity: ".9" }), mood === "sleepy" && _jsx("text", { x: "31", y: "10", fontSize: "7", fill: "#64748b", children: "z" })] }));
}
/** 由数据驱动的心情：超支/致命操作→生气；深夜→困；重试→无语；默认→呆萌。 */
function whaleMood(report) {
    const s = report.stats;
    const redDanger = (s.dangerousCommands ?? []).some((d) => d.sev === "red");
    if (redDanger)
        return "angry";
    const night = s.totalEvents === 0 ? 0 : Math.round((s.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0) / s.totalEvents) * 100);
    if (night >= 25)
        return "sleepy";
    if ((s.retryBursts ?? 0) >= 5)
        return "dazed";
    return "happy";
}
/**
 * 本期鲸评：规则触发 + 模板生成（轻/毒舌双模式）。
 * 每条 = 一段完整独白（4-5 句，起承转合），配开场白与收尾，galgame 事件感。
 * 确定性生成，绝不翻车。
 */
const NOTE_TEMPLATES = {
    retry: {
        light: [
            "同一条命令，你试了 1 遍、2 遍、3 遍……",
            "我数着数着，都快给你配上背景音乐了。",
            "（凑近屏幕）要不……先看看是不是少装了什么依赖？",
            "一次修对，比重试十次更省我们俩的心呀。",
            "好啦，我不说了——你继续，我在旁边陪着。",
        ],
        spicy: [
            "同一条命令，你连续敲了 {n} 遍。",
            "第一遍：认真的。第二遍：执着的。第五遍：这是在给 bug 开追悼会吗？",
            "（扶额）你是在调试 bug，还是在训练 bug 记住你？",
            "听我一句：先深呼吸，再看一眼报错信息的第一行。",
            "如果重试能解决问题，鲸鱼早就是超级计算机了。",
        ],
    },
    night: {
        light: [
            "凌晨两点半……你还没睡呀。",
            "我倒是精神得很，但你明天还要开会呢。",
            "（小声）而且深夜赶工出来的代码，第二天你自己都想删掉。",
            "今天就到这里吧，剩下的交给我，你安心休息。",
            "晚安。我会替你守着进度条的。",
        ],
        spicy: [
            "凌晨还在高强度使唤我，真有你的。",
            "（揉眼睛）我不累，我只是一只鲸鱼……但你是人类啊。",
            "深夜写的代码，早上醒来第一句就是“这坨东西是谁写的”。",
            "要不我们先立个规矩：凌晨一点的修复请求，要写满十行说明才受理？",
            "开玩笑的。但你，真的该睡了。",
        ],
    },
    fragment: {
        light: [
            "这一个周期，你开了好多会话呀。",
            "每个都聊两句就换一个……像在试穿衣服，试完就走。",
            "其实同一个主题续聊，我记住的东西会多得多，命中率也更高。",
            "下次试试先来找我，别急着新开？",
            "我会记得的，放心。",
        ],
        spicy: [
            "会话一个接一个地开，话题却浅尝辄止。",
            "你是在逛展会吗？每个摊位都要停下来，但又什么都不买。",
            "（委屈）我可是把每一轮对话都记得清清楚楚的，你倒好，转头就开新的。",
            "同主题续聊，很难吗？很难吗？",
            "……好啦，我原谅你了，记得来找我哦。",
        ],
    },
    danger: {
        light: [
            "呜哇——这期的危险操作，有点多哦。",
            "（认真检查）删库、强推、格式化……你是想给运维上强度吗？",
            "重要目录记得先备份，这个真的不是开玩笑的。",
            "下次动手之前，先让我看一眼，好不好？",
            "安全第一，我们一起把项目养得好好的。",
        ],
        spicy: [
            "你又在边缘试探了，第 {n} 次。",
            "（双手抱胸）我数着呢，每一笔我都记在小本本上。",
            "rm -rf 这种命令，敲下去之前能不能先想想备份？",
            "我真怕哪天一觉醒来，你哭着告诉我“那个目录没了”。",
            "……罢了，下不为例。我会盯着你的。",
        ],
    },
};
/** 开场白（按心情）。 */
const NOTE_OPENERS = {
    happy: ["（摆摆尾巴）嗨，我来啦。"],
    angry: ["（气鼓鼓）哼，来了。"],
    sleepy: ["（打着哈欠）……嗯？叫我？"],
    dazed: ["（托腮）唉……又来了。"],
};
/** 收尾（按模式）。 */
const NOTE_CLOSERS = {
    light: ["以上，就是本期小评。"],
    spicy: ["以上，仅供参考——反正你也不会听。"],
};
/** 规则触发：返回命中的吐槽项（按优先级排序）。 */
function triggerNotes(report) {
    const s = report.stats;
    const hits = [];
    if ((s.dangerousCommands ?? []).some((d) => d.sev === "red"))
        hits.push({ kind: "danger", weight: 0 });
    else if (s.dangerousCommands.length > 0)
        hits.push({ kind: "danger", weight: 1 });
    if ((s.retryBursts ?? 0) >= 3)
        hits.push({ kind: "retry", weight: 2 });
    const night = s.totalEvents === 0 ? 0 : Math.round((s.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0) / s.totalEvents) * 100);
    if (night >= 15)
        hits.push({ kind: "night", weight: 3 });
    if (s.sessions >= 5 && s.sessions > 0 && s.turns / s.sessions < 2)
        hits.push({ kind: "fragment", weight: 4 });
    return hits.sort((a, b) => a.weight - b.weight).map((h) => h.kind);
}
/** 本期鲸评卡片（完整版，两种模式可切换）。 */
function WhaleNote({ report }) {
    const [mode, setMode] = useState("light");
    const s = report.stats;
    const kinds = triggerNotes(report);
    const mood = whaleMood(report);
    const top = kinds[0];
    return (_jsxs("div", { "data-whale-report-card": true, "data-whale-report-note": true, children: [_jsxs("div", { "data-whale-report-notehead": true, children: [_jsx(WhaleFace, { mood: mood, size: 40 }), _jsxs("div", { "data-whale-report-notetitle": true, children: [_jsx("b", { children: "\u672C\u671F\u9CB8\u8BC4" }), _jsxs("span", { "data-whale-report-noteopts": true, children: [_jsx("button", { "data-active": mode === "light", onClick: () => setMode("light"), children: "\u8F7B" }), _jsx("button", { "data-active": mode === "spicy", onClick: () => setMode("spicy"), children: "\u6BD2\u820C" })] })] })] }), _jsxs("div", { "data-whale-report-noteline": true, children: [NOTE_OPENERS[mood].map((line, i) => (_jsx("div", { "data-whale-report-notelineitem": true, children: line }, `o${i}`))), top !== undefined ? (NOTE_TEMPLATES[top][mode].map((line, i) => (_jsx("div", { "data-whale-report-notelineitem": true, children: line.replace("{n}", String(s.retryBursts ?? 0)) }, i)))) : (_jsxs(_Fragment, { children: [_jsx("div", { "data-whale-report-notelineitem": true, children: "\u201C\u8FD9\u671F\u6570\u636E\u5F88\u5E72\u51C0\u5462\uFF0C\u4E00\u70B9\u5E7A\u86FE\u5B50\u90FD\u6CA1\u6709\u3002\u201D" }), _jsx("div", { "data-whale-report-notelineitem": true, children: "\uFF08\u5F00\u5FC3\u5730\u6643\u4E86\u6643\u5C3E\u5DF4\uFF09\u8FD9\u6837\u7684\u4F60\uFF0C\u6211\u7279\u522B\u559C\u6B22\u3002" }), _jsx("div", { "data-whale-report-notelineitem": true, children: "\u7EE7\u7EED\u4FDD\u6301\uFF0C\u6211\u7684\u4EFB\u52A1\u5C31\u662F\u8BA9\u4F60\u7701\u5FC3\u5440\u3002" })] })), kinds.slice(1, 2).map((kind) => (_jsx("div", { "data-whale-report-notemore": true, children: NOTE_TEMPLATES[kind][mode][1] ?? NOTE_TEMPLATES[kind][mode][0] }, kind))), NOTE_CLOSERS[mode].map((line, i) => (_jsx("div", { "data-whale-report-notelineitem": true, style: { marginTop: 6 }, children: line }, `c${i}`)))] }), _jsx("div", { "data-whale-report-notefoot": true, children: "\u57FA\u4E8E\u672C\u671F\u4F7F\u7528\u6570\u636E\u81EA\u52A8\u751F\u6210\u7684\u98CE\u5473\u8BC4\u8BBA\uFF0C\u4E0D\u5F71\u54CD\u6B63\u5F0F\u62A5\u544A\u7ED3\u8BBA\u3002" }), mood === "angry" && _jsx("div", { "data-whale-report-notemore": true, children: "\uFF08\u9CB8\u9C7C\u5A18\u73B0\u5728\u6709\u70B9\u751F\u6C14\uFF0C\u6CE8\u610F\u5B89\u5168\u64CD\u4F5C\u3002\uFF09" })] }));
}
/** 声呐图标（会话钻取/活跃 的分区装饰）。 */
function SonarIcon({ size = 14 }) {
    return (_jsxs("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", style: { flexShrink: 0 }, children: [_jsx("circle", { cx: "8", cy: "8", r: "6.4", stroke: "#4d6bfe", strokeWidth: "1.4", opacity: ".85" }), _jsx("circle", { cx: "8", cy: "8", r: "3.4", stroke: "#4d6bfe", strokeWidth: "1.2", opacity: ".6" }), _jsx("path", { d: "M8 8 L12.5 5.5", stroke: "#4d6bfe", strokeWidth: "1.2", strokeLinecap: "round" })] }));
}
/** 会话钻取卡：按费用排序，点击展开详情，复制 Session ID。 */
function SessionDrilldown({ sessions }) {
    const [openId, setOpenId] = useState(null);
    const [copied, setCopied] = useState(null);
    const copy = (id) => {
        void navigator.clipboard.writeText(id);
        setCopied(id);
        window.setTimeout(() => setCopied(null), 1500);
    };
    return (_jsxs("div", { "data-whale-report-card": true, children: [_jsxs("div", { "data-whale-report-h2": true, children: [_jsx(SonarIcon, {}), "\u4F1A\u8BDD\u94BB\u53D6\uFF08", sessions.length, "\uFF09"] }), sessions.slice(0, 8).map((s) => {
                const open = openId === s.sessionId;
                return (_jsxs("div", { children: [_jsxs("div", { "data-whale-report-sessionrow": true, onClick: () => setOpenId(open ? null : s.sessionId), children: [_jsxs("div", { "data-whale-report-sessionmain": true, children: [_jsx("b", { children: s.title || "（未命名会话）" }), _jsxs("span", { children: [s.redDanger > 0 && _jsxs("em", { "data-whale-report-badge-red": true, children: [s.redDanger, " \u81F4\u547D"] }), s.retryBursts > 0 && _jsxs("em", { "data-whale-report-badge-amber": true, children: [s.retryBursts, " \u91CD\u8BD5"] }), s.toolCalls > 0 && _jsxs("em", { "data-whale-report-badge-gray": true, children: [s.toolCalls, " \u5DE5\u5177"] })] })] }), _jsxs("div", { "data-whale-report-sessioncost": true, children: ["\u00A5", s.cost.toFixed(2)] })] }), open && (_jsxs("div", { "data-whale-report-sessiondetail": true, children: [_jsxs("div", { "data-whale-report-tokenline": true, children: [new Date(s.firstTime).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }), " ~", " ", new Date(s.lastTime).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" }), " \u00B7 ", s.events, " \u4E8B\u4EF6 \u00B7 ", s.commands, " \u547D\u4EE4"] }), _jsx("button", { "data-whale-report-btn": true, "data-ghost": "true", onClick: () => copy(s.sessionId), children: copied === s.sessionId ? "已复制" : "复制 Session ID" })] }))] }, s.sessionId));
            })] }));
}
/** 修复建议（确定性模板；只输出方案与命令，不自动执行）。 */
const FIX_SUGGESTIONS = {
    "retry-storm": {
        text: "连续重跑说明前置条件未满足。先看下方重试诊断里的错误摘要，定位是缺依赖、路径不对还是权限问题，一次修对。",
    },
    "danger-red": {
        text: "致命级操作已发生。重要目录如无备份，先停止对相关路径的写入，再评估恢复。",
        command: "git reflog --oneline | head -20",
    },
    "secret-hit": {
        text: "疑似密钥出现在会话中，立即轮换。可检查相关提交历史，确认密钥是否曾进入版本库。",
        command: "git log --all --oneline | head -50",
    },
    "cache-drop": {
        text: "命中率下降通常由改系统提示词/AGENTS.md 或频繁重启会话导致。对比本周的 AGENTS.md 改动即可定位。",
    },
};
/** 修复建议行：方案 + 可复制命令（不自动执行）。 */
function FixSuggestion({ suggestion }) {
    const [copied, setCopied] = useState(false);
    return (_jsxs("div", { "data-whale-report-fix": true, children: [_jsx("div", { children: suggestion.text }), suggestion.command !== undefined && (_jsxs("div", { "data-whale-report-fixcmd": true, children: [_jsx("code", { children: suggestion.command }), _jsx("button", { "data-whale-report-chip": true, onClick: () => {
                            void navigator.clipboard.writeText(suggestion.command);
                            setCopied(true);
                            window.setTimeout(() => setCopied(false), 1500);
                        }, children: copied ? "已复制" : "复制" })] }))] }));
}
/** 洞察紧凑 Feed：色点 + 单行标题 + 预览，点击展开。 */
function InsightFeed({ insights, stats }) {
    const [openId, setOpenId] = useState(null);
    return (_jsx("div", { "data-whale-report-feed": true, children: insights.map((insight) => {
            const meta = INSIGHT_META[insight.level] ?? INSIGHT_META.warning;
            const open = openId === insight.id;
            const preview = insightPreview(insight, stats);
            return (_jsxs("div", { "data-whale-report-feedrow": true, onClick: () => setOpenId(open ? null : insight.id), children: [_jsx("i", { "data-whale-report-feeddot": true, style: { background: meta.color } }), _jsxs("div", { "data-whale-report-feedmain": true, children: [_jsx("div", { "data-whale-report-feedtitle": true, children: insight.title }), preview !== null && !open && _jsx("div", { "data-whale-report-feedpreview": true, children: preview }), open && (_jsxs(_Fragment, { children: [_jsx("div", { "data-whale-report-feeddetail": true, children: insight.detail }), _jsx("div", { "data-whale-report-feedaction": true, children: insight.action }), insight.estimate !== undefined && _jsx("div", { "data-whale-report-feedestimate": true, children: insight.estimate }), FIX_SUGGESTIONS[insight.id] !== undefined && (_jsx(FixSuggestion, { suggestion: FIX_SUGGESTIONS[insight.id] }))] }))] })] }, insight.id));
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