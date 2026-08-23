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
import { Component, useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from "react";
import { toolFamilies, TOOL_HEALTH_MIN_CALLS, TOOL_HEALTH_MIN_FAILED, TOOL_HEALTH_MIN_FAILURE_RATE } from "../insights.js";
import { triggerNotes, whaleMood } from "../whale-notes.js";
import { computeCollaborationInsights } from "../collaboration.js";
import { splitModelKey } from "./model-key.js";
import { createRoot, type Root } from "react-dom/client";
import { usageTotalTokens } from "../usage.js";
import {
  ThemeRuntime,
  hostThemeOf,
  THEME_CHOICES,
  THEME_COLORS,
  THEME_LABEL,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeChoice,
  type ThemeDeps,
} from "./theme.js";

export const name = "whale-report-client";
export const inject: string[] = [];

// ─────────────────────────── 主题运行时（System / Light / Dark） ───────────────────────────

let themeRuntime: ThemeRuntime | null = null;

/** 浏览器侧依赖注入：localStorage + 宿主 color-scheme + matchMedia + documentElement。 */
function browserThemeDeps(): ThemeDeps {
  const root = (): HTMLElement => document.documentElement;
  const mq: MediaQueryList | null =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  return {
    getStored: () => {
      try {
        return window.localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        return null;
      }
    },
    setStored: (value) => {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, value);
      } catch {
        /* 隐私模式 / 禁用存储：静默，仅本次会话生效 */
      }
    },
    getHostTheme: () =>
      hostThemeOf(root().style.colorScheme ?? null, root().dataset as Record<string, string | undefined>),
    getPrefersDark: () => (mq !== null ? mq.matches : null),
    subscribePrefersDark: (listener) => {
      if (mq === null) return () => {};
      const handler = (): void => listener();
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    },
    setRootTheme: (resolved) => {
      root().setAttribute("data-whale-theme", resolved);
    },
  };
}

/** 组件侧读取最终主题（内联色 / 图例用；CSS 全部走 token 无需此 hook）。 */
function useResolvedTheme(): ResolvedTheme {
  const rt = themeRuntime;
  if (rt === null) return "light";
  return useSyncExternalStore(rt.subscribe.bind(rt), rt.getResolved.bind(rt));
}

/** 组件侧读取用户选择（theme toggle 高亮用）。 */
function useThemeChoice(): ThemeChoice {
  const rt = themeRuntime;
  if (rt === null) return "system";
  return useSyncExternalStore(rt.subscribe.bind(rt), rt.getChoice.bind(rt));
}

function setWhaleTheme(choice: ThemeChoice): void {
  themeRuntime?.setChoice(choice);
}

