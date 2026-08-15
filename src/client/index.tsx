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
import { Component, useEffect, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from "react";
import { toolFamilies } from "../insights.js";
import { triggerNotes, whaleMood } from "../whale-notes.js";
import { computeCollaborationInsights } from "../collaboration.js";
import { createRoot, type Root } from "react-dom/client";

export const name = "whale-report-client";
export const inject: string[] = [];

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
[data-whale-report-brand] { display: flex; align-items: center; gap: 12px; padding: 2px 2px 8px; }
[data-whale-report-heroimg] { border-radius: 12px; flex-shrink: 0; }
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
[data-whale-report-tokenline] { font-size: 13.5px; color: #374151; line-height: 1.8; }
[data-whale-report-tokenline] .muted { color: #9ca3af; }

/* ── 洞察：告警条式（左色条 + 单行信息） ── */
[data-whale-report-insights] { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
[data-whale-report-insight] {
  background: #fff; border: 1px solid #e5e7eb;
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

/* ────────────────────────── DeepTrace editorial UI ────────────────────────── */
[data-whale-report], [data-whale-report-drawer], [data-whale-report-tabhost] {
  --dt-paper: #f5f8f9;
  --dt-paper-deep: #edf3f6;
  --dt-ink: #0b1733;
  --dt-ink-soft: #33445f;
  --dt-muted: #6e7c8f;
  --dt-faint: #94a2b3;
  --dt-line: #d9e3e8;
  --dt-line-strong: #b9c9d3;
  --dt-blue: #4d6bfe;
  --dt-cyan: #36b9d1;
  --dt-abyss: #07162f;
  --dt-red: #c83a48;
  --dt-amber: #b87519;
  color: var(--dt-ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
  font-feature-settings: "tnum" 1, "ss01" 1;
}
[data-whale-report] button, [data-whale-report-drawer] button, [data-whale-report-tabhost] button,
[data-whale-report] input, [data-whale-report-drawer] input, [data-whale-report-tabhost] input { font: inherit; }
[data-whale-report-drawer], [data-whale-report-tabhost] { container: dtrace / inline-size; }
[data-whale-report-drawer] {
  width: 680px; max-width: 94vw; background: var(--dt-paper); border-left-color: var(--dt-line);
  box-shadow: -18px 0 48px rgba(7, 22, 47, .12);
}
[data-whale-report-head] {
  min-height: 48px; padding: 0 20px; background: var(--dt-paper);
  border-bottom: 1px solid var(--dt-line);
}
[data-whale-report-title] { color: var(--dt-ink); font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
[data-whale-report-close] { color: var(--dt-muted); }
[data-whale-report-fab] {
  width: 50px; height: 50px; border-radius: 50%; background: var(--dt-abyss);
  box-shadow: 0 8px 24px rgba(7, 22, 47, .2);
}
[data-whale-report-fab]:hover { background: #10264d; transform: translateY(-2px); }
[data-whale-report-tabhost] {
  display: flex; flex-direction: column; height: 100%; overflow: hidden; padding: 0;
  color: var(--dt-ink); background: var(--dt-paper);
}
[data-whale-report-drawer] > [data-whale-report-body] {
  display: flex; flex: 1; flex-direction: column; min-height: 0; overflow: hidden; padding: 0;
}
[data-whale-report-tabs] {
  position: sticky; top: 0; z-index: 20; flex: 0 0 auto; gap: 28px;
  padding: 0 24px; background: rgba(245, 248, 249, .97); border-bottom: 1px solid var(--dt-line);
}
[data-whale-report-tab] {
  padding: 15px 0 12px; color: var(--dt-muted); font-size: 12px; font-weight: 650;
  letter-spacing: .08em; border-bottom-width: 1px;
}
[data-whale-report-tab][data-active="true"] { color: var(--dt-ink); border-bottom-color: var(--dt-blue); }
[data-whale-report-body] {
  flex: 1; min-width: 0; overflow-y: auto; padding: 0 24px 36px; background: var(--dt-paper);
  scrollbar-color: var(--dt-line-strong) transparent;
}

/* Brand opening — editorial masthead, not a card. */
[data-whale-report-brand] {
  position: relative; min-height: 224px; margin: 0 -24px; padding: 32px 24px 28px;
  display: block; overflow: hidden; background: var(--dt-paper-deep); border-bottom: 1px solid var(--dt-line);
}
[data-whale-report-brandcopy] { position: relative; z-index: 3; max-width: 64%; }
[data-whale-report-brandkicker], [data-whale-report-overline], [data-whale-report-micro],
[data-whale-report-brandmeta], [data-whale-report-feedcode], [data-whale-report-feedindex],
[data-whale-report-sessionindex], [data-whale-report-modelrank], [data-whale-report-scanmeta],
[data-whale-report-reportlabel] {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px; line-height: 1.5; letter-spacing: .13em; text-transform: uppercase;
}
[data-whale-report-brandkicker] { color: var(--dt-blue); font-weight: 750; }
[data-whale-report-brandname] {
  margin-top: 16px; color: var(--dt-ink); font-size: clamp(34px, 8cqw, 52px); font-weight: 820;
  line-height: .92; letter-spacing: -.055em;
}
[data-whale-report-brandname] span {
  display: block; margin-top: 9px; color: var(--dt-ink); font-size: .43em; font-weight: 700;
  line-height: 1; letter-spacing: .03em;
}
[data-whale-report-brandtag] {
  max-width: 240px; margin-top: 22px; color: var(--dt-ink-soft); font-size: 12px; font-weight: 650;
  line-height: 1.45; letter-spacing: .14em; text-transform: uppercase;
}
[data-whale-report-brandmeta] { display: flex; flex-wrap: wrap; gap: 7px 16px; margin-top: 18px; color: var(--dt-muted); }
[data-whale-report-brandmeta] span::before { content: ""; display: inline-block; width: 4px; height: 4px; margin: 0 7px 2px 0; background: var(--dt-cyan); border-radius: 50%; }
[data-whale-report-brandvisual] { position: absolute; inset: 0; pointer-events: none; }
[data-whale-report-heroimg] {
  position: absolute; z-index: 2; right: 14px; bottom: -5px; width: clamp(118px, 31cqw, 166px); height: auto;
  border-radius: 0; image-rendering: pixelated; filter: none; transform-origin: 50% 100%;
  transition: transform .25s ease;
}
[data-whale-report-brand]:hover [data-whale-report-heroimg] { transform: translateY(-3px); }
[data-whale-report-sonar] { position: absolute; right: 14px; bottom: 19px; width: 160px; aspect-ratio: 1; }
[data-whale-report-sonar] i { position: absolute; inset: 50%; border: 1px solid rgba(77, 107, 254, .22); border-radius: 50%; transform: translate(-50%, -50%); }
[data-whale-report-sonar] i:nth-child(1) { width: 46%; height: 46%; }
[data-whale-report-sonar] i:nth-child(2) { width: 72%; height: 72%; }
[data-whale-report-sonar] i:nth-child(3) { width: 100%; height: 100%; animation: dt-sonar 4.8s ease-out infinite; }
[data-whale-report-depthscale] { position: absolute; right: 10px; top: 18px; height: 82px; padding-right: 14px; border-right: 1px solid var(--dt-line-strong); color: var(--dt-faint); font: 9px/1.1 ui-monospace, monospace; letter-spacing: .08em; }
[data-whale-report-depthscale]::after { content: "4096m\\A 3072\\A 2048\\A 1024\\A 0000"; white-space: pre; display: block; line-height: 18px; text-align: right; }

/* Period selector reads like a report index, not pills. */
[data-whale-report-chips] {
  gap: 0; margin: 0; padding: 0; flex-wrap: nowrap; overflow-x: auto; border-bottom: 1px solid var(--dt-line);
}
[data-whale-report-chip] {
  flex: 0 0 auto; padding: 14px 14px 12px; border: 0; border-bottom: 2px solid transparent;
  border-radius: 0; background: transparent; color: var(--dt-muted); font-size: 11.5px; font-weight: 650;
}
[data-whale-report-chip]:hover { border-bottom-color: var(--dt-line-strong); color: var(--dt-ink); background: transparent; }
[data-whale-report-chip][data-active="true"] { color: var(--dt-blue); background: transparent; border-color: var(--dt-blue); }
[data-whale-report-inputs] { margin: 0; padding: 14px 0; border-bottom: 1px solid var(--dt-line); }
[data-whale-report-inputs] input { min-width: 0; border: 0; border-bottom: 1px solid var(--dt-line-strong); border-radius: 0; background: transparent; color: var(--dt-ink); }
[data-whale-report-inputs] input:focus { box-shadow: none; border-color: var(--dt-blue); }

/* Cost headline — one editorial datum with an instrumentation rail. */
[data-whale-report-hero] {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, .72fr); gap: 24px;
  margin: 0; padding: 34px 0 30px; background: transparent; border: 0; border-bottom: 1px solid var(--dt-line); border-radius: 0;
}
[data-whale-report-herohead] { min-width: 0; }
[data-whale-report-herolabel] { color: var(--dt-muted); font: 700 10px/1.4 ui-monospace, monospace; letter-spacing: .13em; text-transform: uppercase; }
[data-whale-report-heroval] {
  margin: 8px 0 4px; color: var(--dt-ink); font-size: clamp(48px, 12cqw, 76px); font-weight: 830;
  line-height: .98; letter-spacing: -.065em; font-variant-numeric: tabular-nums;
}
[data-whale-report-herodelta2] { gap: 7px; font-size: 12px; }
[data-whale-report-herodelta2] em.up { color: var(--dt-red); }
[data-whale-report-herodelta2] em.down { color: #267957; }
[data-whale-report-herodelta2] span, [data-whale-report-herodelta2] .muted { color: var(--dt-muted); }
[data-whale-report-herostat] {
  align-self: end; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0;
  margin: 0; padding: 0; border: 0; color: var(--dt-muted); font-size: 11px;
}
[data-whale-report-herostat] span { min-height: 60px; padding: 9px 10px; border-top: 1px solid var(--dt-line); }
[data-whale-report-herostat] span:nth-child(odd) { border-right: 1px solid var(--dt-line); padding-left: 0; }
[data-whale-report-herostat] b { display: block; margin-bottom: 4px; color: var(--dt-ink); font-size: 18px; line-height: 1; }

/* Shared editorial section rhythm. */
[data-whale-report-section] { margin-top: 34px; }
[data-whale-report-sectionhead] {
  display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: end; gap: 10px;
  margin-bottom: 13px; padding-bottom: 9px; border-bottom: 1px solid var(--dt-line);
}
[data-whale-report-sectionindex] { color: var(--dt-blue); font: 700 10px/1 ui-monospace, monospace; letter-spacing: .12em; }
[data-whale-report-sectiontitle] { color: var(--dt-ink); font-size: 17px; font-weight: 760; line-height: 1.15; letter-spacing: -.018em; }
[data-whale-report-sectionmeta] { color: var(--dt-faint); font: 9px/1.4 ui-monospace, monospace; letter-spacing: .1em; text-transform: uppercase; text-align: right; }
[data-whale-report-h2] {
  margin: 0 0 10px; color: var(--dt-ink); font-size: 14px; font-weight: 720; letter-spacing: -.01em;
}
[data-whale-report-card] { position: relative; margin: 0; padding: 0; background: transparent; border: 0; border-radius: 0; }
[data-whale-report-card]::after { display: none; }
[data-whale-report-zone] {
  margin: 0 -12px; padding: 18px 12px 16px; background: var(--dt-paper-deep);
  border-top: 1px solid var(--dt-line); border-bottom: 1px solid var(--dt-line);
}
[data-whale-report-scanmeta] { display: flex; flex-wrap: wrap; gap: 7px 18px; margin-bottom: 13px; color: var(--dt-muted); }
[data-whale-report-scanmeta] b { color: var(--dt-cyan); font-weight: 750; }

/* Investigation log. */
[data-whale-report-feed], [data-whale-report-insights] { display: block; margin: 0; }
[data-whale-report-feedrow], [data-whale-report-insight] {
  position: relative; display: grid; grid-template-columns: 32px 62px minmax(0, 1fr); gap: 10px;
  align-items: start; padding: 14px 0; background: transparent; border: 0; border-bottom: 1px solid var(--dt-line);
  border-radius: 0; cursor: pointer;
}
[data-whale-report-feedrow]:first-child, [data-whale-report-insight]:first-child { border-top: 1px solid var(--dt-line); }
[data-whale-report-feedrow]:hover, [data-whale-report-insight]:hover { border-color: var(--dt-line-strong); background: rgba(255, 255, 255, .38); }
[data-whale-report-feedrow][data-level="critical"], [data-whale-report-insight][data-level="critical"] { --dt-level: var(--dt-red); }
[data-whale-report-feedrow][data-level="warning"], [data-whale-report-insight][data-level="warning"] { --dt-level: var(--dt-amber); }
[data-whale-report-feedrow][data-level="tip"], [data-whale-report-insight][data-level="tip"] { --dt-level: #267957; }
[data-whale-report-feedrow][data-level="info"], [data-whale-report-insight][data-level="info"] { --dt-level: var(--dt-blue); }
[data-whale-report-feedindex] { color: var(--dt-faint); padding-top: 2px; }
[data-whale-report-feedcode] { color: var(--dt-level, var(--dt-blue)); font-weight: 750; padding-top: 2px; }
[data-whale-report-feedmain] { min-width: 0; }
[data-whale-report-feedtitle], [data-whale-report-insighthead] b { color: var(--dt-ink); font-size: 13.5px; font-weight: 720; line-height: 1.45; }
[data-whale-report-feedpreview] { margin-top: 4px; color: var(--dt-muted); font-size: 11.5px; }
[data-whale-report-feedrow][data-open="true"] [data-whale-report-feedmain] { padding-bottom: 4px; }
[data-whale-report-feeddetail], [data-whale-report-insightdetail] { margin-top: 10px; color: var(--dt-ink-soft); font-size: 12.5px; line-height: 1.75; }
[data-whale-report-feedaction], [data-whale-report-insightaction] { margin-top: 7px; color: var(--dt-blue); font-size: 12.5px; }
[data-whale-report-feedestimate], [data-whale-report-insightestimate] { color: var(--dt-muted); }
[data-whale-report-feedmore] {
  width: 100%; margin: 0; padding: 12px 0; background: transparent; border: 0; border-bottom: 1px solid var(--dt-line);
  border-radius: 0; color: var(--dt-blue); font-size: 11.5px; text-align: left;
}
[data-whale-report-feedmore]:hover { background: transparent; border-color: var(--dt-line-strong); }
[data-whale-report-feeddot] { display: none; }
[data-whale-report-insighthead] { display: flex; justify-content: space-between; gap: 12px; }
[data-whale-report-insighthead] span { color: var(--dt-faint); font: 9px/1.4 ui-monospace, monospace; text-transform: uppercase; }
[data-whale-report-fix] {
  margin-top: 12px; padding: 10px 0 2px 12px; background: transparent; border: 0; border-left: 1px solid var(--dt-blue);
  border-radius: 0; color: var(--dt-ink-soft); font-size: 11.5px;
}
[data-whale-report-fixcmd] code { background: transparent; border: 0; border-bottom: 1px solid var(--dt-line); border-radius: 0; }
[data-whale-report-fixcmd] button { padding: 4px 0; }

/* Whale note — a magazine marginalia rather than a dashboard card. */
[data-whale-report-note], [data-whale-report-note-short] {
  position: relative; overflow: visible; background: #eef3f8; border: 0; border-top: 1px solid #ccd9e3; border-bottom: 1px solid #ccd9e3;
  border-radius: 0;
}
[data-whale-report-note-short] {
  display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 14px; align-items: center;
  margin: 34px -12px 0; padding: 18px 18px 18px 12px; cursor: pointer;
}
[data-whale-report-note-short]:hover { border-color: var(--dt-blue); }
[data-whale-report-note-short] img { width: 62px !important; height: 62px !important; image-rendering: pixelated; transform: translateY(5px); }
[data-whale-report-notecode] { color: var(--dt-blue); font: 700 9px/1.4 ui-monospace, monospace; letter-spacing: .13em; text-transform: uppercase; }
[data-whale-report-note-short] b { margin-top: 3px; color: var(--dt-ink); font-size: 13px; letter-spacing: .02em; }
[data-whale-report-note-short] span, [data-whale-report-notequote] { display: block; margin-top: 5px; color: var(--dt-ink); font-family: ui-serif, Georgia, "Songti SC", serif; font-size: 15px; line-height: 1.65; }
[data-whale-report-note] { margin: 30px -12px 0; padding: 20px 22px 18px 92px; min-height: 132px; }
[data-whale-report-note] > [data-whale-report-notehead] > img { position: absolute; left: 14px; top: 18px; width: 64px !important; height: 64px !important; image-rendering: pixelated; }
[data-whale-report-notehead] { margin: 0 0 9px; align-items: center; }
[data-whale-report-notetitle] { display: block; }
[data-whale-report-notetitle] b { display: block; color: var(--dt-blue); font: 750 10px/1.4 ui-monospace, monospace; letter-spacing: .13em; text-transform: uppercase; }
[data-whale-report-noteopts] { display: inline-flex; gap: 12px; margin-top: 7px; padding: 0; background: transparent; border-radius: 0; }
[data-whale-report-noteopts] button { padding: 0 0 3px; color: var(--dt-muted); border-bottom: 1px solid transparent; border-radius: 0; font-size: 10px; }
[data-whale-report-noteopts] button[data-active="true"] { color: var(--dt-ink); background: transparent; border-bottom-color: var(--dt-blue); }
[data-whale-report-noteline] { padding: 0; color: var(--dt-ink); font-family: ui-serif, Georgia, "Songti SC", serif; font-size: 14px; }
[data-whale-report-notelineitem] { padding: 0; line-height: 1.75; }
[data-whale-report-notemore] { color: var(--dt-muted); font-size: 11.5px; }
[data-whale-report-notefoot] { color: var(--dt-faint); border-top-color: #ccd9e3; font: 9px/1.6 ui-monospace, monospace; letter-spacing: .04em; }

/* Activity and token scan. */
[data-whale-report-weekrow] { gap: 9px; margin-bottom: 5px; }
[data-whale-report-weekrowlabel] { width: 43px; color: var(--dt-faint); font: 9px/1 ui-monospace, monospace; }
[data-whale-report-squares] { gap: 3px; }
[data-whale-report-squares] i { border-radius: 1px; outline: 1px solid rgba(11, 23, 51, .025); }
[data-whale-report-legend] { color: var(--dt-faint); font: 9px/1.4 ui-monospace, monospace; }
[data-whale-report-legend] i { width: 10px; height: 10px; border-radius: 1px; }
[data-whale-report-tokenbar] { height: 6px; margin: 10px 0; border-radius: 0; background: var(--dt-line); }
[data-whale-report-tokenlegend] { gap: 7px 18px; color: var(--dt-muted); font: 10px/1.6 ui-monospace, monospace; }
[data-whale-report-tokenlegend] i { width: 5px; height: 5px; border-radius: 0; }

/* Model allocation ledger. */
[data-whale-report-modeltable] { display: block; }
[data-whale-report-modelrow] {
  display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 12px;
  padding: 14px 0; background: transparent; border: 0; border-bottom: 1px solid var(--dt-line); border-radius: 0;
}
[data-whale-report-modelrow]:first-child { border-top: 1px solid var(--dt-line); }
[data-whale-report-modelrank] { grid-row: 1 / span 3; color: var(--dt-faint); padding-top: 2px; }
[data-whale-report-modelhead] { margin: 0; }
[data-whale-report-modelhead] b { color: var(--dt-ink); font-size: 13.5px; }
[data-whale-report-modelhead] span { color: var(--dt-blue); font: 700 11px/1.5 ui-monospace, monospace; }
[data-whale-report-modelbar] { height: 2px; margin-top: 9px; border-radius: 0; background: var(--dt-line); overflow: visible; }
[data-whale-report-modelbar] i { min-width: 2px; }
[data-whale-report-modelnums] { margin-top: 7px; color: var(--dt-muted); font: 9.5px/1.55 ui-monospace, monospace; }

/* Full report opening and section compositions. */
[data-whale-report-reportopening] {
  position: relative; overflow: hidden; margin: 0 -24px; padding: 28px 24px 24px; color: #f5f8ff; background: var(--dt-abyss);
  border-bottom: 1px solid #18345d;
}
[data-whale-report-reportopening] [data-whale-report-actions] { position: relative; z-index: 2; }
[data-whale-report-reportopening] [data-whale-report-btn] {
  padding: 8px 12px; color: #fff; background: var(--dt-blue); border-color: var(--dt-blue); white-space: nowrap;
}
[data-whale-report-reportopening] [data-whale-report-btn]:hover { background: #627cff; border-color: #627cff; }
[data-whale-report-reportopening] [data-whale-report-btn][data-ghost="true"] {
  color: #c6d3e5; background: transparent; border-color: rgba(198, 211, 229, .28);
}
[data-whale-report-reportopening] [data-whale-report-btn][data-ghost="true"]:hover {
  color: #fff; background: rgba(255, 255, 255, .06); border-color: rgba(198, 211, 229, .48);
}
[data-whale-report-reportlabel] { color: #7fcde0; }
[data-whale-report-reptitle] { margin-top: 12px; color: #f5f8ff; font-size: clamp(25px, 6cqw, 38px); font-weight: 790; letter-spacing: -.035em; }
[data-whale-report-repsub] { color: #9fb1ca; font: 10px/1.6 ui-monospace, monospace; letter-spacing: .06em; }
[data-whale-report-openingcost] { margin-top: 30px; color: #fff; font-size: clamp(48px, 12cqw, 72px); font-weight: 820; line-height: 1; letter-spacing: -.06em; }
[data-whale-report-reportopening] [data-whale-report-herodelta2] span { color: #9fb1ca; }
[data-whale-report-reportopening] [data-whale-report-herodelta2] .muted { color: #7f93af; }
[data-whale-report-headrow] { position: relative; z-index: 2; padding: 0; }
[data-whale-report-reportopening] [data-whale-report-statgrid] { margin: 26px 0 0; }
[data-whale-report-statgrid] { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; }
[data-whale-report-stat] { min-width: 0; padding: 12px 10px 8px 0; background: transparent; border: 0; border-top: 1px solid rgba(207, 222, 245, .24); border-radius: 0; }
[data-whale-report-stat]:not(:nth-child(3n + 1)) { padding-left: 10px; border-left: 1px solid rgba(207, 222, 245, .16); }
[data-whale-report-stat] b { color: #fff; font-size: clamp(18px, 5cqw, 27px); }
[data-whale-report-stat] span { color: #91a5c1; font: 9px/1.5 ui-monospace, monospace; letter-spacing: .06em; text-transform: uppercase; }
[data-whale-report-stat] em.delta-up { color: #ff8e98; }
[data-whale-report-stat] em.delta-down { color: #75d6b1; }
[data-whale-report-reporthero] { position: absolute; right: 18px; top: 76px; width: 104px; height: 104px; object-fit: contain; image-rendering: pixelated; opacity: .82; }
[data-whale-report-reportsection] { margin-top: 38px; padding-top: 0; }
[data-whale-report-reportsection] > [data-whale-report-sectionhead] { margin-bottom: 16px; }
[data-whale-report-reportgrid] { display: grid; grid-template-columns: minmax(0, 1.18fr) minmax(210px, .82fr); gap: 28px; }
[data-whale-report-reportgrid="equal"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
[data-whale-report-subsection] { min-width: 0; }
[data-whale-report-tokenline] { color: var(--dt-ink-soft); font-size: 12.5px; line-height: 1.75; }
[data-whale-report-tokenline] .muted, [data-whale-report-tokenline].muted { color: var(--dt-faint); }

/* Risk log and tools ledger. */
[data-whale-report-risk] { padding-left: 14px; border-left: 2px solid var(--dt-amber); }
[data-whale-report-risk][data-severity="critical"] { border-left-color: var(--dt-red); }
[data-whale-report-dangersum] { margin: 0 0 12px; padding: 0; background: transparent; border: 0; border-radius: 0; color: var(--dt-ink-soft); }
[data-whale-report-dangercats] { gap: 6px 14px; margin-bottom: 11px; }
[data-whale-report-dangercat], [data-whale-report-secretcat],
[data-whale-report-badge-red], [data-whale-report-badge-amber], [data-whale-report-badge-gray] {
  padding: 0; background: transparent; border: 0; border-radius: 0; font: 9px/1.5 ui-monospace, monospace; letter-spacing: .05em; text-transform: uppercase;
}
[data-whale-report-dangercat], [data-whale-report-badge-red] { color: var(--dt-red); }
[data-whale-report-secretcat] { color: #6750a4; }
[data-whale-report-badge-amber] { color: var(--dt-amber); }
[data-whale-report-badge-gray] { color: var(--dt-muted); }
[data-whale-report-danger] {
  margin: 0; padding: 10px 0; background: transparent !important; border: 0; border-bottom: 1px solid #ead9dc !important;
  border-radius: 0; color: #9f2e3a !important; font-size: 11px;
}
[data-whale-report-danger] em { color: var(--dt-muted) !important; }
[data-whale-report-samplesbtn] { padding-left: 0; color: var(--dt-blue); }
[data-whale-report-toollist] { border-top: 1px solid var(--dt-line); }
[data-whale-report-toolrow] { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--dt-line); color: var(--dt-ink-soft); font-size: 12px; }
[data-whale-report-toolrow] code { color: var(--dt-ink); font-family: ui-monospace, monospace; }
[data-whale-report-toolrow] b { color: var(--dt-blue); font-family: ui-monospace, monospace; }

/* Trace log. */
[data-whale-report-trace] { margin-top: 34px; }
[data-whale-report-sessionrow] {
  display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; gap: 10px; align-items: start;
  padding: 14px 0; border-bottom: 1px solid var(--dt-line); border-radius: 0;
}
[data-whale-report-sessionrow]:first-of-type { border-top: 1px solid var(--dt-line); }
[data-whale-report-sessionrow]:hover { background: rgba(255, 255, 255, .42); border-radius: 0; }
[data-whale-report-sessionindex] { color: var(--dt-faint); padding-top: 2px; }
[data-whale-report-sessionmain] b { color: var(--dt-ink); font-size: 13px; }
[data-whale-report-sessionmain] span { gap: 6px 12px; flex-wrap: wrap; margin-top: 6px; }
[data-whale-report-sessionmeta] { color: var(--dt-muted); font: 9px/1.5 ui-monospace, monospace; letter-spacing: .04em; text-transform: uppercase; }
[data-whale-report-sessioncost] { color: var(--dt-blue); font: 750 13px/1.4 ui-monospace, monospace; text-align: right; }
[data-whale-report-sessioncost] small { display: block; margin-top: 3px; color: var(--dt-faint); font-size: 8.5px; font-weight: 500; }
[data-whale-report-sessiondetail] { margin-left: 48px; padding: 11px 0 14px; border-bottom: 1px solid var(--dt-line); }
[data-whale-report-btn] { border-radius: 3px; background: var(--dt-abyss); font-size: 11.5px; letter-spacing: .02em; }
[data-whale-report-btn]:hover { background: #10264d; }
[data-whale-report-btn][data-ghost="true"] { background: transparent; color: var(--dt-ink-soft); border-color: var(--dt-line-strong); }
[data-whale-report-fullbtn] { margin: 34px 0 0; padding: 14px; border-radius: 2px; letter-spacing: .08em; text-transform: uppercase; }

/* History becomes an archive index. */
[data-whale-report-historyhead] { padding: 28px 0 12px; border-bottom: 1px solid var(--dt-line); }
[data-whale-report-hitem] { margin: 0; padding: 15px 0; background: transparent; border: 0; border-bottom: 1px solid var(--dt-line); border-radius: 0; }
[data-whale-report-hitem]:hover { background: rgba(255, 255, 255, .42); border-color: var(--dt-line-strong); }
[data-whale-report-hitem] b { color: var(--dt-ink); }
[data-whale-report-hitem] span { color: var(--dt-muted); font-family: ui-monospace, monospace; font-size: 10px; }

/* Loading and restrained motion. */
[data-whale-report-sk-hero], [data-whale-report-sk-line] { background: var(--dt-line); animation: dt-pulse 1.25s ease-in-out infinite; }
[data-whale-report-section], [data-whale-report-hero], [data-whale-report-brand], [data-whale-report-reportsection] { animation: dt-reveal .22s ease-out both; }
@keyframes dt-reveal { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes dt-pulse { 50% { opacity: .52; } }
@keyframes dt-sonar { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.62); } 28% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -50%) scale(1); } }

@container dtrace (max-width: 620px) {
  [data-whale-report-body] { padding-right: 18px; padding-left: 18px; }
  [data-whale-report-brand], [data-whale-report-reportopening] { margin-right: -18px; margin-left: -18px; padding-right: 18px; padding-left: 18px; }
  [data-whale-report-hero] { grid-template-columns: 1fr; gap: 18px; }
  [data-whale-report-herostat] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  [data-whale-report-herostat] span { min-height: 48px; padding-left: 9px; border-left: 1px solid var(--dt-line); border-right: 0 !important; }
  [data-whale-report-herostat] span:first-child { padding-left: 0; border-left: 0; }
  [data-whale-report-reportgrid], [data-whale-report-reportgrid="equal"] { grid-template-columns: 1fr; gap: 28px; }
  [data-whale-report-headrow] { display: block; }
  [data-whale-report-actions] { margin-top: 16px; flex-wrap: wrap; }
  [data-whale-report-reporthero] { top: 148px; width: 84px; height: 84px; opacity: .66; }
}
@container dtrace (max-width: 460px) {
  [data-whale-report-body] { padding-right: 14px; padding-left: 14px; }
  [data-whale-report-tabs] { padding: 0 14px; }
  [data-whale-report-brand], [data-whale-report-reportopening] { margin-right: -14px; margin-left: -14px; padding-right: 14px; padding-left: 14px; }
  [data-whale-report-brand] { min-height: 205px; }
  [data-whale-report-brandcopy] { max-width: 68%; }
  [data-whale-report-brandname] { font-size: 34px; }
  [data-whale-report-brandtag] { max-width: 176px; font-size: 10px; }
  [data-whale-report-brandmeta] { display: none; }
  [data-whale-report-heroimg] { right: 2px; width: 112px; }
  [data-whale-report-sonar] { right: -10px; width: 126px; }
  [data-whale-report-depthscale] { display: none; }
  [data-whale-report-chips] { margin-right: -14px; margin-left: -14px; padding-left: 6px; }
  [data-whale-report-heroval] { font-size: 49px; }
  [data-whale-report-herostat] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  [data-whale-report-herostat] span { border-left: 0; }
  [data-whale-report-herostat] span:nth-child(even) { padding-left: 10px; border-left: 1px solid var(--dt-line); }
  [data-whale-report-feedrow], [data-whale-report-insight] { grid-template-columns: 28px 48px minmax(0, 1fr); gap: 6px; }
  [data-whale-report-sectionhead] { grid-template-columns: 34px minmax(0, 1fr); }
  [data-whale-report-sectionmeta] { display: none; }
  [data-whale-report-note] { margin-right: -7px; margin-left: -7px; padding: 18px 14px 16px 72px; }
  [data-whale-report-note] > [data-whale-report-notehead] > img { left: 8px; width: 52px !important; height: 52px !important; }
  [data-whale-report-note-short] { margin-right: -7px; margin-left: -7px; grid-template-columns: 52px minmax(0, 1fr); padding-left: 8px; }
  [data-whale-report-note-short] img { width: 52px !important; height: 52px !important; }
  [data-whale-report-statgrid] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  [data-whale-report-stat]:not(:nth-child(3n + 1)) { padding-left: 0; border-left: 0; }
  [data-whale-report-stat]:nth-child(even) { padding-left: 10px; border-left: 1px solid rgba(207, 222, 245, .16); }
  [data-whale-report-reporthero] { top: 154px; width: 78px; height: 78px; opacity: .54; }
  [data-whale-report-sessionrow] { grid-template-columns: 31px minmax(0, 1fr) auto; gap: 7px; }
  [data-whale-report-sessiondetail] { margin-left: 38px; display: block; }
  [data-whale-report-sessiondetail] button { margin-top: 9px; }
  [data-whale-report-weekrowlabel] { width: 36px; }
  [data-whale-report-squares] { gap: 2px; }
}
@container dtrace (max-width: 360px) {
  [data-whale-report-chips] {
    display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-right: -14px; margin-left: -14px; padding-left: 0; overflow: visible;
  }
  [data-whale-report-chip] { min-width: 0; width: 100%; padding: 10px 3px 9px; text-align: center; }
  [data-whale-report-sessionmain] { min-width: 0; overflow: hidden; }
  [data-whale-report-sessionmain] b { max-width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  [data-whale-report] *, [data-whale-report] *::before, [data-whale-report] *::after,
  [data-whale-report-drawer] *, [data-whale-report-drawer] *::before, [data-whale-report-drawer] *::after,
  [data-whale-report-tabhost] *, [data-whale-report-tabhost] *::before, [data-whale-report-tabhost] *::after {
    scroll-behavior: auto !important; animation: none !important; transition: none !important;
  }
}

/* ── Provider Balance：live instrumentation module ── */
[data-whale-report-balance] {
  margin: 0 0 14px; padding: 10px 14px 9px;
  border: 1px solid var(--dt-line); border-radius: 10px;
  background: var(--dt-paper-deep);
}
[data-whale-report-balancehead] { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
[data-whale-report-balancelabel] { font: 700 9.5px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dt-faint); letter-spacing: .1em; }
[data-whale-report-balancename] { font: 700 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dt-blue); }
[data-whale-report-balancestatus] { font: 400 9px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dt-muted); }
[data-whale-report-balanceval] { font: 700 26px var(--dt-sans, ui-sans-serif, system-ui, sans-serif); color: var(--dt-ink); margin-top: 3px; }
[data-whale-report-balanceval] small { font: 400 10px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dt-faint); margin-left: 8px; }
[data-whale-report-balancebreak] { font: 400 9.5px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dt-muted); margin-top: 2px; }
[data-whale-report-balancefoot] {
  display: flex; justify-content: space-between; gap: 8px; margin-top: 7px; padding-top: 6px;
  border-top: 1px dashed var(--dt-line); font: 400 8.5px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dt-faint);
}
[data-whale-report-balancebtn] {
  background: transparent; border: 1px solid var(--dt-line-strong); border-radius: 6px;
  padding: 2px 9px; font: 600 10px ui-sans-serif, system-ui, sans-serif; color: var(--dt-ink-soft); cursor: pointer;
}
[data-whale-report-balancebtn]:hover { border-color: var(--dt-blue); color: var(--dt-blue); }
[data-whale-report-balancebtn]:disabled { opacity: .5; cursor: default; }
[data-whale-report-balancebtn][data-live="true"] { border-color: var(--dt-blue); color: var(--dt-blue); }

/* ── 协作复盘章节行 ── */
[data-whale-report-collab] { border-left: 2px solid var(--dt-cyan); padding-left: 12px; margin: 10px 0; }
[data-whale-report-collabcode] { font: 700 9.5px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dt-cyan); letter-spacing: .08em; }
[data-whale-report-collabtitle] { font: 600 12.5px ui-sans-serif, system-ui, sans-serif; color: var(--dt-ink); margin-top: 2px; }
[data-whale-report-collabobs] { font: 400 11px ui-sans-serif, system-ui, sans-serif; color: var(--dt-muted); margin-top: 2px; }
[data-whale-report-collabtip] { font: 400 11px ui-sans-serif, system-ui, sans-serif; color: var(--dt-ink-soft); margin-top: 2px; }
[data-whale-report-collabtip] b { color: var(--dt-blue); font-weight: 700; }

/* ── 报告 footer 元数据 ── */
[data-whale-report-repmeta] { font: 400 9px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dt-faint); margin-top: 14px; }

/* 打印 = 面板报告（克隆到 body 顶层后 window.print）：
 * body 其它直接子级全部隐藏（不占位、无空白页），报告独占 A4。 */
@media print {
  @page { size: A4; margin: 10mm 8mm; }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not([data-whale-report-print-root]) { display: none !important; }
  [data-whale-report-print-root] {
    display: block !important; width: auto !important; margin: 0 !important;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  [data-whale-report-card], [data-whale-report-section],
  [data-whale-report-reportsection], [data-whale-report-note] { break-inside: avoid; }
}
`;



let styleInjected = false;
function injectStyle(): void {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin", "dsh-whale-report");
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

// ─────────────────────────── 类型与 API 客户端 ───────────────────────────

interface ReportMeta {
  id: string;
  preset: string;
  from: number;
  to: number;
  createdAt: number;
  sessions: number;
  turns: number;
  totalEvents: number;
}

interface InsightJson {
  id: string;
  level: "info" | "tip" | "warning" | "critical";
  title: string;
  detail: string;
  action: string;
  estimate?: string;
}

interface PrevSummary {
  key: string;
  cost: number;
  sessions: number;
  turns: number;
  cacheHitRate: number;
  nightRatio: number;
  dangerCount: number;
}

interface ReportFull extends ReportMeta {
  stats: StatsJson;
  markdown: string;
  cost?: { perModel: Record<string, number>; total: number; currency: string; source: string };
  insights?: InsightJson[];
  prev?: PrevSummary;
  reportGeneration?: { mode: "local" | "model"; inputTokens: number; outputTokens: number; cacheTokens: number; totalTokens: number; estimatedCostCny: number; model?: string };
}

interface StatsJson {
  period: { from: number; to: number };
  sessions: number;
  subagentSessions: number;
  turns: number;
  steps: number;
  userMessages: number;
  assistantMessages: number;
  tokens: { input: number; output: number; cacheRead: number; reasoning: number };
  toolCalls: Record<string, number>;
  toolCallsTotal: number;
  toolErrors: number;
  commands: number;
  dangerousCommands: { command: string; time: number; sessionId: string; label: string; sev: "red" | "amber" }[];
  hourHistogram: number[];
  activeDays: number;
  busiestDay: { date: string; events: number } | null;
  titles: string[];
  totalEvents: number;
  models: Record<string, { input: number; output: number; cacheRead: number; reasoning: number }>;
  halfHourHistogram: number[];
  dailySeries: { date: string; count: number }[];
  dayHourSeries: { date: string; hours: number[] }[];
  retryBursts?: number;
  burstSamples?: { cmd: string; count: number; time: number; error?: string; sessionId?: string }[];
  secretHits?: { label: string; time: number; source: string; sessionId?: string }[];
  plugins?: string[];
  collab?: { userMessages: number; revisions: number; lateConstraints: number; sessionsWithRevision: number; shortSessions: number };
  sessionsDetail?: {
    sessionId: string;
    title: string;
    firstTime: number;
    lastTime: number;
    events: number;
    commands: number;
    toolCalls: number;
    retryBursts: number;
    dangerCount: number;
    redDanger: number;
    cost: number;
    modelTokens?: Record<string, { input: number; output: number; cacheRead: number; reasoning: number }>;
  }[];
}

async function api<T>(method: string, payload?: unknown): Promise<T> {
  const response = await fetch(`/whale/api/${method}`, {
    method: payload === undefined ? "GET" : "POST",
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = (await response.json()) as { ok: boolean; error?: { message?: string } } & T;
  if (!response.ok || body.ok === false) {
    throw new Error(body.error?.message ?? `HTTP ${response.status}`);
  }
  return body;
}

// ─────────────────────────── 小组件 ───────────────────────────

/** 柱状图小图标（FAB 与侧栏 Tab 共用，无 emoji）。 */
function ChartIcon({ size = 20 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="11" width="3.6" height="6.5" rx="1.2" fill="currentColor" />
      <rect x="8.2" y="6.5" width="3.6" height="11" rx="1.2" fill="currentColor" />
      <rect x="13.9" y="2.5" width="3.6" height="15" rx="1.2" fill="currentColor" />
    </svg>
  );
}

const HERO_LABEL: Record<string, string> = {
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
] as const;

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function dateStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isoWeek(ms: number): number {
  const date = new Date(ms);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function traceCode(preset: string, to = Date.now()): string {
  if (preset === "weekly") return `TRACE / WEEK ${String(isoWeek(to)).padStart(2, "0")}`;
  return `TRACE / ${preset.toUpperCase()}`;
}

function cacheRate(stats: StatsJson): number {
  return Math.round((stats.tokens.cacheRead / Math.max(1, stats.tokens.input + stats.tokens.cacheRead)) * 100);
}

function insightCode(insight: InsightJson): string {
  if (insight.id.includes("secret")) return "SECRET";
  if (insight.id.includes("retry")) return "RETRY";
  if (insight.id.includes("cost")) return "COST";
  if (insight.id.includes("cache")) return "CACHE";
  if (insight.id.includes("night")) return "DEPTH";
  if (insight.id.includes("danger")) return "RISK";
  return "TRACE";
}

function SectionHeader({ index, title, meta }: { index: string; title: string; meta?: string }): ReactNode {
  return (
    <div data-whale-report-sectionhead>
      <span data-whale-report-sectionindex>{index}</span>
      <div data-whale-report-sectiontitle>{title}</div>
      {meta !== undefined && <span data-whale-report-sectionmeta>{meta}</span>}
    </div>
  );
}

function Heatmap({ histogram }: { histogram: number[] }): ReactNode {
  const max = Math.max(1, ...histogram);
  const hue = (level: number): string => {
    const a = 0.14 + level * 0.82;
    return `rgba(77,107,254,${a.toFixed(2)})`;
  };
  // 48 格 = 30 分钟粒度；每 4 格（2 小时）打一个轴标签
  const labels = ["00:00", "02:00", "04:00", "06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00", "24:00"];
  return (
    <div>
      <div data-whale-report-heat>
        {histogram.map((count, idx) => (
          <i
            key={idx}
            title={`${String(Math.floor(idx / 2)).padStart(2, "0")}:${idx % 2 === 0 ? "00" : "30"} · ${count}`}
            style={{ background: hue(count / max) }}
          />
        ))}
      </div>
      <div data-whale-report-heatlabels>
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  );
}

/** 每日事件趋势：纯 CSS 柱状图。 */
/** 四段式 token 构成条（输入/输出/缓存命中/思考）。 */
/** 声呐蓝强度。低值用幂放大：count 只是峰值 1% 的方块也要肉眼可见。 */
function green(level: number): string {
  const boosted = Math.pow(Math.min(1, Math.max(0, level)), 0.4);
  const alpha = 0.2 + boosted * 0.8;
  return boosted > 0.72
    ? `rgba(54,185,209,${alpha.toFixed(2)})`
    : `rgba(77,107,254,${alpha.toFixed(2)})`;
}

/** 图例：少 → 多。 */
function Legend(): ReactNode {
  return (
    <div data-whale-report-legend>
      <span>少</span>
      <i style={{ background: green(0) }} />
      <i style={{ background: green(0.3) }} />
      <i style={{ background: green(0.6) }} />
      <i style={{ background: green(1) }} />
      <span>多</span>
    </div>
  );
}

function EmptyActivity(): ReactNode {
  return <div data-whale-report-gridempty>该报告生成于旧版本，无逐时数据。重新生成即可。</div>;
}

/** 一行小方格：左侧行标签 + 自适应宽度方块（每格随容器伸缩、保持正方形）。 */
function SquareRow({ label, cells }: { label: string; cells: { title: string; level: number }[] }): ReactNode {
  return (
    <div data-whale-report-weekrow>
      <span data-whale-report-weekrowlabel>{label}</span>
      <div data-whale-report-squares>
        {cells.map((c, i) => (
          <i key={i} title={c.title} style={{ background: c.level === 0 ? "#dce7ec" : green(c.level) }} />
        ))}
      </div>
    </div>
  );
}



/**
 * 活动可视化：按报告周期自适应粒度。
 *   日报 → 每格 30 分钟（48 格一行）
 *   周报 → 每格 1 小时（24 行 × 7 天矩阵）
 *   月报 → 每格 1 天（约 30 格一行）
 *   年报 → 每格 1 周（约 52 格一行）
 * 颜色越绿代表事件越多。
 */
function ActivityStrip({ report }: { report: ReportFull }): ReactNode {
  const s = report.stats;
  const preset = report.preset;
  const cell = (count: number, max: number, title: string) => ({ title, level: count === 0 ? 0 : count / max });

  // 日报：每格 30 分钟（4 行 × 12 格，每行 6 小时）
  if (preset === "daily") {
    const hist = s.halfHourHistogram ?? [];
    if (hist.length === 0) return <EmptyActivity />;
    const max = Math.max(1, ...hist);
    const rows = [
      { label: "00–06", cells: hist.slice(0, 12) },
      { label: "06–12", cells: hist.slice(12, 24) },
      { label: "12–18", cells: hist.slice(24, 36) },
      { label: "18–24", cells: hist.slice(36, 48) },
    ];
    return (
      <div>
        {rows.map((row, ri) => (
          <SquareRow
            key={row.label}
            label={row.label}
            cells={row.cells.map((count, i) => {
              const halfHour = ri * 360 + i * 30;
              const h = Math.floor(halfHour / 60);
              const m = halfHour % 60;
              return cell(count, max, `${String(h).padStart(2, "0")}:${m === 0 ? "00" : "30"} · ${count}`);
            })}
          />
        ))}
        <Legend />
      </div>
    );
  }

  // 24小时：滚动窗口 → 一行 24 格（每小时一格，跨天不叠加）
  if (preset === "24h") {
    const hist = s.hourHistogram ?? [];
    if (hist.length === 0) return <EmptyActivity />;
    const max = Math.max(1, ...hist);
    return (
      <div>
        <SquareRow
          label="24h"
          cells={hist.map((count, h) => cell(count, max, `${String(h).padStart(2, "0")}:00 · ${count}`))}
        />
        <Legend />
      </div>
    );
  }

  // 周报 / 自定义：每格 1 小时（7 行 × 24 格，每行 1 天）
  if (preset === "weekly" || preset === "custom") {
    const series = s.dayHourSeries ?? [];
    if (series.length === 0) return <EmptyActivity />;
    const max = Math.max(1, ...series.flatMap((d) => d.hours));
    const shown = series.slice(-30);
    return (
      <div>
        {shown.map((day) => (
          <SquareRow
            key={day.date}
            label={day.date.slice(5)}
            cells={day.hours.map((count, h) => cell(count, max, `${day.date} ${String(h).padStart(2, "0")}:00 · ${count}`))}
          />
        ))}
        <Legend />
      </div>
    );
  }

  // 月报：每格 1 天；年报：每格 1 周
  const series = s.dailySeries ?? [];
  if (series.length === 0) return <EmptyActivity />;
  const buckets =
    preset === "yearly"
      ? (() => {
          const weekly: { label: string; count: number }[] = [];
          const weekMs = 7 * 86400000;
          for (const day of series) {
            const t = Date.parse(day.date + "T00:00:00");
            const weekStart = new Date(Math.floor(t / weekMs) * weekMs);
            const label = weekStart.toISOString().slice(0, 10);
            const last = weekly[weekly.length - 1];
            if (last !== undefined && last.label === label) last.count += day.count;
            else weekly.push({ label, count: day.count });
          }
          return weekly;
        })()
      : series.map((d) => ({ label: d.date, count: d.count }));
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const perRow = preset === "yearly" ? 13 : 10;
  const rows: { label: string; items: typeof buckets }[] = [];
  for (let i = 0; i < buckets.length; i += perRow) {
    const items = buckets.slice(i, i + perRow);
    const from = items[0].label.slice(5);
    const to = items[items.length - 1].label.slice(5);
    rows.push({ label: preset === "yearly" ? `${items[0].label.slice(0, 4)}月` : `${from}–${to}`, items });
  }
  return (
    <div>
      {rows.map((row) => (
        <SquareRow
          key={row.label}
          label={row.label}
          cells={row.items.map((b) => cell(b.count, max, `${b.label} · ${b.count} 事件`))}
        />
      ))}
      <Legend />
    </div>
  );
}


function TokenBar({ tokens }: { tokens: StatsJson["tokens"] }): ReactNode {
  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.reasoning;
  if (total === 0) return null;
  const seg = (value: number, color: string, name: string) => (
    <i key={name} title={`${name} ${fmt(value)}`} style={{ width: `${(value / total) * 100}%`, background: color }} />
  );
  return (
    <div>
      <div data-whale-report-tokenbar>
        {seg(tokens.input, "#4d6bfe", "输入")}
        {seg(tokens.output, "#36b9d1", "输出")}
        {seg(tokens.cacheRead, "#9aaaba", "缓存命中")}
        {seg(tokens.reasoning, "#0b1733", "思考")}
      </div>
      <div data-whale-report-tokenlegend>
        <span><i style={{ background: "#4d6bfe" }} />输入 {fmt(tokens.input)}</span>
        <span><i style={{ background: "#36b9d1" }} />输出 {fmt(tokens.output)}</span>
        <span><i style={{ background: "#9aaaba" }} />缓存 {fmt(tokens.cacheRead)}</span>
        <span><i style={{ background: "#0b1733" }} />思考 {fmt(tokens.reasoning)}</span>
      </div>
    </div>
  );
}

/** 模型用量表（对齐 DS 开放平台用量页的展示习惯）。 */
function ModelTable({ models, cost }: { models: StatsJson["models"]; cost?: ReportFull["cost"] }): ReactNode {
  const entries = Object.entries(models).sort(
    (a, b) => b[1].input + b[1].output + b[1].cacheRead + b[1].reasoning - (a[1].input + a[1].output + a[1].cacheRead + a[1].reasoning),
  );
  if (entries.length === 0) return <div data-whale-report-tokenline>（无模型用量数据）</div>;
  const grand = entries.reduce((sum, [, u]) => sum + u.input + u.output + u.cacheRead + u.reasoning, 0);
  return (
    <div data-whale-report-modeltable>
      {entries.map(([model, u], index) => {
        const total = u.input + u.output + u.cacheRead + u.reasoning;
        const share = grand > 0 ? Math.round((total / grand) * 100) : 0;
        return (
          <div key={model} data-whale-report-modelrow>
            <span data-whale-report-modelrank>{String(index + 1).padStart(2, "0")}</span>
            <div data-whale-report-modelhead>
              <b>{model}</b>
              <span>{share}%{typeof cost?.perModel[model] === "number" ? ` / ¥${cost.perModel[model].toFixed(2)}` : ""}</span>
            </div>
            <div data-whale-report-modelbar>
              <i title={`${model} · ${share}%`} style={{ width: `${share}%`, background: "#4d6bfe" }} />
            </div>
            <div data-whale-report-modelnums>
              TOTAL {fmt(total)} · IN {fmt(u.input)} · OUT {fmt(u.output)} · CACHE {fmt(u.cacheRead)} · THINK {fmt(u.reasoning)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const INSIGHT_META: Record<InsightJson["level"], { color: string; icon: string }> = {
  info: { color: "#4d6bfe", icon: "ℹ" },
  tip: { color: "#16a34a", icon: "✓" },
  warning: { color: "#d97706", icon: "!" },
  critical: { color: "#dc2626", icon: "×" },
};

function InsightsSection({ insights }: { insights: InsightJson[] }): ReactNode {
  const shown = insights.filter((i) => i.level !== "info");
  if (shown.length === 0) return null;
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div data-whale-report-insights>
      {shown.map((insight, index) => {
        const open = openId === insight.id;
        return (
          <div
            key={insight.id}
            data-whale-report-insight
            data-level={insight.level}
            data-open={open}
            onClick={() => setOpenId(open ? null : insight.id)}
          >
            <span data-whale-report-feedindex>{String(index + 1).padStart(2, "0")}</span>
            <span data-whale-report-feedcode>{insightCode(insight)}</span>
            <div data-whale-report-feedmain>
              <div data-whale-report-insighthead>
                <b>{insight.title}</b>
                <span>{open ? "CLOSE" : "OPEN"}</span>
              </div>
              {open && (
                <>
                  <div data-whale-report-insightdetail>{insight.detail}</div>
                  <div data-whale-report-insightaction>{insight.action}</div>
                  {insight.estimate !== undefined && <div data-whale-report-insightestimate>{insight.estimate}</div>}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 危险操作自动总结（规则生成，不用 LLM）。 */
function dangerSummary(danger: StatsJson["dangerousCommands"]): string {
  if (danger.length === 0) return "";
  danger = danger.map((d) => ({ ...d, label: d.label ?? "未分类" }));
  const byLabel = new Map<string, number>();
  for (const d of danger) byLabel.set(d.label, (byLabel.get(d.label) ?? 0) + 1);
  const top = [...byLabel.entries()].sort((a, b) => b[1] - a[1])[0];
  const share = Math.round((top[1] / danger.length) * 100);
  const night = danger.filter((d) => {
    const h = new Date(d.time).getHours();
    return h < 6 || h >= 23;
  }).length;
  return `共 ${danger.length} 条，以「${top[0]}」为主（${top[1]} 条，占 ${share}%）${night > 0 ? `，${night} 条在深夜时段` : ""}。`;
}

function ReportView({ report, onDelete }: { report: ReportFull; onDelete: (id: string) => void }): ReactNode {
  const s = report.stats;
  const night = s.totalEvents === 0 ? 0 : Math.round((s.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0) / s.totalEvents) * 100);
  const topTools = Object.entries(s.toolCalls ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const totalTokens = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.reasoning;
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [samplesShown, setSamplesShown] = useState(false);
  const danger = (s.dangerousCommands ?? []).map((d) => ({ ...d, label: d.label ?? "未分类", sev: d.sev ?? "amber" }));
  const shownDanger = dangerExpanded ? danger.slice(0, 30) : danger.slice(0, 3);
  const summary = dangerSummary(danger);

  // 导出 PDF = 打印面板报告本身：把当前报告克隆到 body 顶层（打印 CSS 只显示它），
  // 浏览器打印对话框 → 另存为 PDF。与面板逐像素一致，数据同源。
  const exportPdf = (): void => {
    const source = document.querySelector<HTMLElement>("[data-whale-report-report]");
    if (source === null) return;
    const clone = prepareExportClone(source);
    const host = document.createElement("div");
    host.setAttribute("data-whale-report-print-root", "");
    host.appendChild(clone);
    document.body.appendChild(host);
    window.print();
    host.remove();
  };

  const delta = report.prev !== undefined && report.prev.cost > 0 && typeof report.cost?.total === "number"
    ? Math.round(((report.cost.total - report.prev.cost) / report.prev.cost) * 100)
    : null;
  return (
    <div data-whale-report-report>
      <header data-whale-report-reportopening>
        <img
          src="/whale/assets/whale-hero.svg"
          alt=""
          data-whale-report-reporthero
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div data-whale-report-headrow>
          <div>
            <div data-whale-report-reportlabel>{traceCode(report.preset, report.to)} / AGENT RESEARCH REPORT</div>
            <div data-whale-report-reptitle>深迹 {PRESETS.find((p) => p.key === report.preset)?.label ?? "报告"}</div>
            <div data-whale-report-repsub>{dateStr(report.from)} — {dateStr(report.to)} / CONTEXT ONLINE</div>
          </div>
          <div data-whale-report-actions>
            <button data-whale-report-btn data-ghost="true" onClick={() => onDelete(report.id)}>删除</button>
            <button
              data-whale-report-btn
              data-ghost="true"
              onClick={() => {
                void exportReportImage(report, "main").catch((err: unknown) => {
                  window.alert(`导出图片失败：${err instanceof Error ? err.message : String(err)}`);
                });
              }}
            >
              图片
            </button>
            <button
              data-whale-report-btn
              data-ghost="true"
              onClick={() => {
                void exportReportImage(report, "trace").catch((err: unknown) => {
                  window.alert(`导出会话轨迹失败：${err instanceof Error ? err.message : String(err)}`);
                });
              }}
            >
              会话轨迹
            </button>
            <button
              data-whale-report-btn
              data-ghost="true"
              onClick={() => {
                window.open(`/whale/api/html?id=${encodeURIComponent(report.id)}`, "_blank");
              }}
            >
              HTML
            </button>
            <button data-whale-report-btn onClick={exportPdf}>导出 PDF</button>
          </div>
        </div>
        <div data-whale-report-openingcost>¥{typeof report.cost?.total === "number" ? report.cost.total.toFixed(2) : "—"}</div>
        <div data-whale-report-herodelta2>
          {delta === null ? (
            <span className="muted">BASELINE / 首次记录</span>
          ) : (
            <><em className={delta > 0 ? "up" : "down"}>{delta > 0 ? "↑" : "↓"} {Math.abs(delta)}%</em><span> vs 上周期</span></>
          )}
        </div>
        <div data-whale-report-statgrid>
          <div data-whale-report-stat><b>{s.sessions}</b><span>Sessions</span></div>
          <div data-whale-report-stat><b>{s.turns}</b><span>Turns</span></div>
          <div data-whale-report-stat><b>{fmt(s.toolCallsTotal)}</b><span>Tool calls</span></div>
          <div data-whale-report-stat><b>{fmt(s.commands)}</b><span>Commands</span></div>
          <div data-whale-report-stat><b>{fmt(totalTokens)}</b><span>Token burn</span></div>
          <div data-whale-report-stat><b>{cacheRate(s)}%</b><span>Cache hit</span></div>
        </div>
      </header>

      <WhaleNote report={report} />

      <section data-whale-report-reportsection>
        <SectionHeader index="02" title="本期发现" meta="FINDINGS / INVESTIGATION LOG" />
        {(report.insights ?? []).filter((item) => item.level !== "info").length > 0
          ? <InsightsSection insights={report.insights ?? []} />
          : <div data-whale-report-tokenline>本期没有需要升级处理的异常。PING / OK</div>}
      </section>

      {(() => {
        const collab = report.stats.collab !== undefined
          ? computeCollaborationInsights({ ...report.stats.collab, sessions: report.stats.sessions })
          : [];
        if (collab.length === 0) return null;
        return (
          <section data-whale-report-reportsection>
            <SectionHeader index="03" title="协作复盘" meta="HUMAN × HARNESS / COLLABORATION REVIEW" />
            {collab.map((item) => (
              <div key={item.code} data-whale-report-collab>
                <div data-whale-report-collabcode>{item.code}</div>
                <div data-whale-report-collabtitle>{item.title}</div>
                <div data-whale-report-collabobs>观察：{item.observation}</div>
                <div data-whale-report-collabtip><b>建议</b>：{item.suggestion}</div>
              </div>
            ))}
          </section>
        );
      })()}

      <section data-whale-report-reportsection>
        <SectionHeader index="04" title="活跃与 Token" meta={`ACTIVITY / NIGHT ${night}%`} />
        <div data-whale-report-reportgrid>
          <div data-whale-report-subsection data-whale-report-zone>
            <div data-whale-report-scanmeta>
              <span>SCAN <b>00—24</b></span><span>DEPTH <b>4,096m</b></span><span>PING <b>OK</b></span><span>NIGHT <b>{night}%</b></span>
            </div>
            <ActivityStrip report={report} />
            <div data-whale-report-tokenline style={{ marginTop: 12 }}>
              活跃 {s.activeDays} 天
              {s.busiestDay ? <> · 最忙 <b>{s.busiestDay.date}</b>（{s.busiestDay.events} 条事件）</> : null}
            </div>
          </div>
          <div data-whale-report-subsection>
            <div data-whale-report-h2>RESOURCE / TOKEN PROFILE</div>
            <TokenBar tokens={s.tokens} />
            <div data-whale-report-tokenline style={{ marginTop: 14 }}>
              共消耗 <b>{fmt(totalTokens)}</b> token；缓存命中 <b>{cacheRate(s)}%</b>。
            </div>
          </div>
        </div>
      </section>

      <section data-whale-report-reportsection>
        <SectionHeader index="05" title="模型与工具" meta="ALLOCATION / INSTRUMENTATION" />
        <div data-whale-report-reportgrid="equal">
          <div data-whale-report-subsection>
            <div data-whale-report-h2>MODEL ALLOCATION</div>
            <ModelTable models={s.models ?? {}} cost={report.cost} />
            {typeof report.cost?.total === "number" && report.cost.total > 0 && (
              <div data-whale-report-tokenline style={{ marginTop: 10 }}>
                预估合计 <b>¥{report.cost.total.toFixed(2)}</b>
                <span className="muted"> · {report.cost.source === "official-page" ? "官方定价页实时价" : "内置价"} · 以平台账单为准</span>
              </div>
            )}
          </div>
          <div data-whale-report-subsection>
            <div data-whale-report-h2>TOOL CALL LEDGER</div>
            {topTools.length === 0 ? (
              <div data-whale-report-tokenline>（没有调用工具）</div>
            ) : (
              <div data-whale-report-toollist>
                {toolFamilies(s.toolCalls ?? {}).map((fam) => (
                  <div key={fam.family} data-whale-report-toolrow><code>{fam.family}</code><b>{fam.count}</b></div>
                ))}
              </div>
            )}
            {(s.plugins ?? []).length > 0 && (
              <div data-whale-report-tokenline style={{ marginTop: 12 }} className="muted">
                PLUGINS / {(s.plugins ?? []).join(" · ")}
              </div>
            )}
          </div>
        </div>
      </section>

      <section data-whale-report-reportsection>
        <SectionHeader index="06" title="风险扫描" meta="RISKS / SECRET SCAN" />
        <div data-whale-report-reportgrid="equal">
          <div data-whale-report-risk data-severity={danger.some((d) => d.sev === "red") ? "critical" : "warning"}>
            <div data-whale-report-h2>DANGEROUS OPERATIONS / {danger.length}</div>
            {danger.length === 0 ? (
              <div data-whale-report-tokenline>未检测到危险操作。STATUS / CLEAR</div>
            ) : (
              <>
                <div data-whale-report-dangersum>{summary}</div>
                <div data-whale-report-dangercats>
                  {[...danger.reduce((m, d) => m.set(d.label, (m.get(d.label) ?? 0) + 1), new Map<string, number>()).entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([label, count]) => <span key={label} data-whale-report-dangercat>{label} <b>{count}</b></span>)}
                </div>
                <button
                  data-whale-report-chip data-whale-report-samplesbtn
                  onClick={() => { setSamplesShown(!samplesShown); setDangerExpanded(false); }}
                >
                  {samplesShown ? "收起样本" : `查看样本（${danger.length}）`}
                </button>
                {samplesShown && (
                  <>
                    {shownDanger.map((d, i) => (
                      <div key={i} data-whale-report-danger>
                        {d.command.replace(/\s+/g, " ").slice(0, 64)}
                        <em>{d.label} · {new Date(d.time).toISOString().slice(0, 16).replace("T", " ")}</em>
                      </div>
                    ))}
                    {danger.length > 3 && !dangerExpanded && (
                      <button data-whale-report-chip onClick={() => setDangerExpanded(true)}>展开更多</button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          {(() => {
            const hits = s.secretHits ?? [];
            return (
              <div data-whale-report-risk data-severity={hits.length > 0 ? "critical" : "warning"}>
                <div data-whale-report-h2>SECRET SCAN / {hits.length}</div>
                {hits.length === 0 ? (
                  <div data-whale-report-tokenline>未发现疑似密钥或令牌。STATUS / CLEAR</div>
                ) : (
                  <>
                    <div data-whale-report-tokenline>疑似密钥/令牌出现在会话中，未展示原文。</div>
                    <div data-whale-report-dangercats style={{ marginTop: 10 }}>
                      {[...hits.reduce((m: Map<string, number>, h: { label: string }) => m.set(h.label, (m.get(h.label) ?? 0) + 1), new Map<string, number>()).entries()].map(([label, count]) => (
                        <span key={label} data-whale-report-secretcat>{label} <b>{count}</b></span>
                      ))}
                    </div>
                    <div data-whale-report-tokenline>建议尽快轮换对应密钥。</div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </section>

      {(s.sessionsDetail ?? []).length > 0 && (
        <SessionDrilldown sessions={s.sessionsDetail ?? []} totalCost={report.cost?.total} index="07" />
      )}

      {(s.titles ?? []).length > 0 && (
        <section data-whale-report-reportsection>
          <SectionHeader index="08" title="会话索引" meta="APPENDIX / TITLES" />
          <ul data-whale-report-titles>
            {s.titles.slice(0, 8).map((t) => <li key={t}>{t}</li>)}
          </ul>
        </section>
      )}

      <div data-whale-report-tokenline style={{ fontSize: 10, marginTop: 34, paddingTop: 12, borderTop: "1px solid var(--dt-line)" }} className="muted">
        {report.reportGeneration !== undefined && (
          <div data-whale-report-repmeta>
            REPORT GENERATION · {fmt(report.reportGeneration.totalTokens)} TOKENS ·{" "}
            {report.reportGeneration.mode === "local" ? "LOCAL DETERMINISTIC" : `MODEL${report.reportGeneration.model !== undefined ? ` · ${report.reportGeneration.model}` : ""}`}
          </div>
        )}
        BASED ON {s.totalEvents} SESSION EVENTS · READ ONLY · GENERATED {dateStr(report.createdAt)}
      </div>
    </div>
  );
}

// ─────────────────────────── 核心内容组件（抽屉与 Tab 共用） ───────────────────────────

interface ContentState {
  toast: string | null;
  view: "dashboard" | "report" | "history";
  preset: (typeof PRESETS)[number]["key"];
  from: string;
  to: string;
  loading: boolean;
  error: string | null;
  dashboard: ReportFull | null;
  current: ReportFull | null;
  history: ReportMeta[] | null;
}

/** 洞察预览行（紧凑 Feed：标题 + 一行数据预览）。 */
function insightPreview(insight: InsightJson, s: StatsJson): string | null {
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

class WhaleContent extends Component<Record<string, never>, ContentState> {
  state: ContentState = {
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
  customDebounce: number | undefined;

  componentDidMount(): void {
    void this.loadDashboard(this.state.preset);
  }

  setToast(message: string): void {
    this.setState({ toast: message });
    window.setTimeout(() => {
      this.setState((prev) => (prev.toast === message ? { ...prev, toast: null } : prev));
    }, 4000);
  }

  /** 仪表盘：当前周期数据（有则复用，无则生成）。preset 显式传入，避免 setState 异步竞态。 */
  async loadDashboard(preset: ContentState["preset"]): Promise<void> {
    const seq = ++this.requestSeq;
    this.setState({ loading: true, error: null });
    try {
      const payload =
        preset === "custom"
          ? { preset: "custom", from: this.state.from, to: this.state.to }
          : { preset };
      const response = await fetch("/whale/api/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { ok: boolean; report: ReportFull; error?: { message?: string } };
      if (!response.ok || body.ok === false) throw new Error(body.error?.message ?? "生成失败");
      // 只应用最新一次请求的结果（快速切换周期时旧响应不得覆盖新响应）。
      if (seq !== this.requestSeq) return;
      this.setState({ dashboard: body.report, current: body.report, loading: false, view: "dashboard" });
    } catch (error) {
      if (seq !== this.requestSeq) return;
      this.setState({ loading: false });
      this.setToast(error instanceof Error ? error.message : String(error));
    }
  }

  async loadHistory(): Promise<void> {
    try {
      const body = await api<{ reports: ReportMeta[] }>("list");
      this.setState({ history: body.reports });
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : String(error));
    }
  }

  async openHistory(id: string): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      const response = await fetch(`/whale/api/get?id=${encodeURIComponent(id)}`);
      const json = (await response.json()) as { ok: boolean; report: ReportFull };
      if (!response.ok || json.ok === false) throw new Error("报告不存在");
      this.setState({ current: json.report, loading: false, view: "report" });
    } catch (error) {
      this.setState({ loading: false });
      this.setToast(error instanceof Error ? error.message : String(error));
    }
  }

  async deleteReport(id: string): Promise<void> {
    try {
      await api<{ ok: boolean }>("delete", { id });
      this.setState({ current: null, dashboard: null, history: null, view: "dashboard" });
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : String(error));
    }
  }

  render(): ReactNode {
    const { view, preset, loading, error, dashboard, current, history } = this.state;
    return (
      <>
        <div data-whale-report-tabs>
          <button data-whale-report-tab data-active={view === "dashboard"} onClick={() => this.setState({ view: "dashboard" })}>
            概览
          </button>
          <button data-whale-report-tab data-active={view === "report"} onClick={() => this.setState({ view: "report" })}>
            报告
          </button>
          <button
            data-whale-report-tab
            data-active={view === "history"}
            onClick={() => {
              this.setState({ view: "history" });
              if (history === null) void this.loadHistory();
            }}
          >
            历史
          </button>
        </div>

        {this.state.toast !== null && (
          <div data-whale-report-toast>{this.state.toast}</div>
        )}

        {view === "dashboard" && (
          <Dashboard
            state={this.state}
            onPreset={(p) => {
              this.setState({ preset: p });
              void this.loadDashboard(p);
            }}
            onCustom={(from, to) => {
              this.setState({ from, to });
              if (this.customDebounce !== undefined) window.clearTimeout(this.customDebounce);
              this.customDebounce = window.setTimeout(() => {
                this.customDebounce = undefined;
                void this.loadDashboard("custom");
              }, 400);
            }}
            onOpenReport={() => this.setState({ view: "report" })}
          />
        )}

        {view === "report" && current !== null && (
          <div data-whale-report-body>
            <ReportView report={current} onDelete={(id) => void this.deleteReport(id)} />
          </div>
        )}
        {view === "report" && current === null && !loading && (
          <div data-whale-report-body>
            <div data-whale-report-empty>先回到概览生成一份报告</div>
          </div>
        )}

        {view === "history" && history === null && <div data-whale-report-loading>加载中…</div>}
        {view === "history" && history !== null && history.length === 0 && (
          <div data-whale-report-empty>暂无报告</div>
        )}
        {view === "history" && history !== null && history.length > 0 && (
          <div data-whale-report-body>
            <div data-whale-report-historyhead>
              <div data-whale-report-overline>ARCHIVE / TRACE INDEX</div>
              <div data-whale-report-sectiontitle style={{ marginTop: 7 }}>历史报告</div>
            </div>
            {history.map((item) => (
              <div key={item.id} data-whale-report-hitem onClick={() => void this.openHistory(item.id)}>
                <b>
                  {PRESETS.find((p) => p.key === item.preset)?.label ?? item.preset} · {dateStr(item.from)} ~ {dateStr(item.to)}
                </b>
                <span>
                  {item.sessions} 会话 · {item.turns} 回合 · {fmt(item.totalEvents)} 事件 · {dateStr(item.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }
}

/** Provider Balance：模型平台余额（live instrumentation module）。
 * 服务端只读探针：key 永不出宿主进程；余额查询失败绝不影响报告加载。 */
interface BalanceJson {
  provider: string;
  name: string;
  status: "connected" | "invalid-key" | "timeout" | "unavailable" | "error";
  balance?: { currency: string; total: number; granted: number; toppedUp: number };
  isAvailable?: boolean;
  checkedAt: number;
  error?: string;
}

const BALANCE_STATUS_LABEL: Record<BalanceJson["status"], string> = {
  connected: "可用",
  "invalid-key": "密钥无效",
  timeout: "请求超时",
  unavailable: "不可用",
  error: "接口异常",
};

function ProviderBalanceCard(): ReactNode {
  const [data, setData] = useState<BalanceJson | null>(null);
  const [loading, setLoading] = useState(false);
  const load = (refresh: boolean): void => {
    setLoading(true);
    fetch(`/whale/api/balance${refresh ? "?refresh=1" : ""}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ ok: boolean; balance: BalanceJson }>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => setData(json.balance))
      .catch(() =>
        setData({ provider: "deepseek", name: "DeepSeek", status: "unavailable", checkedAt: Date.now(), error: "NETWORK" }),
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load(false);
  }, []);
  // 瞬时错误（超时/网络）自动重试一次，避免用户手动点刷新。
  useEffect(() => {
    if (data === null || data.status === "connected" || data.status === "invalid-key" || data.status === "unavailable") return;
    const timer = window.setTimeout(() => load(false), 3000);
    return () => window.clearTimeout(timer);
  }, [data]);
  const money = (n: number | undefined): string => (n === undefined ? "—" : `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const liveTime = data !== null ? new Date(data.checkedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "——";
  return (
    <div data-whale-report-balance>
      <div data-whale-report-balancehead>
        <span data-whale-report-balancelabel>PROVIDER BALANCE / 模型余额</span>
        <button
          data-whale-report-balancebtn
          data-live={!loading}
          disabled={loading}
          onClick={() => load(true)}
        >
          {loading ? "检查中…" : "刷新"}
        </button>
      </div>
      <div data-whale-report-balancehead style={{ marginTop: 5 }}>
        <span data-whale-report-balancename>{data?.name ?? "DeepSeek"}</span>
        <span data-whale-report-balancestatus>
          {data === null ? "CONNECTING…" : `${BALANCE_STATUS_LABEL[data.status]} · ${data.status.toUpperCase()}`}
        </span>
      </div>
      {data !== null && data.status === "connected" && data.balance !== undefined ? (
        <>
          <div data-whale-report-balanceval>
            {money(data.balance.total)}<small>{data.balance.currency}{data.isAvailable === false ? " · 余额不足" : ""}</small>
          </div>
          <div data-whale-report-balancebreak>
            充值余额 {money(data.balance.toppedUp)} · 赠送余额 {money(data.balance.granted)}
          </div>
        </>
      ) : (
        <div data-whale-report-balanceval>
          —<small>{data === null ? "CONNECTING" : (data.error ?? "UNAVAILABLE")}</small>
        </div>
      )}
      <div data-whale-report-balancefoot>
        <span>LIVE · {liveTime} · READ ONLY</span>
        <span>KEY NEVER LEAVES LOCAL HOST</span>
      </div>
    </div>
  );
}

/** 概览（打开即报告）：Hero 大数字 + 洞察 Feed + 活跃 + 模型。 */
function Dashboard(props: {
  state: ContentState;
  onPreset: (p: ContentState["preset"]) => void;
  onCustom: (from: string, to: string) => void;
  onOpenReport: () => void;
}): ReactNode {
  const { state, onPreset, onCustom, onOpenReport } = props;
  const { preset, loading, error, dashboard, from, to } = state;
  const report = dashboard;
  const s = report?.stats;
  const cost = report?.cost?.total;
  const delta = report?.prev !== undefined && report.prev.cost > 0 && cost !== undefined
    ? Math.round(((cost - report.prev.cost) / report.prev.cost) * 100)
    : null;
  const levelWeight: Record<string, number> = { critical: 0, warning: 1, tip: 2 };
  const insights = (report?.insights ?? [])
    .filter((i) => i.level !== "info")
    .sort((a, b) => (levelWeight[a.level] ?? 3) - (levelWeight[b.level] ?? 3));
  const totalTokens = s !== undefined ? s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.reasoning : 0;
  const night = s === undefined || s.totalEvents === 0
    ? 0
    : Math.round((s.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0) / s.totalEvents) * 100);
  const modelRows = (() => {
    if (s === undefined) return [];
    const entries = Object.entries(s.models ?? {}).sort(
      (a, b) => b[1].input + b[1].output + b[1].cacheRead + b[1].reasoning - (a[1].input + a[1].output + a[1].cacheRead + a[1].reasoning),
    );
    const grand = entries.reduce((sum, [, u]) => sum + u.input + u.output + u.cacheRead + u.reasoning, 0);
    return entries.map(([model, u]) => {
      const t = u.input + u.output + u.cacheRead + u.reasoning;
      return { model, total: t, share: grand > 0 ? Math.round((t / grand) * 100) : 0, cost: report?.cost?.perModel?.[model] };
    });
  })();
  return (
    <div data-whale-report-body>
      <div data-whale-report-brand>
        <div data-whale-report-brandcopy>
          <div data-whale-report-brandkicker>{traceCode(preset, report?.to)} / DSH</div>
          <div data-whale-report-brandname>深迹 <span>DeepTrace</span></div>
          <div data-whale-report-brandtag>Your Agent,<br />in numbers.</div>
          <div data-whale-report-brandmeta aria-hidden="true">
            <span>CONTEXT ONLINE</span><span>THINKING / READY</span>{s !== undefined && <span>CACHE HIT {cacheRate(s)}%</span>}
          </div>
        </div>
        <div data-whale-report-brandvisual aria-hidden="true">
          <div data-whale-report-sonar><i /><i /><i /></div>
          <div data-whale-report-depthscale />
          <img
            src="/whale/assets/whale-hero.svg"
            width={166}
            height={166}
            alt=""
            data-whale-report-heroimg
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      </div>

      <div data-whale-report-chips>
        {PRESETS.map((p) => (
          <button key={p.key} data-whale-report-chip data-active={preset === p.key} onClick={() => onPreset(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div data-whale-report-inputs>
          <input type="date" value={from} onChange={(e) => onCustom(e.target.value, to)} />
          <input type="date" value={to} onChange={(e) => onCustom(from, e.target.value)} />
        </div>
      )}

      <ProviderBalanceCard />

      {loading && (
        <div data-whale-report-loadingbar>
          <i />
          <span>更新中…</span>
        </div>
      )}

      {loading && report === null && (
        <div data-whale-report-skeleton>
          <div data-whale-report-sk-hero />
          <div data-whale-report-sk-line />
          <div data-whale-report-sk-line />
          <div data-whale-report-sk-line />
        </div>
      )}
      {!loading && report === null && (
        <div data-whale-report-loading>暂无数据，点击上方周期生成</div>
      )}

      {report !== null && s !== undefined && (
        <>
          <div data-whale-report-hero>
            <div data-whale-report-herohead>
              <div data-whale-report-herolabel>{HERO_LABEL[preset] ?? "Agent 消耗"} / ESTIMATED COST</div>
              <div data-whale-report-heroval>¥{typeof cost === "number" ? cost.toFixed(2) : "—"}</div>
              <div data-whale-report-herodelta2>
                {delta === null ? (
                  <span className="muted">BASELINE / 首次记录，下期起可对比</span>
                ) : (
                  <><em className={delta > 0 ? "up" : "down"}>{delta > 0 ? "↑" : "↓"} {Math.abs(delta)}%</em><span> vs 上周期</span></>
                )}
              </div>
            </div>
            <div data-whale-report-herostat>
              <span><b>{s.sessions}</b> 会话</span>
              <span><b>{fmt(s.toolCallsTotal)}</b> 工具调用</span>
              <span><b>{fmt(totalTokens)}</b> Tokens</span>
              <span><b>{cacheRate(s)}%</b> Cache hit</span>
            </div>
          </div>

          {insights.length > 0 && (
            <section data-whale-report-section>
              <SectionHeader index="01" title="值得注意" meta="FINDINGS / INVESTIGATION LOG" />
              <InsightFeed insights={insights.slice(0, 3)} stats={s} />
              {insights.length > 3 && (
                <button data-whale-report-feedmore onClick={onOpenReport}>
                  还有 {insights.length - 3} 条洞察，见完整报告 →
                </button>
              )}
            </section>
          )}

          {(() => {
            const kinds = triggerNotes(report.stats);
            const quote = kinds.length > 0
              ? NOTE_TEMPLATES[kinds[0]].light[1] ?? NOTE_TEMPLATES[kinds[0]].light[0]
              : "这期数据很干净呢，一点幺蛾子都没有。";
            return (
              <div data-whale-report-note-short onClick={onOpenReport}>
                <WhaleFace mood={whaleMood(report.stats)} size={62} />
                <div>
                  <div data-whale-report-notecode>WHALE NOTE / OBSERVER</div>
                  <b>本期鲸评</b>
                  <span>“{quote}”</span>
                </div>
              </div>
            );
          })()}

          <section data-whale-report-section>
            <SectionHeader index="02" title="活跃扫描" meta={`SONAR / NIGHT ${night}%`} />
            <div data-whale-report-zone>
              <div data-whale-report-scanmeta>
                <span>SCAN <b>00—24</b></span><span>DEPTH <b>4,096m</b></span><span>PING <b>OK</b></span><span>NIGHT <b>{night}%</b></span>
              </div>
              <ActivityStrip report={report} />
            </div>
          </section>

          {modelRows.length > 0 && (
            <section data-whale-report-section>
              <SectionHeader index="03" title="模型分配" meta="RESOURCE / ALLOCATION" />
              <div data-whale-report-modeltable>
                {modelRows.map((m, index) => (
                  <div key={m.model} data-whale-report-modelrow>
                    <span data-whale-report-modelrank>{String(index + 1).padStart(2, "0")}</span>
                    <div data-whale-report-modelhead>
                      <b>{m.model}</b>
                      <span>{m.share}% / ¥{typeof m.cost === "number" ? m.cost.toFixed(1) : "—"}</span>
                    </div>
                    <div data-whale-report-modelbar>
                      <i style={{ width: `${m.share}%`, background: "#4d6bfe" }} />
                    </div>
                    <div data-whale-report-modelnums>TOTAL {fmt(m.total)} TOKEN</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(s.sessionsDetail ?? []).length > 0 && (
            <SessionDrilldown sessions={(s.sessionsDetail ?? []).slice(0, 5)} totalCost={cost} index="04" />
          )}

          <button data-whale-report-btn data-whale-report-fullbtn onClick={onOpenReport}>
            Open full research report →
          </button>
        </>
      )}
    </div>
  );
}

/**
 * 长图导出：canvas 按面板报告同款视觉逐块绘制完整内容（零依赖、无 canvas 污染问题）。
 * - 内容与报告一致：报告头/鲸评/Findings/活跃+Token/模型与工具/风险扫描/会话轨迹/会话索引/页脚；
 * - 数据口径与面板同源（cacheRate/night/delta/费用占比/鲸评规则全部复用同一函数）；
 * - 高度：budgetExportHeight 随内容精确增长 + 绘制完成后按实际高度裁剪，任何周期都不裁切。
 */

/** 导出模式：main = 主报告（不含会话轨迹/索引）；trace = 单独导出会话轨迹+会话索引。 */
export type ExportSections = "main" | "trace";

/** 导出预算：逻辑高度（px）。与绘制使用同一组数据与行高常量，随内容单调增长。 */
export function budgetExportHeight(report: ReportFull, sections: ExportSections = "main"): number {
  const s = report.stats;
  const P = 28;
  const sessions = s.sessionsDetail ?? [];
  const titles = s.titles ?? [];
  if (sections === "trace") {
    // 独立会话轨迹页：头（标题/日期/统计）+ 06 会话轨迹 + 07 会话索引 + 页脚
    let h = P * 2 + 12 + 24 + 30 + 16 + 16 + 44 + 2 * 32 + 14;
    h += 18 + 26 + 12 + sessions.length * 44 + 12; // 06 会话轨迹
    h += 18 + 26 + 12 + titles.length * 19 + 12; // 07 会话索引
    h += 26; // 页脚
    return Math.min(Math.ceil(h * 1.12) + 140, 32000);
  }
  const totalTokens = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.reasoning;
  const hist = s.dayHourSeries ?? [];
  const cellW = (W - P * 2 - 30) / 24;
  const activityRows = Math.min(hist.length, 7);
  const insights = (report.insights ?? []).filter((i) => i.level !== "info");
  const noteLines = triggerNotes(s).length > 0 ? NOTE_TEMPLATES[triggerNotes(s)[0]].light.length : 1;
  const danger = s.dangerousCommands ?? [];
  const bursts = (s.burstSamples ?? []).slice(0, 8);
  const modelEntries = Object.entries(s.models ?? {});
  const toolEntries = Object.entries(s.toolCalls ?? {}).slice(0, 10);
  const families = toolFamilies(s.toolCalls ?? {});
  const statLines = 2;
  let h = P * 2 + 12 + 26 + 34 + 18 + 16 + 44 + statLines * 32 + 14; // 报告头（含 6 统计 2 行）
  h += 10 + 58 + noteLines * 21 + 14 + 10; // 鲸评卡
  h += 18 + 26 + 12 + (insights.length === 0 ? 18 : insights.length * 84) + 10; // 02 Findings
  const collabShort = computeCollaborationInsights({ ...(s.collab ?? { userMessages: 0, revisions: 0, lateConstraints: 0, sessionsWithRevision: 0, shortSessions: 0 }), sessions: s.sessions });
  h += collabShort.length > 0 ? 18 + 26 + 12 + collabShort.length * 36 + 8 : 0; // 协作复盘（简短）
  h += 18 + 26 + 12 + 16 + (activityRows > 0 ? activityRows * (cellW + 3) + 6 : 0) + 18 + 26 + 16 + 12; // 03 活跃 + TokenBar
  h += 18 + 26 + 12 + modelEntries.length * 26 + families.length * 18 + 18 + toolEntries.length * 19 + 12; // 04 模型与工具
  h += 18 + 26 + 12 + danger.length * 21 + 18 + (bursts.length > 0 ? bursts.length * 19 : 18) + 18 + 12; // 05 风险
  h += 26 + 16; // 页脚（含 REPORT GENERATION 行）
  return Math.min(Math.ceil(h * 1.12) + 140, 32000);
}

type ModelUsageLike = { input: number; output: number; cacheRead: number; reasoning: number };
const W = 720;

/** 短时间格式（与面板会话详情一致）。 */
function timeStr(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
const EXPORT_SANS = `"PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif`;
const EXPORT_MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
const C = {
  paper: "#f5f8f9",
  ink: "#0b1733",
  inkSoft: "#33445f",
  muted: "#6e7c8f",
  faint: "#94a2b3",
  line: "#d9e3e8",
  lineStrong: "#b9c9d3",
  blue: "#4d6bfe",
  cyan: "#36b9d1",
  red: "#c83a48",
  amber: "#b87519",
  safe: "#31765a",
  white: "#ffffff",
};

/** 导出/打印共用的报告克隆（打印路径用）：移除操作按钮、绝对化图片路径、注入 DeepTrace 样式。 */
function prepareExportClone(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.setAttribute("data-whale-report", ""); // 继承 DeepTrace 变量与字体
  clone.style.backgroundColor = "var(--dt-paper)"; // 与抽屉底色一致
  clone.querySelectorAll("[data-whale-report-actions]").forEach((el) => el.remove());
  // 打印页面内相对 URL 无法解析？打印走真实页面（body 顶层），相对路径仍可用，这里仅兜底转绝对。
  clone.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (src !== null && src.startsWith("/")) {
      img.setAttribute("src", new URL(src, window.location.href).href);
    }
  });
  const style = document.createElement("style");
  style.setAttribute("data-export", "");
  style.textContent = CSS;
  clone.prepend(style);
  return clone;
}

/** 手绘鲸鱼脸（与 WhaleFace SVG 同款蓝白卡通，按 mood 换眼睛嘴巴）。 */
function drawWhaleFace(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, mood: string): void {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;
  ctx.fillStyle = C.blue;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5b78ff";
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#dbe4ff";
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.3, r * 0.4, r * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.ink;
  const eyeY = cy - r * 0.22;
  if (mood === "angry") {
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - r * 0.3, eyeY - r * 0.18); ctx.lineTo(cx - r * 0.02, eyeY + r * 0.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + r * 0.3, eyeY - r * 0.18); ctx.lineTo(cx + r * 0.02, eyeY + r * 0.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - r * 0.28, cy + r * 0.34); ctx.lineTo(cx + r * 0.28, cy + r * 0.34); ctx.stroke();
  } else if (mood === "sleepy") {
    ctx.beginPath(); ctx.moveTo(cx - r * 0.3, eyeY); ctx.lineTo(cx - r * 0.02, eyeY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + r * 0.02, eyeY); ctx.lineTo(cx + r * 0.3, eyeY); ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.arc(cx, cy + r * 0.34, r * 0.09, 0, Math.PI * 2); ctx.fill();
  } else if (mood === "dazed") {
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.arc(cx - r * 0.2, eyeY, r * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + r * 0.2, eyeY, r * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(cx - r * 0.2, cy + r * 0.36); ctx.quadraticCurveTo(cx, cy + r * 0.28, cx + r * 0.2, cy + r * 0.36); ctx.stroke();
  } else {
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.arc(cx - r * 0.2, eyeY, r * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + r * 0.2, eyeY, r * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(cx - r * 0.2, cy + r * 0.24); ctx.quadraticCurveTo(cx, cy + r * 0.42, cx + r * 0.2, cy + r * 0.24); ctx.stroke();
  }
  ctx.fillStyle = "#ffb4c8";
  ctx.beginPath(); ctx.arc(cx - r * 0.45, cy + r * 0.1, r * 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + r * 0.45, cy + r * 0.1, r * 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "transparent";
  ctx.lineWidth = 1;
}

/** 加载同源素材（与面板 WhaleFace 相同策略：png 优先，svg 回退）。 */
function loadAssetImage(...names: string[]): Promise<HTMLImageElement | null> {
  const tryLoad = (src: string): Promise<HTMLImageElement | null> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  return names.reduce(
    (chain, name) => chain.then((found) => (found !== null ? found : tryLoad(`/whale/assets/${name}`))),
    Promise.resolve<HTMLImageElement | null>(null),
  );
}

/** 长图导出：main = 主报告（报告头/鲸评/Findings/活跃/模型工具/风险，不含会话轨迹与索引）；
 *  trace = 单独导出会话轨迹 + 会话索引。鲸鱼娘与报告面板一致（真实素材，png→svg 回退，缺图才手绘）。 */
export async function exportReportImage(report: ReportFull, sections: ExportSections = "main"): Promise<void> {
  const s = report.stats;
  const scale = 2;
  const P = 28;
  const rowH = (font: number) => Math.round(font * 1.5);
  const maxText = W - P * 2;
  const totalTokens = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.reasoning;
  const cost = typeof report.cost?.total === "number" ? report.cost.total : null;
  const costText = cost !== null ? `¥${cost.toFixed(2)}` : "—";
  const delta = report.prev !== undefined && report.prev.cost > 0 && cost !== null
    ? Math.round(((cost - report.prev.cost) / report.prev.cost) * 100)
    : null;
  const night = s.totalEvents === 0 ? 0 : Math.round((s.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0) / s.totalEvents) * 100);
  const insights = (report.insights ?? []).filter((i) => i.level !== "info");
  const mood = whaleMood(s);
  const kinds = triggerNotes(s);
  const noteLines = kinds.length > 0 ? NOTE_TEMPLATES[kinds[0]].light : ["这期数据很干净呢，一点幺蛾子都没有。"];
  const hist = s.dayHourSeries ?? [];
  const cellW = (W - P * 2 - 30) / 24;
  const activityRows = Math.min(hist.length, 7);
  const danger = (s.dangerousCommands ?? []).map((d) => ({ ...d, sev: d.sev ?? "amber" }));
  const bursts = (s.burstSamples ?? []).slice(0, 8);
  const secretHits = s.secretHits ?? [];
  const secretCounts = new Map<string, number>();
  for (const hit of secretHits) secretCounts.set(hit.label, (secretCounts.get(hit.label) ?? 0) + 1);
  const sessions = s.sessionsDetail ?? [];
  const resolvedTotal = cost !== null && cost > 0 ? cost : sessions.reduce((sum, sd) => sum + sd.cost, 0);
  const tot = (u: ModelUsageLike) => u.input + u.output + u.cacheRead + u.reasoning;
  const modelEntries = Object.entries(s.models ?? {}).sort((a, b) => tot(b[1]) - tot(a[1]));
  const toolEntries = Object.entries(s.toolCalls ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const families = toolFamilies(s.toolCalls ?? {});
  const titles = s.titles ?? [];
  // 鲸鱼娘真实素材（png 优先，svg 回退；与面板显示一致）
  const faceImg = await loadAssetImage(`whale-${mood}.png`, `whale-${mood}.svg`);
  const heroImg = sections === "main" ? await loadAssetImage("whale-hero.png", "whale-hero.svg") : null;
  const presetLabel = PRESETS.find((p) => p.key === report.preset)?.label ?? "报告";

  const height = budgetExportHeight(report, sections);
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  ctx.scale(scale, scale);
  ctx.fillStyle = C.white;
  ctx.fillRect(0, 0, W, height);

  const ellipsis = (raw: string, maxWidth: number, size: number): string => {
    if (ctx.measureText(raw).width <= maxWidth) return raw;
    let t = raw;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
    return t + "…";
  };
  const paint = (text: string, size: number, color: string, font: "sans" | "mono", weight: number, maxW = maxText): void => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${font === "mono" ? EXPORT_MONO : EXPORT_SANS}`;
    ctx.fillText(ellipsis(text, maxW, size), P, y + size);
    y += rowH(size);
  };
  const right = (text: string, size: number, color: string, font: "sans" | "mono"): void => {
    ctx.fillStyle = color;
    ctx.font = `400 ${size}px ${font === "mono" ? EXPORT_MONO : EXPORT_SANS}`;
    ctx.textAlign = "right";
    ctx.fillText(text, W - P, y + size);
    ctx.textAlign = "left";
  };
  const hline = (yy: number, strong = false): void => {
    ctx.strokeStyle = strong ? C.lineStrong : C.line;
    ctx.beginPath();
    ctx.moveTo(P, yy);
    ctx.lineTo(W - P, yy);
    ctx.stroke();
  };
  const sectionHead = (index: string, titleText: string, meta: string): void => {
    y += 16;
    ctx.font = `700 13px ${EXPORT_MONO}`;
    ctx.fillStyle = C.blue;
    ctx.fillText(index, P, y + 13);
    ctx.font = `700 15px ${EXPORT_SANS}`;
    ctx.fillStyle = C.ink;
    ctx.fillText(titleText, P + 34, y + 13);
    right(meta, 9.5, C.faint, "mono");
    y += 16;
    hline(y, true);
    y += 12;
  };
  let y = P;

  // ── 报告头 ──
  const headTop = y;
  paint(`${traceCode(report.preset, report.to)} · AGENT RESEARCH REPORT`, 10, C.faint, "mono", 400);
  if (sections === "main" && heroImg !== null) {
    // 与面板报告头一致：右上角 whale-hero 素材
    ctx.drawImage(heroImg, W - P - 96, headTop - 2, 96, 96);
  }
  paint(`深迹 ${presetLabel}`, 26, C.ink, "sans", 700);
  paint(`${dateStr(report.from)} — ${dateStr(report.to)} · CONTEXT ONLINE`, 11, C.muted, "sans", 400);
  y += 6;
  ctx.font = `700 44px ${EXPORT_SANS}`;
  ctx.fillStyle = C.ink;
  ctx.fillText(costText, P, y + 44);
  if (delta !== null) {
    ctx.font = `700 14px ${EXPORT_MONO}`;
    ctx.fillStyle = delta > 0 ? C.red : C.safe;
    ctx.fillText(`${delta > 0 ? "↑" : "↓"} ${Math.abs(delta)}%`, P + 160, y + 30);
    ctx.font = `400 10px ${EXPORT_MONO}`;
    ctx.fillStyle = C.muted;
    ctx.fillText("VS 上周期", P + 160, y + 46);
  } else {
    ctx.font = `400 10px ${EXPORT_MONO}`;
    ctx.fillStyle = C.faint;
    ctx.fillText("BASELINE / 首次记录，下期起可对比", P + 160, y + 44);
  }
  y += 44 + 12;
  hline(y);
  y += 14;
  const statItems: [string, string][] = [
    ["Sessions", fmt(s.sessions)],
    ["Turns", fmt(s.turns)],
    ["Tool calls", fmt(s.toolCallsTotal)],
    ["Commands", fmt(s.commands)],
    ["Token burn", fmt(totalTokens)],
    ["Cache hit", `${cacheRate(s)}%`],
  ];
  const drawStatGrid = (): void => {
    const colW = (W - P * 2) / 3;
    statItems.forEach((item, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = P + col * colW;
      const yy = y + row * 32;
      ctx.font = `700 16px ${EXPORT_SANS}`;
      ctx.fillStyle = C.ink;
      ctx.fillText(item[1], x, yy + 16);
      ctx.font = `400 9px ${EXPORT_MONO}`;
      ctx.fillStyle = C.faint;
      ctx.fillText(item[0].toUpperCase(), x, yy + 30);
      if (col > 0) {
        ctx.strokeStyle = C.line;
        ctx.beginPath();
        ctx.moveTo(x - 10, yy);
        ctx.lineTo(x - 10, yy + 30);
        ctx.stroke();
      }
    });
    y += 2 * 32 + 8;
  };
  drawStatGrid();

  // ── 鲸评卡 ──
  y += 6;
  const noteTop = y;
  const noteH = 12 + 52 + noteLines.length * 21 + 12 + 14 + 12;
  ctx.fillStyle = C.paper;
  ctx.fillRect(P, noteTop, W - P * 2, noteH);
  ctx.strokeStyle = C.line;
  ctx.strokeRect(P, noteTop, W - P * 2, noteH);
  if (faceImg !== null) {
    ctx.drawImage(faceImg, P + 12, noteTop + 14, 44, 44);
  } else {
    drawWhaleFace(ctx, P + 12, noteTop + 14, 44, mood);
  }
  ctx.font = `700 10px ${EXPORT_MONO}`;
  ctx.fillStyle = C.blue;
  ctx.fillText("WHALE NOTE / OBSERVER", P + 66, noteTop + 30);
  ctx.font = `400 9px ${EXPORT_MONO}`;
  ctx.fillStyle = C.faint;
  ctx.fillText("DEEP TRACE DATA OBSERVER", P + 66, noteTop + 44);
  y = noteTop + 52;
  for (const line of noteLines) {
    paint(`“${line}”`, 12, C.inkSoft, "sans", 400);
  }
  y += 4;
  paint("基于本期使用数据自动生成的风味评论，不影响正式报告结论。", 9, C.faint, "sans", 400);
  y = noteTop + noteH + 10;

  if (sections === "main") {
  // ── 02 Findings ──
  sectionHead("02", "本期发现", "FINDINGS / INVESTIGATION LOG");
  if (insights.length === 0) {
    paint("本期没有需要升级处理的异常。PING / OK", 11, C.muted, "sans", 400);
  }
  const levelColor: Record<string, string> = { critical: C.red, warning: C.amber, tip: "#16a34a" };
  const levelLabel: Record<string, string> = { critical: "CRITICAL", warning: "WATCH", tip: "NOTE" };
  for (const insight of insights) {
    ctx.fillStyle = levelColor[insight.level] ?? C.blue;
    ctx.beginPath();
    ctx.arc(P + 5, y + 5, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 10px ${EXPORT_MONO}`;
    ctx.fillStyle = levelColor[insight.level] ?? C.blue;
    ctx.fillText(insightCode(insight), P + 16, y + 9);
    ctx.fillStyle = C.faint;
    ctx.fillText(levelLabel[insight.level] ?? "INFO", P + 16 + ctx.measureText(insightCode(insight)).width + 10, y + 9);
    y += 14;
    paint(insight.title, 13, C.ink, "sans", 700);
    paint(insight.detail, 11, C.muted, "sans", 400);
    paint(`ACTION  ${insight.action}`, 11, C.inkSoft, "sans", 400);
    const fix = FIX_SUGGESTIONS[insight.id];
    if (fix !== undefined && fix.command !== undefined) {
      paint(fix.command, 10, C.inkSoft, "mono", 400);
    }
    y += 6;
  }

  // ── 协作复盘（简短版：最多 3 条）──
  const collabShort = computeCollaborationInsights({
    ...(s.collab ?? { userMessages: 0, revisions: 0, lateConstraints: 0, sessionsWithRevision: 0, shortSessions: 0 }),
    sessions: s.sessions,
  });
  if (collabShort.length > 0) {
    sectionHead("03", "协作复盘", "HUMAN × HARNESS / COLLABORATION REVIEW");
    for (const item of collabShort) {
      ctx.font = `700 9.5px ${EXPORT_MONO}`;
      ctx.fillStyle = C.cyan;
      ctx.fillText(item.code, P, y + 10);
      paint(item.title, 11.5, C.ink, "sans", 600, W - P * 2 - 110);
      paint(`建议：${item.suggestion}`, 10.5, C.inkSoft, "sans", 400);
      y += 4;
    }
  }

  // ── 04 活跃与 Token ──
  sectionHead("04", "活跃与 Token", `ACTIVITY / NIGHT ${night}%`);
  paint(`SCAN 00—24 · DEPTH 4,096m · PING OK · NIGHT ${night}%`, 9.5, C.faint, "mono", 400);
  if (hist.length > activityRows) {
    right("LAST 7 DAYS", 9.5, C.faint, "mono");
  }
  if (hist.length > 0) {
    const max = Math.max(1, ...hist.flatMap((d) => d.hours));
    for (const day of hist.slice(-activityRows)) {
      for (let h = 0; h < 24; h++) {
        const count = day.hours[h] ?? 0;
        if (count === 0) {
          ctx.fillStyle = "#eef2f5";
        } else {
          const boosted = Math.pow(Math.min(1, Math.max(0, count / max)), 0.4);
          ctx.fillStyle = `rgba(77,107,254,${(0.18 + boosted * 0.82).toFixed(2)})`;
        }
        ctx.fillRect(P + h * cellW, y, cellW - 2, cellW - 2);
      }
      y += cellW + 3;
    }
    y += 6;
  }
  paint(`活跃 ${s.activeDays} 天${s.busiestDay ? ` · 最忙 ${s.busiestDay.date}（${s.busiestDay.events} 条事件）` : ""}`, 11, C.muted, "sans", 400);
  // TokenBar：input/output/cacheRead/reasoning 四段
  const segments: [string, number, string][] = [
    ["INPUT", s.tokens.input, C.blue],
    ["OUTPUT", s.tokens.output, C.cyan],
    ["CACHE", s.tokens.cacheRead, "#9aa7ff"],
    ["REASON", s.tokens.reasoning, "#cdd6ff"],
  ];
  const barW = W - P * 2;
  const barH = 14;
  let acc = 0;
  for (const [, value, color] of segments) {
    const w = totalTokens > 0 ? (value / totalTokens) * barW : 0;
    ctx.fillStyle = color;
    ctx.fillRect(P + acc, y, Math.max(w, 2), barH);
    acc += w;
  }
  ctx.strokeStyle = C.line;
  ctx.strokeRect(P, y, barW, barH);
  y += barH + 6;
  let legendX = P;
  let legendY = y;
  for (const [label, value, color] of segments) {
    ctx.fillStyle = color;
    ctx.fillRect(legendX, legendY + 2, 8, 8);
    ctx.font = `400 9px ${EXPORT_MONO}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(`${label} ${fmt(value)}`, legendX + 12, legendY + 10);
    const step = 12 + ctx.measureText(`${label} ${fmt(value)}`).width + 16;
    if (legendX + step > W - P) {
      legendX = P;
      legendY += 16;
    } else {
      legendX += step;
    }
  }
  y = legendY + 16;

  // ── 04 模型与工具 ──
  sectionHead("05", "模型与工具", "MODEL / TOOL / PLUGINS");
  for (const [model, u] of modelEntries) {
    const share = totalTokens > 0 ? tot(u) / totalTokens : 0;
    ctx.fillStyle = C.line;
    ctx.fillRect(P, y + 4, barW, 8);
    ctx.fillStyle = C.blue;
    ctx.fillRect(P, y + 4, barW * share, 8);
    paint(`${model}  ${Math.round(share * 100)}%  ${fmt(tot(u))} tok`, 12, C.ink, "sans", 600);
  }
  if (families.length > 0) {
    paint(families.map((f) => `${f.family} × ${f.count}`).join(" · "), 10, C.muted, "sans", 400);
  }
  paint(`TOOL CALL · TOP ${toolEntries.length}`, 9, C.faint, "mono", 400);
  const toolTotal = Math.max(1, s.toolCallsTotal);
  toolEntries.forEach(([name, count], i) => {
    ctx.font = `400 10px ${EXPORT_MONO}`;
    ctx.fillStyle = C.faint;
    ctx.fillText(String(i + 1).padStart(2, "0"), P, y + 10);
    paint(`${name}`, 11, C.inkSoft, "sans", 400, W - P * 2 - 120);
    right(`${Math.round((count / toolTotal) * 100)}% · ${count}`, 10, C.muted, "mono");
  });

  // ── 05 风险扫描 ──
  sectionHead("06", "风险扫描", "RISK / READ ONLY");
  for (const d of danger) {
    ctx.fillStyle = d.sev === "red" ? C.red : C.amber;
    ctx.beginPath();
    ctx.arc(P + 5, y + 5, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 9.5px ${EXPORT_MONO}`;
    ctx.fillStyle = d.sev === "red" ? C.red : C.amber;
    ctx.fillText(d.label ?? "未分类", P + 16, y + 9);
    ctx.font = `400 10px ${EXPORT_MONO}`;
    ctx.fillStyle = C.inkSoft;
    ctx.fillText(ellipsis(d.command.replace(/\s+/g, " ").slice(0, 56), W - P * 2 - 190, 10), P + 16 + 110, y + 9);
    ctx.font = `400 9px ${EXPORT_MONO}`;
    ctx.fillStyle = C.faint;
    ctx.fillText(timeStr(d.time), W - P - 90, y + 9);
    y += 21;
  }
  if (danger.length === 0) {
    paint("本期未检测到危险操作。PING / OK", 11, C.muted, "sans", 400);
  }
  paint("RETRY DIAGNOSE", 9, C.faint, "mono", 400);
  if (bursts.length > 0) {
    for (const b of bursts) {
      ctx.font = `400 10px ${EXPORT_MONO}`;
      ctx.fillStyle = C.inkSoft;
      ctx.fillText(ellipsis(b.cmd.replace(/\s+/g, " ").slice(0, 44), W - P * 2 - 180, 10), P, y + 10);
      ctx.fillStyle = C.muted;
      ctx.fillText(`× ${b.count} · ${timeStr(b.time)}`, W - P - 100, y + 10);
      if (b.error !== undefined && b.error !== "") {
        ctx.fillStyle = C.faint;
        ctx.fillText(ellipsis(b.error.slice(0, 40), 300, 9), P + 140, y + 10);
      }
      y += 19;
    }
  } else {
    paint("未检测到重试风暴。", 10, C.muted, "sans", 400);
  }
  if (secretCounts.size > 0) {
    ctx.font = `700 9.5px ${EXPORT_MONO}`;
    ctx.fillStyle = C.red;
    ctx.fillText(`SECRET SCAN · ${secretHits.length} HIT`, P, y + 10);
    ctx.font = `400 10px ${EXPORT_MONO}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(
      [...secretCounts.entries()].map(([label, n]) => `${label} × ${n}`).join(" · "),
      P + 150,
      y + 10,
    );
    y += 16;
    paint("只记录存在性，不展示原文。请尽快轮换对应密钥。", 9, C.faint, "sans", 400);
  } else {
    ctx.font = `700 9.5px ${EXPORT_MONO}`;
    ctx.fillStyle = C.safe;
    ctx.fillText("SECRET SCAN · CLEAR", P, y + 10);
    ctx.fillStyle = C.faint;
    ctx.fillText("CONTENT NEVER REPRINTED", W - P - 20, y + 10, );
    y += 18;
  }

  } else {
  // ── 独立会话轨迹导出：只画轨迹 + 索引 ──
  paint(`${traceCode(report.preset, report.to)} · SESSION TRACE EXPORT`, 10, C.faint, "mono", 400);
  paint(`深迹 · 会话轨迹`, 24, C.ink, "sans", 700);
  paint(`${dateStr(report.from)} — ${dateStr(report.to)} · ${sessions.length} TARGETS`, 11, C.muted, "sans", 400);
  y += 6;
  hline(y, true);
  y += 14;
  drawStatGrid();
  // ── 06 会话轨迹 ──
  sectionHead("07", "会话轨迹", `TRACE LOG / ${sessions.length} TARGETS`);
  for (let i = 0; i < sessions.length; i++) {
    const sd = sessions[i];
    const share = resolvedTotal > 0 ? Math.round((sd.cost / resolvedTotal) * 100) : 0;
    ctx.font = `400 10px ${EXPORT_MONO}`;
    ctx.fillStyle = C.faint;
    ctx.fillText(`T-${String(i + 1).padStart(2, "0")}`, P, y + 12);
    ctx.font = `600 12px ${EXPORT_SANS}`;
    ctx.fillStyle = C.ink;
    ctx.fillText(ellipsis(sd.title || "（未命名会话）", W - P * 2 - 260, 12), P + 40, y + 12);
    let badgeX = P + 40 + ctx.measureText(ellipsis(sd.title || "", W - P * 2 - 260, 12)).width + 10;
    const badge = (text: string, color: string) => {
      ctx.font = `700 8.5px ${EXPORT_MONO}`;
      ctx.fillStyle = color;
      ctx.fillText(text, badgeX, y + 11);
      badgeX += ctx.measureText(text).width + 8;
    };
    if (sd.redDanger > 0) badge(`${sd.redDanger} 致命`, C.red);
    if (sd.retryBursts > 0) badge(`${sd.retryBursts} 重试`, C.amber);
    if (sd.toolCalls > 0) badge(`${sd.toolCalls} tools`, C.faint);
    ctx.font = `700 12px ${EXPORT_MONO}`;
    ctx.fillStyle = C.ink;
    ctx.fillText(`¥${sd.cost.toFixed(2)}`, W - P - 110, y + 12);
    ctx.font = `400 8.5px ${EXPORT_MONO}`;
    ctx.fillStyle = C.faint;
    ctx.fillText(`${share}% OF PERIOD`, W - P - 110, y + 24);
    y += 24;
    const sessionTokens = Object.values(sd.modelTokens ?? {}).reduce(
      (sum, u) => sum + u.input + u.output + u.cacheRead + u.reasoning,
      0,
    );
    ctx.font = `400 9px ${EXPORT_MONO}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(
      `${new Date(sd.firstTime).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} ~ ${new Date(sd.lastTime).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · ${sd.events} 事件 · ${sd.commands} 命令 · ${sd.toolCalls} 工具${sessionTokens > 0 ? ` · ${fmt(sessionTokens)} token` : ""}`,
      P + 40,
      y + 10,
    );
    y += 18;
  }
  if (sessions.length === 0) {
    paint("本期无会话级明细（legacy 报告）。", 11, C.muted, "sans", 400);
  }

  // ── 07 会话索引 ──
  sectionHead("08", "会话索引", "SESSION INDEX / APPENDIX");
  titles.forEach((t, i) => {
    ctx.font = `400 9.5px ${EXPORT_MONO}`;
    ctx.fillStyle = C.faint;
    ctx.fillText(String(i + 1).padStart(2, "0"), P, y + 10);
    paint(t, 10.5, C.inkSoft, "sans", 400, W - P * 2 - 40);
  });
  if (titles.length === 0) {
    paint("无会话标题索引。", 10, C.muted, "sans", 400);
  }

  }

  // ── 页脚 ──
  y += 10;
  hline(y);
  y += 12;
  const genMeta = report.reportGeneration as
    | { mode: "local" | "model"; totalTokens: number; model?: string }
    | undefined;
  paint(
    genMeta === undefined
      ? "REPORT GENERATION · LOCAL DETERMINISTIC · 0 TOKENS"
      : `REPORT GENERATION · ${fmt(genMeta.totalTokens)} TOKENS · ${genMeta.mode === "local" ? "LOCAL DETERMINISTIC" : `MODEL${genMeta.model !== undefined ? ` ${genMeta.model}` : ""}`}`,
    9.5,
    C.faint,
    "mono",
    400,
  );
  paint(`BASED ON ${fmt(s.totalEvents)} SESSION EVENTS · READ ONLY · GENERATED ${dateStr(report.createdAt)}`, 9.5, C.faint, "mono", 400);

  // 按实际绘制高度裁剪（预算偏大无妨，绝不裁切内容）。
  const finalY = Math.ceil(y) + 8;
  if (finalY * scale < canvas.height) {
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = finalY * scale;
    const octx = out.getContext("2d");
    if (octx !== null) {
      octx.drawImage(canvas, 0, 0);
      const a = document.createElement("a");
      a.download = `深迹-${report.preset}-${dateStr(report.to)}.png`;
      a.href = out.toDataURL("image/png");
      a.click();
      return;
    }
  }
  const a = document.createElement("a");
  a.download = `深迹-${report.preset}-${dateStr(report.to)}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
}

// ─────────────────────────── 鲸鱼娘：表情 + 本期鲸评 ───────────────────────────

/** 鲸鱼娘表情脸（inline SVG，蓝白卡通）。 */
function WhaleFace({ mood, size = 44 }: { mood: "happy" | "angry" | "sleepy" | "dazed"; size?: number }): ReactNode {
  const [imgFailed, setImgFailed] = useState<Record<string, boolean>>({});
  const src = `/whale/assets/whale-${mood}.png`;
  if (!imgFailed[mood] && typeof document !== "undefined") {
    return (
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        style={{ borderRadius: size / 4 }}
        onError={() => setImgFailed((prev) => ({ ...prev, [mood]: true }))}
      />
    );
  }
  const eye = (kind: string) => {
    if (kind === "angry") return <path d="M8 16 L14 13 M32 16 L26 13" stroke="#0f172a" strokeWidth="2.4" strokeLinecap="round" />;
    if (kind === "sleepy") return <path d="M9 15 L15 15 M25 15 L31 15" stroke="#0f172a" strokeWidth="2.4" strokeLinecap="round" />;
    if (kind === "dazed") return <><circle cx="12" cy="15" r="1.6" fill="#0f172a" /><circle cx="28" cy="15" r="1.6" fill="#0f172a" /></>;
    return <><circle cx="12" cy="15" r="2.6" fill="#0f172a" /><circle cx="28" cy="15" r="2.6" fill="#0f172a" /></>;
  };
  const mouth = (kind: string) => {
    if (kind === "happy") return <path d="M12 21 Q20 27 28 21" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" fill="none" />;
    if (kind === "angry") return <path d="M13 23 L27 23" stroke="#0f172a" strokeWidth="2.4" strokeLinecap="round" />;
    if (kind === "sleepy") return <circle cx="20" cy="22" r="1.8" fill="#0f172a" />;
    return <path d="M13 22 Q20 20 27 22" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" fill="none" />;
  };
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 4 C9 4 4 12 4 20 C4 30 11 36 20 36 C29 36 36 30 36 20 C36 12 31 4 20 4 Z" fill="#4d6bfe" />
      <path d="M20 4 C9 4 4 12 4 20 C4 30 11 36 20 36 Z" fill="#5b78ff" />
      <ellipse cx="20" cy="26" rx="8" ry="5" fill="#dbe4ff" />
      {eye(mood)}
      {mouth(mood)}
      <circle cx="9" cy="19" r="2" fill="#ffb4c8" opacity=".9" />
      <circle cx="31" cy="19" r="2" fill="#ffb4c8" opacity=".9" />
      {mood === "sleepy" && <text x="31" y="10" fontSize="7" fill="#64748b">z</text>}
    </svg>
  );
}

/** 表情与鲸评触发统一由 ../whale-notes.ts 的同一套规则驱动（见 triggerNotes / whaleMood）。 */

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
} as const;

/** 开场白（按心情）。 */
const NOTE_OPENERS = {
  happy: ["（摆摆尾巴）嗨，我来啦。"],
  angry: ["（气鼓鼓）哼，来了。"],
  sleepy: ["（打着哈欠）……嗯？叫我？"],
  dazed: ["（托腮）唉……又来了。"],
} as const;

/** 收尾（按模式）。 */
const NOTE_CLOSERS = {
  light: ["以上，就是本期小评。"],
  spicy: ["以上，仅供参考——反正你也不会听。"],
} as const;

/**
 * 本期鲸评：规则触发 + 模板生成（轻/毒舌双模式）。
 * 每条 = 一段完整独白（4-5 句，起承转合），配开场白与收尾，galgame 事件感。
 * 确定性生成，绝不翻车。
 */

/** 本期鲸评卡片（完整版，两种模式可切换）。 */
function WhaleNote({ report }: { report: ReportFull }): ReactNode {
  const [mode, setMode] = useState<"light" | "spicy">("light");
  const s = report.stats;
  const kinds = triggerNotes(s);
  const mood = whaleMood(s);
  const top = kinds[0];
  return (
    <aside data-whale-report-note aria-label="本期鲸评">
      <div data-whale-report-notehead>
        <WhaleFace mood={mood} size={64} />
        <div data-whale-report-notetitle>
          <b>WHALE NOTE / OBSERVER</b>
          <span data-whale-report-micro>DeepTrace data observer</span>
          <span data-whale-report-noteopts>
            <button data-active={mode === "light"} onClick={() => setMode("light")}>轻</button>
            <button data-active={mode === "spicy"} onClick={() => setMode("spicy")}>毒舌</button>
          </span>
        </div>
      </div>
      <div data-whale-report-noteline>
        {NOTE_OPENERS[mood].map((line, i) => (
          <div key={`o${i}`} data-whale-report-notelineitem>{line}</div>
        ))}
        {top !== undefined ? (
          NOTE_TEMPLATES[top][mode].map((line, i) => (
            <div key={i} data-whale-report-notelineitem>
              {line.replace("{n}", String(s.retryBursts ?? 0))}
            </div>
          ))
        ) : (
          <>
            <div data-whale-report-notelineitem>“这期数据很干净呢，一点幺蛾子都没有。”</div>
            <div data-whale-report-notelineitem>（开心地晃了晃尾巴）这样的你，我特别喜欢。</div>
            <div data-whale-report-notelineitem>继续保持，我的任务就是让你省心呀。</div>
          </>
        )}
        {kinds.slice(1, 2).map((kind) => (
          <div key={kind} data-whale-report-notemore>
            {NOTE_TEMPLATES[kind][mode][1] ?? NOTE_TEMPLATES[kind][mode][0]}
          </div>
        ))}
        {NOTE_CLOSERS[mode].map((line, i) => (
          <div key={`c${i}`} data-whale-report-notelineitem style={{ marginTop: 6 }}>
            {line}
          </div>
        ))}
      </div>
      <div data-whale-report-notefoot>基于本期使用数据自动生成的风味评论，不影响正式报告结论。</div>
      {mood === "angry" && <div data-whale-report-notemore>（鲸鱼娘现在有点生气，注意安全操作。）</div>}
    </aside>
  );
}

/** 声呐图标（会话钻取/活跃 的分区装饰）。 */
function SonarIcon({ size = 14 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="6.4" stroke="#4d6bfe" strokeWidth="1.4" opacity=".85" />
      <circle cx="8" cy="8" r="3.4" stroke="#4d6bfe" strokeWidth="1.2" opacity=".6" />
      <path d="M8 8 L12.5 5.5" stroke="#4d6bfe" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** 会话轨迹：按费用排序，点击展开详情，复制 Session ID。 */
function SessionDrilldown({
  sessions,
  totalCost,
  index = "04",
}: {
  sessions: NonNullable<StatsJson["sessionsDetail"]>;
  totalCost?: number;
  index?: string;
}): ReactNode {
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const resolvedTotal = typeof totalCost === "number" && totalCost > 0
    ? totalCost
    : sessions.reduce((sum, session) => sum + session.cost, 0);
  const copy = (id: string): void => {
    void navigator.clipboard.writeText(id);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1500);
  };
  return (
    <section data-whale-report-trace data-whale-report-reportsection>
      <SectionHeader index={index} title="会话轨迹" meta={`TRACE LOG / ${sessions.length} TARGETS`} />
      {sessions.slice(0, 8).map((s, rowIndex) => {
        const open = openId === s.sessionId;
        const share = resolvedTotal > 0 ? Math.round((s.cost / resolvedTotal) * 100) : 0;
        const sessionTokens = Object.values(s.modelTokens ?? {}).reduce(
          (sum, token) => sum + token.input + token.output + token.cacheRead + token.reasoning,
          0,
        );
        return (
          <div key={s.sessionId}>
            <div data-whale-report-sessionrow onClick={() => setOpenId(open ? null : s.sessionId)}>
              <span data-whale-report-sessionindex>T-{String(rowIndex + 1).padStart(2, "0")}</span>
              <div data-whale-report-sessionmain>
                <b>{s.title || "（未命名会话）"}</b>
                <span>
                  {s.redDanger > 0 && <em data-whale-report-badge-red>{s.redDanger} 致命</em>}
                  {s.retryBursts > 0 && <em data-whale-report-badge-amber>{s.retryBursts} 重试</em>}
                  {s.toolCalls > 0 && <em data-whale-report-sessionmeta>{s.toolCalls} tool calls</em>}
                </span>
              </div>
              <div data-whale-report-sessioncost>¥{s.cost.toFixed(2)}<small>{share}% OF PERIOD</small></div>
            </div>
            {open && (
              <div data-whale-report-sessiondetail>
                <div data-whale-report-tokenline>
                  {new Date(s.firstTime).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} ~{" "}
                  {new Date(s.lastTime).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · {s.events} 事件 · {s.commands} 命令 · {s.toolCalls} 工具
                  {sessionTokens > 0 ? ` · ${fmt(sessionTokens)} token` : ""}
                </div>
                <button data-whale-report-btn data-ghost="true" onClick={() => copy(s.sessionId)}>
                  {copied === s.sessionId ? "已复制" : "复制 Session ID"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** 修复建议（确定性模板；只输出方案与命令，不自动执行）。 */
const FIX_SUGGESTIONS: Record<string, { text: string; command?: string }> = {
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
function FixSuggestion({ suggestion }: { suggestion: { text: string; command?: string } }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <div data-whale-report-fix>
      <div>{suggestion.text}</div>
      {suggestion.command !== undefined && (
        <div data-whale-report-fixcmd>
          <code>{suggestion.command}</code>
          <button
            data-whale-report-chip
            onClick={() => {
              void navigator.clipboard.writeText(suggestion.command!);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      )}
    </div>
  );
}

/** 洞察紧凑 Feed：色点 + 单行标题 + 预览，点击展开。 */
function InsightFeed({ insights, stats }: { insights: InsightJson[]; stats: StatsJson }): ReactNode {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div data-whale-report-feed>
      {insights.map((insight, index) => {
        const open = openId === insight.id;
        const preview = insightPreview(insight, stats);
        return (
          <div
            key={insight.id}
            data-whale-report-feedrow
            data-level={insight.level}
            data-open={open}
            onClick={() => setOpenId(open ? null : insight.id)}
          >
            <span data-whale-report-feedindex>{String(index + 1).padStart(2, "0")}</span>
            <span data-whale-report-feedcode>{insightCode(insight)}</span>
            <div data-whale-report-feedmain>
              <div data-whale-report-feedtitle>{insight.title}</div>
              {preview !== null && !open && <div data-whale-report-feedpreview>{preview}</div>}
              {open && (
                <>
                  <div data-whale-report-feeddetail>{insight.detail}</div>
                  <div data-whale-report-feedaction>{insight.action}</div>
                  {insight.estimate !== undefined && <div data-whale-report-feedestimate>{insight.estimate}</div>}
                  {FIX_SUGGESTIONS[insight.id] !== undefined && (
                    <FixSuggestion suggestion={FIX_SUGGESTIONS[insight.id]} />
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────── Tab 模式标记（better-sidebar 存在时隐藏悬浮球） ───────────────────────────

let tabRegistered = false;
const tabModeListeners = new Set<() => void>();
function setTabRegistered(value: boolean): void {
  if (tabRegistered === value) return;
  tabRegistered = value;
  for (const listener of tabModeListeners) listener();
}
function subscribeTabMode(listener: () => void): () => void {
  tabModeListeners.add(listener);
  return () => tabModeListeners.delete(listener);
}

/** better-sidebar 注册服务的最小结构化视图。 */
interface BetterSidebarLike {
  registerTab(descriptor: {
    id: string;
    title: string;
    icon?: ReactNode | ((size: number) => ReactNode);
    order?: number;
    single?: boolean;
    component: (props: unknown) => ReactNode;
  }): () => void;
}

/** better-sidebar 里的深迹 Tab（与抽屉共用 WhaleContent）。 */
function SidebarTab(): ReactNode {
  return (
    <div data-whale-report-tabhost>
      <WhaleContent />
    </div>
  );
}

// ─────────────────────────── 兜底：悬浮球 + 抽屉 ───────────────────────────

interface DrawerState {
  open: boolean;
}

class DrawerPanel extends Component<Record<string, never>, DrawerState> {
  state: DrawerState = { open: false };

  toggle = (): void => {
    this.setState((prev) => ({ open: !prev.open }));
  };

  render(): ReactNode {
    const { open } = this.state;
    return (
      <>
        <button data-whale-report-fab onClick={this.toggle} title="深迹 DeepTrace" aria-label="深迹 DeepTrace">
          <ChartIcon size={20} />
        </button>
        <div data-whale-report-drawer hidden={!open}>
          <div data-whale-report-head>
            <span data-whale-report-title>深迹 DeepTrace</span>
            <button data-whale-report-close onClick={this.toggle} aria-label="关闭">
              ✕
            </button>
          </div>
          <div data-whale-report-body>
            <WhaleContent />
          </div>
        </div>
      </>
    );
  }
}

/** 函数包装：Tab 已注册时悬浮球整体退场（hooks 只能在函数组件里用）。 */
function FallbackDrawer(): ReactNode {
  const tabMode = useSyncExternalStore(subscribeTabMode, () => tabRegistered);
  if (tabMode) return null; // 已在 better-sidebar 里，悬浮球退场
  return <DrawerPanel />;
}

// ─────────────────────────── 客户端插件装配 ───────────────────────────

/** 客户端 cordis 上下文的最小结构化视图（type-only，不引入运行时依赖）。 */
interface ClientContext {
  effect(execute: () => () => void): unknown;
  inject(names: string[], callback: (ctx: Record<string, unknown>) => void): unknown;
}

export function apply(ctx: ClientContext): void {
  injectStyle();

  // 兜底 UI 永远挂载：better-sidebar 不存在时提供悬浮球抽屉；
  // 一旦 Tab 注册成功（tabRegistered 翻转），悬浮球自动隐藏。
  ctx.effect(() => {
    const host = document.createElement("div");
    host.setAttribute("data-whale-report", "");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    root.render(<FallbackDrawer />);
    return () => {
      root.unmount();
      host.remove();
    };
  });

  // Tab 优先：better-sidebar 的注册服务存在时，把深迹做进它的工作台。
  // 惰性注入：服务缺失只跳过回调，绝不阻塞装配。
  ctx.inject(["betterSidebar"], (injected) => {
    const service = injected.betterSidebar as BetterSidebarLike | undefined;
    if (service === undefined) return;
    ctx.effect(() =>
      service.registerTab({
        id: "dsh-whale-report:report",
        title: "深迹 DeepTrace",
        icon: (size) => <ChartIcon size={size} />,
        order: 90,
        single: true,
        component: () => <SidebarTab />,
      }),
    );
    setTabRegistered(true);
  });
}
