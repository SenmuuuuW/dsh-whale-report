export const THEME_STORAGE_KEY = "whale.theme";
export const THEME_CHOICES = ["system", "light", "dark"];
/** 中文标签（UI 用）。 */
export const THEME_LABEL = {
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
export function resolveTheme(choice, hostTheme, prefersDark) {
    if (choice === "light" || choice === "dark")
        return choice;
    if (hostTheme === "light" || hostTheme === "dark")
        return hostTheme;
    if (prefersDark === true)
        return "dark";
    return "light";
}
/** 解析 localStorage 里的选择；非法/缺失 → null（= system 默认）。 */
export function parseStoredChoice(raw) {
    if (raw === "system" || raw === "light" || raw === "dark")
        return raw;
    return null;
}
/**
 * 宿主 theme 探测（可复用信号，不侵入 DSH 本体）：
 * 1. DSH web 在 <html> 的 style 上设置 color-scheme: light|dark —— 首选信号；
 * 2. 兜底：data-theme / data-color-scheme 属性。
 * 拿不到 → null（交给 prefers-color-scheme）。
 */
export function hostThemeOf(styleColorScheme, dataset) {
    const cs = styleColorScheme;
    if (cs === "light" || cs === "dark")
        return cs;
    if (dataset !== null) {
        const attr = dataset.theme ?? dataset.colorScheme;
        if (attr === "light" || attr === "dark")
            return attr;
    }
    return null;
}
/** 主题运行时：持有 choice + resolved，可订阅（React 侧 useSyncExternalStore）。 */
export class ThemeRuntime {
    deps;
    choice;
    resolved;
    listeners = new Set();
    unsubscribeMedia = null;
    constructor(deps) {
        this.deps = deps;
        let stored = null;
        try {
            stored = parseStoredChoice(deps.getStored());
        }
        catch {
            stored = null; // 存储不可用：默认 system，仅本次会话生效
        }
        this.choice = stored ?? "system";
        this.resolved = resolveTheme(this.choice, deps.getHostTheme(), deps.getPrefersDark());
        this.deps.setRootTheme(this.resolved);
    }
    getChoice() {
        return this.choice;
    }
    getResolved() {
        return this.resolved;
    }
    subscribe(listener) {
        this.listeners.add(listener);
        if (this.listeners.size === 1)
            this.attachMedia();
        return () => {
            this.listeners.delete(listener);
            if (this.listeners.size === 0)
                this.detachMedia();
        };
    }
    /** 用户显式切换：持久化 choice 并立即应用。 */
    setChoice(choice) {
        if (this.choice === choice)
            return;
        this.choice = choice;
        try {
            this.deps.setStored(choice);
        }
        catch {
            /* 存储不可用：本次会话生效，不持久化 */
        }
        this.apply();
    }
    /** 重新解析（system 档在系统主题变化时调用）；同时维护 media 订阅状态。 */
    apply() {
        this.resolved = resolveTheme(this.choice, this.deps.getHostTheme(), this.deps.getPrefersDark());
        this.deps.setRootTheme(this.resolved);
        if (this.choice === "system" && this.listeners.size > 0 && this.unsubscribeMedia === null) {
            this.attachMedia();
        }
        else if (this.choice !== "system") {
            this.detachMedia();
        }
        for (const listener of [...this.listeners])
            listener();
    }
    attachMedia() {
        if (this.choice !== "system")
            return;
        this.unsubscribeMedia = this.deps.subscribePrefersDark(() => this.apply());
    }
    detachMedia() {
        this.unsubscribeMedia?.();
        this.unsubscribeMedia = null;
    }
}
/** 深色下的主题化内联色（heatmap / 图例 / token 分段条用；CSS 走 token）。 */
export const THEME_COLORS = {
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
//# sourceMappingURL=theme.js.map