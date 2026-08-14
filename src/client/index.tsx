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
import { Component, useSyncExternalStore, type ChangeEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

export const name = "whale-report-client";
export const inject: string[] = [];

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
  dangerousCommands: { command: string; time: number; sessionId: string }[];
  hourHistogram: number[];
  activeDays: number;
  busiestDay: { date: string; events: number } | null;
  titles: string[];
  totalEvents: number;
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
    const a = 0.12 + level * 0.8;
    return `rgba(77,107,254,${a.toFixed(2)})`;
  };
  return (
    <div data-whale-report-heat>
      {histogram.map((count, hour) => (
        <i key={hour} title={`${String(hour).padStart(2, "0")}:00 · ${count}`} style={{ background: hue(count / max) }} />
      ))}
    </div>
  );
}

function ReportView({ report, onDelete }: { report: ReportFull; onDelete: (id: string) => void }): ReactNode {
  const s = report.stats;
  const night = s.totalEvents === 0 ? 0 : Math.round((s.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0) / s.totalEvents) * 100);
  const topTools = Object.entries(s.toolCalls ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const totalTokens = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.reasoning;
  return (
    <div>
      <div data-whale-report-actions>
        <button data-whale-report-btn onClick={() => window.print()}>导出 PDF / 打印</button>
        <button data-whale-report-btn data-ghost="true" onClick={() => onDelete(report.id)}>删除</button>
      </div>

      <div data-whale-report-h2>⚙️ 干了多少活</div>
      <div data-whale-report-cards>
        <div data-whale-report-card><b>{s.sessions}</b><span>会话（子代理 {s.subagentSessions}）</span></div>
        <div data-whale-report-card><b>{s.turns}</b><span>回合</span></div>
        <div data-whale-report-card><b>{fmt(s.toolCallsTotal)}</b><span>工具调用（失败 {s.toolErrors}）</span></div>
        <div data-whale-report-card><b>{fmt(s.commands)}</b><span>bash 命令</span></div>
        <div data-whale-report-card><b>{s.userMessages}</b><span>你的消息</span></div>
        <div data-whale-report-card><b>{fmt(s.assistantMessages)}</b><span>它的回复</span></div>
      </div>
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

      <div data-whale-report-h2>🔥 烧了多少 token</div>
      <div data-whale-report-tokenline>
        输入 {fmt(s.tokens.input)} · 输出 {fmt(s.tokens.output)} · 缓存命中 {fmt(s.tokens.cacheRead)} · 思考 {fmt(s.tokens.reasoning)}
        <br />合计约 <b>{fmt(totalTokens)}</b> token
      </div>

      <div data-whale-report-h2>🌙 作息画像（凌晨活跃 {night}%）</div>
      <Heatmap histogram={s.hourHistogram ?? []} />
      <div data-whale-report-tokenline>
        活跃 {s.activeDays} 天
        {s.busiestDay ? <> · 最忙 <b>{s.busiestDay.date}</b>（{s.busiestDay.events} 条事件）</> : null}
      </div>

      <div data-whale-report-h2>⚠️ 惊魂时刻（{s.dangerousCommands?.length ?? 0}）</div>
      {(s.dangerousCommands ?? []).length === 0 ? (
        <div data-whale-report-tokenline>这段时间很平静 🎉</div>
      ) : (
        s.dangerousCommands.slice(0, 10).map((d, i) => (
          <div key={i} data-whale-report-danger>
            {d.command.replace(/\s+/g, " ")}
            <em>{new Date(d.time).toISOString().slice(0, 16).replace("T", " ")}</em>
          </div>
        ))
      )}

      {(s.titles ?? []).length > 0 && (
        <>
          <div data-whale-report-h2>🧵 会话标题</div>
          <ul data-whale-report-titles>
            {s.titles.slice(0, 8).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      )}

      <div data-whale-report-tokenline style={{ marginTop: 16, fontSize: 11 }}>
        数据来自 {s.totalEvents} 条会话事件 · 只读，不改写任何历史 · {dateStr(report.createdAt)} 生成
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
          <div data-whale-report-empty>还没有报告。去「新报告」生成第一份吧 🐋</div>
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
                {loading && <div data-whale-report-loading>鲸鱼正在翻你的日志…</div>}
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
    icon?: ReactNode;
    order?: number;
    single?: boolean;
    component: (props: unknown) => ReactNode;
  }): () => void;
}

/** better-sidebar 里的鲸鱼 Tab（与抽屉共用 WhaleContent）。 */
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
        <button data-whale-report-fab onClick={this.toggle} title="鲸鱼记事本" aria-label="鲸鱼记事本">
          🐋
        </button>
        <div data-whale-report-drawer hidden={!open}>
          <div data-whale-report-head>
            <span data-whale-report-title>🐋 鲸鱼记事本</span>
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

  // Tab 优先：better-sidebar 的注册服务存在时，把鲸鱼做进它的工作台。
  // 惰性注入：服务缺失只跳过回调，绝不阻塞装配。
  ctx.inject(["betterSidebar"], (injected) => {
    const service = injected.betterSidebar as BetterSidebarLike | undefined;
    if (service === undefined) return;
    ctx.effect(() =>
      service.registerTab({
        id: "dsh-whale-report:report",
        title: "🐋 鲸鱼记事本",
        order: 90,
        single: true,
        component: () => <SidebarTab />,
      }),
    );
    setTabRegistered(true);
  });
}