/** 小型主题切换（System / Light / Dark），顶部右侧，不抢主界面。 */
function ThemeIcon({ choice }: { choice: ThemeChoice }): ReactNode {
  if (choice === "light") {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (choice === "dark") {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M13 9.6A5.6 5.6 0 0 1 6.4 3a5.6 5.6 0 1 0 6.6 6.6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11.6 4.4a4.6 4.6 0 1 1-6 6 4.6 4.6 0 0 0 6-6Z" fill="currentColor" fillOpacity=".9" />
    </svg>
  );
}

function ThemeToggle(): ReactNode {
  const choice = useThemeChoice();
  return (
    <div data-whale-report-theme role="group" aria-label="主题切换（跟随系统 / 浅色 / 深色）">
      {THEME_CHOICES.map((c) => (
        <button
          key={c}
          type="button"
          data-active={choice === c}
          aria-label={THEME_LABEL[c]}
          title={THEME_LABEL[c]}
          aria-pressed={choice === c}
          onClick={() => setWhaleTheme(c)}
        >
          <ThemeIcon choice={c} />
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────── 样式（JS 注入，避免打包管线） ───────────────────────────

const CSS = `
[data-whale-report-panel] { font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif; }
[data-whale-report-fab] {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  width: 52px; height: 52px; border-radius: 12px;
  background: var(--dt-blue); color: var(--dt-on-accent);
  border: none; cursor: pointer; box-shadow: 0 4px 14px var(--dt-blue-glow);
  transition: transform .15s ease, background .15s ease;
  display: flex; align-items: center; justify-content: center;
}
[data-whale-report-fab]:hover { transform: translateY(-2px); background: var(--dt-blue-strong); }
[data-whale-report-drawer] {
  position: fixed; top: 0; right: 0; height: 100vh; width: 520px; max-width: 94vw;
  z-index: 2147482999; background: var(--dt-paper); color: var(--dt-ink);
  box-shadow: -12px 0 40px var(--dt-shadow);
  display: flex; flex-direction: column;
  transform: translateX(0); transition: transform .22s ease;
  border-left: 1px solid var(--dt-border);
}
[data-whale-report-drawer][hidden] { transform: translateX(100%); pointer-events: none; }
[data-whale-report-head] {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--dt-border); background: var(--dt-surface);
}
[data-whale-report-title] { font-size: 16px; font-weight: 700; color: var(--dt-ink); letter-spacing: .01em; }
[data-whale-report-close] { background: none; border: none; color: var(--dt-muted); font-size: 18px; cursor: pointer; }
[data-whale-report-close]:hover { color: var(--dt-ink); }
[data-whale-report-tabs] { display: flex; gap: 24px; padding: 0 16px; border-bottom: 1px solid var(--dt-border); background: var(--dt-surface); }
[data-whale-report-tab] {
  padding: 13px 2px 11px; font-size: 14px; font-weight: 600; cursor: pointer;
  background: transparent; color: var(--dt-muted); border: none; border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
[data-whale-report-tab][data-active="true"] { color: var(--dt-blue); border-bottom-color: var(--dt-blue); }
[data-whale-report-body] { flex: 1; overflow-y: auto; padding: 10px 16px 20px; background: var(--dt-paper); }
[data-whale-report-chips] { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
[data-whale-report-chip] {
  padding: 5px 14px; border-radius: 7px; font-size: 13px; font-weight: 500; cursor: pointer;
  background: var(--dt-surface); color: var(--dt-ink-soft); border: 1px solid var(--dt-border-strong);
}
[data-whale-report-chip]:hover { border-color: var(--dt-blue); color: var(--dt-blue); }
[data-whale-report-chip][data-active="true"] { background: var(--dt-blue); border-color: var(--dt-blue); color: var(--dt-on-accent); }
[data-whale-report-inputs] { display: flex; gap: 8px; margin-bottom: 12px; }
[data-whale-report-inputs] input {
  flex: 1; background: var(--dt-surface); color: var(--dt-ink); border: 1px solid var(--dt-border-strong);
  border-radius: 8px; padding: 9px 12px; font-size: 13.5px;
}
[data-whale-report-inputs] input:focus { outline: none; border-color: var(--dt-blue); box-shadow: 0 0 0 3px var(--dt-blue-12); }

/* ── DATA PARTIAL（fault isolation：会话损坏被跳过时的非阻断提示）── */
[data-whale-report-partial] {
  display: flex; align-items: flex-start; gap: 8px; margin: 0 0 12px;
  padding: 8px 12px; border: 1px solid var(--dt-warning-border); border-radius: 8px;
  background: var(--dt-warning-bg); color: var(--dt-warning); font-size: 12px; line-height: 1.55;
}
[data-whale-report-partial] b { color: var(--dt-warning); font-weight: 750; }
[data-whale-report-partial] code {
  font: 500 10px ui-monospace, Menlo, monospace; color: var(--dt-warning);
  background: var(--dt-warning-soft-bg); border-radius: 4px; padding: 0 4px;
}
[data-whale-report-partialmark] {
  display: inline-block; flex: none; margin-top: 1px;
  font: 750 8.5px ui-monospace, Menlo, monospace; letter-spacing: .1em;
  color: var(--dt-warning); background: var(--dt-warning-mark-bg); border: 1px solid var(--dt-warning-mark); border-radius: 4px; padding: 1px 6px;
}
[data-whale-report-reportopening] [data-whale-report-partial] { margin: 12px 0 0; }

/* ── 主题切换（System / Light / Dark；顶部右侧，小型 segmented，不抢主界面）── */
[data-whale-report-theme] {
  display: inline-flex; align-items: center; gap: 2px; padding: 2px;
  border: 1px solid var(--dt-line); border-radius: 8px; background: var(--dt-paper-deep);
  flex-shrink: 0;
}
[data-whale-report-theme] button {
  display: flex; align-items: center; justify-content: center;
  width: 25px; height: 21px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: var(--dt-muted); cursor: pointer;
}
[data-whale-report-theme] button:hover { color: var(--dt-ink); background: var(--dt-hover); }
[data-whale-report-theme] button:focus-visible { outline: 1px solid var(--dt-blue); outline-offset: 1px; }
[data-whale-report-theme] button[data-active="true"] { color: var(--dt-blue); background: var(--dt-blue-soft); }
[data-whale-report-theme] svg { width: 13px; height: 13px; display: block; }
/* 抽屉头部：title 左，toggle + close 右。 */
[data-whale-report-head] [data-whale-report-theme] { margin-left: auto; margin-right: 10px; }
/* 概览品牌区：右上角峰谷徽标下方。 */
[data-whale-report-brand] [data-whale-report-theme] { position: absolute; top: 50px; right: 14px; z-index: 5; }
/* 完整报告头部（abyss 深底）的变体。 */
[data-whale-report-reportopening] [data-whale-report-theme] {
  border-color: var(--dt-abyss-line-2); background: rgba(255, 255, 255, .05);
}
[data-whale-report-reportopening] [data-whale-report-theme] button { color: var(--dt-abyss-muted); }
[data-whale-report-reportopening] [data-whale-report-theme] button:hover { color: var(--dt-abyss-text); background: rgba(255, 255, 255, .08); }
[data-whale-report-reportopening] [data-whale-report-theme] button[data-active="true"] { color: var(--dt-blue); background: var(--dt-blue-16); }
[data-whale-report-actions] [data-whale-report-theme] { align-self: center; }
/* 抽屉模式：head 常驻 toggle，正文区不再重复出现。 */
[data-whale-report-drawer] [data-whale-report-brand] [data-whale-report-theme],
[data-whale-report-drawer] [data-whale-report-actions] [data-whale-report-theme] { display: none; }
[data-whale-report-actions] { display: flex; gap: 8px; }
[data-whale-report-btn] {
  padding: 9px 18px; border-radius: 8px; font-size: 13.5px; font-weight: 600; cursor: pointer;
  border: 1px solid transparent; background: var(--dt-blue); color: var(--dt-on-accent);
}
[data-whale-report-btn]:hover { background: var(--dt-blue-strong); }
[data-whale-report-btn][data-ghost="true"] { background: var(--dt-surface); border-color: var(--dt-border-strong); color: var(--dt-ink-soft); }
[data-whale-report-btn][data-ghost="true"]:hover { border-color: var(--dt-faint); }

/* ── 品牌区 ── */
[data-whale-report-brand] { display: flex; align-items: center; gap: 12px; padding: 2px 2px 8px; }
[data-whale-report-heroimg] { border-radius: 12px; flex-shrink: 0; }
[data-whale-report-brandname] { font-size: 24px; font-weight: 800; color: var(--dt-ink); letter-spacing: .01em; line-height: 1.1; }
[data-whale-report-brandname] span { color: var(--dt-blue); font-weight: 700; font-size: 17px; }
[data-whale-report-brandtag] { font-size: 12px; color: var(--dt-faint); margin-top: 3px; }
[data-whale-report-brandactions] { position: absolute; right: 18px; margin-top: -30px; }
[data-whale-report-link] { background: none; border: none; color: var(--dt-muted); font-size: 12.5px; cursor: pointer; padding: 5px 10px; border-radius: 7px; border: 1px solid var(--dt-border); background: var(--dt-surface); }
[data-whale-report-link]:hover { border-color: var(--dt-blue); color: var(--dt-blue); }

/* ── toast ── */
[data-whale-report-toast] {
  position: fixed; top: 14px; right: 14px; z-index: 2147483001;
  background: var(--dt-surface); border: 1px solid var(--dt-danger-border); border-left: 4px solid var(--dt-up);
  color: var(--dt-danger); padding: 9px 14px; border-radius: 10px; font-size: 13px;
  box-shadow: 0 6px 18px var(--dt-shadow); max-width: 300px;
}

/* ── 切换周期加载条 ── */
[data-whale-report-loadingbar] { display: flex; align-items: center; gap: 8px; margin: 0 2px 8px; font-size: 12px; color: var(--dt-muted); }
[data-whale-report-loadingbar] i {
  flex: 1; height: 2px; border-radius: 1px; background: var(--dt-border); overflow: hidden; position: relative;
}
[data-whale-report-loadingbar] i::after {
  content: ""; position: absolute; inset: 0; width: 40%;
  background: var(--dt-blue); border-radius: 1px;
  animation: dshload 1s ease-in-out infinite;
}
@keyframes dshload { 0% { left: -40%; } 100% { left: 100%; } }

/* ── 加载骨架 ── */
[data-whale-report-skeleton] { display: flex; flex-direction: column; gap: 8px; }
[data-whale-report-sk-hero] { height: 120px; border-radius: 14px; background: linear-gradient(90deg, var(--dt-sk-a) 25%, var(--dt-sk-b) 50%, var(--dt-sk-a) 75%); background-size: 200% 100%; animation: dshsk 1.2s infinite; }
[data-whale-report-sk-line] { height: 14px; border-radius: 6px; background: linear-gradient(90deg, var(--dt-sk-a) 25%, var(--dt-sk-b) 50%, var(--dt-sk-a) 75%); background-size: 200% 100%; animation: dshsk 1.2s infinite; }
@keyframes dshsk { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* ── 仪表盘 hero ── */
[data-whale-report-hero] {
  background: var(--dt-surface); border: 1px solid var(--dt-border); border-radius: 14px;
  padding: 16px 18px 14px; margin-bottom: 10px;
}
[data-whale-report-herolabel] { font-size: 13px; font-weight: 600; color: var(--dt-ink); }
[data-whale-report-heroval] { font-size: 44px; font-weight: 800; color: var(--dt-ink); font-variant-numeric: tabular-nums; line-height: 1.15; margin: 4px 0 2px; }
[data-whale-report-herodelta2] { font-size: 13px; display: flex; gap: 6px; align-items: baseline; }
[data-whale-report-herodelta2] em.up { color: var(--dt-up); font-style: normal; font-weight: 700; }
[data-whale-report-herodelta2] em.down { color: var(--dt-down); font-style: normal; font-weight: 700; }
[data-whale-report-herodelta2] span { color: var(--dt-muted); }
[data-whale-report-herodelta2] .muted { color: var(--dt-faint); }
[data-whale-report-herostat] { display: flex; gap: 16px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--dt-line-soft); font-size: 12.5px; color: var(--dt-muted); }
[data-whale-report-herostat] b { color: var(--dt-ink); font-weight: 800; font-variant-numeric: tabular-nums; }
[data-whale-report-heropeak] { display: inline-flex; align-items: center; gap: 5px; }
[data-whale-report-heropeak] i {
  width: 6px; height: 6px; border-radius: 50%; background: var(--dt-amber);
}
[data-whale-report-heropeak][data-valley] i { background: var(--dt-cyan-deep); }
[data-whale-report-heropeak] b { color: var(--dt-amber); }
[data-whale-report-heropeak][data-valley] b { color: var(--dt-cyan-deep); }

/* ── 洞察 Feed ── */
[data-whale-report-feed] { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
[data-whale-report-feedrow] {
  display: flex; gap: 9px; align-items: flex-start; cursor: pointer;
  border-left: 2px solid var(--dt-line); padding: 7px 0 7px 12px;
  transition: border-color 120ms;
}
[data-whale-report-feedrow]:hover { border-left-color: var(--dt-blue); background: var(--dt-blue-25); border-radius: 0 4px 4px 0; }
[data-whale-report-feedrow][data-open="true"] { border-left-color: var(--dt-blue); }
[data-whale-report-feeddot] { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
[data-whale-report-feedmain] { flex: 1; min-width: 0; }
[data-whale-report-feedtitle] { font-size: 13.5px; font-weight: 700; color: var(--dt-ink); }
[data-whale-report-feedpreview] { font-size: 12.5px; color: var(--dt-muted); margin-top: 2px; font-family: ui-monospace, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-whale-report-feeddetail] { font-size: 13px; color: var(--dt-ink-soft); line-height: 1.7; margin-top: 5px; }
[data-whale-report-feedaction] { font-size: 13px; color: var(--dt-blue); margin-top: 4px; }
[data-whale-report-feedestimate] { font-size: 12px; color: var(--dt-muted); margin-top: 3px; }

[data-whale-report-feedmore] {
  width: 100%; background: none; border: 1px dashed var(--dt-border-strong); color: var(--dt-blue);
  font-size: 12.5px; padding: 7px; border-radius: 8px; cursor: pointer; margin-bottom: 12px;
}
[data-whale-report-feedmore]:hover { border-color: var(--dt-blue); background: var(--dt-blue-soft); }

/* ── IMPROVE 区（v0.5：值得改的行为建议；只读，未自动修改任何配置）── */
[data-whale-report-improvelist] { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
[data-whale-report-improveitem] {
  border-left: 2px solid var(--dt-cyan-deep); padding: 6px 0 6px 12px;
  cursor: pointer; transition: border-color 120ms;
}
[data-whale-report-improveitem][data-severity="HIGH"] { border-left-color: var(--dt-danger); }
[data-whale-report-improveitem][data-severity="MEDIUM"] { border-left-color: var(--dt-amber); }
[data-whale-report-improveitem][data-severity="LOW"] { border-left-color: var(--dt-cyan-deep); }
[data-whale-report-improveitem]:hover { border-left-color: var(--dt-blue); }
[data-whale-report-improvehead] { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
[data-whale-report-improveindex] { font: 700 9.5px ui-monospace, monospace; color: var(--dt-faint); }
[data-whale-report-improvesev] {
  font: 750 8.5px ui-monospace, monospace; font-style: normal; letter-spacing: .08em;
  padding: 1px 6px; border-radius: 4px; color: var(--dt-danger); background: var(--dt-danger-bg); border: 1px solid var(--dt-danger-border);
}
[data-whale-report-improveitem][data-severity="MEDIUM"] [data-whale-report-improvesev] {
  color: var(--dt-warning); background: var(--dt-warning-bg); border-color: var(--dt-warning-border);
}
[data-whale-report-improveitem][data-severity="LOW"] [data-whale-report-improvesev] {
  color: var(--dt-cyan-deep); background: var(--dt-cyan-bg); border-color: var(--dt-cyan-border);
}
[data-whale-report-improveexp] {
  font: 700 8px ui-monospace, monospace; font-style: normal; letter-spacing: .08em;
  color: var(--dt-muted); border: 1px dashed var(--dt-line-strong); border-radius: 4px; padding: 1px 5px;
}
[data-whale-report-improvehead] b { font: 650 12.5px ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: var(--dt-ink); }
[data-whale-report-improvetoggle] {
  margin-left: auto; background: none; border: 1px solid var(--dt-line); border-radius: 6px;
  font: 600 9px ui-monospace, monospace; color: var(--dt-muted); padding: 2px 8px; cursor: pointer;
}
[data-whale-report-improvetoggle]:hover { border-color: var(--dt-blue); color: var(--dt-blue); }
[data-whale-report-improvenums] {
  display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 5px;
  font: 400 11px ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: var(--dt-muted);
}
[data-whale-report-improvenums] b { color: var(--dt-ink); font-weight: 800; font-variant-numeric: tabular-nums; margin-right: 4px; }
[data-whale-report-improverec] { margin-top: 4px; font: 400 11px/1.5 ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: var(--dt-ink-soft); }
[data-whale-report-improvedetail] {
  margin-top: 7px; padding: 8px 10px; background: var(--dt-paper-deep);
  border: 1px solid var(--dt-line); border-radius: 8px;
  display: flex; flex-direction: column; gap: 6px;
}
[data-whale-report-improverow] { display: grid; grid-template-columns: 72px 1fr; gap: 8px; }
[data-whale-report-improverow] span { font: 750 8.5px ui-monospace, monospace; color: var(--dt-faint); letter-spacing: .1em; padding-top: 2px; }
[data-whale-report-improverow] p { margin: 0; font: 400 11px/1.55 ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: var(--dt-ink-soft); }
[data-whale-report-improvesid] { font: 400 9px ui-monospace, monospace; color: var(--dt-faint); }

/* ── 本期鲸评 ── */

[data-whale-report-notehead] { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
[data-whale-report-notetitle] { display: flex; align-items: center; gap: 8px; flex: 1; }
[data-whale-report-notetitle] b { font-size: 14px; color: var(--dt-ink); }
[data-whale-report-noteopts] { display: flex; gap: 2px; background: var(--dt-blue-soft); border-radius: 999px; padding: 2px; }
[data-whale-report-noteopts] button { border: none; background: none; font-size: 11px; color: var(--dt-muted); padding: 2px 9px; border-radius: 999px; cursor: pointer; }
[data-whale-report-noteopts] button[data-active="true"] { background: var(--dt-blue); color: var(--dt-on-accent); }
[data-whale-report-noteline] { font-size: 13.5px; color: var(--dt-ink-soft); padding: 4px 2px; }
[data-whale-report-notelineitem] { line-height: 1.85; padding: 1.5px 0; }
[data-whale-report-notemore] { font-size: 12px; color: var(--dt-muted); line-height: 1.7; padding: 2px 2px; }
[data-whale-report-notefoot] { font-size: 11px; color: var(--dt-faint); margin-top: 8px; padding-top: 7px; border-top: 1px dashed var(--dt-border); }
[data-whale-report-note-short] {
  display: flex; align-items: center; gap: 9px; cursor: pointer;
  background: var(--dt-blue-soft); border: 1px solid var(--dt-blue-border); border-radius: 10px;
  padding: 9px 12px; margin-bottom: 12px;
}
[data-whale-report-note-short]:hover { border-color: var(--dt-blue); }
[data-whale-report-note-short] b { font-size: 12.5px; color: var(--dt-ink); display: block; }
[data-whale-report-note-short] span { font-size: 12.5px; color: var(--dt-blue-ink); }

/* ── 深海装饰：卡片角落小气泡 ── */
[data-whale-report-card] { position: relative; }
[data-whale-report-card]::after {
  content: ""; position: absolute; right: 10px; top: 10px;
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--dt-blue-10);
  pointer-events: none;
}

/* ── 修复建议 ── */
[data-whale-report-fix] {
  margin-top: 7px; padding: 8px 10px; background: var(--dt-surface-2); border: 1px solid var(--dt-border-2);
  border-radius: 8px; font-size: 12.5px; color: var(--dt-ink-soft); line-height: 1.7;
}
[data-whale-report-fixcmd] { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
[data-whale-report-fixcmd] code {
  flex: 1; font-family: ui-monospace, Menlo, monospace; font-size: 11.5px;
  background: var(--dt-surface); border: 1px solid var(--dt-border-2); border-radius: 6px; padding: 5px 8px;
  color: var(--dt-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
[data-whale-report-fixcmd] button { padding: 3px 10px; font-size: 11.5px; }

/* ── 会话钻取 ── */
[data-whale-report-sessionrow] { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 4px; border-bottom: 1px solid var(--dt-line-soft); cursor: pointer; }
[data-whale-report-sessionrow]:hover { background: var(--dt-surface-2); border-radius: 6px; }
[data-whale-report-sessionmain] { flex: 1; min-width: 0; }
[data-whale-report-sessionmain] b { font-size: 13px; font-weight: 600; color: var(--dt-ink); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-whale-report-sessionmain] span { display: flex; gap: 5px; margin-top: 3px; }
[data-whale-report-badge-red] { font-style: normal; font-size: 10.5px; background: var(--dt-danger-bg); color: var(--dt-danger); border: 1px solid var(--dt-danger-border); border-radius: 999px; padding: 1px 7px; }
[data-whale-report-badge-amber] { font-style: normal; font-size: 10.5px; background: var(--dt-warning-bg); color: var(--dt-warning); border: 1px solid var(--dt-warning-border); border-radius: 999px; padding: 1px 7px; }
[data-whale-report-badge-gray] { font-style: normal; font-size: 10.5px; background: var(--dt-surface-2); color: var(--dt-gray-ink); border: 1px solid var(--dt-border-2); border-radius: 999px; padding: 1px 7px; }
[data-whale-report-sessioncost] { font-size: 13.5px; font-weight: 700; color: var(--dt-blue); font-variant-numeric: tabular-nums; }
[data-whale-report-sessiondetail] { padding: 8px 4px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }

/* ── 完整报告按钮 ── */
[data-whale-report-fullbtn] { width: 100%; margin: 4px 0 12px; padding: 11px; font-size: 14px; }

/* ── 报告视图：紧凑头部 + 大数字统计条 ── */
[data-whale-report-headrow] {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 4px 2px 12px;
}
[data-whale-report-reptitle] { font-size: 18px; font-weight: 800; color: var(--dt-ink); }
[data-whale-report-repsub] { font-size: 13px; color: var(--dt-muted); margin-top: 3px; }
[data-whale-report-statgrid] {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px;
}
[data-whale-report-stat] {
  background: var(--dt-surface); border: 1px solid var(--dt-border); border-radius: 10px;
  padding: 10px 12px 9px;
}
[data-whale-report-stat] b {
  display: block; font-size: 24px; font-weight: 800; color: var(--dt-ink);
  font-variant-numeric: tabular-nums; line-height: 1.2;
}
[data-whale-report-stat] span { font-size: 11.5px; color: var(--dt-muted); }
[data-whale-report-stat] em.delta-up { color: var(--dt-up); font-size: 12px; font-weight: 700; margin-left: 6px; font-style: normal; }
[data-whale-report-stat] em.delta-down { color: var(--dt-down); font-size: 12px; font-weight: 700; margin-left: 6px; font-style: normal; }

/* ── 卡片 ── */
[data-whale-report-card] {
  background: var(--dt-surface); border: 1px solid var(--dt-border); border-radius: 10px;
  padding: 12px 14px; margin-bottom: 10px;
}
[data-whale-report-h2] {
  font-size: 14px; font-weight: 700; color: var(--dt-ink); margin: 0 0 8px;
  display: flex; align-items: center; gap: 7px;
}
[data-whale-report-tokenline] { font-size: 13.5px; color: var(--dt-ink-soft); line-height: 1.8; }
[data-whale-report-tokenline] .muted { color: var(--dt-faint); }

/* ── 洞察：告警条式（左色条 + 单行信息） ── */
[data-whale-report-insights] { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
[data-whale-report-insight] {
  background: var(--dt-surface); border: 1px solid var(--dt-border);
  border-radius: 8px; padding: 8px 12px; cursor: pointer;
}
[data-whale-report-insight][data-open="true"] { padding-bottom: 10px; }
[data-whale-report-insighthead] { display: flex; align-items: baseline; gap: 8px; }
[data-whale-report-insighthead] b { font-size: 13.5px; color: var(--dt-ink); }
[data-whale-report-insighthead] span { font-size: 12.5px; color: var(--dt-muted); }
[data-whale-report-insightdetail] { font-size: 13px; color: var(--dt-ink-soft); line-height: 1.7; margin-top: 5px; }
[data-whale-report-insightaction] { font-size: 13px; color: var(--dt-blue); margin-top: 4px; }
[data-whale-report-insightestimate] { font-size: 12px; color: var(--dt-muted); margin-top: 3px; }

/* 活动方块 */
[data-whale-report-weekrow] { display: flex; align-items: center; gap: 7px; margin-bottom: 4px; }
[data-whale-report-weekrowlabel] { width: 36px; flex-shrink: 0; font-size: 10.5px; color: var(--dt-faint); text-align: right; }
[data-whale-report-squares] { display: flex; gap: 3px; flex: 1; min-width: 0; }
[data-whale-report-squares] i { flex: 1 1 0; min-width: 0; aspect-ratio: 1; border-radius: 3px; display: block; }
[data-whale-report-legend] { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--dt-faint); margin-top: 7px; }
[data-whale-report-legend] i { display: inline-block; width: 11px; height: 11px; border-radius: 2px; }
[data-whale-report-gridempty] { font-size: 13px; color: var(--dt-muted); padding: 6px 0; }

/* Token 构成 */
[data-whale-report-tokenbar] { display: flex; height: 16px; border-radius: 8px; overflow: hidden; background: var(--dt-track); margin: 6px 0 6px; }
[data-whale-report-tokenbar] i { display: block; height: 100%; }
[data-whale-report-tokenlegend] { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--dt-muted); }
[data-whale-report-tokenlegend] span { display: inline-flex; align-items: center; gap: 4px; }
[data-whale-report-tokenlegend] i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; }

/* 模型用量 */
[data-whale-report-modeltable] { display: flex; flex-direction: column; gap: 7px; }
[data-whale-report-modelrow] { background: var(--dt-surface-2); border: 1px solid var(--dt-border); border-radius: 8px; padding: 9px 11px; }
[data-whale-report-modelhead] { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
[data-whale-report-modelname] { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
[data-whale-report-modelname] b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
[data-whale-report-modelprov] { font: 700 9px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dt-faint); letter-spacing: .06em; flex-shrink: 0; white-space: nowrap; }
[data-whale-report-modelhead] b { font-size: 13.5px; font-weight: 700; color: var(--dt-ink); }
[data-whale-report-modelhead] span { font-size: 12.5px; font-weight: 700; color: var(--dt-blue); font-variant-numeric: tabular-nums; }
[data-whale-report-modelbar] { display: flex; height: 9px; border-radius: 4px; overflow: hidden; background: var(--dt-track); }
[data-whale-report-modelbar] i { display: block; height: 100%; }
[data-whale-report-modelnums] { font-size: 12px; color: var(--dt-muted); margin-top: 5px; font-variant-numeric: tabular-nums; }

/* 危险/敏感 */
[data-whale-report-dangersum] {
  background: var(--dt-blue-soft); border: 1px solid var(--dt-blue-border); border-radius: 8px;
  padding: 9px 11px; font-size: 13px; color: var(--dt-blue-ink); line-height: 1.6; margin-bottom: 7px;
}
[data-whale-report-dangercats] { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 7px; }
[data-whale-report-dangercat] {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px;
  border-radius: 999px; font-size: 12px; background: var(--dt-danger-bg); color: var(--dt-danger);
  border: 1px solid var(--dt-danger-border);
}
[data-whale-report-dangercat] b { font-weight: 800; }
[data-whale-report-secretcat] {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px;
  border-radius: 999px; font-size: 12px; background: var(--dt-secret-bg); color: var(--dt-secret-ink);
  border: 1px solid var(--dt-secret-border);
}
[data-whale-report-secretcat] b { font-weight: 800; }
[data-whale-report-danger] {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px;
  background: var(--dt-danger-bg); border: 1px solid var(--dt-danger-border); border-radius: 8px;
  padding: 8px 10px; margin: 5px 0; color: var(--dt-danger); word-break: break-all;
}
[data-whale-report-danger][data-sev="red"] { background: var(--dt-danger-bg); border-color: var(--dt-up); color: var(--dt-danger); }
[data-whale-report-danger][data-sev="amber"] { background: var(--dt-warning-bg); border-color: var(--dt-warning-strong); color: var(--dt-warning); }
[data-whale-report-danger][data-sev="amber"] em { color: var(--dt-warning-strong); }
[data-whale-report-danger] em { display: block; font-style: normal; font-size: 12px; color: var(--dt-up); opacity: .75; margin-top: 4px; }
[data-whale-report-samplesbtn] { margin-top: 4px; }
[data-whale-report-titles] li { font-size: 13px; color: var(--dt-ink-soft); margin: 4px 0; }
[data-whale-report-empty] { color: var(--dt-muted); font-size: 13.5px; text-align: center; padding: 40px 0; }
[data-whale-report-hitem] {
  background: var(--dt-surface); border: 1px solid var(--dt-border); border-radius: 10px;
  padding: 11px 13px; margin-bottom: 7px; cursor: pointer;
}
[data-whale-report-hitem]:hover { border-color: var(--dt-blue); }
[data-whale-report-hitem] b { font-size: 13.5px; font-weight: 700; color: var(--dt-ink); }
[data-whale-report-hitem] span { display: block; font-size: 12.5px; color: var(--dt-muted); margin-top: 3px; }
[data-whale-report-loading] { color: var(--dt-muted); font-size: 13px; padding: 20px 0; text-align: center; }

/* Tab 形态 */
[data-whale-report-tabhost] { height: 100%; overflow-y: auto; padding: 10px 16px 20px; color: var(--dt-ink); background: var(--dt-paper); }
[data-whale-report-tabhost] [data-whale-report-card] { background: var(--dt-surface); }

/* ────────────────────────── DeepTrace editorial UI ────────────────────────── */
/* Theme tokens：所有颜色收敛到 --dt-*，禁止散落硬编码色。
 * Light = 默认（下方基座）；Dark = [data-whale-theme="dark"] 覆盖（documentElement 上
 * 由 theme.ts 设置，选择器仍收在 whale 根内，不泄漏到宿主）。 */
[data-whale-report], [data-whale-report-drawer], [data-whale-report-tabhost] {
  color-scheme: light;
  --dt-paper: #f5f8f9;
  --dt-paper-deep: #edf3f6;
  --dt-surface: #ffffff;
  --dt-surface-2: #f8fafc;
  --dt-ink: #0b1733;
  --dt-ink-soft: #33445f;
  --dt-muted: #6e7c8f;
  --dt-faint: #94a2b3;
  --dt-line: #d9e3e8;
  --dt-line-soft: #f1f5f9;
  --dt-line-strong: #b9c9d3;
  --dt-border: #e5e7eb;
  --dt-border-2: #e2e8f0;
  --dt-border-strong: #d1d5db;
  --dt-blue: #4d6bfe;
  --dt-blue-strong: #3e5bf5;
  --dt-blue-soft: #eef2ff;
  --dt-blue-border: #c7d2fe;
  --dt-blue-ink: #3730a3;
  --dt-cyan: #36b9d1;
  --dt-cyan-deep: #147a92;
  --dt-abyss: #07162f;
  --dt-abyss-2: #10264d;
  --dt-red: #c83a48;
  --dt-amber: #b87519;
  --dt-safe: #31765a;
  --dt-level-tip: #267957;
  --dt-up: #dc2626;
  --dt-down: #16a34a;
  --dt-danger: #b91c1c;
  --dt-danger-strong: #dc2626;
  --dt-danger-bg: #fef2f2;
  --dt-danger-border: #fecaca;
  --dt-warning: #92400e;
  --dt-warning-strong: #b45309;
  --dt-warning-bg: #fffbeb;
  --dt-warning-border: #fde68a;
  --dt-warning-mark: #fcd34d;
  --dt-warning-mark-bg: #fef3c7;
  --dt-warning-soft-bg: rgba(146, 64, 14, .08);
  --dt-amber-ink: #8a5a0e;
  --dt-cyan-soft: rgba(54, 185, 209, .14);
  --dt-cyan-soft-2: rgba(20, 122, 146, .72);
  --dt-cyan-soft-3: rgba(54, 185, 209, .16);
  --dt-cyan-soft-5: rgba(54, 185, 209, .5);
  --dt-cyan-bg: rgba(54, 185, 209, .1);
  --dt-cyan-border: rgba(54, 185, 209, .3);
  --dt-cyan-badge-bg: rgba(54, 185, 209, .09);
  --dt-cyan-badge-border: rgba(54, 185, 209, .45);
  --dt-amber-soft: rgba(184, 117, 25, .15);
  --dt-amber-soft-2: rgba(138, 90, 14, .72);
  --dt-amber-soft-4: rgba(184, 117, 25, .42);
  --dt-amber-soft-5: rgba(184, 117, 25, .68);
  --dt-amber-bg: rgba(184, 117, 25, .1);
  --dt-amber-border: rgba(184, 117, 25, .32);
  --dt-amber-badge-bg: rgba(184, 117, 25, .1);
  --dt-amber-badge-border: rgba(184, 117, 25, .5);
  --dt-secret-ink: #6d28d9;
  --dt-secret-bg: #f5f3ff;
  --dt-secret-border: #ddd6fe;
  --dt-gray-ink: #475569;
  --dt-track: #f3f4f6;
  --dt-hover: rgba(255, 255, 255, .42);
  --dt-hover-strong: rgba(255, 255, 255, .5);
  --dt-substrate: rgba(11, 23, 51, .014);
  --dt-heat-grid: rgba(11, 23, 51, .025);
  --dt-heat-0: #f7f9fc;
  --dt-heat-0-border: #dbe2ec;
  --dt-heat-empty: #dce7ec;
  --dt-heat-1: #dbe4ff;
  --dt-heat-2: #b3c4ff;
  --dt-heat-3: #8aa4ff;
  --dt-heat-4: #6b87ff;
  --dt-heat-5: #4d6bfe;
  --dt-heat-cur: rgba(77, 107, 254, .5);
  --dt-note-bg: #eef3f8;
  --dt-note-border: #ccd9e3;
  --dt-tooltip-bg: #0b1733;
  --dt-tooltip-text: #eef2f7;
  --dt-tooltip-muted: #c3cfe0;
  --dt-tooltip-faint: #9fb0c8;
  --dt-shadow: rgba(15, 23, 42, .12);
  --dt-shadow-2: rgba(7, 22, 47, .2);
  --dt-shadow-3: rgba(7, 22, 47, .25);
  --dt-sk-a: #eef0f5;
  --dt-sk-b: #f7f8fb;
  --dt-paper-97: rgba(245, 248, 249, .97);
  --dt-blue-glow: rgba(77, 107, 254, .35);
  --dt-blue-50: rgba(77, 107, 254, .5);
  --dt-blue-25: rgba(77, 107, 254, .025);
  --dt-blue-16: rgba(77, 107, 254, .16);
  --dt-blue-12: rgba(77, 107, 254, .12);
  --dt-blue-10: rgba(77, 107, 254, .10);
  --dt-blue-ring-22: rgba(77, 107, 254, .22);
  --dt-blue-ring-17: rgba(77, 107, 254, .17);
  --dt-blue-ring-16: rgba(77, 107, 254, .16);
  --dt-blue-ring-13: rgba(77, 107, 254, .13);
  --dt-blue-ring-05: rgba(77, 107, 254, .05);
  --dt-abyss-line-2: rgba(198, 211, 229, .3);
  --dt-abyss-line-3: rgba(198, 211, 229, .28);
  --dt-abyss-line-4: rgba(198, 211, 229, .16);
  --dt-abyss-white-06: rgba(255, 255, 255, .06);
  --dt-abyss-white-48: rgba(198, 211, 229, .48);
  --dt-on-accent: #ffffff;
  --dt-abyss-text: #f5f8ff;
  --dt-abyss-text-2: #cfdcf2;
  --dt-abyss-border: #18345d;
  --dt-abyss-muted: #9fb1ca;
  --dt-abyss-faint: #7f93af;
  --dt-abyss-stat: #91a5c1;
  --dt-abyss-line: rgba(207, 222, 245, .24);
  --dt-abyss-line-soft: rgba(207, 222, 245, .16);
  --dt-abyss-cyan: #7fcde0;
  --dt-export-muted: #c6d3e5;
  --dt-export-faint: #8698b3;
  --dt-export-hover: #ff8e98;
  --dt-export-down: #75d6b1;
  color: var(--dt-ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
  font-feature-settings: "tnum" 1, "ss01" 1;
}
/* Dark：深蓝黑 graphite（DeepSeek × Linear × Vercel），克制、低眩光、非纯黑。 */
:root[data-whale-theme="dark"] [data-whale-report],
:root[data-whale-theme="dark"] [data-whale-report-drawer],
:root[data-whale-theme="dark"] [data-whale-report-tabhost] {
  color-scheme: dark;
  --dt-paper: #0d1424;
  --dt-paper-deep: #111a2e;
  --dt-surface: #131c30;
  --dt-surface-2: #182238;
  --dt-ink: #e8edf6;
  --dt-ink-soft: #b7c3da;
  --dt-muted: #8b99b6;
  --dt-faint: #64728f;
  --dt-line: #22304a;
  --dt-line-soft: #1c2940;
  --dt-line-strong: #32425f;
  --dt-border: #2a3852;
  --dt-border-2: #2c3a55;
  --dt-border-strong: #3a4a68;
  --dt-blue: #6b87ff;
  --dt-blue-strong: #7f97ff;
  --dt-blue-soft: #1c2740;
  --dt-blue-border: #2f3f68;
  --dt-blue-ink: #9db1ff;
  --dt-cyan: #4fc6e0;
  --dt-cyan-deep: #58c4dc;
  --dt-abyss: #060e20;
  --dt-abyss-2: #16304f;
  --dt-red: #f26d7a;
  --dt-amber: #e2a14f;
  --dt-safe: #4cc38a;
  --dt-level-tip: #4cc38a;
  --dt-up: #ff7b87;
  --dt-down: #4cc38a;
  --dt-danger: #ff7b87;
  --dt-danger-strong: #ff5c68;
  --dt-danger-bg: #38202a;
  --dt-danger-border: #6b2f3b;
  --dt-warning: #f0b45e;
  --dt-warning-strong: #f59e0b;
  --dt-warning-bg: #382d18;
  --dt-warning-border: #77591f;
  --dt-warning-mark: #8a6a24;
  --dt-warning-mark-bg: #453414;
  --dt-warning-soft-bg: rgba(240, 180, 94, .14);
  --dt-amber-ink: #e2a14f;
  --dt-cyan-soft: rgba(88, 196, 220, .16);
  --dt-cyan-soft-2: rgba(88, 196, 220, .75);
  --dt-cyan-soft-3: rgba(88, 196, 220, .18);
  --dt-cyan-soft-5: rgba(88, 196, 220, .55);
  --dt-cyan-bg: rgba(88, 196, 220, .12);
  --dt-cyan-border: rgba(88, 196, 220, .35);
  --dt-cyan-badge-bg: rgba(88, 196, 220, .12);
  --dt-cyan-badge-border: rgba(88, 196, 220, .5);
  --dt-amber-soft: rgba(226, 161, 79, .18);
  --dt-amber-soft-2: rgba(226, 161, 79, .8);
  --dt-amber-soft-4: rgba(226, 161, 79, .5);
  --dt-amber-soft-5: rgba(226, 161, 79, .75);
  --dt-amber-bg: rgba(226, 161, 79, .14);
  --dt-amber-border: rgba(226, 161, 79, .4);
  --dt-amber-badge-bg: rgba(226, 161, 79, .16);
  --dt-amber-badge-border: rgba(226, 161, 79, .55);
  --dt-secret-ink: #b39df2;
  --dt-secret-bg: #262040;
  --dt-secret-border: #45386e;
  --dt-gray-ink: #93a1bd;
  --dt-track: #1d2940;
  --dt-hover: rgba(232, 237, 246, .05);
  --dt-hover-strong: rgba(232, 237, 246, .08);
  --dt-substrate: rgba(232, 237, 246, .03);
  --dt-heat-grid: rgba(232, 237, 246, .07);
  --dt-heat-0: #141e33;
  --dt-heat-0-border: #273650;
  --dt-heat-empty: #1c2a45;
  --dt-heat-1: #23345c;
  --dt-heat-2: #2c4280;
  --dt-heat-3: #3a57a8;
  --dt-heat-4: #4d6bfe;
  --dt-heat-5: #6f8bff;
  --dt-heat-cur: rgba(111, 139, 255, .55);
  --dt-note-bg: #141e33;
  --dt-note-border: #2a3852;
  --dt-tooltip-bg: #1d2940;
  --dt-tooltip-text: #e8edf6;
  --dt-tooltip-muted: #93a1bd;
  --dt-tooltip-faint: #64728f;
  --dt-shadow: rgba(0, 0, 0, .4);
  --dt-shadow-2: rgba(0, 0, 0, .5);
  --dt-shadow-3: rgba(0, 0, 0, .5);
  --dt-sk-a: #182238;
  --dt-sk-b: #1f2b45;
  --dt-paper-97: rgba(13, 20, 36, .94);
  --dt-blue-glow: rgba(77, 107, 254, .4);
  --dt-blue-50: rgba(111, 139, 255, .5);
  --dt-blue-25: rgba(111, 139, 255, .07);
  --dt-blue-16: rgba(111, 139, 255, .22);
  --dt-blue-12: rgba(111, 139, 255, .18);
  --dt-blue-10: rgba(111, 139, 255, .14);
  --dt-blue-ring-22: rgba(111, 139, 255, .3);
  --dt-blue-ring-17: rgba(111, 139, 255, .24);
  --dt-blue-ring-16: rgba(111, 139, 255, .22);
  --dt-blue-ring-13: rgba(111, 139, 255, .18);
  --dt-blue-ring-05: rgba(111, 139, 255, .08);
  --dt-abyss-line-2: rgba(198, 211, 229, .3);
  --dt-abyss-line-3: rgba(198, 211, 229, .28);
  --dt-abyss-line-4: rgba(198, 211, 229, .16);
  --dt-abyss-white-06: rgba(255, 255, 255, .06);
  --dt-abyss-white-48: rgba(198, 211, 229, .48);
  --dt-on-accent: #ffffff;
  --dt-abyss-text: #f5f8ff;
  --dt-abyss-text-2: #cfdcf2;
  --dt-abyss-border: #18345d;
  --dt-abyss-muted: #9fb1ca;
  --dt-abyss-faint: #7f93af;
  --dt-abyss-stat: #91a5c1;
  --dt-abyss-line: rgba(207, 222, 245, .24);
  --dt-abyss-line-soft: rgba(207, 222, 245, .16);
  --dt-abyss-cyan: #7fcde0;
  --dt-export-muted: #c6d3e5;
  --dt-export-faint: #8698b3;
  --dt-export-hover: #ff8e98;
  --dt-export-down: #75d6b1;
}
/* 深色下鲸鱼像素素材：压一档亮度/饱和度，避免白块感（不复制资产）。 */
:root[data-whale-theme="dark"] [data-whale-report-heroimg],
:root[data-whale-theme="dark"] [data-whale-report-reporthero],
:root[data-whale-theme="dark"] [data-whale-report-note-short] img,
:root[data-whale-theme="dark"] [data-whale-report-note] > [data-whale-report-notehead] > img {
  filter: brightness(.94) saturate(.88);
}
/* :where() keeps this reset at zero specificity so the per-control rules below
 * (all single attribute selectors) can actually win. */
:where([data-whale-report], [data-whale-report-drawer], [data-whale-report-tabhost]) :where(button, input) {
  font: inherit;
}
[data-whale-report-drawer], [data-whale-report-tabhost] { container: dtrace / inline-size; }
[data-whale-report-drawer] {
  width: 680px; max-width: 94vw; background: var(--dt-paper); border-left-color: var(--dt-line);
  box-shadow: -18px 0 48px var(--dt-shadow);
}
[data-whale-report-head] {
  min-height: 48px; padding: 0 20px; background: var(--dt-paper);
  border-bottom: 1px solid var(--dt-line);
}
[data-whale-report-title] { color: var(--dt-ink); font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
[data-whale-report-close] { color: var(--dt-muted); }
[data-whale-report-fab] {
  width: 50px; height: 50px; border-radius: 50%; background: var(--dt-abyss);
  box-shadow: 0 8px 24px var(--dt-shadow-2);
}
[data-whale-report-fab]:hover { background: var(--dt-abyss-2); transform: translateY(-2px); }
[data-whale-report-tabhost] {
  display: flex; flex-direction: column; height: 100%; overflow: hidden; padding: 0;
  color: var(--dt-ink); background: var(--dt-paper);
}
[data-whale-report-drawer] > [data-whale-report-body] {
  display: flex; flex: 1; flex-direction: column; min-height: 0; overflow: hidden; padding: 0;
}
[data-whale-report-tabs] {
  position: sticky; top: 0; z-index: 20; flex: 0 0 auto; gap: 28px;
  padding: 0 24px; background: var(--dt-paper-97); border-bottom: 1px solid var(--dt-line);
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
[data-whale-report-sonar] i { position: absolute; inset: 50%; border: 1px solid var(--dt-blue-ring-22); border-radius: 50%; transform: translate(-50%, -50%); }
[data-whale-report-sonar] i:nth-child(1) { width: 46%; height: 46%; }
[data-whale-report-sonar] i:nth-child(2) { width: 72%; height: 72%; }
[data-whale-report-sonar] i:nth-child(3) { width: 100%; height: 100%; animation: dt-sonar 4.8s ease-out infinite; }
[data-whale-report-depthscale] { position: absolute; right: 10px; top: 52px; height: 82px; padding-right: 14px; border-right: 1px solid var(--dt-line-strong); color: var(--dt-faint); font: 9px/1.1 ui-monospace, monospace; letter-spacing: .08em; }
[data-whale-report-depthscale]::after { content: "4096m\\A 3072\\A 2048\\A 1024\\A 0000"; white-space: pre; display: block; line-height: 18px; text-align: right; }

/* Hero sonar: slow scan sweep + faint pings, no glow. */
[data-whale-report-heroimg] { animation: dt-float 8.5s ease-in-out infinite; }
[data-whale-report-sonar] i:nth-child(1) { width: 46%; height: 46%; border-color: var(--dt-blue-16); }
[data-whale-report-sonar] i:nth-child(2) { width: 72%; height: 72%; border-color: var(--dt-blue-ring-13); }
[data-whale-report-sweep] {
  position: absolute; right: 14px; bottom: 19px; width: 160px; aspect-ratio: 1;
  border-radius: 50%; overflow: hidden; opacity: .5;
}
[data-whale-report-sweep] i {
  position: absolute; inset: 0; border-radius: 50%; transform-origin: 50% 50%;
  background: conic-gradient(from 0deg, var(--dt-blue-ring-17) 0deg, var(--dt-blue-ring-05) 26deg, transparent 62deg);
  animation: dt-sweep 13s linear infinite;
}
[data-whale-report-ping] { position: absolute; right: 14px; bottom: 19px; width: 160px; aspect-ratio: 1; }
[data-whale-report-ping] i {
  position: absolute; width: 3px; height: 3px; background: var(--dt-cyan); border-radius: 50%;
  animation: dt-ping 13s linear infinite;
}
[data-whale-report-ping] i:nth-child(1) { top: 34%; left: 27%; animation-delay: 1.1s; }
[data-whale-report-ping] i:nth-child(2) { top: 61%; left: 62%; animation-delay: 5.4s; }
[data-whale-report-ping] i:nth-child(3) { top: 24%; left: 68%; animation-delay: 9.2s; }
/* Telemetry readout: live dot on the first item only. */
[data-whale-report-brandmeta] span[data-live="true"]::before { animation: dt-live 2.6s ease-in-out infinite; }

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
[data-whale-report-herodelta2] em.down { color: var(--dt-level-tip); }
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
/* Subsection labels are instrument captions, not headlines: mono, small, with a short rule. */
[data-whale-report-h2] {
  display: flex; align-items: center; gap: 9px; margin: 0 0 12px;
  color: var(--dt-ink-soft); font: 9.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 750;
  letter-spacing: .15em; text-transform: uppercase;
}
[data-whale-report-h2]::after {
  content: ""; flex: 1; height: 1px; background: var(--dt-line);
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
[data-whale-report-feedrow]:hover, [data-whale-report-insight]:hover { border-color: var(--dt-line-strong); background: var(--dt-hover); }
[data-whale-report-feedrow][data-level="critical"], [data-whale-report-insight][data-level="critical"] { --dt-level: var(--dt-red); }
[data-whale-report-feedrow][data-level="warning"], [data-whale-report-insight][data-level="warning"] { --dt-level: var(--dt-amber); }
[data-whale-report-feedrow][data-level="tip"], [data-whale-report-insight][data-level="tip"] { --dt-level: var(--dt-level-tip); }
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
[data-whale-report-insighthead] span {
  color: var(--dt-faint); font: 9px/1.4 ui-monospace, monospace;
  letter-spacing: .14em; text-transform: uppercase; white-space: nowrap; transition: color .18s ease;
}
[data-whale-report-insight]:hover [data-whale-report-insightopen],
[data-whale-report-insight][data-open="true"] [data-whale-report-insightopen] { color: var(--dt-blue); }
[data-whale-report-fix] {
  margin-top: 12px; padding: 10px 0 2px 12px; background: transparent; border: 0; border-left: 1px solid var(--dt-blue);
  border-radius: 0; color: var(--dt-ink-soft); font-size: 11.5px;
}
[data-whale-report-fixcmd] code { background: transparent; border: 0; border-bottom: 1px solid var(--dt-line); border-radius: 0; }
[data-whale-report-fixcmd] button { padding: 4px 0; }

/* Whale note — a magazine marginalia rather than a dashboard card. */
[data-whale-report-note], [data-whale-report-note-short] {
  position: relative; overflow: visible; background: var(--dt-note-bg); border: 0; border-top: 1px solid var(--dt-note-border); border-bottom: 1px solid var(--dt-note-border);
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
/* Label block left, tone switch pinned right on the same optical line. */
[data-whale-report-notetitle] {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 10px; flex: 1;
}
[data-whale-report-notetitle] b {
  grid-column: 1; color: var(--dt-blue); font: 10px/1.4 ui-monospace, monospace; font-weight: 750;
  letter-spacing: .13em; text-transform: uppercase;
}
[data-whale-report-notetitle] > [data-whale-report-micro] { grid-column: 1; margin-top: 2px; }
[data-whale-report-noteopts] {
  grid-row: 1 / span 2; grid-column: 2; display: inline-flex; gap: 12px; margin: 0;
  padding: 0; background: transparent; border-radius: 0;
}
[data-whale-report-noteopts] button { padding: 0 0 3px; color: var(--dt-muted); border-bottom: 1px solid transparent; border-radius: 0; font-size: 10px; }
[data-whale-report-noteopts] button[data-active="true"] { color: var(--dt-ink); background: transparent; border-bottom-color: var(--dt-blue); }
[data-whale-report-noteline] { padding: 0; color: var(--dt-ink); font-family: ui-serif, Georgia, "Songti SC", serif; font-size: 14px; }
[data-whale-report-notelineitem] { padding: 0; line-height: 1.75; }
/* Lead line carries the note; the rest settles into the body voice. */
[data-whale-report-noteline] > [data-whale-report-notelineitem]:first-child {
  margin-bottom: 3px; color: var(--dt-abyss); font-size: 15.5px; line-height: 1.6;
}
[data-whale-report-noteline] > [data-whale-report-notelineitem]:not(:first-child) { color: var(--dt-ink-soft); }
[data-whale-report-notemore] {
  margin-top: 8px; padding-left: 11px; border-left: 1px solid var(--dt-line-strong);
  color: var(--dt-muted); font-size: 11.5px;
}
[data-whale-report-notefoot] { color: var(--dt-faint); border-top-color: var(--dt-note-border); font: 9px/1.6 ui-monospace, monospace; letter-spacing: .04em; }

/* Activity and token scan. */
[data-whale-report-weekrow] { gap: 9px; margin-bottom: 5px; }
[data-whale-report-weekrowlabel] { width: 43px; color: var(--dt-faint); font: 9px/1 ui-monospace, monospace; }
[data-whale-report-squares] { gap: 3px; }
[data-whale-report-squares] i { border-radius: 1px; outline: 1px solid var(--dt-heat-grid); }
[data-whale-report-legend] { color: var(--dt-faint); font: 9px/1.4 ui-monospace, monospace; }
[data-whale-report-legend] i { width: 10px; height: 10px; border-radius: 1px; }
/* Token flow reads as a measured band on a ruled baseline, not a progress bar:
 * thin body, hairline gaps between segments, tick scale underneath. */
[data-whale-report-tokenbar] {
  position: relative; height: 4px; margin: 12px 0 0; border-radius: 0; background: var(--dt-line);
}
[data-whale-report-tokenbar] i + i { box-shadow: -1px 0 0 var(--dt-paper); }
[data-whale-report-tokenbar]::after {
  content: ""; position: absolute; right: 0; bottom: -6px; left: 0; height: 3px;
  background-image: linear-gradient(to right, var(--dt-line-strong) 0 1px, transparent 1px);
  background-size: 10% 3px; opacity: .55; pointer-events: none;
}
[data-whale-report-tokenlegend] { gap: 7px 18px; margin-top: 14px; color: var(--dt-muted); font: 10px/1.6 ui-monospace, monospace; }
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
[data-whale-report-modelprov] { color: var(--dt-faint); }
[data-whale-report-modelhead] span { color: var(--dt-blue); font: 700 11px/1.5 ui-monospace, monospace; }
[data-whale-report-modelbar] { height: 2px; margin-top: 9px; border-radius: 0; background: var(--dt-line); overflow: visible; }
[data-whale-report-modelbar] i { min-width: 2px; }
[data-whale-report-modelnums] { margin-top: 7px; color: var(--dt-muted); font: 9.5px/1.55 ui-monospace, monospace; }

/* Full report opening and section compositions. */
[data-whale-report-reportopening] {
  position: relative; overflow: hidden; margin: 0 -24px; padding: 28px 24px 24px; color: var(--dt-abyss-text); background: var(--dt-abyss);
  border-bottom: 1px solid var(--dt-abyss-border);
}
[data-whale-report-reportopening] [data-whale-report-actions] { position: relative; z-index: 2; }
[data-whale-report-reportopening] [data-whale-report-btn] {
  padding: 7px 13px; color: var(--dt-abyss-text-2); background: transparent;
  border: 1px solid var(--dt-abyss-line-2); white-space: nowrap;
  font: 700 9.5px/1.4 ui-monospace, monospace; letter-spacing: .16em; text-transform: uppercase;
}
[data-whale-report-reportopening] [data-whale-report-btn]:hover {
  color: var(--dt-on-accent); background: var(--dt-blue-16); border-color: var(--dt-blue);
}
[data-whale-report-reportopening] [data-whale-report-btn][aria-expanded="true"] {
  color: var(--dt-on-accent); border-color: var(--dt-blue);
}
[data-whale-report-reportopening] [data-whale-report-btn][data-ghost="true"] {
  color: var(--dt-export-muted); background: transparent; border-color: var(--dt-abyss-line-3);
}
[data-whale-report-reportopening] [data-whale-report-btn][data-ghost="true"]:hover {
  color: var(--dt-on-accent); background: var(--dt-abyss-white-06); border-color: var(--dt-abyss-white-48);
}
[data-whale-report-reportlabel] { color: var(--dt-abyss-cyan); }
[data-whale-report-reptitle] { margin-top: 12px; color: var(--dt-abyss-text); font-size: clamp(25px, 6cqw, 38px); font-weight: 790; letter-spacing: -.035em; }
[data-whale-report-repsub] { color: var(--dt-abyss-muted); font: 10px/1.6 ui-monospace, monospace; letter-spacing: .06em; }
[data-whale-report-openingcost] { margin-top: 30px; color: var(--dt-on-accent); font-size: clamp(48px, 12cqw, 72px); font-weight: 820; line-height: 1; letter-spacing: -.06em; }
[data-whale-report-reportopening] [data-whale-report-herodelta2] span { color: var(--dt-abyss-muted); }
[data-whale-report-reportopening] [data-whale-report-herodelta2] .muted { color: var(--dt-abyss-faint); }
[data-whale-report-headrow] { position: relative; z-index: 2; padding: 0; }
[data-whale-report-reportopening] [data-whale-report-statgrid] { margin: 26px 0 0; }
[data-whale-report-statgrid] { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; }
[data-whale-report-stat] { min-width: 0; padding: 12px 10px 8px 0; background: transparent; border: 0; border-top: 1px solid var(--dt-abyss-line); border-radius: 0; }
[data-whale-report-stat]:not(:nth-child(3n + 1)) { padding-left: 10px; border-left: 1px solid var(--dt-abyss-line-soft); }
[data-whale-report-stat] b { color: var(--dt-on-accent); font-size: clamp(18px, 5cqw, 27px); }
[data-whale-report-stat] span { color: var(--dt-abyss-stat); font: 9px/1.5 ui-monospace, monospace; letter-spacing: .06em; text-transform: uppercase; }
[data-whale-report-stat] em.delta-up { color: var(--dt-export-hover); }
[data-whale-report-stat] em.delta-down { color: var(--dt-export-down); }
[data-whale-report-reporthero] { position: absolute; right: 18px; top: 76px; width: 104px; height: 104px; object-fit: contain; image-rendering: pixelated; opacity: .82; }
[data-whale-report-reportsection] { margin-top: 38px; padding-top: 0; }
[data-whale-report-reportsection] > [data-whale-report-sectionhead] { margin-bottom: 16px; }
[data-whale-report-reportgrid] { display: grid; grid-template-columns: minmax(0, 1.18fr) minmax(210px, .82fr); gap: 28px; }
[data-whale-report-reportgrid="equal"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
[data-whale-report-subsection] { min-width: 0; }
[data-whale-report-tokenline] { color: var(--dt-ink-soft); font-size: 12.5px; line-height: 1.75; }
[data-whale-report-tokenline] .muted, [data-whale-report-tokenline].muted { color: var(--dt-faint); }

/* Risk log and tools ledger. */
/* Risk is the cooled-down zone: a hairline gutter carries the severity, and the
 * saturated marker is a short cap at the top rather than a full-height red rail. */
[data-whale-report-risk] { position: relative; padding-left: 14px; border-left: 1px solid var(--dt-line-strong); }
[data-whale-report-risk]::before {
  content: ""; position: absolute; top: 0; left: -1px; width: 1px; height: 22px; background: var(--dt-amber);
}
[data-whale-report-risk][data-severity="critical"]::before { background: var(--dt-red); }
[data-whale-report-dangersum] { margin: 0 0 12px; padding: 0; background: transparent; border: 0; border-radius: 0; color: var(--dt-ink-soft); }
[data-whale-report-dangercats] { gap: 6px 14px; margin-bottom: 11px; }
[data-whale-report-dangercat], [data-whale-report-secretcat],
[data-whale-report-badge-red], [data-whale-report-badge-amber], [data-whale-report-badge-gray] {
  padding: 0; background: transparent; border: 0; border-radius: 0; font: 9px/1.5 ui-monospace, monospace; letter-spacing: .05em; text-transform: uppercase;
}
/* Red is reserved for the genuinely fatal category; everything else cools to amber. */
[data-whale-report-dangercat] { color: var(--dt-amber); }
[data-whale-report-dangercat][data-sev="red"], [data-whale-report-badge-red] { color: var(--dt-red); }
[data-whale-report-secretcat] { color: var(--dt-cyan-deep, #147a92); }
[data-whale-report-badge-amber] { color: var(--dt-amber); }
[data-whale-report-badge-gray] { color: var(--dt-muted); }
/* Forensic log line: timestamp + severity marker above, command verbatim below.
 * No red field, only a hairline tick carrying the severity. */
[data-whale-report-danger] {
  position: relative; margin: 0; padding: 10px 0 10px 11px;
  background: transparent !important; border: 0; border-bottom: 1px solid var(--dt-line) !important;
  border-radius: 0; color: var(--dt-ink) !important; font-size: 11px; word-break: break-all;
}
[data-whale-report-danger]::before {
  content: ""; position: absolute; top: 13px; left: 0; width: 2px; height: 9px; background: var(--dt-amber);
}
[data-whale-report-danger][data-sev="red"]::before { background: var(--dt-red); }
[data-whale-report-danger] em {
  display: block; margin: 0 0 4px; color: var(--dt-faint) !important;
  font: 9px/1.5 ui-monospace, monospace; font-style: normal; letter-spacing: .1em; text-transform: uppercase;
}
[data-whale-report-danger][data-sev="red"] em { color: var(--dt-red) !important; }
/* Sample disclosure is an instrument action, not a tab. */
[data-whale-report-samplesbtn] {
  padding: 6px 0 4px; color: var(--dt-blue); border-bottom: 1px solid transparent;
  font: 9px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 750; letter-spacing: .15em; text-transform: uppercase;
}
[data-whale-report-samplesbtn]:hover { color: var(--dt-blue); border-bottom-color: var(--dt-blue); }
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
[data-whale-report-sessionrow]:hover { background: var(--dt-hover); border-radius: 0; }
[data-whale-report-sessionindex] { color: var(--dt-faint); padding-top: 2px; }
[data-whale-report-sessionmain] b { color: var(--dt-ink); font-size: 13px; }
[data-whale-report-sessionmain] span { gap: 6px 12px; flex-wrap: wrap; margin-top: 6px; }
[data-whale-report-sessionmeta] { color: var(--dt-muted); font: 9px/1.5 ui-monospace, monospace; letter-spacing: .04em; text-transform: uppercase; }
[data-whale-report-sessioncost] { color: var(--dt-blue); font: 13px/1.4 ui-monospace, monospace; font-weight: 750; text-align: right; }
[data-whale-report-sessioncost] small { display: block; margin-top: 3px; color: var(--dt-faint); font-size: 8.5px; font-weight: 500; }
[data-whale-report-sessiondetail] { margin-left: 48px; padding: 11px 0 14px; border-bottom: 1px solid var(--dt-line); }
[data-whale-report-btn] { border-radius: 3px; background: var(--dt-abyss); font-size: 11.5px; letter-spacing: .02em; }
[data-whale-report-btn]:hover { background: var(--dt-abyss-2); }
[data-whale-report-btn][data-ghost="true"] { background: transparent; color: var(--dt-ink-soft); border-color: var(--dt-line-strong); }
[data-whale-report-fullbtn] { margin: 34px 0 0; padding: 14px; border-radius: 2px; letter-spacing: .08em; text-transform: uppercase; }

/* History becomes an archive index. */
[data-whale-report-historyhead] { padding: 28px 0 12px; border-bottom: 1px solid var(--dt-line); }
[data-whale-report-hitem] { margin: 0; padding: 15px 0; background: transparent; border: 0; border-bottom: 1px solid var(--dt-line); border-radius: 0; }
[data-whale-report-hitem]:hover { background: var(--dt-hover); border-color: var(--dt-line-strong); }
[data-whale-report-hitem] b { color: var(--dt-ink); }
[data-whale-report-hitem] span { color: var(--dt-muted); font-family: ui-monospace, monospace; font-size: 10px; }

/* Loading and restrained motion. */
[data-whale-report-sk-hero], [data-whale-report-sk-line] { background: var(--dt-line); animation: dt-pulse 1.25s ease-in-out infinite; }
[data-whale-report-section], [data-whale-report-hero], [data-whale-report-brand], [data-whale-report-reportsection] { animation: dt-reveal .22s ease-out both; }
@keyframes dt-reveal { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes dt-pulse { 50% { opacity: .52; } }
@keyframes dt-sonar { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.62); } 28% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -50%) scale(1); } }
@keyframes dt-sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes dt-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
@keyframes dt-live { 0%, 100% { opacity: 1; } 50% { opacity: .32; } }
@keyframes dt-ping { 0%, 72%, 100% { opacity: 0; } 12%, 40% { opacity: .85; } }

/* ── Deep-sea instrument substrate: faint, non-competing measurement traces ── */
/* Substrate stays at the threshold of visibility: horizontal depth rules only,
 * so it never reads as a table behind the content. */
[data-whale-report-body] {
  position: relative;
  background-image: linear-gradient(to bottom, var(--dt-substrate) 0 1px, transparent 1px);
  background-size: 100% 88px;
}
/* Measurement ticks hanging off each section rule. */
[data-whale-report-sectionhead] { position: relative; }
[data-whale-report-sectionhead]::after {
  content: ""; position: absolute; right: 0; bottom: -1px; left: 0; height: 3px;
  background-image: linear-gradient(to right, var(--dt-line-strong) 0 1px, transparent 1px);
  background-size: 13px 3px; opacity: .5; pointer-events: none;
}
/* Corner crosshair marker used by instrumented zones. */
[data-whale-report-xhair] {
  position: absolute; width: 9px; height: 9px; pointer-events: none;
  border-top: 1px solid var(--dt-line-strong); border-left: 1px solid var(--dt-line-strong); opacity: .75;
}
[data-whale-report-xhair][data-corner="tr"] { transform: rotate(90deg); }
[data-whale-report-xhair][data-corner="br"] { transform: rotate(180deg); }
[data-whale-report-xhair][data-corner="bl"] { transform: rotate(270deg); }

/* ── Investigation affordance: severity tick + OPEN reveal on hover ── */
[data-whale-report-feedrow]::before, [data-whale-report-insight]::before {
  content: ""; position: absolute; top: 17px; left: 0; width: 2px; height: 10px;
  background: var(--dt-level, var(--dt-line-strong)); opacity: 0; transition: opacity .18s ease;
}
/* Keep the index clear of the severity tick. */
[data-whale-report-feedindex], [data-whale-report-insight] > [data-whale-report-feedindex] { padding-left: 8px; }
[data-whale-report-feedrow][data-level]::before, [data-whale-report-insight][data-level]::before { opacity: .85; }
/* Out of flow so revealing it never reflows the row or pads its height;
 * the row keeps a small right gutter so long titles can't run under it. */
[data-whale-report-feedrow] { padding-right: 46px; }
[data-whale-report-feedopen] {
  position: absolute; top: 15px; right: 0; color: var(--dt-blue);
  font: 700 9px/1.4 ui-monospace, monospace;
  letter-spacing: .14em; text-transform: uppercase; opacity: 0; transition: opacity .18s ease;
}
[data-whale-report-feedrow]:hover [data-whale-report-feedopen],
[data-whale-report-feedrow][data-open="true"] [data-whale-report-feedopen] { opacity: 1; }
[data-whale-report-feedrow]:hover [data-whale-report-feedindex],
[data-whale-report-sessionrow]:hover [data-whale-report-sessionindex] { color: var(--dt-muted); }

/* ── Trace log: a faint vertical investigation line ── */
[data-whale-report-trace] { position: relative; }
[data-whale-report-trace]::before {
  content: ""; position: absolute; top: 74px; bottom: 12px; left: 15px; width: 1px;
  background: var(--dt-line); opacity: .8; pointer-events: none;
}
[data-whale-report-sessionrow] { position: relative; }
[data-whale-report-sessionrow]::before {
  content: ""; position: absolute; top: 21px; left: 15px; width: 9px; height: 1px; background: var(--dt-line-strong);
}
[data-whale-report-sessionindex] { position: relative; z-index: 1; background: var(--dt-paper); }
[data-whale-report-traceorigin] {
  display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; margin-bottom: 12px;
  color: var(--dt-muted); font: 9px/1.6 ui-monospace, monospace; letter-spacing: .13em; text-transform: uppercase;
}
[data-whale-report-traceorigin] b { color: var(--dt-ink-soft); font-weight: 750; }

/* ── Activity scan: hover locator, no contribution-graph feel ── */
[data-whale-report-weekrow] { position: relative; padding: 1px 0; }
[data-whale-report-weekrow]:hover { background: var(--dt-hover-strong); }
[data-whale-report-weekrow]:hover [data-whale-report-weekrowlabel] { color: var(--dt-muted); }
[data-whale-report-squares] i { transition: outline-color .16s ease; }
[data-whale-report-squares] i:hover { outline: 1px solid var(--dt-blue) !important; }

@container dtrace (max-width: 620px) {
  [data-whale-report-heatzone] { flex-direction: column; gap: 16px; }
  [data-whale-report-heatsummary] { padding-top: 0; flex-direction: row; flex-wrap: wrap; gap: 22px; }
  [data-whale-report-heatsummary] [data-whale-report-heatsumhead] { flex-basis: 100%; margin-bottom: 4px; }
  [data-whale-report-heatsumrow] { border-bottom: 0; padding: 2px 0; flex-direction: column; gap: 1px; align-items: flex-start; }
  [data-whale-report-heatcells] { width: 300px; }
  [data-whale-report-heataxis] { width: 300px; }
  [data-whale-report-heataxis] span { left: auto !important; }
  [data-whale-report-heataxis] span[data-align="start"] { left: 0 !important; }
  [data-whale-report-heataxis] span[data-align="end"] { left: 300px !important; }
  [data-whale-report-heataxis] span:nth-child(even) { display: none; }
  [data-whale-report-trendgrid] { grid-template-columns: 1fr; }
  [data-whale-report-heataxis] span:nth-child(even) { display: none; }
  [data-whale-report-heatcells] { gap: 1px; }
  [data-whale-report-body] { padding-right: 18px; padding-left: 18px; }
  [data-whale-report-brand], [data-whale-report-reportopening] { margin-right: -18px; margin-left: -18px; padding-right: 18px; padding-left: 18px; }
  [data-whale-report-hero] { grid-template-columns: 1fr; gap: 18px; }
  /* Four hero stats: one measured row, never a 3 + 1 orphan. */
  [data-whale-report-herostat] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  [data-whale-report-herostat] span { min-height: 48px; padding-left: 9px; border-left: 1px solid var(--dt-line); border-right: 0 !important; }
  [data-whale-report-herostat] span:first-child { padding-left: 0; border-left: 0; }
  [data-whale-report-herostat] b { font-size: 16.5px; letter-spacing: -.02em; }
  [data-whale-report-zone] { margin: 0 -18px; padding-right: 18px; padding-left: 18px; }
  [data-whale-report-reportgrid], [data-whale-report-reportgrid="equal"] { grid-template-columns: 1fr; gap: 28px; }
  [data-whale-report-headrow] { display: block; }
  [data-whale-report-actions] { margin-top: 16px; flex-wrap: wrap; }
  [data-whale-report-reporthero] { top: 148px; width: 84px; height: 84px; opacity: .66; }
}
@container dtrace (max-width: 460px) {
  [data-whale-report-body] { padding-right: 14px; padding-left: 14px; }
  [data-whale-report-tabs] { padding: 0 14px; }
  [data-whale-report-brand], [data-whale-report-reportopening] { margin-right: -14px; margin-left: -14px; padding-right: 14px; padding-left: 14px; }
  [data-whale-report-zone] { margin: 0 -14px; padding-right: 14px; padding-left: 14px; }
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
  [data-whale-report-stat]:nth-child(even) { padding-left: 10px; border-left: 1px solid var(--dt-abyss-line-soft); }
  [data-whale-report-reporthero] { top: 154px; width: 78px; height: 78px; opacity: .54; }
  [data-whale-report-sessionrow] { grid-template-columns: 31px minmax(0, 1fr) auto; gap: 7px; }
  [data-whale-report-sessiondetail] { margin-left: 38px; display: block; }
  [data-whale-report-sessiondetail] button { margin-top: 9px; }
  [data-whale-report-weekrowlabel] { width: 36px; }
  [data-whale-report-squares] { gap: 2px; }
  [data-whale-report-balancehead] { row-gap: 4px; }
  [data-whale-report-balancestatus] { flex: 1 0 100%; margin-left: 0; }
  [data-whale-report-balancefoot] { flex-wrap: wrap; row-gap: 5px; letter-spacing: .07em; }
}
@container dtrace (max-width: 360px) {
  [data-whale-report-chips] {
    display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-right: -14px; margin-left: -14px; padding-left: 0; overflow: visible;
  }
  [data-whale-report-chip] { min-width: 0; width: 100%; padding: 10px 3px 9px; text-align: center; }
  [data-whale-report-feedrow] { padding-right: 28px; }
  [data-whale-report-sessionmain] { min-width: 0; overflow: hidden; }
  [data-whale-report-sessionmain] b { max-width: 100%; }
  [data-whale-report-collabobs], [data-whale-report-collabtip] { grid-template-columns: 1fr; gap: 2px; }
  [data-whale-report-repmeta] { grid-template-columns: 1fr; gap: 5px; }
  [data-whale-report-repmeta] i { display: none; }
  [data-whale-report-repmeta] span { text-align: left; }
}
/* 280px: the narrowest supported instrument. Nothing may overflow. */
@container dtrace (max-width: 300px) {
  [data-whale-report-body] { padding-right: 10px; padding-left: 10px; background-size: 54px 100%, 100% 54px; }
  [data-whale-report-tabs] { gap: 16px; padding: 0 10px; }
  [data-whale-report-brand], [data-whale-report-reportopening] {
    margin-right: -10px; margin-left: -10px; padding-right: 10px; padding-left: 10px;
  }
  [data-whale-report-brand] { min-height: 0; padding-top: 22px; padding-bottom: 18px; }
  [data-whale-report-brandcopy] { max-width: 100%; }
  [data-whale-report-brandname] { font-size: 30px; }
  [data-whale-report-brandtag] { margin-top: 15px; }
  [data-whale-report-brandvisual] { position: relative; height: 92px; margin-top: 12px; }
  [data-whale-report-heroimg] { right: 0; bottom: 0; width: 88px; }
  [data-whale-report-sonar], [data-whale-report-sweep], [data-whale-report-ping] { width: 92px; right: -2px; bottom: 0; }
  [data-whale-report-heroval] { font-size: 40px; }
  [data-whale-report-herostat] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  [data-whale-report-herostat] span { min-height: 0; padding: 8px 0 !important; border-left: 0 !important; border-right: 0 !important; }
  [data-whale-report-herostat] span:nth-child(even) { padding-left: 9px !important; border-left: 1px solid var(--dt-line) !important; }
  [data-whale-report-herostat] b { font-size: 16px; }
  [data-whale-report-statgrid] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  [data-whale-report-stat] { padding-left: 0 !important; border-left: 0 !important; }
  [data-whale-report-stat]:nth-child(even) { padding-left: 9px !important; border-left: 1px solid var(--dt-abyss-line-soft) !important; }
  [data-whale-report-chips] { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-right: -10px; margin-left: -10px; }
  [data-whale-report-feedrow], [data-whale-report-insight] { grid-template-columns: 22px minmax(0, 1fr); gap: 5px; }
  [data-whale-report-feedrow] { padding-right: 0; }
  [data-whale-report-feedopen] { display: none; }
  [data-whale-report-feedcode] { grid-column: 2; }
  [data-whale-report-feedmain] { grid-column: 2; }
  [data-whale-report-collab] { grid-template-columns: 1fr; gap: 4px; }
  [data-whale-report-collabrail] { grid-template-columns: 1fr; gap: 4px; }
  [data-whale-report-collabrail] i { display: none; }
  [data-whale-report-balanceval] { font-size: 24px; }
  [data-whale-report-balancestatus] { flex: 1 0 100%; margin-left: 0; }
  [data-whale-report-balancefoot] { flex-wrap: wrap; row-gap: 5px; }
  [data-whale-report-balancefoot] span { flex: 1 0 100%; }
  [data-whale-report-feedindex] { padding-left: 7px; }
  [data-whale-report-note] { margin: 24px -6px 0; padding: 58px 12px 14px 12px; }
  [data-whale-report-note] > [data-whale-report-notehead] > img { left: 12px; top: 14px; width: 40px !important; height: 40px !important; }
  [data-whale-report-note-short] { grid-template-columns: 40px minmax(0, 1fr); gap: 9px; padding: 14px 12px 14px 6px; }
  [data-whale-report-note-short] img { width: 40px !important; height: 40px !important; }
  [data-whale-report-sessionrow] { grid-template-columns: 22px minmax(0, 1fr); gap: 6px; }
  [data-whale-report-sessioncost] { grid-column: 2; text-align: left; }
  [data-whale-report-sessiondetail] { margin-left: 22px; }
  [data-whale-report-trace]::before, [data-whale-report-sessionrow]::before { display: none; }
  [data-whale-report-actions] { gap: 9px; }
  [data-whale-report-danger-action] { margin-left: 0; }
  [data-whale-report-toolrow] { grid-template-columns: 20px minmax(0, 1fr); gap: 6px; }
  [data-whale-report-toolrow] b { grid-column: 2; }
  [data-whale-report-reporthero] { display: none; }
  /* Zone bleed must match this tier's 10px body padding exactly. */
  [data-whale-report-zone] { margin: 0 -10px; padding-right: 10px; padding-left: 10px; }
  [data-whale-report-weekrowlabel] { width: 30px; }
}
@media (prefers-reduced-motion: reduce) {
  [data-whale-report] *, [data-whale-report] *::before, [data-whale-report] *::after,
  [data-whale-report-drawer] *, [data-whale-report-drawer] *::before, [data-whale-report-drawer] *::after,
  [data-whale-report-tabhost] *, [data-whale-report-tabhost] *::before, [data-whale-report-tabhost] *::after {
    scroll-behavior: auto !important; animation: none !important; transition: none !important;
  }
}

/* ── 活跃图扫描线（SCAN 仪器感；纯色细线，无渐变）── */
@keyframes dt-scan {
  0% { left: -3px; opacity: 0; }
  10% { opacity: .85; }
  88% { opacity: .85; }
  100% { left: calc(100% - 3px); opacity: 0; }
}
[data-whale-report-scanwrap] { position: relative; }
[data-whale-report-scanline] {
  position: absolute; top: 0; bottom: 0; width: 3px;
  background: var(--dt-blue); opacity: 0;
  animation: dt-scan 4.5s ease-in-out infinite;
  pointer-events: none; z-index: 1;
}

/* ── 当前价格时段（峰谷仪表：峰=琥珀 / 谷=青，时段色贯穿整卡）── */
[data-whale-report-price] {
  margin: 0 0 14px; padding: 10px 14px 9px;
  border: 1px solid var(--dt-line); border-left: 3px solid var(--dt-cyan-deep);
  border-radius: 10px; background: var(--dt-paper-deep); position: relative;
}
[data-whale-report-price][data-period="peak"] { border-left-color: var(--dt-amber); }
[data-whale-report-pricehead] { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
[data-whale-report-pricecode] { font: 700 9.5px ui-monospace, monospace; color: var(--dt-faint); letter-spacing: .1em; }
[data-whale-report-priceperiod] {
  font: 750 9.5px ui-monospace, monospace; font-style: normal; letter-spacing: .08em;
  padding: 2px 9px; border-radius: 999px; white-space: nowrap;
  color: var(--dt-cyan-deep); background: var(--dt-cyan-soft);
}
[data-whale-report-price][data-period="peak"] [data-whale-report-priceperiod] {
  color: var(--dt-amber-ink); background: var(--dt-amber-soft);
}
[data-whale-report-ratetable] { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
[data-whale-report-raterow] {
  display: grid; grid-template-columns: 66px 1fr 1.5fr 1.3fr auto;
  align-items: baseline; gap: 8px; padding: 5px 9px;
  background: var(--dt-paper); border: 1px solid var(--dt-line); border-radius: 7px;
  font-variant-numeric: tabular-nums;
}
[data-whale-report-ratemodel] {
  font: 750 9px ui-monospace, monospace; font-style: normal; letter-spacing: .06em; color: var(--dt-ink-soft);
}
[data-whale-report-ratein], [data-whale-report-ratecache] { font: 400 9.5px ui-monospace, monospace; color: var(--dt-muted); }
[data-whale-report-rateout] {
  font: 700 14.5px/1.1 ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: var(--dt-cyan-deep);
}
[data-whale-report-price][data-period="peak"] [data-whale-report-rateout] { color: var(--dt-amber); }
[data-whale-report-rateother] { font: 400 9.5px ui-monospace, monospace; color: var(--dt-amber-soft-2); }
[data-whale-report-price][data-period="peak"] [data-whale-report-rateother] { color: var(--dt-cyan-soft-2); }
[data-whale-report-pricestrip] {
  position: relative; display: grid; grid-template-columns: repeat(24, 1fr);
  gap: 2px; margin-top: 8px; height: 14px;
}
[data-whale-report-pricestrip] i {
  display: block; border-radius: 2px; background: var(--dt-cyan-soft-3);
}
[data-whale-report-pricestrip] i[data-peak="true"] { background: var(--dt-amber-soft-4); }
[data-whale-report-pricestrip] i[data-now="true"] {
  box-shadow: 0 0 0 1.5px var(--dt-ink-soft) inset;
  background: var(--dt-cyan-soft-5);
}
[data-whale-report-pricestrip] i[data-now="true"][data-peak="true"] { background: var(--dt-amber-soft-5); }
[data-whale-report-stripneedle] {
  position: absolute; top: -3px; bottom: -3px; width: 2px;
  background: var(--dt-cyan-deep); transform: translateX(-50%);
  animation: dt-needle 1.4s ease-in-out infinite; pointer-events: none;
}
[data-whale-report-price][data-period="peak"] [data-whale-report-stripneedle] { background: var(--dt-amber); }
@keyframes dt-needle {
  0%, 100% { opacity: 1; }
  50% { opacity: .25; }
}
[data-whale-report-stripticks] {
  display: flex; justify-content: space-between; margin-top: 3px;
  font: 400 8px ui-monospace, monospace; color: var(--dt-faint);
}
[data-whale-report-pricecount] { font: 400 9px ui-monospace, monospace; color: var(--dt-muted); margin-top: 5px; letter-spacing: .03em; }
[data-whale-report-pricenotice] {
  margin-top: 7px; padding: 6px 9px; border-radius: 6px;
  color: var(--dt-ink-soft); font: 600 10px ui-sans-serif, system-ui, "PingFang SC", sans-serif;
  background: var(--dt-cyan-bg); border: 1px solid var(--dt-cyan-border);
  animation: dt-reveal .25s ease-out both;
}
[data-whale-report-price][data-period="peak"] [data-whale-report-pricenotice] {
  background: var(--dt-amber-bg); border-color: var(--dt-amber-border);
}

/* ── 右上角峰谷徽标（常驻时段指示：峰=琥珀 / 谷=青，与价格卡同口径）── */
[data-whale-report-peakbadge] {
  position: absolute; top: 14px; right: 14px; z-index: 4;
  display: flex; align-items: center; gap: 6px;
  padding: 4px 10px 4px 9px; border-radius: 999px;
  border: 1px solid var(--dt-cyan-badge-border); background: var(--dt-cyan-badge-bg);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
[data-whale-report-peakbadge][data-period="peak"] {
  border-color: var(--dt-amber-badge-border); background: var(--dt-amber-bg);
}
[data-whale-report-peakicon] {
  fill: var(--dt-cyan-deep); animation: dt-pulse 2s ease-in-out infinite; flex-shrink: 0;
}
[data-whale-report-peakbadge][data-period="peak"] [data-whale-report-peakicon] { fill: var(--dt-amber); }
[data-whale-report-peakrate] { font: 700 10px ui-monospace, monospace; color: var(--dt-ink-soft); }
@keyframes dt-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }

/* ── 当前会话消耗（live session meter）── */
[data-whale-report-live] {
  margin: 0 0 14px; padding: 10px 14px 9px;
  border: 1px solid var(--dt-line); border-radius: 10px;
  background: var(--dt-paper-deep);
}
[data-whale-report-livehead] { display: flex; justify-content: space-between; align-items: center; }
[data-whale-report-livecode] { font: 700 9.5px ui-monospace, monospace; color: var(--dt-faint); letter-spacing: .1em; }
[data-whale-report-livepulse] {
  font-style: normal; color: var(--dt-safe, var(--dt-safe)); font-size: 9px;
  animation: dt-breathe 2.4s ease-in-out infinite;
}
[data-whale-report-livetitle] {
  font: 600 12.5px ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: var(--dt-ink);
  margin-top: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
[data-whale-report-liveval] {
  font: 700 22px/1.2 ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: var(--dt-ink);
  font-variant-numeric: tabular-nums; margin-top: 2px;
}
[data-whale-report-liveval] small { font: 400 10px ui-monospace, monospace; color: var(--dt-faint); margin-left: 8px; }
[data-whale-report-livenums] { font: 400 9.5px ui-monospace, monospace; color: var(--dt-muted); margin-top: 3px; }
[data-whale-report-livefoot] {
  display: flex; justify-content: space-between; margin-top: 7px; padding-top: 6px;
  border-top: 1px dashed var(--dt-line); font: 400 8.5px ui-monospace, monospace; color: var(--dt-faint);
  letter-spacing: .05em;
}

/* ── Balance 动效：呼吸 LIVE 点 + 刷新差值 ── */
@keyframes dt-breathe {
  0%, 100% { opacity: .3; transform: scale(.85); }
  50% { opacity: 1; transform: scale(1.15); }
}
[data-whale-report-live-dot] {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: var(--dt-safe, var(--dt-safe)); margin-right: 6px; vertical-align: 1px;
  animation: dt-breathe 2.4s ease-in-out infinite;
}
[data-whale-report-balance][data-state="warn"] [data-whale-report-live-dot],
[data-whale-report-balance][data-state="bad"] [data-whale-report-live-dot],
[data-whale-report-balance][data-state="idle"] [data-whale-report-live-dot] {
  background: var(--dt-faint); animation: none;
}
[data-whale-report-balancedelta] {
  font: 600 9.5px ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--dt-faint); margin-left: 8px;
  font-variant-numeric: tabular-nums;
}

/* ── TOOL HEALTH（Full Report）── */
[data-whale-report-toolhealth-row] {
  display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px;
  padding: 9px 0; border-bottom: 1px solid var(--dt-line);
}
[data-whale-report-toolhealth-index] { color: var(--dt-faint); font: 400 10px ui-monospace, monospace; padding-top: 1px; }
[data-whale-report-toolhealth-main] { min-width: 0; }
[data-whale-report-toolhealth-head] { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
[data-whale-report-toolhealth-head] b { color: var(--dt-ink); font: 600 12.5px ui-sans-serif, system-ui, sans-serif; }
[data-whale-report-toolhealth-rate] { color: var(--dt-faint); font: 700 9.5px ui-monospace, monospace; }
[data-whale-report-toolhealth-rate][data-abnormal="true"] { color: var(--dt-red); }
[data-whale-report-toolhealth-bar] {
  height: 2px; margin-top: 6px; border-radius: 0; background: var(--dt-line); overflow: hidden;
}
[data-whale-report-toolhealth-bar] i { display: block; height: 100%; background: var(--dt-safe, var(--dt-safe)); min-width: 2px; }
[data-whale-report-toolhealth-row][data-abnormal="true"] [data-whale-report-toolhealth-bar] i { background: var(--dt-red); }
[data-whale-report-toolhealth-nums] {
  margin-top: 5px; color: var(--dt-muted); font: 400 9px/1.5 ui-monospace, monospace;
}
[data-whale-report-toolhealth-nums] em { font-style: normal; color: var(--dt-faint); }
[data-whale-report-toolhealth-nums] em[data-abnormal="true"] { color: var(--dt-red); font-weight: 700; }

/* ── 活跃扫描 v2（hourly heatmap：GitHub contribution × sonar）── */
[data-whale-report-heatwrap] { position: relative; margin-top: 4px; }
/* 活跃扫描 instrument：左 heatmap（~65%）+ 右 summary（~35%），顶部对齐，内容限宽。 */
[data-whale-report-heatzone] {
  display: flex; gap: 22px; align-items: flex-start; flex-wrap: wrap;
  max-width: 960px; margin-top: 6px;
}
[data-whale-report-heatwrap] { min-width: 0; flex: 1 1 470px; }
[data-whale-report-heatsummary] { flex: 1 1 220px; min-width: 180px; padding-top: 0; }
[data-whale-report-heatscan] {
  display: flex; gap: 18px; margin-left: 40px; margin-bottom: 5px;
  font: 400 8.5px ui-monospace, monospace; color: var(--dt-faint); letter-spacing: .08em;
}
[data-whale-report-heatscan] b { color: var(--dt-ink-soft); font-weight: 700; }
[data-whale-report-heataxis] { position: relative; height: 16px; width: 429px; margin-left: 40px; }
[data-whale-report-heataxis] span {
  position: absolute; transform: translateX(-50%);
  font: 400 9px ui-monospace, monospace; color: var(--dt-ink-soft);
}
[data-whale-report-heataxis] span[data-align="start"] { transform: none; left: 0 !important; }
[data-whale-report-heataxis] span[data-align="end"] { transform: translateX(-100%); }
[data-whale-report-heatrows] { display: flex; flex-direction: column; gap: 4px; width: fit-content; }
[data-whale-report-heatrow] { display: flex; align-items: center; gap: 6px; }
[data-whale-report-heatdate] {
  width: 34px; flex-shrink: 0; text-align: right;
  font: 400 9px ui-monospace, monospace; color: var(--dt-ink-soft);
  white-space: nowrap;
}
[data-whale-report-heatdate] em {
  font-style: normal; font-weight: 700; color: var(--dt-blue);
  font-size: 8px; margin-left: 2px; letter-spacing: .06em;
}
/* 固定 429px 网格（24 × 15px + 23 × 3px）。 */
[data-whale-report-heatcells] { display: flex; gap: 3px; width: 429px; }
[data-whale-report-heatcells] i {
  width: 15px; height: 15px; flex: none; border-radius: 2.5px; display: block;
  position: relative; transition: transform .08s ease;
}
/* hover hit 区扩大（视觉 15px，命中 ~21px）。 */
[data-whale-report-heatcells] i::after { content: ""; position: absolute; inset: -3px; }
/* 无活动：极浅背景格 + 细边框——空格子也清晰可见，24 列结构完整。 */
[data-whale-report-heatcells] i[data-level="0"] {
  background: var(--dt-heat-0);
  box-shadow: inset 0 0 0 1px var(--dt-heat-0-border);
}
[data-whale-report-heatcells] i[data-level="1"] { background: var(--dt-heat-1); }
[data-whale-report-heatcells] i[data-level="2"] { background: var(--dt-heat-2); }
[data-whale-report-heatcells] i[data-level="3"] { background: var(--dt-heat-3); }
[data-whale-report-heatcells] i[data-level="4"] { background: var(--dt-heat-4); }
[data-whale-report-heatcells] i[data-level="5"] { background: var(--dt-blue); }
[data-whale-report-heatcells] i:hover { transform: scale(1.25); z-index: 2; }
/* 当前小时：细 1px 蓝色描边。 */
[data-whale-report-heatcells] i[data-cur="true"] { outline: 1px solid var(--dt-heat-cur); outline-offset: 0; }
/* 活跃摘要：中文主标题 + 英文小 meta；label 弱 value 强；无卡片边框。 */
[data-whale-report-heatsumhead] {
  display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px;
}
[data-whale-report-heatsumhead] b { font: 700 13px ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: var(--dt-ink); }
[data-whale-report-heatsumhead] em { font: 700 8.5px ui-monospace, monospace; color: var(--dt-faint); letter-spacing: .1em; font-style: normal; }
[data-whale-report-heatsumrow] {
  display: flex; justify-content: space-between; align-items: baseline; gap: 16px;
  padding: 7px 0; border-bottom: 1px solid var(--dt-line);
}
[data-whale-report-heatsumrow]:last-child { border-bottom: 0; }
[data-whale-report-heatsumrow] span {
  font: 500 10.5px ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: var(--dt-muted);
  white-space: nowrap;
}
[data-whale-report-heatsumrow] b {
  font: 700 13px ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: var(--dt-ink);
  font-variant-numeric: tabular-nums; text-align: right;
}
[data-whale-report-heatsumrow] b em { font-style: normal; font-weight: 400; color: var(--dt-faint); font-size: 11px; }
[data-whale-report-heatlegend] {
  display: flex; align-items: center; gap: 4px; margin-top: 10px; margin-left: 40px;
  font: 400 10px ui-sans-serif, system-ui, sans-serif; color: var(--dt-muted);
  max-width: 429px;
}
[data-whale-report-heatlegend] i { width: 13px; height: 13px; border-radius: 2.5px; display: inline-block; }
[data-whale-report-heatlegend] em {
  font-style: normal; margin-left: 10px; font: 400 9px ui-monospace, monospace; color: var(--dt-faint);
}
[data-whale-report-heattip] {
  position: absolute; z-index: 6; top: 0; right: 0; min-width: 168px;
  background: var(--dt-ink); color: var(--dt-tooltip-text); border-radius: 8px; padding: 8px 10px;
  font: 400 10.5px/1.7 ui-sans-serif, system-ui, sans-serif; box-shadow: 0 8px 24px var(--dt-shadow-3);
  pointer-events: none;
}
[data-whale-report-heattip] b { display: block; font: 700 10.5px ui-monospace, monospace; color: var(--dt-on-accent); margin-bottom: 2px; }
[data-whale-report-heattip] div { display: flex; justify-content: space-between; gap: 14px; color: var(--dt-tooltip-muted); }
[data-whale-report-heattip] div em { font-style: normal; font-weight: 700; color: var(--dt-on-accent); font-variant-numeric: tabular-nums; }
[data-whale-report-heattip-empty] { color: var(--dt-tooltip-faint); }
[data-whale-report-heatlegend] {
  display: flex; align-items: center; gap: 3px; margin-top: 8px; margin-left: 44px;
  font: 400 9px ui-sans-serif, system-ui, sans-serif; color: var(--dt-muted);
}
[data-whale-report-heatlegend] i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
[data-whale-report-heatlegend] em {
  font-style: normal; margin-left: 8px; font: 400 8.5px ui-monospace, monospace; color: var(--dt-faint);
}

/* ── 历史趋势 TRENDS（v2：中文主标题 / 当前值 / 时间轴 / hover tooltip）── */
[data-whale-report-trendgrid] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
[data-whale-report-trendchart] {
  position: relative; min-width: 0; padding: 10px 12px 8px;
  background: transparent; border: 0; border-bottom: 1px solid var(--dt-line);
}
[data-whale-report-trendhead] { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
[data-whale-report-trendhead] b { font: 700 13px ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: var(--dt-ink); letter-spacing: .02em; }
[data-whale-report-trendhead] em { font: 700 8.5px ui-monospace, monospace; color: var(--dt-faint); letter-spacing: .1em; font-style: normal; }
[data-whale-report-trendval] {
  font: 700 24px/1.2 ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: var(--dt-ink);
  font-variant-numeric: tabular-nums; margin: 2px 0 6px; display: flex; align-items: baseline; gap: 8px;
}
[data-whale-report-trendval] [data-trend-delta] { font: 700 11px ui-monospace, monospace; }
[data-whale-report-trendval] [data-trend-delta="up"] { color: var(--dt-red); }
[data-whale-report-trendval] [data-trend-delta="down"] { color: var(--dt-safe, var(--dt-safe)); }
[data-whale-report-trendaxis] {
  display: flex; justify-content: space-between; gap: 2px; margin-top: 5px;
  font: 400 9px ui-monospace, monospace; color: var(--dt-ink-soft);
}
[data-whale-report-trendaxis] span { cursor: default; white-space: nowrap; padding: 1px 3px; }
[data-whale-report-trendaxis] span[data-live="true"] { color: var(--dt-blue); font-weight: 700; }
[data-whale-report-trendaxis] span[data-hover="true"] { background: var(--dt-paper-deep); border-radius: 4px; }
[data-whale-report-trendlive] {
  font: 700 8px/1.4 ui-monospace, monospace; color: var(--dt-blue);
  border: 1px solid var(--dt-blue); border-radius: 4px; padding: 0 4px; margin-left: 6px;
  letter-spacing: .08em; vertical-align: 2px;
}
[data-whale-report-trendtip] {
  position: absolute; z-index: 5; top: 46px; right: 8px; min-width: 150px;
  background: var(--dt-ink); color: var(--dt-tooltip-text); border-radius: 8px; padding: 8px 10px;
  font: 400 10.5px/1.7 ui-sans-serif, system-ui, sans-serif; box-shadow: 0 8px 24px var(--dt-shadow-3);
}
[data-whale-report-trendtip] b { display: block; font: 700 11px ui-monospace, monospace; color: var(--dt-on-accent); }
[data-whale-report-trendtip] > span { color: var(--dt-tooltip-faint); font: 400 9.5px ui-monospace, monospace; }
[data-whale-report-trendtip] div { display: flex; justify-content: space-between; gap: 14px; margin-top: 2px; color: var(--dt-tooltip-muted); }
[data-whale-report-trendtip] div em { font-style: normal; font-weight: 700; color: var(--dt-on-accent); font-variant-numeric: tabular-nums; }
[data-whale-report-trendempty] {
  margin-top: 12px; padding: 22px 0; text-align: center; border-bottom: 1px solid var(--dt-line);
  color: var(--dt-muted); font: 500 12px ui-sans-serif, system-ui, sans-serif; letter-spacing: .04em;
}

/* ── Provider Balance：live instrumentation module ── */
[data-whale-report-balance] {
  position: relative; overflow: hidden; margin: 0 0 4px; padding: 15px 0 12px;
  border: 0; border-top: 1px solid var(--dt-line); border-bottom: 1px solid var(--dt-line);
  border-radius: 0; background: transparent;
}
[data-whale-report-balance]::before {
  content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 34%;
  background: linear-gradient(90deg, transparent, var(--dt-blue-ring-05), transparent);
  animation: dt-scanx 9s ease-in-out infinite; pointer-events: none;
}
@keyframes dt-scanx { 0%, 100% { transform: translateX(-40%); } 50% { transform: translateX(320%); } }
[data-whale-report-balancehead] { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
[data-whale-report-balancelabel],
[data-whale-report-balancename],
[data-whale-report-balancestatus] {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .13em; text-transform: uppercase;
}
[data-whale-report-balancelabel] { font-size: 9px; font-weight: 700; color: var(--dt-faint); }
[data-whale-report-balancename] { font-size: 10px; font-weight: 750; color: var(--dt-ink); }
[data-whale-report-balancestatus] { margin-left: auto; font-size: 9px; color: var(--dt-muted); }
[data-whale-report-balancestatus] i {
  display: inline-block; width: 4px; height: 4px; margin: 0 6px 1px 0; border-radius: 50%;
  background: var(--dt-muted); vertical-align: baseline;
}
[data-whale-report-balance][data-state="ok"] [data-whale-report-balancestatus] { color: var(--dt-blue); }
[data-whale-report-balance][data-state="ok"] [data-whale-report-balancestatus] i {
  background: var(--dt-blue); animation: dt-live 2.4s ease-in-out infinite;
}
[data-whale-report-balance][data-state="warn"] [data-whale-report-balancestatus] { color: var(--dt-amber); }
[data-whale-report-balance][data-state="warn"] [data-whale-report-balancestatus] i { background: var(--dt-amber); }
[data-whale-report-balance][data-state="bad"] [data-whale-report-balancestatus] { color: var(--dt-red); }
[data-whale-report-balance][data-state="bad"] [data-whale-report-balancestatus] i { background: var(--dt-red); }
[data-whale-report-balanceval] {
  margin-top: 9px; color: var(--dt-ink); font-size: 30px; font-weight: 800; line-height: 1;
  letter-spacing: -.045em; font-variant-numeric: tabular-nums;
}
[data-whale-report-balanceval] small {
  display: block; margin: 7px 0 0; color: var(--dt-faint); font: 9px/1.4 ui-monospace, monospace;
  letter-spacing: .13em; text-transform: uppercase;
}
[data-whale-report-balance][data-stale="true"] [data-whale-report-balanceval] { color: var(--dt-muted); }
[data-whale-report-balancebreak] {
  margin-top: 8px; color: var(--dt-muted); font: 9.5px/1.6 ui-monospace, monospace; letter-spacing: .06em;
}
[data-whale-report-balancefoot] {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 11px;
  padding-top: 8px; border-top: 1px solid var(--dt-line);
  font: 8.5px/1.4 ui-monospace, monospace; color: var(--dt-faint); letter-spacing: .1em; text-transform: uppercase;
}
[data-whale-report-balancebtn] {
  flex: 0 0 auto; padding: 3px 0; background: transparent; border: 0; border-bottom: 1px solid transparent;
  border-radius: 0; color: var(--dt-ink-soft); cursor: pointer;
  font: 700 9px/1.4 ui-monospace, monospace; letter-spacing: .13em; text-transform: uppercase;
}
[data-whale-report-balancebtn]:hover { color: var(--dt-blue); border-bottom-color: var(--dt-blue); }
[data-whale-report-balancebtn]:disabled { opacity: .45; cursor: default; }
[data-whale-report-balancebtn][data-live="true"] { color: var(--dt-blue); }
/* Loading skeleton — measurement bars, not gray blobs. */
[data-whale-report-balancesk] { margin-top: 10px; height: 30px; display: flex; align-items: center; gap: 4px; }
[data-whale-report-balancesk] i {
  display: block; width: 4px; background: var(--dt-line-strong); animation: dt-pulse 1.15s ease-in-out infinite;
}
[data-whale-report-balancesk] i:nth-child(odd) { height: 15px; }
[data-whale-report-balancesk] i:nth-child(even) { height: 25px; animation-delay: .18s; }

/* ── 协作复盘章节行 ── */
/* Human × Harness relation rail — a restrained instrument, not chat bubbles. */
[data-whale-report-collabrail] {
  display: grid; grid-template-columns: auto minmax(24px, 1fr) auto; align-items: center; gap: 10px;
  margin: 0 0 16px; padding-bottom: 13px; border-bottom: 1px solid var(--dt-line);
  font: 9px/1.4 ui-monospace, monospace; letter-spacing: .15em; text-transform: uppercase; color: var(--dt-muted);
}
[data-whale-report-collabrail] b { color: var(--dt-ink); font-weight: 750; }
[data-whale-report-collabrail] i {
  position: relative; height: 1px; background: var(--dt-line-strong);
}
[data-whale-report-collabrail] i::before,
[data-whale-report-collabrail] i::after {
  content: ""; position: absolute; top: -2px; width: 5px; height: 5px; border-radius: 50%;
  background: var(--dt-paper);
}
[data-whale-report-collabrail] i::before { left: 0; border: 1px solid var(--dt-blue); }
[data-whale-report-collabrail] i::after { right: 0; border: 1px solid var(--dt-cyan); }
[data-whale-report-collabrail] em {
  color: var(--dt-faint); font-style: normal; font-size: 8.5px; letter-spacing: .1em;
}
[data-whale-report-collab] {
  display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 12px; align-items: start;
  margin: 0; padding: 15px 0; border: 0; border-bottom: 1px solid var(--dt-line);
}
[data-whale-report-collab]:first-of-type { border-top: 1px solid var(--dt-line); }
[data-whale-report-collab]:hover { background: var(--dt-hover); }
[data-whale-report-collabindex] {
  color: var(--dt-faint); font: 10px/1.5 ui-monospace, monospace; letter-spacing: .12em; padding-top: 2px;
}
[data-whale-report-collabbody] { min-width: 0; }
[data-whale-report-collabcode] {
  font: 9px/1.5 ui-monospace, monospace; font-weight: 750; color: var(--dt-cyan); letter-spacing: .15em; text-transform: uppercase;
}
[data-whale-report-collabtitle] { margin-top: 4px; color: var(--dt-ink); font-size: 13.5px; font-weight: 720; line-height: 1.45; }
[data-whale-report-collabobs], [data-whale-report-collabtip] {
  display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 10px; margin-top: 9px;
  color: var(--dt-ink-soft); font-size: 12px; line-height: 1.7;
}
[data-whale-report-collabobs]::before, [data-whale-report-collabtip]::before {
  font: 700 8.5px/1.9 ui-monospace, monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--dt-faint);
}
[data-whale-report-collabobs]::before { content: "observation"; }
[data-whale-report-collabtip]::before { content: "try"; color: var(--dt-blue); }
[data-whale-report-collabobs] { color: var(--dt-muted); }
[data-whale-report-collabtip] b { color: var(--dt-ink); font-weight: 700; }

/* ── Export cluster: one primary disclosure + separated destructive action ── */
[data-whale-report-actions] { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
[data-whale-report-exportwrap] { position: relative; }
[data-whale-report-exportmenu] {
  display: grid; gap: 0; margin-top: 10px; padding: 4px 0 0;
  border-top: 1px solid var(--dt-abyss-line-3);
}
[data-whale-report-exportmenu] button {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding: 8px 0; background: transparent; border: 0; border-bottom: 1px solid var(--dt-abyss-line-4);
  border-radius: 0; color: var(--dt-export-muted); cursor: pointer; text-align: left;
  font: 700 9.5px/1.4 ui-monospace, monospace; letter-spacing: .13em; text-transform: uppercase;
}
[data-whale-report-exportmenu] button:hover { color: var(--dt-on-accent); }
[data-whale-report-exportmenu] button em { color: var(--dt-abyss-faint); font-style: normal; font-size: 8.5px; letter-spacing: .1em; }
[data-whale-report-exportmenu] button:hover em { color: var(--dt-abyss-muted); }
[data-whale-report-actions] i {
  width: 1px; height: 11px; background: var(--dt-abyss-line-2);
}
[data-whale-report-danger-action] {
  padding: 3px 0; background: transparent; border: 0; border-bottom: 1px solid transparent;
  border-radius: 0; color: var(--dt-export-faint); cursor: pointer;
  font: 700 9px/1.4 ui-monospace, monospace; letter-spacing: .13em; text-transform: uppercase;
}
[data-whale-report-danger-action]:hover { color: var(--dt-export-hover); border-bottom-color: var(--dt-export-hover); }

/* ── Report generation: a stated guarantee, not a gray footnote ── */
[data-whale-report-repmeta] {
  display: grid; grid-template-columns: auto minmax(14px, 1fr) auto; align-items: center; gap: 12px;
  margin-top: 30px; padding-top: 13px; border-top: 1px solid var(--dt-line);
  font: 9px/1.5 ui-monospace, monospace; color: var(--dt-faint); letter-spacing: .14em; text-transform: uppercase;
}
[data-whale-report-repmeta] b { color: var(--dt-ink-soft); font-weight: 750; }
[data-whale-report-repmeta] i { height: 1px; background: var(--dt-line); }
[data-whale-report-repmeta] span { color: var(--dt-muted); text-align: right; }
[data-whale-report-repmeta] span em { color: var(--dt-blue); font-style: normal; font-weight: 750; }
[data-whale-report-repfine] {
  margin-top: 9px; color: var(--dt-faint); font: 8.5px/1.7 ui-monospace, monospace; letter-spacing: .08em;
}

/* ── Tool call trace: ranked measurement rows ── */
[data-whale-report-toollist] { border-top: 0; }
[data-whale-report-toolrow] {
  display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; gap: 10px; align-items: baseline;
  padding: 9px 0; border-bottom: 1px solid var(--dt-line); color: var(--dt-ink-soft); font-size: 12px;
}
[data-whale-report-toolrow]:first-child { border-top: 1px solid var(--dt-line); }
[data-whale-report-toolrow]:hover { background: var(--dt-hover); }
[data-whale-report-toolrow] i {
  color: var(--dt-faint); font: 9.5px/1.5 ui-monospace, monospace; font-style: normal; letter-spacing: .1em;
}
[data-whale-report-toolrow] code { color: var(--dt-ink); font-family: ui-monospace, monospace; font-size: 11.5px; }
[data-whale-report-toolrow] b {
  color: var(--dt-muted); font: 600 9.5px/1.5 ui-monospace, monospace; letter-spacing: .06em; white-space: nowrap;
}
[data-whale-report-toolrow] b em { color: var(--dt-blue); font-style: normal; font-weight: 750; }
/* Raw call names under the family rollup: keeps the trace dense without
 * touching the family caliber that insights.ts / the exports agree on. */
[data-whale-report-toolraw] {
  display: flex; flex-wrap: wrap; gap: 5px 14px; margin-top: 12px;
  color: var(--dt-muted); font: 9.5px/1.6 ui-monospace, monospace; letter-spacing: .04em;
}
[data-whale-report-toolraw] span { display: inline-flex; align-items: baseline; gap: 6px; }
[data-whale-report-toolraw] code {
  color: var(--dt-ink-soft); font-family: inherit; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase;
}
[data-whale-report-toolfine] {
  margin-top: 13px; padding-top: 9px; border-top: 1px solid var(--dt-line);
  color: var(--dt-faint); font: 9px/1.6 ui-monospace, monospace; letter-spacing: .1em; text-transform: uppercase;
}

/* 打印 = 面板报告（克隆到 body 顶层后 window.print）：
 * body 其它直接子级全部隐藏（不占位、无空白页），报告独占 A4。 */
@media print {
  @page { size: A4; margin: 10mm 8mm; }
  html, body { height: auto !important; overflow: visible !important; background: #ffffff !important; }
  body > *:not([data-whale-report-print-root]) { display: none !important; }
  /* 面板里报告用负 margin 向 body padding 出血（opening -24px / zone·note -12px）。
   * 打印根没有那层 padding，若不补上，两侧会被裁掉，所以这里补最大出血量。 */
  [data-whale-report-print-root] {
    display: block !important; width: auto !important; margin: 0 !important;
    padding: 0 24px !important;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  [data-whale-report-card], [data-whale-report-section],
  [data-whale-report-reportsection], [data-whale-report-note] { break-inside: avoid; }
  /* Decoration is screen-only: no animation, no substrate, no sonar in print. */
  [data-whale-report-print-root] *,
  [data-whale-report-print-root] *::before,
  [data-whale-report-print-root] *::after { animation: none !important; transition: none !important; }
  [data-whale-report-print-root] [data-whale-report-body] { background-image: none !important; }
  [data-whale-report-sonar], [data-whale-report-sweep], [data-whale-report-ping],
  [data-whale-report-xhair], [data-whale-report-feedopen], [data-whale-report-balancesk],
  [data-whale-report-insightopen], [data-whale-report-samplesbtn],
  [data-whale-report-exportmenu], [data-whale-report-danger-action],
  [data-whale-report-noteopts] { display: none !important; }
  [data-whale-report-balance]::before { display: none !important; }
  [data-whale-report-sectionhead]::after { display: none !important; }
  [data-whale-report-trace]::before, [data-whale-report-sessionrow]::before { display: none !important; }
  [data-whale-report-sessionindex] { background: transparent !important; }
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

/** Improve 建议（v0.5；服务端确定性规则，旧报告可缺省）。 */
interface ImprovementJson {
  id: string;
  period: string;
  category: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  summary: string;
  evidence: {
    metrics: Record<string, number>;
    affectedTools: string[];
    affectedSessions: string[];
    affectedModels: string[];
    affectedProviders: string[];
    occurrences: number;
    confidence: number;
    experimental?: boolean;
  };
  recommendation: string;
  verificationPlan: { targetMetric: string; baseline: number | null; target: string; window: string };
  status: string;
  createdAt: number;
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
  cost?: { perModel: Record<string, number>; total: number; currency: string; source: string; peakRatio?: number; peakShare?: number };
  insights?: InsightJson[];
  improvements?: ImprovementJson[];
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
  dayHourDetail?: {
    date: string;
    hours: {
      tokens: number;
      sessions: number;
      turns: number;
      toolCalls: number;
      modelTokens: Record<string, { input: number; output: number; cacheRead: number; reasoning: number }>;
      cost: number;
    }[];
  }[];
  toolHealth?: {
    name: string;
    calls: number;
    completed: number;
    failed: number;
    incomplete: number;
    successRate: number;
    failureRate: number;
    avgDurationMs: number;
    p50DurationMs: number;
    p95DurationMs: number;
    errorCodes: Record<string, number>;
  }[];
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
  /** 数据完整性（fault isolation）：损坏/读取失败被跳过的会话；缺失 ≠ 0。 */
  partial?: {
    skippedSessionIds: string[];
    skippedCount: number;
    reasons: string[];
    /** P0 salvage：官方读取器拒读但已只读恢复的会话。 */
    salvage?: {
      recoveredSessions: number;
      recoveredRecords: number;
      droppedRecords: number;
    };
  };
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

/** DATA PARTIAL 非阻断提示（fault isolation：部分会话损坏被跳过，数字低于实际）。 */
function PartialBanner({ partial }: { partial?: StatsJson["partial"] }): ReactNode {
  if (partial === undefined || (partial.skippedCount <= 0 && partial.salvage === undefined)) return null;
  const shown = partial.skippedSessionIds.slice(0, 4);
  const sv = partial.salvage;
  return (
    <div data-whale-report-partial role="note">
      <span data-whale-report-partialmark>DATA PARTIAL</span>
      <span>
        {partial.skippedCount > 0 && (
          <>
            <b>{partial.skippedCount}</b> 个会话日志损坏/无法读取，已跳过
            {shown.length > 0 && (
              <>
                {" "}
                <code>{shown.join(" · ")}</code>
                {shown.length < partial.skippedCount && ` +${partial.skippedCount - shown.length}`}
              </>
            )}
            。{" "}
          </>
        )}
        {sv !== undefined && (
          <>
            {sv.droppedRecords > 0
              ? `${sv.recoveredSessions} 个会话尾部损坏。已恢复 ${sv.recoveredRecords} 条完整记录，${sv.droppedRecords} 条残缺记录未计入。`
              : `${sv.recoveredSessions} 个会话的全部 ${sv.recoveredRecords} 条记录已只读恢复（0 条丢弃）。`}{" "}
          </>
        )}
        {partial.skippedCount > 0 || (sv !== undefined && sv.droppedRecords > 0) ? "缺失数据不按 0 计。" : "数据已完整恢复。"}
      </span>
    </div>
  );
}

function Heatmap({ histogram }: { histogram: number[] }): ReactNode {
  const theme = useResolvedTheme();
  const max = Math.max(1, ...histogram);
  const hue = (level: number): string => {
    const a = 0.14 + level * 0.82;
    const [r, g, b] = theme === "dark" ? [111, 139, 255] : [77, 107, 254];
    return `rgba(${r},${g},${b},${a.toFixed(2)})`;
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
/**
 * 深度色阶：冰蓝 → DeepSeek 蓝，单一冷色梯度（不换色相，避免出现紫/青突变）。
 * 只有最深的一档朝 cyan 微偏，作为「触底」标记。纯呈现，不影响任何数据口径。
 * 深色模式：深灰蓝底 → 更亮的 DeepTrace blue/cyan（THEME_COLORS.heatBase/heatPeak）。
 */
function green(level: number, theme: ResolvedTheme): string {
  const boosted = Math.pow(Math.min(1, Math.max(0, level)), 0.55);
  const [base, peak] = theme === "dark"
    ? [THEME_COLORS.dark.heatBase, THEME_COLORS.dark.heatPeak]
    : [THEME_COLORS.light.heatBase, THEME_COLORS.light.heatPeak];
  const mix = (from: number, to: number): number => Math.round(from + (to - from) * boosted);
  const r = mix(base[0], peak[0]);
  const g = mix(base[1], peak[1]);
  const b = mix(base[2], peak[2]);
  if (boosted > 0.88) {
    // 触底档：向 cyan 轻微偏移，作为峰值标记。
    return `rgb(${Math.round(r * 0.72)},${Math.round(g * 1.06)},${Math.round(b * 0.94)})`;
  }
  return `rgb(${r},${g},${b})`;
}

/** 图例：少 → 多。 */
function Legend(): ReactNode {
  const theme = useResolvedTheme();
  return (
    <div data-whale-report-legend>
      <span>少</span>
      <i style={{ background: green(0, theme) }} />
      <i style={{ background: green(0.3, theme) }} />
      <i style={{ background: green(0.6, theme) }} />
      <i style={{ background: green(1, theme) }} />
      <span>多</span>
    </div>
  );
}

function EmptyActivity(): ReactNode {
  return <div data-whale-report-gridempty>该报告生成于旧版本，无逐时数据。重新生成即可。</div>;
}

/** 一行小方格：左侧行标签 + 自适应宽度方块（每格随容器伸缩、保持正方形）。 */
function SquareRow({ label, cells }: { label: string; cells: { title: string; level: number }[] }): ReactNode {
  const theme = useResolvedTheme();
  const empty = theme === "dark" ? THEME_COLORS.dark.heatEmpty : THEME_COLORS.light.heatEmpty;
  return (
    <div data-whale-report-weekrow>
      <span data-whale-report-weekrowlabel>{label}</span>
      <div data-whale-report-squares data-whale-report-scanwrap>
        <i data-whale-report-scanline aria-hidden="true" />
        {cells.map((c, i) => (
          <i key={i} title={c.title} style={{ background: c.level === 0 ? empty : green(c.level, theme) }} />
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
/**
 * 活跃扫描（v2）：GitHub contribution × hourly heatmap。
 * nightOf：夜间占比（0–6 点，与报告口径一致）。
 * 每格 = 1 小时；颜色深浅 = activityLevel(tokens)（固定 log 阈值，跨日可比）；
 * hover 显示该小时的完整统计（tokens/会话/回合/工具/成本，来自报告聚合，无 hover IO）。
 */
const ACTIVITY_LEVEL_COLORS: Record<ResolvedTheme, string[]> = {
  light: THEME_COLORS.light.activityLevels,
  dark: THEME_COLORS.dark.activityLevels,
};

/** 夜间占比（0–6 点，与报告口径一致）。 */
function nightOf(s: StatsJson): number {
  return s.totalEvents === 0 ? 0 : Math.round((s.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0) / s.totalEvents) * 100);
}

function ActivityStrip({ report }: { report: ReportFull }): ReactNode {
  const theme = useResolvedTheme();
  const s = report.stats;
  const detail = s.dayHourDetail;
  // 旧报告（无 hour 级明细）：回退事件计数版（无 tooltip）。
  if (detail === undefined || detail.length === 0) {
    return <LegacyActivityStrip report={report} />;
  }
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const curHour = now.getHours();
  const rows = detail.slice(-31);
  const [hover, setHover] = useState<{ date: string; hour: number } | null>(null);
  const hovered = hover !== null ? rows.find((r) => r.date === hover.date) : undefined;
  const hoverCell =
    hover !== null && hovered !== undefined && hover.hour >= 0 && hover.hour < 24 ? hovered.hours[hover.hour] : undefined;
  // 右侧 summary（确定性，从 dayHourDetail 聚合，无 hover IO）。
  let peak: { date: string; hour: number; tokens: number } | null = null;
  let activeHours = 0;
  let totalTokens = 0;
  for (const day of rows) {
    for (let h = 0; h < 24; h++) {
      const cell = day.hours[h];
      totalTokens += cell.tokens;
      if (cell.tokens > 0) activeHours += 1;
      if (peak === null || cell.tokens > peak.tokens) {
        peak = { date: day.date, hour: h, tokens: cell.tokens };
      }
    }
  }
  const totalHours = rows.length * 24;
  return (
    <div data-whale-report-heatzone>
      <div data-whale-report-heatwrap>
        <div data-whale-report-heatscan>
          <span>SCAN <b>00—24</b></span>
          <span>DEPTH <b>4,096M</b></span>
          <span>PING <b>OK</b></span>
          <span>NIGHT <b>{nightOf(s)}%</b></span>
        </div>
        <div data-whale-report-heataxis>
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
            <span
              key={h}
              data-align={h === 0 ? "start" : h === 24 ? "end" : "center"}
              style={{ left: h === 0 ? 0 : h === 24 ? 429 : h * 18 + 7.5 }}
            >
              {String(h).padStart(2, "0")}
            </span>
          ))}
        </div>
        <div data-whale-report-heatrows>
          {rows.map((day) => {
            const isToday = day.date === todayKey;
            return (
              <div key={day.date} data-whale-report-heatrow>
                <span data-whale-report-heatdate>
                  {day.date.slice(5).replace("-", "/")}
                  {isToday && <em>LIVE</em>}
                </span>
                <div data-whale-report-heatcells>
                  {day.hours.map((cell, h) => {
                    const level = cell.tokens > 0 ? activityLevelOf(cell.tokens) : 0;
                    const isCur = isToday && h === curHour;
                    return (
                      <i
                        key={h}
                        data-level={level}
                        data-cur={isCur}
                        onMouseEnter={() => setHover({ date: day.date, hour: h })}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {hoverCell !== undefined && hovered !== undefined && hover !== null && (
          <div data-whale-report-heattip>
            <b>
              {hover.date.slice(5).replace("-", "月")}月 · {String(hover.hour).padStart(2, "0")}:00–{String(hover.hour + 1).padStart(2, "0")}:00
              {hover.date === todayKey && hover.hour === curHour ? " · 当前" : ""}
            </b>
            {hoverCell.tokens > 0 ? (
              <>
                <div>Tokens <em>{fmt(hoverCell.tokens)}</em></div>
                <div>会话 <em>{hoverCell.sessions}</em></div>
                <div>回合 <em>{hoverCell.turns}</em></div>
                <div>Tool calls <em>{hoverCell.toolCalls}</em></div>
                {hoverCell.cost > 0 && <div>成本 <em>¥{hoverCell.cost.toFixed(2)}</em></div>}
              </>
            ) : (
              <div data-whale-report-heattip-empty>无活动</div>
            )}
          </div>
        )}
        <div data-whale-report-heatlegend>
          <span>少</span>
          {[0, 1, 2, 3, 4, 5].map((l) => (
            <i key={l} style={{ background: ACTIVITY_LEVEL_COLORS[theme][l] }} title={l === 0 ? "无活动" : l === 1 ? "低" : l === 2 ? "中低" : l === 3 ? "中" : l === 4 ? "高" : "非常高"} />
          ))}
          <span>多</span>
          <em>基于 Tokens · 固定阈值</em>
        </div>
      </div>
      <div data-whale-report-heatsummary>
        <div data-whale-report-heatsumhead>
          <b>活跃摘要</b>
          <em>ACTIVITY SUMMARY</em>
        </div>
        <div data-whale-report-heatsumrow>
          <span>峰值时段</span>
          <b>
            {peak !== null && peak.tokens > 0
              ? `${peak.date.slice(5).replace("-", "/")} · ${String(peak.hour).padStart(2, "0")}:00–${String(peak.hour + 1).padStart(2, "0")}:00`
              : "—"}
          </b>
        </div>
        <div data-whale-report-heatsumrow>
          <span>活跃小时</span>
          <b>
            {activeHours} <em>/ {totalHours}</em>
          </b>
        </div>
        <div data-whale-report-heatsumrow>
          <span>本期 Tokens</span>
          <b>{fmt(totalTokens)}</b>
        </div>
      </div>
    </div>
  );
}

/** 旧报告回退：事件计数版 heatmap（无 tooltip，无小时明细）。 */
function LegacyActivityStrip({ report }: { report: ReportFull }): ReactNode {
  const s = report.stats;
  const series = s.dayHourSeries ?? [];
  if (series.length === 0) return <EmptyActivity />;
  const max = Math.max(1, ...series.flatMap((d) => d.hours));
  return (
    <div data-whale-report-heatwrap>
      <div data-whale-report-heatrows>
        {series.slice(-31).map((day) => (
          <div key={day.date} data-whale-report-heatrow>
            <span data-whale-report-heatdate>{day.date.slice(5).replace("-", "/")}</span>
            <div data-whale-report-heatcells>
              {day.hours.map((count, h) => {
                const level = count === 0 ? 0 : Math.min(5, 1 + Math.floor((count / max) * 5));
                return <i key={h} data-level={level} title={`${day.date} ${String(h).padStart(2, "0")}:00 · ${count} 事件`} />;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** activityLevel 的前端版本（与 stats.ts 同阈值；tokens 来自报告聚合）。 */
function activityLevelOf(tokens: number): number {
  if (tokens <= 0) return 0;
  if (tokens >= 80_000_000) return 5;
  if (tokens >= 30_000_000) return 4;
  if (tokens >= 10_000_000) return 3;
  if (tokens >= 1_000_000) return 2;
  return 1;
}


function TokenBar({ tokens }: { tokens: StatsJson["tokens"] }): ReactNode {
  const theme = useResolvedTheme();
  const legend = THEME_COLORS[theme].tokenLegend;
  const total = usageTotalTokens(tokens);
  if (total === 0) return null;
  const seg = (value: number, color: string, name: string) => (
    <i key={name} title={`${name} ${fmt(value)}`} style={{ width: `${(value / total) * 100}%`, background: color }} />
  );
  return (
    <div>
      <div data-whale-report-tokenbar>
        {seg(tokens.input, legend[0], "输入")}
        {seg(tokens.output, legend[1], "输出")}
        {seg(tokens.cacheRead, legend[2], "缓存命中")}
        {seg(tokens.reasoning, legend[3], "思考")}
      </div>
      <div data-whale-report-tokenlegend>
        <span><i style={{ background: legend[0] }} />输入 {fmt(tokens.input)}</span>
        <span><i style={{ background: legend[1] }} />输出 {fmt(tokens.output)}</span>
        <span><i style={{ background: legend[2] }} />缓存 {fmt(tokens.cacheRead)}</span>
        <span><i style={{ background: legend[3] }} />思考 {fmt(tokens.reasoning)}</span>
      </div>
    </div>
  );
}

/** 模型用量表（对齐 DS 开放平台用量页的展示习惯）。 */
/** 工具健康确定性排序：异常工具（失败明显）优先，健康工具按调用次数。 */
export function sortToolHealth(
  health: NonNullable<StatsJson["toolHealth"]>,
): { tool: NonNullable<StatsJson["toolHealth"]>[number]; abnormal: boolean }[] {
  return health
    .map((tool) => ({ tool, abnormal: tool.calls >= TOOL_HEALTH_MIN_CALLS && tool.failed >= TOOL_HEALTH_MIN_FAILED && tool.failureRate >= TOOL_HEALTH_MIN_FAILURE_RATE }))
    .sort((a, b) => {
      if (a.abnormal !== b.abnormal) return a.abnormal ? -1 : 1;
      if (a.abnormal && b.abnormal) return b.tool.failureRate - a.tool.failureRate;
      return b.tool.calls - a.tool.calls;
    });
}

function fmtDur(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** Full Report：TOOL HEALTH 区块（研究终端风格，异常优先展示）。 */
function ToolHealthBlock({ health }: { health: NonNullable<StatsJson["toolHealth"]> }): ReactNode {
  const rows = sortToolHealth(health);
  if (rows.length === 0) return <div data-whale-report-tokenline>（无工具调用数据）</div>;
  return (
    <div data-whale-report-toollist style={{ marginTop: 12 }}>
      <div data-whale-report-h2>TOOL HEALTH</div>
      {rows.slice(0, 10).map(({ tool, abnormal }, index) => {
        const successPct = Math.round(tool.successRate * 1000) / 10;
        const failedPct = Math.round(tool.failureRate * 1000) / 10;
        const errText = Object.entries(tool.errorCodes)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([code, n]) => `${code} ×${n}`)
          .join(" · ");
        return (
          <div key={tool.name} data-whale-report-toolhealth-row data-abnormal={abnormal}>
            <span data-whale-report-toolhealth-index>{String(index + 1).padStart(2, "0")}</span>
            <div data-whale-report-toolhealth-main>
              <div data-whale-report-toolhealth-head>
                <b>{tool.name}</b>
                <span data-whale-report-toolhealth-rate data-abnormal={abnormal}>
                  {successPct}% SUCCESS
                </span>
              </div>
              <div data-whale-report-toolhealth-bar>
                <i style={{ width: `${Math.max(1, Math.round(tool.successRate * 100))}%` }} />
              </div>
              <div data-whale-report-toolhealth-nums>
                {tool.calls} CALLS · {fmtDur(tool.avgDurationMs)} AVG
                {tool.failed > 0 && <em data-abnormal={abnormal}> · {tool.failed} FAILED{failedPct > 0 ? ` (${failedPct}%)` : ""}</em>}
                {tool.incomplete > 0 && <span> · {tool.incomplete} INCOMPLETE</span>}
                {errText !== "" && <span className="muted"> · {errText}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModelTable({ models, cost }: { models: StatsJson["models"]; cost?: ReportFull["cost"] }): ReactNode {
  const entries = Object.entries(models).sort(
    (a, b) => usageTotalTokens(b[1]) - usageTotalTokens(a[1]),
  );
  if (entries.length === 0) return <div data-whale-report-tokenline>（无模型用量数据）</div>;
  const grand = entries.reduce((sum, [, u]) => sum + usageTotalTokens(u), 0);
  return (
    <div data-whale-report-modeltable>
      {entries.map(([model, u], index) => {
        const total = usageTotalTokens(u);
        const share = grand > 0 ? Math.round((total / grand) * 100) : 0;
        return (
          <div key={model} data-whale-report-modelrow>
            <span data-whale-report-modelrank>{String(index + 1).padStart(2, "0")}</span>
            <div data-whale-report-modelhead>
              <div data-whale-report-modelname>
                <b>{splitModelKey(model).model}</b>
                {splitModelKey(model).provider !== null && <em data-whale-report-modelprov>{splitModelKey(model).provider!.toUpperCase()}</em>}
              </div>
              <span>{share}%{typeof cost?.perModel[model] === "number" ? ` / ¥${cost.perModel[model].toFixed(2)}` : ""}</span>
            </div>
            <div data-whale-report-modelbar>
              <i title={`${model} · ${share}%`} style={{ width: `${share}%`, background: "var(--dt-blue)" }} />
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
  info: { color: "var(--dt-blue)", icon: "ℹ" },
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
                <span data-whale-report-insightopen>{open ? "close ↑" : "open →"}</span>
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
  const totalTokens = usageTotalTokens(s.tokens);
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [samplesShown, setSamplesShown] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
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
            <ThemeToggle />
            <button data-whale-report-btn onClick={() => setExportOpen(!exportOpen)} aria-expanded={exportOpen}>
              EXPORT {exportOpen ? "↑" : "↓"}
            </button>
            <i aria-hidden="true" />
            <button data-whale-report-danger-action onClick={() => onDelete(report.id)}>删除报告</button>
          </div>
        </div>
        {exportOpen && (
          <div data-whale-report-exportmenu>
            <button
              onClick={() => {
                void exportReportImage(report, "main").catch((err: unknown) => {
                  window.alert(`导出图片失败：${err instanceof Error ? err.message : String(err)}`);
                });
              }}
            >
              PNG report <em>整份报告长图</em>
            </button>
            <button
              onClick={() => {
                void exportReportImage(report, "trace").catch((err: unknown) => {
                  window.alert(`导出会话轨迹失败：${err instanceof Error ? err.message : String(err)}`);
                });
              }}
            >
              Trace PNG <em>会话轨迹 + 索引</em>
            </button>
            <button
              onClick={() => {
                window.open(`/whale/api/html?id=${encodeURIComponent(report.id)}`, "_blank");
              }}
            >
              HTML <em>独立静态页</em>
            </button>
            <button onClick={exportPdf}>
              PDF <em>打印当前面板 · A4</em>
            </button>
          </div>
        )}
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
        <PartialBanner partial={s.partial} />
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
            <div data-whale-report-collabrail aria-hidden="true">
              <b>User · {fmt(report.stats.collab?.userMessages ?? 0)} 轮</b>
              <i />
              <b>Harness · {fmt(report.stats.sessions)} 会话</b>
            </div>
            {collab.map((item, i) => (
              <div key={item.code} data-whale-report-collab>
                <div data-whale-report-collabindex>{String(i + 1).padStart(2, "0")}</div>
                <div data-whale-report-collabbody>
                  <div data-whale-report-collabcode>{item.code}</div>
                  <div data-whale-report-collabtitle>{item.title}</div>
                  <div data-whale-report-collabobs><span>{item.observation}</span></div>
                  <div data-whale-report-collabtip><span>{item.suggestion}</span></div>
                </div>
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
            {(s.toolHealth ?? []).length > 0 && <ToolHealthBlock health={s.toolHealth ?? []} />}
            {typeof report.cost?.total === "number" && report.cost.total > 0 && (
              <div data-whale-report-tokenline style={{ marginTop: 10 }}>
                预估合计 <b>¥{report.cost.total.toFixed(2)}</b>
                <span className="muted"> · {report.cost.source === "official-page" ? "官方定价页实时价" : report.cost.source === "peak-offpeak" ? "官方峰谷价（按时段）" : "内置价"} · 以平台账单为准</span>
              </div>
            )}
          </div>
          <div data-whale-report-subsection>
            <div data-whale-report-h2>TOOL CALL TRACE</div>
            {topTools.length === 0 ? (
              <div data-whale-report-tokenline>（没有调用工具）</div>
            ) : (
              <div data-whale-report-toollist>
                {toolFamilies(s.toolCalls ?? {}).map((fam, i) => {
                  const share = s.toolCallsTotal > 0 ? Math.round((fam.count / s.toolCallsTotal) * 100) : 0;
                  return (
                    <div key={fam.family} data-whale-report-toolrow>
                      <i>{String(i + 1).padStart(2, "0")}</i>
                      <code>{fam.family}</code>
                      <b><em>{share}%</em> · {fmt(fam.count)}</b>
                    </div>
                  );
                })}
              </div>
            )}
            {topTools.length > 0 && (
              <div data-whale-report-toolraw>
                {topTools.map(([name, count]) => (
                  <span key={name}><code>{name}</code>{fmt(count)}</span>
                ))}
              </div>
            )}
            {(s.plugins ?? []).length > 0 && (
              <div data-whale-report-toolfine>
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
                  {[...danger
                    .reduce((m, d) => {
                      const cur = m.get(d.label);
                      // 只做展示分组：保留该类别中最高的严重度，红色仅留给真正致命的一类。
                      return m.set(d.label, { count: (cur?.count ?? 0) + 1, sev: cur?.sev === "red" ? "red" : d.sev });
                    }, new Map<string, { count: number; sev: string }>())
                    .entries()]
                    .sort((a, b) => b[1].count - a[1].count)
                    .map(([label, agg]) => (
                      <span key={label} data-whale-report-dangercat data-sev={agg.sev}>{label} <b>{agg.count}</b></span>
                    ))}
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
                      <div key={i} data-whale-report-danger data-sev={d.sev}>
                        <em>{new Date(d.time).toISOString().slice(0, 16).replace("T", " ")} · {d.label}</em>
                        {d.command.replace(/\s+/g, " ").slice(0, 64)}
                      </div>
                    ))}
                    {danger.length > 3 && !dangerExpanded && (
                      <button data-whale-report-chip data-whale-report-samplesbtn onClick={() => setDangerExpanded(true)}>
                        展开更多 ↓
                      </button>
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

      <div data-whale-report-repmeta>
        <b>Report generation</b>
        <i />
        <span>
          <em>{report.reportGeneration === undefined ? 0 : fmt(report.reportGeneration.totalTokens)} tokens</em>
          {" / "}
          {report.reportGeneration === undefined || report.reportGeneration.mode === "local"
            ? "local · deterministic · read only"
            : `model${report.reportGeneration.model !== undefined ? ` · ${report.reportGeneration.model}` : ""}`}
        </span>
      </div>
      <div data-whale-report-repfine>
        BASED ON {fmt(s.totalEvents)} SESSION EVENTS · GENERATED {dateStr(report.createdAt)}
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

/** 历史趋势：读 period_stats 的多周期曲线（零依赖 SVG 折线）。 */
interface TrendPoint {
  key: string;
  cost: number;
  sessions: number;
  totalEvents: number;
  tokens: { input: number; output: number; cacheRead: number; reasoning: number };
  nightRatio: number;
  cacheHitRate: number;
  dangerCount: number;
  redDanger: number;
  retryBursts: number;
  activeDays: number;
  from: number;
  to: number;
  /** 进行中周期（服务端确定性判定）：展示语义，不参与统计。 */
  isCurrent?: boolean;
  /** 数据完整性：该周期被跳过（损坏/读取失败）的会话数（fault isolation）。 */
  skippedCount?: number;
}

/** 周期短标签：wk-2026-W33 → W33；day-2026-08-16 → 08/16；mo-2026-06 → 2026-06；yr-2026 → 2026。 */
export function periodShortLabel(key: string): string {
  if (key.startsWith("wk-")) {
    const m = key.match(/W(\d+)$/);
    return m !== null ? `W${m[1]}` : key.slice(3);
  }
  if (key.startsWith("day-")) return key.slice(9, 11) + "/" + key.slice(12, 14);
  if (key.startsWith("mo-")) return key.slice(3);
  if (key.startsWith("yr-")) return key.slice(3);
  return key;
}

/** 周期日期范围（tooltip）：08/10 – 08/16。 */
function periodRange(from: number, to: number): string {
  const d = (ms: number): string => {
    const x = new Date(ms);
    return `${String(x.getMonth() + 1).padStart(2, "0")}/${String(x.getDate()).padStart(2, "0")}`;
  };
  return `${d(from)} – ${d(to)}`;
}

/** 完整周期标签（tooltip）：2026-W33。 */
function periodFullLabel(preset: string, key: string): string {
  if (preset === "weekly") return key.replace("wk-", "").replace("-W", "-W");
  if (preset === "daily") return key.slice(4).replace(/-/g, "/");
  if (preset === "monthly") return key.slice(3);
  if (preset === "yearly") return key.slice(3);
  return key;
}

function TrendChart({
  preset,
  points,
  metric,
  color,
  unit,
  cnTitle,
  hoverIndex,
  onHover,
}: {
  preset: string;
  points: TrendPoint[];
  metric: (t: TrendPoint) => number;
  color: string;
  unit: string;
  cnTitle: string;
  hoverIndex: number | null;
  onHover: (i: number | null) => void;
}): ReactNode {
  const W = 220;
  const H = 60;
  const P = 6;
  const values = points.map(metric);
  const liveLast = points[points.length - 1].isCurrent === true;
  const last = values[values.length - 1];
  // 当前值 vs 上一完整周期（LIVE 时对比前一个；无 LIVE 时对比上一个点）。
  const prevComplete = liveLast ? values[values.length - 2] : values[values.length - 2];
  const delta = prevComplete !== undefined && prevComplete > 0 ? Math.round(((last - prevComplete) / prevComplete) * 100) : null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = Math.max(max - min, max * 0.15, 1);
  const pts = values.map((v, i) => {
    const x = P + (i / (values.length - 1)) * (W - P * 2);
    const y = H - P - ((v - min) / range) * (H - P * 2 - 8);
    return [x, y] as const;
  });
  const lastIdx = pts.length - 1;
  const fmtVal = (v: number): string => (unit === "%" ? `${v}%` : unit === "¥" ? `¥${v.toFixed(2)}` : fmt(v) + unit);
  const hover = hoverIndex !== null ? points[hoverIndex] : null;
  return (
    <div data-whale-report-trendchart onMouseLeave={() => onHover(null)}>
      <div data-whale-report-trendhead>
        <b>
          {cnTitle} <span>{points.length > 0 && unit === "%" ? "夜间活跃" : unit}</span>
        </b>
        <em>{unit === "¥" ? "COST" : unit === "%" ? "NIGHT" : cnTitle.toUpperCase()}</em>
      </div>
      <div data-whale-report-trendval>
        {fmtVal(last)}
        {delta !== null && delta !== 0 && (
          <span data-trend-delta={delta > 0 ? "up" : "down"}>
            {delta > 0 ? "↑" : "↓"} {Math.abs(delta)}%
          </span>
        )}
        {liveLast && <em data-whale-report-trendlive>LIVE</em>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${cnTitle} 趋势`}>
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--dt-line)" strokeWidth="1" />
        {pts.map(([x, y], i) => (
          <g key={i}>
            {i > 0 && (
              <line
                x1={pts[i - 1][0]}
                y1={pts[i - 1][1]}
                x2={x}
                y2={y}
                stroke={color}
                strokeWidth="1.8"
                strokeDasharray={liveLast && i === lastIdx ? "3 3" : undefined}
              />
            )}
            <circle
              cx={x}
              cy={y}
              r={liveLast && i === lastIdx ? 3.2 : hoverIndex === i ? 3.6 : 2.6}
              fill={liveLast && i === lastIdx ? "var(--dt-paper-deep)" : color}
              stroke={color}
              strokeWidth={liveLast && i === lastIdx ? 1.4 : 0}
              style={{ cursor: "pointer", transition: "r .12s ease" }}
              onMouseEnter={() => onHover(i)}
            />
          </g>
        ))}
      </svg>
      <div data-whale-report-trendaxis>
        {points.map((t, i) => (
          <span key={t.key} data-live={t.isCurrent === true} data-hover={hoverIndex === i} onMouseEnter={() => onHover(i)}>
            {periodShortLabel(t.key)}
            {t.isCurrent === true ? " LIVE" : ""}
            {(t.skippedCount ?? 0) > 0 ? " ⚠" : ""}
          </span>
        ))}
      </div>
      {hover !== null && (
        <div data-whale-report-trendtip>
          <b>
            {periodFullLabel(preset, hover.key)}
            {hover.isCurrent === true ? " · LIVE" : ""}
            {(hover.skippedCount ?? 0) > 0 ? " · DATA PARTIAL" : ""}
          </b>
          <span>{periodRange(hover.from, hover.to)}{hover.isCurrent === true ? " · 当前进行中" : ""}</span>
          {(hover.skippedCount ?? 0) > 0 && (
            <span>
              该周期 {hover.skippedCount} 个会话损坏被跳过 · 数字低于实际
            </span>
          )}
          <div>
            成本 <em>¥{hover.cost.toFixed(2)}</em>
          </div>
          <div>
            会话 <em>{hover.sessions}</em>
          </div>
          <div>
            Tokens <em>{fmt(usageTotalTokens(hover.tokens))}</em>
          </div>
          <div>
            夜间 <em>{hover.nightRatio}%</em>
          </div>
        </div>
      )}
    </div>
  );
}

function TrendSection({ preset }: { preset: string }): ReactNode {
  const [trends, setTrends] = useState<TrendPoint[] | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    setTrends(null);
    setHoverIndex(null);
    fetch(`/whale/api/trends?preset=${encodeURIComponent(preset)}&limit=8`)
      .then((r) => (r.ok ? (r.json() as Promise<{ ok: boolean; trends: TrendPoint[] }>) : Promise.reject(new Error("HTTP"))))
      .then((json) => {
        if (alive && Array.isArray(json.trends)) setTrends(json.trends);
      })
      .catch(() => {
        if (alive) setTrends([]);
      });
    return () => {
      alive = false;
    };
  }, [preset]);
  if (trends === null) return null;
  if (trends.length < 2) {
    return (
      <section data-whale-report-section>
        <SectionHeader index="—" title="历史趋势" meta="HISTORY / TREND" />
        <div data-whale-report-trendempty>暂无足够历史数据 · 至少需要 2 个周期</div>
      </section>
    );
  }
  const liveCount = trends.filter((t) => t.isCurrent === true).length;
  const completeCount = trends.length - liveCount;
  const partialCount = trends.filter((t) => (t.skippedCount ?? 0) > 0).length;
  const chart = (cnTitle: string, metric: (t: TrendPoint) => number, color: string, unit: string) => (
    <TrendChart
      preset={preset}
      points={trends}
      metric={metric}
      color={color}
      unit={unit}
      cnTitle={cnTitle}
      hoverIndex={hoverIndex}
      onHover={setHoverIndex}
    />
  );
  return (
    <section data-whale-report-section>
      <SectionHeader
        index="—"
        title="历史趋势"
        meta={`HISTORY / ${completeCount} COMPLETE${liveCount > 0 ? ` · ${liveCount} LIVE` : ""}${partialCount > 0 ? ` · ${partialCount} PARTIAL` : ""}`}
      />
      <div data-whale-report-trendgrid>
        {chart("成本", (t) => t.cost, "var(--dt-blue)", "¥")}
        {chart("会话", (t) => t.sessions, "var(--dt-cyan)", "")}
        {chart("缓存命中", (t) => t.cacheHitRate, "var(--dt-safe, #31765a)", "%")}
        {chart("夜间活跃", (t) => t.nightRatio, "var(--dt-amber)", "%")}
      </div>
    </section>
  );
}

