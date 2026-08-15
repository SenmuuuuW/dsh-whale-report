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
import { Component, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from "react";
import { toolFamilies } from "../insights.js";
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
  budget?: number;
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
  burstSamples?: { cmd: string; count: number; time: number; error?: string }[];
  secretHits?: { label: string; time: number; source: string }[];
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
/** 绿色强度（越绿越活跃）。低值用幂放大：count 只是峰值 1% 的方块也要肉眼可见。 */
function green(level: number): string {
  const boosted = Math.pow(Math.min(1, Math.max(0, level)), 0.4);
  return `rgba(34,197,94,${(0.22 + boosted * 0.78).toFixed(2)})`;
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

  if (preset === "daily") {
    const hist = s.halfHourHistogram ?? [];
    if (hist.length === 0) return <EmptyActivity />;
    const max = Math.max(1, ...hist);
    const labels = ["00:00", "06:00", "12:00", "18:00", "24:00"];
    return (
      <div>
        <div data-whale-report-strip>
          {hist.map((count, idx) => (
            <i
              key={idx}
              title={`${String(Math.floor(idx / 2)).padStart(2, "0")}:${idx % 2 ? "30" : "00"} · ${count}`}
              style={{ background: count === 0 ? "#f1f5f9" : green(count / max) }}
            />
          ))}
        </div>
        <div data-whale-report-striplabels>
          {labels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
        <Legend />
      </div>
    );
  }

  if (preset === "weekly" || preset === "custom") {
    const series = s.dayHourSeries ?? [];
    if (series.length === 0) return <EmptyActivity />;
    const max = Math.max(1, ...series.flatMap((d) => d.hours));
    const hourLabels = ["00", "06", "12", "18", "23"];
    const shown = series.slice(-30);
    return (
      <div>
        <div data-whale-report-gridwrap>
          <div data-whale-report-grid>
            <div data-whale-report-gridhours>
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h}>{hourLabels.includes(String(h).padStart(2, "0")) ? String(h).padStart(2, "0") : ""}</span>
              ))}
            </div>
            {shown.map((day) => (
              <div key={day.date} data-whale-report-gridcol>
                {day.hours.map((count, h) => (
                  <i
                    key={h}
                    title={`${day.date} ${String(h).padStart(2, "0")}:00 · ${count}`}
                    style={{ background: count === 0 ? "#f1f5f9" : green(count / max) }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div data-whale-report-griddates>
            {shown.map((day) => (
              <span key={day.date}>{day.date.slice(5)}</span>
            ))}
          </div>
        </div>
        <Legend />
      </div>
    );
  }

  // monthly：每格 1 天；yearly：每格 1 周
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
            const label = weekStart.toISOString().slice(5, 10);
            const last = weekly[weekly.length - 1];
            if (last !== undefined && last.label === label) last.count += day.count;
            else weekly.push({ label, count: day.count });
          }
          return weekly;
        })()
      : series.map((d) => ({ label: d.date.slice(5), count: d.count }));
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div>
      <div data-whale-report-strip>
        {buckets.map((b) => (
          <i
            key={b.label}
            title={`${b.label} · ${b.count} 事件`}
            style={{ background: b.count === 0 ? "#f1f5f9" : green(b.count / max) }}
          />
        ))}
      </div>
      <div data-whale-report-striplabels>
        <span>{buckets[0]?.label}</span>
        <span>{buckets[Math.floor(buckets.length / 2)]?.label}</span>
        <span>{buckets[buckets.length - 1]?.label}</span>
      </div>
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
        {seg(tokens.output, "#38bdf8", "输出")}
        {seg(tokens.cacheRead, "#94a3b8", "缓存命中")}
        {seg(tokens.reasoning, "#c4b5fd", "思考")}
      </div>
      <div data-whale-report-tokenlegend>
        <span><i style={{ background: "#4d6bfe" }} />输入 {fmt(tokens.input)}</span>
        <span><i style={{ background: "#38bdf8" }} />输出 {fmt(tokens.output)}</span>
        <span><i style={{ background: "#94a3b8" }} />缓存 {fmt(tokens.cacheRead)}</span>
        <span><i style={{ background: "#c4b5fd" }} />思考 {fmt(tokens.reasoning)}</span>
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
  return (
    <div data-whale-report-modeltable>
      {entries.map(([model, u]) => {
        const total = u.input + u.output + u.cacheRead + u.reasoning;
        return (
          <div key={model} data-whale-report-modelrow>
            <div data-whale-report-modelhead>
              <b>{model}</b>
              <span>{fmt(total)} token{typeof cost?.perModel[model] === "number" ? ` · ¥${cost.perModel[model].toFixed(2)}` : ""}</span>
            </div>
            <div data-whale-report-modelbar>
              <i title={`输入 ${fmt(u.input)}`} style={{ width: `${(u.input / total) * 100}%`, background: "#4d6bfe" }} />
              <i title={`输出 ${fmt(u.output)}`} style={{ width: `${(u.output / total) * 100}%`, background: "#38bdf8" }} />
              <i title={`缓存命中 ${fmt(u.cacheRead)}`} style={{ width: `${(u.cacheRead / total) * 100}%`, background: "#94a3b8" }} />
              <i title={`思考 ${fmt(u.reasoning)}`} style={{ width: `${(u.reasoning / total) * 100}%`, background: "#c4b5fd" }} />
            </div>
            <div data-whale-report-modelnums>
              输入 {fmt(u.input)} · 输出 {fmt(u.output)} · 缓存 {fmt(u.cacheRead)} · 思考 {fmt(u.reasoning)}
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
      {shown.map((insight) => {
        const meta = INSIGHT_META[insight.level] ?? INSIGHT_META.warning;
        const open = openId === insight.id;
        return (
          <div
            key={insight.id}
            data-whale-report-insight
            data-open={open}
            style={{ borderLeftColor: meta.color }}
            onClick={() => setOpenId(open ? null : insight.id)}
          >
            <div data-whale-report-insighthead>
              <b>{insight.title}</b>
              <span>{open ? "收起" : "详情"}</span>
            </div>
            {open && (
              <>
                <div data-whale-report-insightdetail>{insight.detail}</div>
                <div data-whale-report-insightaction>{insight.action}</div>
                {insight.estimate !== undefined && <div data-whale-report-insightestimate>{insight.estimate}</div>}
              </>
            )}
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

  const exportPdf = (): void => {
    const url = `/whale/api/html?id=${encodeURIComponent(report.id)}`;
    window.open(url, "_blank");
  };

  const delta = report.prev !== undefined && report.prev.cost > 0 && typeof report.cost?.total === "number"
    ? Math.round(((report.cost.total - report.prev.cost) / report.prev.cost) * 100)
    : null;
  const budgetUsed = typeof report.budget === "number" && report.budget > 0 && typeof report.cost?.total === "number"
    ? Math.min(1, report.cost.total / report.budget)
    : null;
  return (
    <div>
      <div data-whale-report-headrow>
        <div>
          <div data-whale-report-reptitle>深迹 {PRESETS.find((p) => p.key === report.preset)?.label ?? "报告"}</div>
          <div data-whale-report-repsub>{dateStr(report.from)} ~ {dateStr(report.to)}</div>
        </div>
        <div data-whale-report-actions>
          <button data-whale-report-btn data-ghost="true" onClick={() => onDelete(report.id)}>删除</button>
          <button data-whale-report-btn onClick={exportPdf}>导出 PDF</button>
        </div>
      </div>

      <div data-whale-report-statgrid>
        <div data-whale-report-stat><b>{s.sessions}</b><span>会话</span></div>
        <div data-whale-report-stat><b>{s.turns}</b><span>回合</span></div>
        <div data-whale-report-stat><b>{fmt(s.toolCallsTotal)}</b><span>工具调用</span></div>
        <div data-whale-report-stat><b>{fmt(s.commands)}</b><span>命令</span></div>
        <div data-whale-report-stat><b>{fmt(totalTokens)}</b><span>Token</span></div>
        <div data-whale-report-stat>
          <b>¥{typeof report.cost?.total === "number" ? report.cost.total.toFixed(2) : "—"}</b>
          <span>
            预估费用
            {delta !== null && (
              <em className={delta > 0 ? "delta-up" : "delta-down"}>{delta > 0 ? "▲" : "▼"} {Math.abs(delta)}%</em>
            )}
          </span>
        </div>
      </div>

      {budgetUsed !== null && (
        <div data-whale-report-budget>
          <div data-whale-report-budgetbar>
            <i style={{ width: `${budgetUsed * 100}%`, background: budgetUsed >= 1 ? "#dc2626" : budgetUsed >= 0.8 ? "#d97706" : "#16a34a" }} />
          </div>
          <span>
            预算 {budgetUsed >= 1 ? "超支" : `${(budgetUsed * 100).toFixed(0)}%`} · ¥{report.cost!.total.toFixed(2)} / ¥{report.budget!.toFixed(2)}
          </span>
        </div>
      )}

      <InsightsSection insights={report.insights ?? []} />

      <div data-whale-report-card>
        <div data-whale-report-h2>活跃时段（凌晨 {night}%）</div>
        <ActivityStrip report={report} />
        <div data-whale-report-tokenline>
          活跃 {s.activeDays} 天
          {s.busiestDay ? <> · 最忙 <b>{s.busiestDay.date}</b>（{s.busiestDay.events} 条事件）</> : null}
        </div>
      </div>

      <div data-whale-report-card>
        <div data-whale-report-h2>Token 构成</div>
        <TokenBar tokens={s.tokens} />
      </div>

      <div data-whale-report-card>
        <div data-whale-report-h2>模型用量（DeepSeek 官方计价）</div>
        <ModelTable models={s.models ?? {}} cost={report.cost} />
        {typeof report.cost?.total === "number" && report.cost.total > 0 && (
          <div data-whale-report-tokenline style={{ marginTop: 8 }}>
            预估合计 <b>¥{report.cost.total.toFixed(2)}</b>
            <span className="muted"> · {report.cost.source === "official-page" ? "官方定价页实时价" : "内置价"} · 以平台账单为准</span>
          </div>
        )}
      </div>

      <div data-whale-report-card>
        <div data-whale-report-h2>工具使用（按族）</div>
        {toolFamilies(s.toolCalls ?? {}).length === 0 ? (
          <div data-whale-report-tokenline>（没有调用工具）</div>
        ) : (
          toolFamilies(s.toolCalls ?? {}).map((fam) => (
            <div key={fam.family} data-whale-report-tokenline>
              <code>{fam.family}</code> × {fam.count}
            </div>
          ))
        )}
      </div>

      {(s.burstSamples ?? []).length > 0 && (() => {
        const bursts = s.burstSamples ?? [];
        return (
        <div data-whale-report-card>
          <div data-whale-report-h2>重试诊断（{bursts.length}）</div>
          {bursts.slice(0, 3).map((b, i) => (
            <div key={i} data-whale-report-danger data-sev="amber">
              {b.cmd}
              <em>
                重复 {b.count} 次 · {new Date(b.time).toISOString().slice(0, 16).replace("T", " ")}
                {b.error !== undefined ? <> · 错误：{b.error.slice(0, 90)}</> : null}
              </em>
            </div>
          ))}
          {bursts.length > 3 && <div data-whale-report-tokenline>……共 {bursts.length} 条，完整列表见导出 PDF</div>}
        </div>
        );
      })()}

      <div data-whale-report-card>
        <div data-whale-report-h2>危险操作（{danger.length}）</div>
        {danger.length === 0 ? (
          <div data-whale-report-tokenline>无危险操作</div>
        ) : (
          <>
            <div data-whale-report-dangersum>{summary}</div>
            <div data-whale-report-dangercats>
              {[...danger.reduce((m, d) => m.set(d.label, (m.get(d.label) ?? 0) + 1), new Map<string, number>()).entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([label, count]) => (
                  <span key={label} data-whale-report-dangercat>
                    {label} <b>{count}</b>
                  </span>
                ))}
            </div>
            <button
              data-whale-report-chip
              data-whale-report-samplesbtn
              onClick={() => {
                setSamplesShown(!samplesShown);
                setDangerExpanded(false);
              }}
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

      {(s.secretHits ?? []).length > 0 && (() => {
        const hits = s.secretHits ?? [];
        return (
        <div data-whale-report-card>
          <div data-whale-report-h2>敏感信息（{hits.length}）</div>
          <div data-whale-report-tokenline>疑似密钥/令牌出现在会话中，未展示原文。</div>
          <div data-whale-report-dangercats>
            {[...hits.reduce((m: Map<string, number>, h: { label: string }) => m.set(h.label, (m.get(h.label) ?? 0) + 1), new Map<string, number>()).entries()].map(([label, count]) => (
              <span key={label} data-whale-report-secretcat>{label} <b>{count}</b></span>
            ))}
          </div>
          <div data-whale-report-tokenline style={{ marginTop: 6 }}>建议尽快轮换对应密钥。</div>
        </div>
        );
      })()}

      {(s.titles ?? []).length > 0 && (
        <div data-whale-report-card>
          <div data-whale-report-h2>会话标题</div>
          <ul data-whale-report-titles>
            {s.titles.slice(0, 8).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      <div data-whale-report-tokenline style={{ fontSize: 11 }} className="muted">
        基于 {s.totalEvents} 条会话事件 · 只读 · 生成于 {dateStr(report.createdAt)}
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
  budgetInput: string;
  showBudgetEdit: boolean;
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
    budgetInput: "",
    showBudgetEdit: false,
  };

  requestSeq = 0;

  componentDidMount(): void {
    void this.loadDashboard(this.state.preset);
    void this.loadBudget();
  }

  setToast(message: string): void {
    this.setState({ toast: message });
    window.setTimeout(() => {
      this.setState((prev) => (prev.toast === message ? { ...prev, toast: null } : prev));
    }, 4000);
  }

  async loadBudget(): Promise<void> {
    try {
      const response = await fetch("/whale/api/settings");
      const body = (await response.json()) as { ok: boolean; settings?: number | null };
      if (response.ok && body.ok && typeof body.settings === "number") {
        this.setState({ budgetInput: String(body.settings) });
      }
    } catch {
      /* 忽略 */
    }
  }

  async saveBudget(): Promise<void> {
    const value = Number(this.state.budgetInput);
    const budget = Number.isFinite(value) && value > 0 ? value : undefined;
    try {
      const response = await fetch("/whale/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ budgetWeeklyCny: budget }),
      });
      const body = (await response.json()) as { ok: boolean; error?: { message?: string } };
      if (!response.ok || body.ok === false) throw new Error(body.error?.message ?? "保存失败");
      this.setState({ error: null, showBudgetEdit: false });
      this.setToast("预算已保存");
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : String(error));
    }
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
              void this.loadDashboard("custom");
            }}
            onOpenReport={() => this.setState({ view: "report" })}
            onBudgetToggle={() => this.setState({ showBudgetEdit: !this.state.showBudgetEdit })}
            onBudgetInput={(v) => this.setState({ budgetInput: v })}
            onSaveBudget={() => void this.saveBudget()}
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

/** 概览（打开即报告）：Hero 大数字 + 洞察 Feed + 活跃 + 模型。 */
function Dashboard(props: {
  state: ContentState;
  onPreset: (p: ContentState["preset"]) => void;
  onCustom: (from: string, to: string) => void;
  onOpenReport: () => void;
  onBudgetToggle: () => void;
  onBudgetInput: (v: string) => void;
  onSaveBudget: () => void;
}): ReactNode {
  const { state, onPreset, onCustom, onOpenReport, onBudgetToggle, onBudgetInput, onSaveBudget } = props;
  const { preset, loading, error, dashboard, showBudgetEdit, budgetInput, from, to } = state;
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
  const modelRows = (() => {
    if (s === undefined) return [];
    const entries = Object.entries(s.models ?? {}).sort(
      (a, b) => b[1].input + b[1].output + b[1].cacheRead + b[1].reasoning - (a[1].input + a[1].output + a[1].cacheRead + a[1].reasoning),
    );
    const grand = entries.reduce((sum, [, u]) => sum + u.input + u.output + u.cacheRead + u.reasoning, 0);
    return entries.map(([model, u]) => {
      const t = u.input + u.output + u.cacheRead + u.reasoning;
      return { model, share: grand > 0 ? Math.round((t / grand) * 100) : 0, cost: report?.cost?.perModel?.[model] };
    });
  })();
  const budgetUsed = typeof report?.budget === "number" && report.budget > 0 && cost !== undefined
    ? Math.min(1, cost / report.budget)
    : null;

  return (
    <div data-whale-report-body>
      <div data-whale-report-brand>
        <div data-whale-report-brandname>深迹 <span>DeepTrace</span></div>
        <div data-whale-report-brandtag>Your Agent, in numbers.</div>
        <div data-whale-report-brandactions>
          <button data-whale-report-link onClick={onBudgetToggle}>
            {typeof cost === "number" && typeof report?.budget === "number" && report.budget > 0 && preset === "weekly"
              ? `¥${cost.toFixed(2)} / ¥${report.budget.toFixed(2)}`
              : "预算"}
          </button>
        </div>
      </div>

      {showBudgetEdit && (
        <div data-whale-report-budgetedit>
          <span>周预算（¥）：</span>
          <input type="number" min="0" step="1" placeholder="如 50" value={budgetInput} onChange={(e) => onBudgetInput(e.target.value)} />
          <button data-whale-report-btn data-ghost="true" onClick={onSaveBudget}>保存</button>
        </div>
      )}

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
            <div data-whale-report-herolabel>{HERO_LABEL[preset] ?? "Agent 消耗"}</div>
            <div data-whale-report-heroval>¥{typeof cost === "number" ? cost.toFixed(2) : "—"}</div>
            <div data-whale-report-herodelta2>
              {delta === null ? (
                <span className="muted">首次记录，下周起可对比</span>
              ) : (
                <>
                  <em className={delta > 0 ? "up" : "down"}>{delta > 0 ? "↑" : "↓"} {Math.abs(delta)}%</em>
                  <span> vs 上周</span>
                </>
              )}
            </div>
            <div data-whale-report-herostat>
              <span><b>{s.sessions}</b> 会话</span>
              <span><b>{fmt(s.toolCallsTotal)}</b> 工具调用</span>
              <span><b>{fmt(totalTokens)}</b> Tokens</span>
            </div>
          </div>

          {budgetUsed !== null && preset === "weekly" && (
            <div data-whale-report-budget>
              <div data-whale-report-budgetbar>
                <i style={{ width: `${budgetUsed * 100}%`, background: budgetUsed >= 1 ? "#dc2626" : budgetUsed >= 0.8 ? "#d97706" : "#4d6bfe" }} />
              </div>
              <span>¥{cost!.toFixed(2)} / ¥{report.budget!.toFixed(2)} {budgetUsed >= 1 ? "超支" : ""}</span>
            </div>
          )}

          {insights.length > 0 && (
            <>
              <div data-whale-report-h2>值得注意</div>
              <InsightFeed insights={insights.slice(0, 3)} stats={s} />
              {insights.length > 3 && (
                <button data-whale-report-feedmore onClick={onOpenReport}>
                  还有 {insights.length - 3} 条洞察，见完整报告 →
                </button>
              )}
            </>
          )}

          <div data-whale-report-h2>活跃</div>
          <div data-whale-report-card>
            <ActivityStrip report={report} />
          </div>

          {modelRows.length > 0 && (
            <>
              <div data-whale-report-h2>模型</div>
              <div data-whale-report-card>
                {modelRows.map((m) => (
                  <div key={m.model} data-whale-report-modelrow>
                    <div data-whale-report-modelhead>
                      <b>{m.model}</b>
                      <span>{m.share}% · ¥{typeof m.cost === "number" ? m.cost.toFixed(1) : "—"}</span>
                    </div>
                    <div data-whale-report-modelbar>
                      <i style={{ width: `${m.share}%`, background: "#4d6bfe" }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <button data-whale-report-btn data-whale-report-fullbtn onClick={onOpenReport}>
            生成完整报告 →
          </button>
        </>
      )}
    </div>
  );
}

/** 洞察紧凑 Feed：色点 + 单行标题 + 预览，点击展开。 */
function InsightFeed({ insights, stats }: { insights: InsightJson[]; stats: StatsJson }): ReactNode {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div data-whale-report-feed>
      {insights.map((insight) => {
        const meta = INSIGHT_META[insight.level] ?? INSIGHT_META.warning;
        const open = openId === insight.id;
        const preview = insightPreview(insight, stats);
        return (
          <div
            key={insight.id}
            data-whale-report-feedrow
            onClick={() => setOpenId(open ? null : insight.id)}
          >
            <i data-whale-report-feeddot style={{ background: meta.color }} />
            <div data-whale-report-feedmain>
              <div data-whale-report-feedtitle>{insight.title}</div>
              {preview !== null && !open && <div data-whale-report-feedpreview>{preview}</div>}
              {open && (
                <>
                  <div data-whale-report-feeddetail>{insight.detail}</div>
                  <div data-whale-report-feedaction>{insight.action}</div>
                  {insight.estimate !== undefined && <div data-whale-report-feedestimate>{insight.estimate}</div>}
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
        order: 90,
        single: true,
        component: () => <SidebarTab />,
      }),
    );
    setTabRegistered(true);
  });
}
