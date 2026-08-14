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
import { createRoot, type Root } from "react-dom/client";

export const name = "whale-report-client";
export const inject: string[] = [];

// ─────────────────────────── 样式（JS 注入，避免打包管线） ───────────────────────────

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
  z-index: 2147482999; background: #ffffff; color: #111827;
  box-shadow: -12px 0 40px rgba(15,23,42,.12);
  display: flex; flex-direction: column;
  transform: translateX(0); transition: transform .22s ease;
  border-left: 1px solid #e5e7eb;
}
[data-whale-report-drawer][hidden] { transform: translateX(100%); pointer-events: none; }
[data-whale-report-head] {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid #e5e7eb; background: #fff;
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
[data-whale-report-body] { flex: 1; overflow-y: auto; padding: 20px; background: #fff; }
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
[data-whale-report-actions] { display: flex; gap: 8px; margin-bottom: 20px; }
[data-whale-report-btn] {
  padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  border: 1px solid transparent; background: #4d6bfe; color: #fff;
}
[data-whale-report-btn]:hover { background: #3e5bf5; }
[data-whale-report-btn][data-ghost="true"] { background: #fff; border-color: #d1d5db; color: #374151; }
[data-whale-report-btn][data-ghost="true"]:hover { border-color: #9ca3af; }
[data-whale-report-h2] { font-size: 14px; font-weight: 700; color: #111827; margin: 22px 0 10px; }
[data-whale-report-cards] { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
[data-whale-report-card] {
  background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 12px 14px;
}
[data-whale-report-card] b { display: block; font-size: 22px; font-weight: 800; color: #111827; }
[data-whale-report-card] span { font-size: 12px; color: #4b5563; }
[data-whale-report-tokenline] { font-size: 13px; color: #374151; line-height: 1.9; }
[data-whale-report-heat] { display: flex; gap: 2px; margin: 10px 0 6px; }
[data-whale-report-heat] i { flex: 1; height: 36px; border-radius: 4px; background: #eef2ff; }
[data-whale-report-danger] {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
  padding: 8px 10px; margin: 6px 0; color: #b91c1c; word-break: break-all;
}
[data-whale-report-danger] em { display: block; font-style: normal; font-size: 11px; color: #dc2626; opacity: .75; margin-top: 4px; }
[data-whale-report-titles] li { font-size: 13px; color: #374151; margin: 5px 0; }
[data-whale-report-empty] { color: #6b7280; font-size: 13.5px; text-align: center; padding: 48px 0; }
[data-whale-report-hitem] {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 12px 14px; margin-bottom: 8px; cursor: pointer;
}
[data-whale-report-hitem]:hover { border-color: #4d6bfe; box-shadow: 0 2px 8px rgba(77,107,254,.08); }
[data-whale-report-hitem] b { font-size: 13.5px; font-weight: 700; color: #111827; }
[data-whale-report-hitem] span { display: block; font-size: 12px; color: #6b7280; margin-top: 4px; }
[data-whale-report-loading] { color: #6b7280; font-size: 13px; padding: 24px 0; text-align: center; }

[data-whale-report-heatlabels] { display: flex; justify-content: space-between; font-size: 10px; color: #9ca3af; margin-top: 4px; }
[data-whale-report-heatlabels] span { width: 16px; text-align: center; transform: translateX(-50%); }
[data-whale-report-heatlabels] span:first-child { transform: none; }
[data-whale-report-heatlabels] span:last-child { transform: translateX(-100%); }
[data-whale-report-heat] { display: flex; gap: 1px; margin: 8px 0 2px; }
[data-whale-report-heat] i { flex: 1; height: 44px; border-radius: 2px; background: #eef2ff; }
[data-whale-report-summary] { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 4px 0 4px; }
[data-whale-report-sumitem] {
  background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 10px 14px; display: flex; flex-direction: column; gap: 2px;
}
[data-whale-report-sumitem] b { font-size: 20px; font-weight: 800; color: #111827; }
[data-whale-report-sumitem] span { font-size: 11.5px; color: #6b7280; }
[data-whale-report-tokenbar] { display: flex; height: 14px; border-radius: 7px; overflow: hidden; background: #f3f4f6; margin: 8px 0 6px; }
[data-whale-report-tokenbar] i { display: block; height: 100%; }
[data-whale-report-tokenlegend] { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11.5px; color: #4b5563; }
[data-whale-report-tokenlegend] span { display: inline-flex; align-items: center; gap: 4px; }
[data-whale-report-tokenlegend] i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
[data-whale-report-modeltable] { display: flex; flex-direction: column; gap: 10px; }
[data-whale-report-modelrow] {
  background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px;
}
[data-whale-report-modelhead] { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
[data-whale-report-modelhead] b { font-size: 13px; font-weight: 700; color: #111827; }
[data-whale-report-modelhead] span { font-size: 12px; font-weight: 600; color: #4d6bfe; }
[data-whale-report-modelbar] { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: #f3f4f6; }
[data-whale-report-modelbar] i { display: block; height: 100%; }
[data-whale-report-modelnums] { font-size: 11px; color: #6b7280; margin-top: 6px; }
[data-whale-report-daily] { display: flex; align-items: flex-end; gap: 3px; height: 96px; margin: 10px 0 6px; }
[data-whale-report-dailycol] { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; gap: 4px; min-width: 0; }
[data-whale-report-dailycol] i { display: block; width: 100%; max-width: 22px; border-radius: 3px 3px 0 0; background: #4d6bfe; }
[data-whale-report-dailycol] span { font-size: 9.5px; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }

[data-whale-report-gridwrap] { margin: 10px 0 4px; }
[data-whale-report-grid] { display: flex; gap: 3px; align-items: stretch; }
[data-whale-report-gridhours] { display: flex; flex-direction: column; gap: 3px; margin-right: 4px; flex-shrink: 0; }
[data-whale-report-gridhours] span { height: 9px; font-size: 8.5px; color: #9ca3af; line-height: 9px; text-align: right; width: 20px; }
[data-whale-report-gridcol] { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
[data-whale-report-gridcol] i { height: 9px; border-radius: 2px; }
[data-whale-report-griddates] { display: flex; gap: 3px; margin: 6px 0 0 24px; }
[data-whale-report-griddates] span { flex: 1; min-width: 0; font-size: 8.5px; color: #9ca3af; text-align: center; overflow: hidden; white-space: nowrap; }
[data-whale-report-dangercats] { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
[data-whale-report-dangercat] {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px;
  border-radius: 999px; font-size: 11.5px; background: #fef2f2; color: #b91c1c;
  border: 1px solid #fecaca;
}
[data-whale-report-dangercat] b { font-weight: 800; }

/* Tab 形态：填满侧栏 pane，白底 + 自带滚动 */
[data-whale-report-tabhost] { height: 100%; overflow-y: auto; padding: 16px 20px 24px; color: #111827; background: #ffffff; }
[data-whale-report-tabhost] [data-whale-report-card] { background: #f9fafb; }

@media print {
  body * { visibility: hidden; }
  [data-whale-report-drawer], [data-whale-report-drawer] * { visibility: visible; }
  [data-whale-report-drawer] {
    position: absolute; left: 0; top: 0; width: 100%; height: auto;
    box-shadow: none; border: none; background: #fff; color: #111;
  }
  [data-whale-report-fab], [data-whale-report-close], [data-whale-report-tabs],
  [data-whale-report-chips], [data-whale-report-inputs], [data-whale-report-actions] { display: none !important; }
  [data-whale-report-card] { background: #f9fafb; border-color: #e2e4ee; }
  [data-whale-report-card] b { color: #111; }
  [data-whale-report-card] span { color: #555; }
  [data-whale-report-tokenline] { color: #333; }
  [data-whale-report-danger] { background: #fdf0f0; color: #7f1d1d; border-color: #f5c6c6; }
  [data-whale-report-h2], [data-whale-report-titles] li { color: #111; }
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

interface ReportFull extends ReportMeta {
  stats: StatsJson;
  markdown: string;
  cost?: { perModel: Record<string, number>; total: number; currency: string; source: string };
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
  dangerousCommands: { command: string; time: number; sessionId: string; label: string }[];
  hourHistogram: number[];
  activeDays: number;
  busiestDay: { date: string; events: number } | null;
  titles: string[];
  totalEvents: number;
  models: Record<string, { input: number; output: number; cacheRead: number; reasoning: number }>;
  halfHourHistogram: number[];
  dailySeries: { date: string; count: number }[];
  dayHourSeries: { date: string; hours: number[] }[];
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

const PRESETS = [
  { key: "daily", label: "日报" },
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
function DailyBars({ series }: { series: { date: string; count: number }[] }): ReactNode {
  const max = Math.max(1, ...series.map((s) => s.count));
  return (
    <div data-whale-report-daily>
      {series.map((s) => (
        <div key={s.date} data-whale-report-dailycol title={`${s.date} · ${fmt(s.count)} 事件`}>
          <i style={{ height: `${Math.max(3, Math.round((s.count / max) * 100))}%` }} />
          <span>{s.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

/** GitHub 贡献图风格的活动矩阵：行 = 24 小时，列 = 天。 */
function ActivityGrid({ series }: { series: { date: string; hours: number[] }[] }): ReactNode {
  if (series.length === 0) return null;
  const max = Math.max(1, ...series.flatMap((s) => s.hours));
  const hue = (count: number): string => {
    if (count === 0) return "#f3f4f6";
    const level = Math.max(0.15, Math.min(1, count / max));
    return `rgba(77,107,254,${level.toFixed(2)})`;
  };
  const hourLabels = ["00", "06", "12", "18", "23"];
  const shown = series.slice(-30); // 最多 30 列
  return (
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
                title={`${day.date} ${String(h).padStart(2, "0")}:00 · ${count} 事件`}
                style={{ background: hue(count) }}
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
  );
}

/** 四段式 token 构成条（输入/输出/缓存命中/思考）。 */
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

function ReportView({ report, onDelete }: { report: ReportFull; onDelete: (id: string) => void }): ReactNode {
  const s = report.stats;
  const night = s.totalEvents === 0 ? 0 : Math.round((s.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0) / s.totalEvents) * 100);
  const topTools = Object.entries(s.toolCalls ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const totalTokens = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.reasoning;
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const danger = s.dangerousCommands ?? [];
  const shownDanger = dangerExpanded ? danger.slice(0, 20) : danger.slice(0, 5);
  return (
    <div>
      <div data-whale-report-actions>
        <button data-whale-report-btn onClick={() => window.print()}>导出 PDF / 打印</button>
        <button data-whale-report-btn data-ghost="true" onClick={() => onDelete(report.id)}>删除</button>
      </div>

      <div data-whale-report-summary>
        <div data-whale-report-sumitem><b>{s.sessions}</b><span>会话</span></div>
        <div data-whale-report-sumitem><b>{s.turns}</b><span>回合</span></div>
        <div data-whale-report-sumitem><b>{fmt(s.toolCallsTotal)}</b><span>工具调用</span></div>
        <div data-whale-report-sumitem><b>{fmt(s.commands)}</b><span>命令</span></div>
        <div data-whale-report-sumitem><b>{fmt(totalTokens)}</b><span>Token</span></div>
        <div data-whale-report-sumitem><b>{Object.keys(s.models ?? {}).length}</b><span>模型</span></div>
      </div>

      <div data-whale-report-h2>Token 构成</div>
      <TokenBar tokens={s.tokens} />

      <div data-whale-report-h2>模型用量（DeepSeek 官方计价）</div>
      <ModelTable models={s.models ?? {}} cost={report.cost} />
      {typeof report.cost?.total === "number" && report.cost.total > 0 && (
        <div data-whale-report-tokenline>
          预估费用合计 <b>¥{report.cost.total.toFixed(2)}</b>
          <span style={{ color: "#9ca3af" }}>（{report.cost.source === "official-page" ? "官方定价页实时价" : "内置价"} · 仅计费估算，以平台账单为准）</span>
        </div>
      )}

      <div data-whale-report-h2>活跃时段（GitHub 风格 · 凌晨 {night}%）</div>
      <ActivityGrid series={s.dayHourSeries ?? []} />
      <div data-whale-report-tokenline>
        活跃 {s.activeDays} 天
        {s.busiestDay ? <> · 最忙 <b>{s.busiestDay.date}</b>（{s.busiestDay.events} 条事件）</> : null}
      </div>

      {(s.dailySeries ?? []).length > 0 && (
        <>
          <div data-whale-report-h2>每日活跃</div>
          <DailyBars series={s.dailySeries} />
        </>
      )}

      <div data-whale-report-h2>常用工具</div>
      {topTools.length === 0 ? (
        <div data-whale-report-tokenline>（没有调用工具）</div>
      ) : (
        topTools.map(([toolName, count]) => (
          <div key={toolName} data-whale-report-tokenline>
            <code>{toolName}</code> × {count}
          </div>
        ))
      )}

      <div data-whale-report-h2>危险操作（{danger.length}）</div>
      {danger.length === 0 ? (
        <div data-whale-report-tokenline>无危险操作</div>
      ) : (
        <>
          <div data-whale-report-dangercats>
            {[...danger.reduce((m, d) => m.set(d.label, (m.get(d.label) ?? 0) + 1), new Map<string, number>()).entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([label, count]) => (
                <span key={label} data-whale-report-dangercat>
                  {label} <b>{count}</b>
                </span>
              ))}
          </div>
          <div data-whale-report-tokenline>最近样本：</div>
          {shownDanger.map((d, i) => (
            <div key={i} data-whale-report-danger>
              {d.command.replace(/\s+/g, " ").slice(0, 64)}
              <em>{d.label} · {new Date(d.time).toISOString().slice(0, 16).replace("T", " ")}</em>
            </div>
          ))}
          {danger.length > 5 && (
            <button data-whale-report-chip onClick={() => setDangerExpanded(!dangerExpanded)}>
              {dangerExpanded ? "收起" : `查看全部 ${danger.length} 条`}
            </button>
          )}
        </>
      )}

      {(s.titles ?? []).length > 0 && (
        <>
          <div data-whale-report-h2>会话标题</div>
          <ul data-whale-report-titles>
            {s.titles.slice(0, 8).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      )}

      <div data-whale-report-tokenline style={{ marginTop: 16, fontSize: 11 }}>
        基于 {s.totalEvents} 条会话事件 · 只读 · 生成于 {dateStr(report.createdAt)}
      </div>
    </div>
  );
}

// ─────────────────────────── 核心内容组件（抽屉与 Tab 共用） ───────────────────────────

interface ContentState {
  tab: "report" | "history";
  preset: (typeof PRESETS)[number]["key"];
  from: string;
  to: string;
  loading: boolean;
  error: string | null;
  current: ReportFull | null;
  history: ReportMeta[] | null;
}

class WhaleContent extends Component<Record<string, never>, ContentState> {
  state: ContentState = {
    tab: "report",
    preset: "weekly",
    from: dateStr(Date.now() - 7 * 86400000),
    to: dateStr(Date.now()),
    loading: false,
    error: null,
    current: null,
    history: null,
  };

  async loadHistory(): Promise<void> {
    try {
      const body = await api<{ reports: ReportMeta[] }>("list");
      this.setState({ history: body.reports, error: null });
    } catch (error) {
      this.setState({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  async generate(): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      const payload =
        this.state.preset === "custom"
          ? { preset: "custom", from: this.state.from, to: this.state.to }
          : { preset: this.state.preset };
      const body = await api<{ report: ReportFull }>("generate", payload);
      this.setState({ current: body.report, loading: false, tab: "report" });
    } catch (error) {
      this.setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async openHistory(id: string): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      const response = await fetch(`/whale/api/get?id=${encodeURIComponent(id)}`);
      const json = (await response.json()) as { ok: boolean; report: ReportFull };
      if (!response.ok || json.ok === false) throw new Error("报告不存在");
      this.setState({ current: json.report, loading: false, tab: "report" });
    } catch (error) {
      this.setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async deleteReport(id: string): Promise<void> {
    try {
      await api<{ ok: boolean }>("delete", { id });
      this.setState({ current: null, history: null });
      if (this.state.tab === "history") void this.loadHistory();
    } catch (error) {
      this.setState({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  render(): ReactNode {
    const { tab, preset, loading, error, current, history } = this.state;
    return (
      <>
        <div data-whale-report-tabs>
          <button data-whale-report-tab data-active={tab === "report"} onClick={() => this.setState({ tab: "report" })}>
            新报告
          </button>
          <button
            data-whale-report-tab
            data-active={tab === "history"}
            onClick={() => {
              this.setState({ tab: "history" });
              if (history === null) void this.loadHistory();
            }}
          >
            历史
          </button>
        </div>

        {error !== null && <div data-whale-report-danger>出错了：{error}</div>}

        {tab === "history" && history === null && <div data-whale-report-loading>加载中…</div>}
        {tab === "history" && history !== null && history.length === 0 && (
          <div data-whale-report-empty>暂无报告</div>
        )}
        {tab === "history" && history !== null && history.length > 0 && (
          <div>
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

        {tab === "report" && (
          <>
            {current === null && (
              <>
                <div data-whale-report-chips>
                  {PRESETS.map((p) => (
                    <button
                      key={p.key}
                      data-whale-report-chip
                      data-active={preset === p.key}
                      onClick={() => this.setState({ preset: p.key })}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {preset === "custom" && (
                  <div data-whale-report-inputs>
                    <input
                      type="date"
                      value={this.state.from}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => this.setState({ from: e.target.value })}
                    />
                    <input
                      type="date"
                      value={this.state.to}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => this.setState({ to: e.target.value })}
                    />
                  </div>
                )}
                <div data-whale-report-actions>
                  <button data-whale-report-btn onClick={() => void this.generate()} disabled={loading}>
                    {loading ? "生成中…" : "生成报告"}
                  </button>
                </div>
                {loading && <div data-whale-report-loading>正在生成报告…</div>}
              </>
            )}
            {current !== null && <ReportView report={current} onDelete={(id) => void this.deleteReport(id)} />}
          </>
        )}
      </>
    );
  }
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