/** 峰谷时段判定（前端版；与 pricing.ts 同口径：北京时间 9–12、14–18 高峰）。 */
function isPeakNow(ms: number): boolean {
  const cstHour = (new Date(ms).getUTCHours() + 8) % 24;
  return (cstHour >= 9 && cstHour < 12) || (cstHour >= 14 && cstHour < 18);
}

/** 当前价格时段 + 时段切换提醒（每分钟检查）。
 * 官方峰谷价目（2026-08-17 起；与 pricing.ts 的 PEAK_PRICES/OFFPEAK_PRICES 同源），单位 ¥/百万 token。 */
const RATE_ROWS: Array<{
  model: string;
  peak: { in: string; out: string; cache: string };
  offpeak: { in: string; out: string; cache: string };
}> = [
  { model: "V4 PRO", peak: { in: "9.0", out: "27.0", cache: "0.30" }, offpeak: { in: "4.5", out: "13.5", cache: "0.15" } },
  { model: "V4 FLASH", peak: { in: "3.0", out: "9.0", cache: "0.10" }, offpeak: { in: "1.5", out: "4.5", cache: "0.05" } },
];
/** 峰谷切换边界（北京时间）；9:00/14:00 转高峰，12:00/18:00 转谷时。 */
const PERIOD_BOUNDS: Array<{ m: number; label: string; to: "peak" | "offpeak" }> = [
  { m: 9 * 60, label: "9:00", to: "peak" },
  { m: 12 * 60, label: "12:00", to: "offpeak" },
  { m: 14 * 60, label: "14:00", to: "peak" },
  { m: 18 * 60, label: "18:00", to: "offpeak" },
];

