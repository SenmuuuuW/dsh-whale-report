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
export declare const THEME_STORAGE_KEY = "whale.theme";
export declare const THEME_CHOICES: ThemeChoice[];
/** 中文标签（UI 用）。 */
export declare const THEME_LABEL: Record<ThemeChoice, string>;
/**
 * 解析最终主题。纯函数：
 * - 显式 light/dark → 直接采用；
 * - system → 宿主 theme → prefers-color-scheme → light。
 * prefersDark 为 null 表示 matchMedia 不可用（老浏览器 / 测试兜底）。
 */
export declare function resolveTheme(choice: ThemeChoice, hostTheme: ResolvedTheme | null, prefersDark: boolean | null): ResolvedTheme;
/** 解析 localStorage 里的选择；非法/缺失 → null（= system 默认）。 */
export declare function parseStoredChoice(raw: string | null): ThemeChoice | null;
/**
 * 宿主 theme 探测（可复用信号，不侵入 DSH 本体）：
 * 1. DSH web 在 <html> 的 style 上设置 color-scheme: light|dark —— 首选信号；
 * 2. 兜底：data-theme / data-color-scheme 属性。
 * 拿不到 → null（交给 prefers-color-scheme）。
 */
export declare function hostThemeOf(styleColorScheme: string | null, dataset: Record<string, string | undefined> | null): ResolvedTheme | null;
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
export declare class ThemeRuntime {
    private deps;
    private choice;
    private resolved;
    private listeners;
    private unsubscribeMedia;
    constructor(deps: ThemeDeps);
    getChoice(): ThemeChoice;
    getResolved(): ResolvedTheme;
    subscribe(listener: () => void): () => void;
    /** 用户显式切换：持久化 choice 并立即应用。 */
    setChoice(choice: ThemeChoice): void;
    /** 重新解析（system 档在系统主题变化时调用）；同时维护 media 订阅状态。 */
    private apply;
    private attachMedia;
    private detachMedia;
}
/** 深色下的主题化内联色（heatmap / 图例 / token 分段条用；CSS 走 token）。 */
export declare const THEME_COLORS: Record<ResolvedTheme, {
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
}>;
//# sourceMappingURL=theme.d.ts.map