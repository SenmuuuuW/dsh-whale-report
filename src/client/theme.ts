/**
 * DeepTrace theme core — System / Light / Dark 三档主题。
 *
 * 解析优先级（需求固定）：
 *   用户显式选择 > 宿主 theme（DSH web 在 <html> 上设置 color-scheme）>
 *   prefers-color-scheme > light fallback
 *
 * 本模块是纯函数 + 可注入依赖的运行时，零 DOM 副作用（便于单测）；
 * DOM 访问全部通过注入的 deps 完成，浏览器侧由 index.tsx 装配。
 * 选择持久化用 localStorage（key: whale.theme），不上传任何设置。
 */
export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "whale.theme";

export const THEME_CHOICES: ThemeChoice[] = ["system", "light", "dark"];

/** 中文标签（UI 用）。 */
export const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

/**
 * 解析最终主题。纯函数：
 * - 显式 light/dark → 直接采用；
 * - system → 宿主 theme → prefers-color-scheme → light。
 * prefersDark 为 null 表示 matchMedia 不可用（老浏览器 / 测试兜底）。
 */
export function resolveTheme(
  choice: ThemeChoice,
  hostTheme: ResolvedTheme | null,
  prefersDark: boolean | null,
): ResolvedTheme {
  if (choice === "light" || choice === "dark") return choice;
  if (hostTheme === "light" || hostTheme === "dark") return hostTheme;
  if (prefersDark === true) return "dark";
  return "light";
}

/** 解析 localStorage 里的选择；非法/缺失 → null（= system 默认）。 */
export function parseStoredChoice(raw: string | null): ThemeChoice | null {
  if (raw === "system" || raw === "light" || raw === "dark") return raw;
  return null;
}

/**
 * 宿主 theme 探测（可复用信号，不侵入 DSH 本体）：
 * 1. DSH web 在 <html> 的 style 上设置 color-scheme: light|dark —— 首选信号；
 * 2. 兜底：data-theme / data-color-scheme 属性。
 * 拿不到 → null（交给 prefers-color-scheme）。
 */
export function hostThemeOf(
  styleColorScheme: string | null,
  dataset: Record<string, string | undefined> | null,
): ResolvedTheme | null {
  const cs = styleColorScheme;
  if (cs === "light" || cs === "dark") return cs;
  if (dataset !== null) {
    const attr = dataset.theme ?? dataset.colorScheme;
    if (attr === "light" || attr === "dark") return attr;
  }
  return null;
}

/** 依赖注入面：浏览器侧实现（index.tsx），测试侧用 fake。 */
export interface ThemeDeps {
  /** 读取持久化的选择（localStorage.get）。 */
  getStored(): string | null;
  /** 写入持久化的选择（localStorage.set）。 */
  setStored(value: string): void;
  /** 宿主 theme 信号（documentElement.style.colorScheme + dataset）。 */
  getHostTheme(): ResolvedTheme | null;
  /** prefers-color-scheme: dark 是否匹配；matchMedia 不可用 → null。 */
  getPrefersDark(): boolean | null;
  /** 订阅系统主题变化（仅 system 档需要）；返回取消订阅。 */
  subscribePrefersDark(listener: () => void): () => void;
  /** 把解析结果写到根节点（documentElement data-whale-theme）。 */
  setRootTheme(resolved: ResolvedTheme): void;
}

/** 主题运行时：持有 choice + resolved，可订阅（React 侧 useSyncExternalStore）。 */
export class ThemeRuntime {
  private deps: ThemeDeps;
  private choice: ThemeChoice;
  private resolved: ResolvedTheme;
  private listeners = new Set<() => void>();
  private unsubscribeMedia: (() => void) | null = null;

  constructor(deps: ThemeDeps) {
    this.deps = deps;
    let stored: ThemeChoice | null = null;
    try {
      stored = parseStoredChoice(deps.getStored());
    } catch {
      stored = null; // 存储不可用：默认 system，仅本次会话生效
    }
    this.choice = stored ?? "system";
    this.resolved = resolveTheme(this.choice, deps.getHostTheme(), deps.getPrefersDark());
    this.deps.setRootTheme(this.resolved);
  }

  getChoice(): ThemeChoice {
    return this.choice;
  }

  getResolved(): ResolvedTheme {
    return this.resolved;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.attachMedia();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.detachMedia();
    };
  }

  /** 用户显式切换：持久化 choice 并立即应用。 */
  setChoice(choice: ThemeChoice): void {
    if (this.choice === choice) return;
    this.choice = choice;
    try {
      this.deps.setStored(choice);
    } catch {
      /* 存储不可用：本次会话生效，不持久化 */
    }
    this.apply();
  }

  /** 重新解析（system 档在系统主题变化时调用）；同时维护 media 订阅状态。 */
  private apply(): void {
    this.resolved = resolveTheme(this.choice, this.deps.getHostTheme(), this.deps.getPrefersDark());
    this.deps.setRootTheme(this.resolved);
    if (this.choice === "system" && this.listeners.size > 0 && this.unsubscribeMedia === null) {
      this.attachMedia();
    } else if (this.choice !== "system") {
      this.detachMedia();
    }
    for (const listener of [...this.listeners]) listener();
  }

  private attachMedia(): void {
    if (this.choice !== "system") return;
    this.unsubscribeMedia = this.deps.subscribePrefersDark(() => this.apply());
  }

  private detachMedia(): void {
    this.unsubscribeMedia?.();
    this.unsubscribeMedia = null;
  }
}

/** 深色下的主题化内联色（heatmap / 图例 / token 分段条用；CSS 走 token）。 */
export const THEME_COLORS: Record<ResolvedTheme, {
  /** v1 活跃图：冰蓝 → 蓝 混合基线（rgb 分量）。 */
  heatBase: [number, number, number];
  heatPeak: [number, number, number];
  /** v2 活跃图：6 档固定色。 */
  activityLevels: string[];
  /** v1 活跃图空 cell。 */
  heatEmpty: string;
  /** Token 构成图例。 */
  tokenLegend: string[];
  /** 模型条。 */
  modelBar: string;
}> = {
  light: {
    heatBase: [222, 236, 246],
    heatPeak: [77, 107, 254],
    activityLevels: ["#eef2f5", "#dbe4ff", "#b3c4ff", "#8aa4ff", "#6b87ff", "#4d6bfe"],
    heatEmpty: "#dce7ec",
    tokenLegend: ["#4d6bfe", "#36b9d1", "#aec0d8", "#26406e"],
    modelBar: "#4d6bfe",
  },
  dark: {
    heatBase: [27, 39, 64],
    heatPeak: [111, 139, 255],
    activityLevels: ["#1b2740", "#23345c", "#2c4280", "#3a57a8", "#4d6bfe", "#6f8bff"],
    heatEmpty: "#1c2a45",
    tokenLegend: ["#6b87ff", "#4fc6e0", "#5f6d8c", "#8b99b6"],
    modelBar: "#6b87ff",
  },
};