function PricePeriodCard(): ReactNode {
  const [period, setPeriod] = useState<"peak" | "offpeak">(isPeakNow(Date.now()) ? "peak" : "offpeak");
  const [noticed, setNoticed] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const initial: "peak" | "offpeak" = isPeakNow(Date.now()) ? "peak" : "offpeak";
    let prev = initial;
    setPeriod(initial);
    const timer = window.setInterval(() => {
      const cur = isPeakNow(Date.now()) ? "peak" : "offpeak";
      tick((t) => t + 1); // 每分钟重绘时针与倒计时
      if (cur !== prev) {
        setPeriod(cur);
        setNoticed(true);
        window.setTimeout(() => setNoticed(false), 6000);
      }
      prev = cur;
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const peak = period === "peak";
  const now = new Date();
  const cstHour = (now.getUTCHours() + 8) % 24;
  const cstClock = cstHour * 60 + now.getUTCMinutes();
  const next = PERIOD_BOUNDS.find((b) => b.m > cstClock) ?? { m: 33 * 60, label: "9:00", to: "peak" as const };
  const minutesLeft = next.m - cstClock;
  const countdown =
    minutesLeft >= 60 ? `${Math.floor(minutesLeft / 60)}h ${String(minutesLeft % 60).padStart(2, "0")}m` : `${minutesLeft}m`;
  const hours = Array.from({ length: 24 }, (_, h) => (h >= 9 && h < 12) || (h >= 14 && h < 18));
  return (
    <div data-whale-report-price data-period={period}>
      <div data-whale-report-pricehead>
        <span data-whale-report-pricecode>CURRENT RATE · ¥/1M TOKEN / 当前价格</span>
        <em data-whale-report-priceperiod>{peak ? "高峰 · PEAK" : "谷时 · OFF-PEAK"}</em>
      </div>
      <div data-whale-report-ratetable>
        {RATE_ROWS.map((r) => {
          const cur = peak ? r.peak : r.offpeak;
          const other = peak ? r.offpeak : r.peak;
          return (
            <div key={r.model} data-whale-report-raterow>
              <em data-whale-report-ratemodel>{r.model}</em>
              <span data-whale-report-ratein>输入 ¥{cur.in}</span>
              <b data-whale-report-rateout>输出 ¥{cur.out}</b>
              <span data-whale-report-ratecache>缓存 ¥{cur.cache}</span>
              <span data-whale-report-rateother>
                {peak ? "谷" : "峰"} ¥{other.out}
              </span>
            </div>
          );
        })}
      </div>
      <div
        data-whale-report-pricestrip
        role="img"
        aria-label="峰谷时段分布：高峰 9–12 与 14–18 时（琥珀色），其余为谷时（青色），指针标示当前时刻"
      >
        {hours.map((pk, h) => (
          <i key={h} data-peak={pk} data-now={h === cstHour} />
        ))}
        <div data-whale-report-stripneedle style={{ left: `${((cstClock / (24 * 60)) * 100).toFixed(2)}%` }} />
      </div>
      <div data-whale-report-stripticks aria-hidden="true">
        <span>0</span>
        <span>6</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      <div data-whale-report-pricecount>
        距 {next.label} 转{next.to === "peak" ? "高峰" : "谷时"} {countdown} · 高峰 9–12 / 14–18 北京时间
        {peak ? " · 谷时 5 折" : " · 高峰 2×"}
      </div>
      {noticed && (
        <div data-whale-report-pricenotice>
          {peak
            ? "已进入高峰时段 · PRO 输出 ¥27.0 / FLASH 输出 ¥9.0"
            : "已切换到谷时段 · PRO 输出 ¥13.5 / FLASH 输出 ¥4.5"}
        </div>
      )}
    </div>
  );
}

/** 右上角峰谷徽标：常驻显示当前时段与 PRO 输出价（与 PricePeriodCard 同口径，每分钟刷新）。 */
function PeakBadge(): ReactNode {
  const [period, setPeriod] = useState<"peak" | "offpeak">(isPeakNow(Date.now()) ? "peak" : "offpeak");
  useEffect(() => {
    const timer = window.setInterval(() => {
      setPeriod(isPeakNow(Date.now()) ? "peak" : "offpeak");
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const peak = period === "peak";
  const proOut = peak ? RATE_ROWS[0].peak.out : RATE_ROWS[0].offpeak.out;
  return (
    <div
      data-whale-report-peakbadge
      data-period={period}
      role="status"
      aria-label={
        peak
          ? `当前高峰时段，V4 Pro 输出价 ¥${RATE_ROWS[0].peak.out}/百万 token`
          : `当前谷时段，V4 Pro 输出价 ¥${RATE_ROWS[0].offpeak.out}/百万 token`
      }
    >
      <svg data-whale-report-peakicon viewBox="0 0 16 16" width={13} height={13} aria-hidden="true">
        {peak ? (
          <path d="M1.5 14 L4.5 5 L7 9.5 L10 2 L14.5 14 Z" />
        ) : (
          <path d="M1.5 2 L4.5 11 L7 6.5 L10 14 L14.5 2 Z" />
        )}
      </svg>
      <span data-whale-report-peakrate>¥{proOut} 输出</span>
    </div>
  );
}

/** 当前会话消耗（live session meter）：30s 轮询，实时聚合 live 会话。 */
interface LiveSessionJson {
  sessionId: string;
  title: string;
  turns: number;
  toolCalls: number;
  tokens: { input: number; output: number; cacheRead: number; reasoning: number };
  totalTokens: number;
  cost: number;
  costSource: string;
  lastTime: number;
}

function LiveSessionCard(): ReactNode {
  const [sessions, setSessions] = useState<LiveSessionJson[] | null>(null);
  const [error, setError] = useState(false);
  const load = (): void => {
    fetch("/whale/api/live-session")
      .then((r) => (r.ok ? (r.json() as Promise<{ ok: boolean; sessions: LiveSessionJson[] }>) : Promise.reject(new Error("HTTP"))))
      .then((json) => {
        setSessions(Array.isArray(json.sessions) ? json.sessions : []);
        setError(false);
      })
      .catch(() => setError(true));
  };
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (sessions === null || sessions.length === 0) return null;
  const s = sessions[0];
  const liveTime = new Date(s.lastTime).toLocaleTimeString("zh-CN", { hour12: false });
  return (
    <div data-whale-report-live>
      <div data-whale-report-livehead>
        <span data-whale-report-livecode>LIVE SESSION</span>
        <em data-whale-report-livepulse>●</em>
      </div>
      <div data-whale-report-livetitle>{s.title || "（未命名会话）"}</div>
      <div data-whale-report-liveval>
        ¥{s.cost.toFixed(2)}
        <small>{fmt(s.totalTokens)} tokens</small>
      </div>
      <div data-whale-report-livenums>
        {s.turns} 回合 · {s.toolCalls} 工具 · IN {fmt(s.tokens.input)} / OUT {fmt(s.tokens.output)} / CACHE {fmt(s.tokens.cacheRead)}
      </div>
      <div data-whale-report-livefoot>
        <span>LAST EVENT {liveTime} · 30s AUTO REFRESH</span>
        <span>READ ONLY</span>
      </div>
    </div>
  );
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
  const [displayTotal, setDisplayTotal] = useState<number | null>(null);
  const prevTotalRef = useRef<number | null>(null);
  const load = (refresh: boolean, silent = false): void => {
    if (!silent) setLoading(true);
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
  // 60s 自动静默刷新（服务端缓存 TTL 同 60s）：余额变化时数字滚动展示。
  useEffect(() => {
    const timer = window.setInterval(() => load(false, true), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  // 瞬时错误（超时/网络）自动重试一次，避免用户手动点刷新。
  useEffect(() => {
    if (data === null || data.status === "connected" || data.status === "invalid-key" || data.status === "unavailable") return;
    const timer = window.setTimeout(() => load(false), 3000);
    return () => window.clearTimeout(timer);
  }, [data]);
  // 余额数字滚动（count-up，600ms ease-out；不改变任何数据语义）。
  useEffect(() => {
    const target = data?.balance?.total;
    if (target === undefined) return;
    if (displayTotal === null) {
      setDisplayTotal(target);
      return;
    }
    if (target === displayTotal) return;
    const from = displayTotal;
    const start = performance.now();
    let raf = 0;
    const tick = (): void => {
      const t = Math.min(1, (performance.now() - start) / 600);
      setDisplayTotal(from + (target - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data?.balance?.total]);
  // 刷新间余额变动差值（±，仅显示量级，不涉及凭据）。
  useEffect(() => {
    if (data?.balance === undefined) return;
    if (prevTotalRef.current !== null) {
      setDelta(prevTotalRef.current !== data.balance.total ? data.balance.total - prevTotalRef.current : null);
    }
    prevTotalRef.current = data.balance.total;
  }, [data]);
  const [delta, setDelta] = useState<number | null>(null);
  const money = (n: number | undefined): string => (n === undefined ? "—" : `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const liveTime = data !== null
    ? new Date(data.checkedAt).toLocaleTimeString("zh-CN", { hour12: false })
    : "--:--:--";
  const ok = data !== null && data.status === "connected";
  const state: "ok" | "warn" | "bad" | "idle" =
    data === null ? "idle" : ok ? "ok" : data.status === "invalid-key" || data.status === "unavailable" ? "bad" : "warn";
  // 状态行只用固定文案（balance.ts 保证 error 不含 key），不回显任何凭据。
  const statusText = data === null
    ? "CONNECTING"
    : `${BALANCE_STATUS_LABEL[data.status]} · ${data.status.toUpperCase().replace(/-/g, " ")}`;
  return (
    <div data-whale-report-balance data-state={state} data-stale={loading && data !== null}>
      <div data-whale-report-balancehead>
        <span data-whale-report-balancelabel>Provider</span>
        <span data-whale-report-balancename>{data?.name ?? "DeepSeek"}</span>
        <span data-whale-report-balancestatus><i />{statusText}</span>
      </div>
      {data === null ? (
        <div data-whale-report-balancesk aria-label="读取中"><i /><i /><i /><i /><i /><i /><i /></div>
      ) : ok && data.balance !== undefined ? (
        <>
          <div data-whale-report-balanceval>
            {money(displayTotal ?? data.balance.total)}
            {delta !== null && delta !== 0 && (
              <em data-whale-report-balancedelta>
                Δ {delta > 0 ? "+" : ""}
                {delta.toFixed(2)}
              </em>
            )}
            <small>Available balance · {data.balance.currency}{data.isAvailable === false ? " · 余额不足" : ""}</small>
          </div>
          <div data-whale-report-balancebreak>
            充值 {money(data.balance.toppedUp)} &nbsp;/&nbsp; 赠送 {money(data.balance.granted)}
          </div>
        </>
      ) : (
        <>
          <div data-whale-report-balanceval>
            ——<small>{data.error ?? "UNAVAILABLE"}</small>
          </div>
          <div data-whale-report-balancebreak>{BALANCE_STATUS_LABEL[data.status]}，本期费用仍按本地事件估算。</div>
        </>
      )}
      <div data-whale-report-balancefoot>
        <span><i data-whale-report-live-dot />Last check {liveTime}{loading && data !== null ? " · 检查中" : ""}</span>
        <button data-whale-report-balancebtn data-live={!loading} disabled={loading} onClick={() => load(true)}>
          {loading ? "checking" : "refresh"}
        </button>
      </div>
      <div data-whale-report-balancefoot style={{ marginTop: 4, paddingTop: 0, borderTop: 0 }}>
        <span>Key never leaves local host · read only</span>
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
  const totalTokens = s !== undefined ? usageTotalTokens(s.tokens) : 0;
  const night = s === undefined || s.totalEvents === 0
    ? 0
    : Math.round((s.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0) / s.totalEvents) * 100);
  // 动效 C：成本大数字滚动（count-up，600ms；纯展示，不改数据语义）。
  const [displayCost, setDisplayCost] = useState<number | null>(null);
  useEffect(() => {
    if (cost === undefined) return;
    if (displayCost === null) {
      setDisplayCost(cost);
      return;
    }
    if (cost === displayCost) return;
    const from = displayCost;
    const start = performance.now();
    let raf = 0;
    const tick = (): void => {
      const t = Math.min(1, (performance.now() - start) / 600);
      setDisplayCost(from + (cost - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cost]);
  const modelRows = (() => {
    if (s === undefined) return [];
    const entries = Object.entries(s.models ?? {}).sort(
      (a, b) => usageTotalTokens(b[1]) - usageTotalTokens(a[1]),
    );
    const grand = entries.reduce((sum, [, u]) => sum + usageTotalTokens(u), 0);
    return entries.map(([model, u]) => {
      const t = usageTotalTokens(u);
      const { provider, model: modelName } = splitModelKey(model);
      return { model, modelName, provider, total: t, share: grand > 0 ? Math.round((t / grand) * 100) : 0, cost: report?.cost?.perModel?.[model] };
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
            <span data-live="true">CONTEXT ONLINE</span>
            {s !== undefined && <span>CACHE {cacheRate(s)}%</span>}
            {s !== undefined && <span>{fmt(s.totalEvents)} EVENTS</span>}
            <span>LOCAL / READY</span>
          </div>
        </div>
        <div data-whale-report-brandvisual aria-hidden="true">
          <div data-whale-report-sonar><i /><i /><i /></div>
          <div data-whale-report-sweep><i /></div>
          <div data-whale-report-ping><i /><i /><i /></div>
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
        <PeakBadge />
        <ThemeToggle />
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

      <PartialBanner partial={s?.partial} />

      <ProviderBalanceCard />
      <PricePeriodCard />
      <LiveSessionCard />

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
              <div data-whale-report-heroval>¥{displayCost !== null ? displayCost.toFixed(2) : "—"}</div>
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
              {report.cost?.peakShare !== undefined && (
                <>
                  <span data-whale-report-heropeak><i /><b>¥{report.cost.peakShare.toFixed(1)}</b> 高峰</span>
                  <span data-whale-report-heropeak data-valley><i /><b>¥{(report.cost.total - report.cost.peakShare).toFixed(1)}</b> 谷时</span>
                </>
              )}
            </div>
          </div>

          <TrendSection preset={preset} />

          {(report.improvements ?? []).length > 0 && <ImproveSection items={report.improvements ?? []} />}

          {insights.length > 0 && (
            <section data-whale-report-section>
              <SectionHeader index="02" title="值得注意" meta="FINDINGS / INVESTIGATION LOG" />
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
            <SectionHeader index="03" title="活跃扫描" meta={`SONAR / NIGHT ${night}%`} />
            <div data-whale-report-zone>
              <div data-whale-report-scanmeta>
                <span>SCAN <b>00—24</b></span><span>DEPTH <b>4,096m</b></span><span>PING <b>OK</b></span><span>NIGHT <b>{night}%</b></span>
              </div>
              <ActivityStrip report={report} />
            </div>
          </section>

          {modelRows.length > 0 && (
            <section data-whale-report-section>
              <SectionHeader index="04" title="模型分配" meta="RESOURCE / ALLOCATION" />
              <div data-whale-report-modeltable>
                {modelRows.map((m, index) => (
                  <div key={m.model} data-whale-report-modelrow>
                    <span data-whale-report-modelrank>{String(index + 1).padStart(2, "0")}</span>
                    <div data-whale-report-modelhead>
                      <div data-whale-report-modelname>
                        <b>{m.modelName}</b>
                        {m.provider !== null && <em data-whale-report-modelprov>{m.provider.toUpperCase()}</em>}
                      </div>
                      <span>{m.share}% / ¥{typeof m.cost === "number" ? m.cost.toFixed(1) : "—"}</span>
                    </div>
                    <div data-whale-report-modelbar>
                      <i style={{ width: `${m.share}%`, background: "var(--dt-blue)" }} />
                    </div>
                    <div data-whale-report-modelnums>TOTAL {fmt(m.total)} TOKEN</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(s.sessionsDetail ?? []).length > 0 && (
            <SessionDrilldown sessions={(s.sessionsDetail ?? []).slice(0, 5)} totalCost={cost} index="05" />
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
  const totalTokens = usageTotalTokens(s.tokens);
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
  const healthRows = (s.toolHealth ?? []).filter((t) => t.calls >= 5).slice(0, 5).length;
  h += 18 + 26 + 12 + modelEntries.length * 26 + families.length * 18 + 18 + toolEntries.length * 19 + 12; // 04 模型与工具
  h += (healthRows > 0 ? 18 + healthRows * 21 + 6 : 0); // 04 工具健康（简版）
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
  // 交互控件不进纸：导出按钮组与其展开菜单一并移除（@media print 也有兜底）。
  clone.querySelectorAll("[data-whale-report-actions], [data-whale-report-exportmenu]").forEach((el) => el.remove());
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
  const totalTokens = usageTotalTokens(s.tokens);
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
  const tot = (u: ModelUsageLike) => usageTotalTokens(u);
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
  // TokenBar：input(miss) + cacheRead(hit) + output 三段（P0 口径：output 已含 reasoning，
  // reasoning 只在 OUTPUT 图例中作为 breakdown 展示，不占额外段宽）。
  const segments: [string, number, string][] = [
    ["INPUT", s.tokens.input, C.blue],
    ["OUTPUT", s.tokens.output, C.cyan],
    ["CACHE", s.tokens.cacheRead, "#9aa7ff"],
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
  if (s.tokens.reasoning > 0) {
    // P0：reasoning 是 output 的子集（breakdown 展示，不重复计）。
    paint(`OUTPUT 含思考 ${fmt(s.tokens.reasoning)}`, 8.5, C.faint, "mono", 400);
    y += rowH(8.5);
  }

  // ── 04 模型与工具 ──
  sectionHead("05", "模型与工具", "MODEL / TOOL / PLUGINS");
  for (const [model, u] of modelEntries) {
    const share = totalTokens > 0 ? tot(u) / totalTokens : 0;
    ctx.fillStyle = C.line;
    ctx.fillRect(P, y + 4, barW, 8);
    ctx.fillStyle = C.blue;
    ctx.fillRect(P, y + 4, barW * share, 8);
    const { provider, model: modelName } = splitModelKey(model);
    if (provider !== null) {
      // provider 作为小号 mono meta（如 OPENCODE-GO），主模型名不被污染。
      ctx.font = `700 9px ${EXPORT_MONO}`;
      ctx.fillStyle = C.faint;
      ctx.fillText(provider.toUpperCase(), P, y + 10);
      paint(`${modelName}  ${Math.round(share * 100)}%  ${fmt(tot(u))} tok`, 12, C.ink, "sans", 600, W - P * 2 - 130);
    } else {
      paint(`${modelName}  ${Math.round(share * 100)}%  ${fmt(tot(u))} tok`, 12, C.ink, "sans", 600);
    }
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

  // ── 工具健康（简版：异常优先，最多 5 个，样本 ≥5）──
  const healthTop = (s.toolHealth ?? [])
    .filter((t) => t.calls >= 5)
    .sort((a, b) => {
      const ab = (x: typeof a) => x.failed >= 3 && x.failureRate >= 0.15;
      if (ab(a) !== ab(b)) return ab(a) ? -1 : 1;
      if (ab(a) && ab(b)) return b.failureRate - a.failureRate;
      return b.calls - a.calls;
    })
    .slice(0, 5);
  if (healthTop.length > 0) {
    paint("TOOL HEALTH", 9, C.faint, "mono", 400);
    for (const t of healthTop) {
      const abnormal = t.calls >= TOOL_HEALTH_MIN_CALLS && t.failed >= TOOL_HEALTH_MIN_FAILED && t.failureRate >= TOOL_HEALTH_MIN_FAILURE_RATE;
      const successPct = Math.round(t.successRate * 1000) / 10;
      // 极细 measurement bar（success 占比；异常工具红色）
      ctx.fillStyle = C.line;
      ctx.fillRect(P, y + 6, barW, 2);
      ctx.fillStyle = abnormal ? C.red : C.safe;
      ctx.fillRect(P, y + 6, Math.max(2, barW * t.successRate), 2);
      ctx.font = `600 11px ${EXPORT_SANS}`;
      ctx.fillStyle = C.ink;
      ctx.fillText(t.name, P + 6, y + 10);
      ctx.font = `700 9px ${EXPORT_MONO}`;
      ctx.fillStyle = abnormal ? C.red : C.faint;
      ctx.fillText(`${successPct}% SUCCESS`, P + 6 + Math.min(150, ctx.measureText(t.name).width) + 14, y + 10);
      ctx.font = `400 9px ${EXPORT_MONO}`;
      ctx.fillStyle = C.muted;
      const dur = t.avgDurationMs >= 1000 ? `${(t.avgDurationMs / 1000).toFixed(1)}s` : `${Math.round(t.avgDurationMs)}ms`;
      ctx.fillText(`${t.calls} CALLS · ${dur} AVG${t.failed > 0 ? ` · ${t.failed} FAILED` : ""}`, W - P - 160, y + 10);
      y += 21;
    }
    y += 4;
  }

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
      (sum, u) => sum + usageTotalTokens(u),
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
    if (kind === "angry") return <path d="M8 16 L14 13 M32 16 L26 13" stroke="var(--dt-ink)" strokeWidth="2.4" strokeLinecap="round" />;
    if (kind === "sleepy") return <path d="M9 15 L15 15 M25 15 L31 15" stroke="var(--dt-ink)" strokeWidth="2.4" strokeLinecap="round" />;
    if (kind === "dazed") return <><circle cx="12" cy="15" r="1.6" fill="var(--dt-ink)" /><circle cx="28" cy="15" r="1.6" fill="var(--dt-ink)" /></>;
    return <><circle cx="12" cy="15" r="2.6" fill="var(--dt-ink)" /><circle cx="28" cy="15" r="2.6" fill="var(--dt-ink)" /></>;
  };
  const mouth = (kind: string) => {
    if (kind === "happy") return <path d="M12 21 Q20 27 28 21" stroke="var(--dt-ink)" strokeWidth="2" strokeLinecap="round" fill="none" />;
    if (kind === "angry") return <path d="M13 23 L27 23" stroke="var(--dt-ink)" strokeWidth="2.4" strokeLinecap="round" />;
    if (kind === "sleepy") return <circle cx="20" cy="22" r="1.8" fill="var(--dt-ink)" />;
    return <path d="M13 22 Q20 20 27 22" stroke="var(--dt-ink)" strokeWidth="2" strokeLinecap="round" fill="none" />;
  };
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 4 C9 4 4 12 4 20 C4 30 11 36 20 36 C29 36 36 30 36 20 C36 12 31 4 20 4 Z" fill="var(--dt-blue)" />
      <path d="M20 4 C9 4 4 12 4 20 C4 30 11 36 20 36 Z" fill="var(--dt-blue-strong)" />
      <ellipse cx="20" cy="26" rx="8" ry="5" fill="var(--dt-heat-1)" />
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
      <circle cx="8" cy="8" r="6.4" stroke="var(--dt-blue)" strokeWidth="1.4" opacity=".85" />
      <circle cx="8" cy="8" r="3.4" stroke="var(--dt-blue)" strokeWidth="1.2" opacity=".6" />
      <path d="M8 8 L12.5 5.5" stroke="var(--dt-blue)" strokeWidth="1.2" strokeLinecap="round" />
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
      <div data-whale-report-traceorigin aria-hidden="true">
        <span>↓</span>
        <span>Findings traced to <b>{Math.min(sessions.length, 8)} sessions</b> · 按费用排序</span>
      </div>
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
              <div data-whale-report-feedopen aria-hidden="true">{open ? "close ↑" : "open →"}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 指标中文标签（IMPROVE 强数字展示；未知 key 不渲染）。 */
const IMPROVE_METRIC_LABEL: Record<string, string> = {
  calls: "调用",
  failures: "失败",
  failureRate: "失败率",
  sessions: "会话",
  mainCodeCount: "主错误码",
  p95Ms: "P95",
  bursts: "重试",
  corrections: "纠正",
  peakCost: "高峰成本",
  peakRatio: "高峰占比",
  avoidableCost: "可省",
  nightPct: "夜间",
};

/** Improve 列表（v0.5：默认 Top 3；点击展开 Evidence / VERIFY）。 */
function ImproveSection({ items }: { items: ImprovementJson[] }): ReactNode {
  const [openId, setOpenId] = useState<string | null>(null);
  const top = items.slice(0, 3);
  return (
    <section data-whale-report-section>
      <SectionHeader index="01" title="值得改进" meta={`IMPROVE / TOP ${top.length}${items.length > top.length ? ` · +${items.length - top.length} 条` : ""}`} />
      <div data-whale-report-improvelist>
        {top.map((it, index) => {
          const open = openId === it.id;
          const metrics = Object.entries(it.evidence.metrics)
            .filter(([key]) => IMPROVE_METRIC_LABEL[key] !== undefined)
            .map(([key, value]) => ({ key, label: IMPROVE_METRIC_LABEL[key], value }));
          return (
            <div key={it.id} data-whale-report-improveitem data-severity={it.severity} data-open={open}>
              <div data-whale-report-improvehead>
                <span data-whale-report-improveindex>{String(index + 1).padStart(2, "0")}</span>
                <em data-whale-report-improvesev>{it.severity}</em>
                {it.evidence.experimental === true && <i data-whale-report-improveexp>EXPERIMENTAL</i>}
                <b>{it.title}</b>
                <button data-whale-report-improvetoggle onClick={() => setOpenId(open ? null : it.id)}>
                  {open ? "收起 ↑" : "查看证据 ↓"}
                </button>
              </div>
              <div data-whale-report-improvenums>
                {metrics.map((m) => (
                  <span key={m.key}>
                    <b>{m.key === "failureRate" || m.key === "peakRatio" || m.key === "nightPct" ? `${m.value}%` : m.value}</b>
                    {m.label}
                  </span>
                ))}
              </div>
              <div data-whale-report-improverec>建议 · {it.recommendation}</div>
              {open && (
                <div data-whale-report-improvedetail>
                  <div data-whale-report-improverow>
                    <span>WHY</span>
                    <p>{it.summary}</p>
                  </div>
                  <div data-whale-report-improverow>
                    <span>AFFECTED</span>
                    <p>
                      {it.evidence.affectedTools.length > 0 && <>工具 {it.evidence.affectedTools.join(" / ")} · </>}
                      会话 {it.evidence.occurrences} 个
                      {it.evidence.affectedSessions.length > 0 && (
                        <>
                          {" "}
                          <code data-whale-report-improvesid>{it.evidence.affectedSessions.slice(0, 4).join(" · ")}</code>
                          {it.evidence.affectedSessions.length > 4 && ` +${it.evidence.affectedSessions.length - 4}`}
                        </>
                      )}
                      {it.evidence.confidence > 0 && <> · 置信度 {(it.evidence.confidence * 100).toFixed(0)}%</>}
                    </p>
                  </div>
                  <div data-whale-report-improverow>
                    <span>VERIFY</span>
                    <p>
                      {it.verificationPlan.targetMetric} 基线 {it.verificationPlan.baseline ?? "—"} → 目标 {it.verificationPlan.target}
                      {" · "}
                      {it.verificationPlan.window}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
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
            <ThemeToggle />
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
  // 主题运行时：读持久化选择 → 解析（显式 > 宿主 > prefers-color-scheme > light）→
  // 写到 documentElement data-whale-theme；组件渲染前完成，无闪烁。
  if (themeRuntime === null) themeRuntime = new ThemeRuntime(browserThemeDeps());

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
