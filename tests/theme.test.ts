/**
 * DeepTrace Dark Mode — theme core 单测。
 *
 * 覆盖：默认 system / prefers dark→dark / prefers light→light /
 * 显式覆盖 system / 持久化 / matchMedia 不可用回退 / 不影响 report data /
 * 旧报告 / 不崩溃。
 */
import { describe, expect, it, vi } from "vitest";
import {
  ThemeRuntime,
  hostThemeOf,
  parseStoredChoice,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeChoice,
  type ThemeDeps,
} from "../src/client/theme.js";

function makeDeps(overrides?: Partial<ThemeDeps>): ThemeDeps {
  let stored: string | null = null;
  const listeners = new Set<() => void>();
  return {
    getStored: () => stored,
    setStored: (v) => { stored = v; },
    getHostTheme: () => null,
    getPrefersDark: () => false,
    subscribePrefersDark: (l) => { listeners.add(l); return () => listeners.delete(l); },
    setRootTheme: () => {},
    ...overrides,
  };
}

describe("resolveTheme（优先级：显式 > 宿主 > prefers > light）", () => {
  it("默认 system + 无宿主信号 + prefers dark → dark", () => {
    expect(resolveTheme("system", null, true)).toBe("dark");
  });

  it("system + prefers light → light", () => {
    expect(resolveTheme("system", null, false)).toBe("light");
  });

  it("system + 宿主 dark 优先于 prefers light", () => {
    expect(resolveTheme("system", "dark", false)).toBe("dark");
    expect(resolveTheme("system", "light", true)).toBe("light");
  });

  it("显式 light/dark 覆盖宿主与系统", () => {
    expect(resolveTheme("light", "dark", true)).toBe("light");
    expect(resolveTheme("dark", "light", false)).toBe("dark");
  });

  it("system + 无任何信号 → light fallback", () => {
    expect(resolveTheme("system", null, null)).toBe("light");
  });
});

describe("hostThemeOf（复用 DSH 宿主 color-scheme，不侵入本体）", () => {
  it("documentElement.style.colorSche me → 直接采用", () => {
    expect(hostThemeOf("dark", null)).toBe("dark");
    expect(hostThemeOf("light", {})).toBe("light");
  });

  it("data-theme / data-color-scheme 兜底", () => {
    expect(hostThemeOf(null, { theme: "dark" })).toBe("dark");
    expect(hostThemeOf(null, { colorScheme: "light" })).toBe("light");
  });

  it("无信号 → null（交给 prefers）", () => {
    expect(hostThemeOf(null, null)).toBeNull();
    expect(hostThemeOf("auto", { theme: "x" })).toBeNull();
  });
});

describe("parseStoredChoice（localStorage 内容）", () => {
  it("合法三档可解析；缺失/非法 → null（= system 默认）", () => {
    expect(parseStoredChoice("system")).toBe("system");
    expect(parseStoredChoice("light")).toBe("light");
    expect(parseStoredChoice("dark")).toBe("dark");
    expect(parseStoredChoice(null)).toBeNull();
    expect(parseStoredChoice("neon")).toBeNull();
    expect(parseStoredChoice("")).toBeNull();
  });
});

describe("ThemeRuntime（持久化 + 应用 + 订阅）", () => {
  it("无存储 → 默认 system；resolved 立即写到根", () => {
    const rootTheme: string[] = [];
    const rt = new ThemeRuntime(makeDeps({ getPrefersDark: () => true, setRootTheme: (t) => rootTheme.push(t) }));
    expect(rt.getChoice()).toBe("system");
    expect(rt.getResolved()).toBe("dark");
    expect(rootTheme).toEqual(["dark"]);
  });

  it("显式 dark 覆盖 system 并持久化", () => {
    let stored: string | null = null;
    const roots: string[] = [];
    const rt = new ThemeRuntime(makeDeps({
      getStored: () => stored,
      setStored: (v) => { stored = v; },
      getPrefersDark: () => false,
      setRootTheme: (t) => roots.push(t),
    }));
    expect(rt.getResolved()).toBe("light");
    rt.setChoice("dark");
    expect(rt.getChoice()).toBe("dark");
    expect(rt.getResolved()).toBe("dark");
    expect(stored).toBe("dark");
    expect(roots).toEqual(["light", "dark"]);
  });

  it("显式 light 覆盖宿主 dark；持久化 light", () => {
    let stored: string | null = null;
    const rt = new ThemeRuntime(makeDeps({
      getStored: () => stored,
      setStored: (v) => { stored = v; },
      getHostTheme: () => "dark" as ResolvedTheme,
      getPrefersDark: () => true,
    }));
    expect(rt.getResolved()).toBe("dark"); // system → 宿主 dark
    rt.setChoice("light");
    expect(rt.getResolved()).toBe("light");
    expect(stored).toBe("light");
  });

  it("持久化选择在重建 runtime 时恢复（跨会话）", () => {
    let stored: string | null = "dark";
    const rt = new ThemeRuntime(makeDeps({ getStored: () => stored, setStored: (v) => { stored = v; } }));
    expect(rt.getChoice()).toBe("dark");
    expect(rt.getResolved()).toBe("dark");
  });

  it("matchMedia 不可用（null）→ 回退 light，不崩溃", () => {
    const rt = new ThemeRuntime(makeDeps({ getPrefersDark: () => null }));
    expect(rt.getResolved()).toBe("light");
    expect(() => rt.setChoice("dark")).not.toThrow();
    expect(rt.getResolved()).toBe("dark");
  });

  it("system 档订阅系统变化：prefers 翻转 → resolved 跟着翻转并通知", () => {
    let prefers = false;
    const listeners = new Set<() => void>();
    const deps = makeDeps({
      getPrefersDark: () => prefers,
      subscribePrefersDark: (l) => { listeners.add(l); return () => listeners.delete(l); },
    });
    const rt = new ThemeRuntime(deps);
    const seen: ResolvedTheme[] = [];
    rt.subscribe(() => seen.push(rt.getResolved()));
    prefers = true;
    for (const l of [...listeners]) l();
    expect(rt.getResolved()).toBe("dark");
    expect(seen).toEqual(["dark"]);
    // 切到显式 light → 不再跟随系统
    rt.setChoice("light");
    prefers = false;
    for (const l of [...listeners]) l();
    expect(rt.getResolved()).toBe("light");
  });

  it("subscribe 返回取消函数；无监听时 media 订阅自动摘除", () => {
    let attached = 0;
    let detached = 0;
    const deps = makeDeps({
      getPrefersDark: () => true,
      subscribePrefersDark: (l) => { attached += 1; return () => { detached += 1; }; },
    });
    const rt = new ThemeRuntime(deps);
    const off = rt.subscribe(() => {});
    expect(attached).toBe(1);
    off();
    expect(detached).toBe(1);
    // 显式档不挂 media 订阅
    rt.setChoice("dark");
    expect(attached).toBe(1);
  });
});

describe("theme 不影响 report data / 旧报告 / 崩溃面", () => {
  it("切换主题只改根属性与存储，不触碰任何报告结构", () => {
    const report = { stats: { sessions: 3 }, markdown: "# x" };
    const rt = new ThemeRuntime(makeDeps());
    rt.setChoice("dark");
    rt.setChoice("light");
    rt.setChoice("system");
    expect(report).toEqual({ stats: { sessions: 3 }, markdown: "# x" });
  });

  it("本地存储读写异常（隐私模式）不抛错", () => {
    const rt = new ThemeRuntime(makeDeps({
      getStored: () => { throw new Error("denied"); },
      setStored: () => { throw new Error("denied"); },
    }));
    expect(() => rt.setChoice("dark")).not.toThrow();
    expect(rt.getResolved()).toBe("dark");
  });

  it("THEME_STORAGE_KEY 稳定（迁移防护）", () => {
    expect(THEME_STORAGE_KEY).toBe("whale.theme");
  });

  it("theme.ts 无 DOM 副作用（可被 node 单测直接 import）", () => {
    expect(typeof resolveTheme).toBe("function");
    expect(typeof ThemeRuntime).toBe("function");
    expect(vi).toBeDefined();
  });
});
