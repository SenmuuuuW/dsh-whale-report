// @vitest-environment jsdom
/**
 * v0.5.x architecture repair — P0 不变量测试（failing，先证明 bug 再重构）。
 *
 * 不变量：DISPLAYED PERIOD === DISPLAYED REPORT PERIOD。
 * 任何时候 report.preset !== selectedPreset，都不允许把该 report 当作当前周期展示。
 *
 * 当前已知 bug：onPreset → setState({preset}) → 异步 refreshOverview；
 * 新数据返回前 state.dashboard 仍是旧 period 报告，Dashboard 渲染层不校验
 * report.preset === preset → weekly 数据伪装成 24h 数据。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhaleContent } from "../src/client/index.js";

type Deferred = { resolve: (r: Response) => void; reject: (e: unknown) => void };
interface FetchCall {
  url: string;
  init?: RequestInit;
  deferred: Deferred;
}

function makeRouter() {
  const calls: FetchCall[] = [];
  const fn = vi.fn((url: string, init?: RequestInit) => {
    let resolve!: Deferred["resolve"];
    let reject!: Deferred["reject"];
    const promise = new Promise<Response>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    calls.push({ url: String(url), init, deferred: { resolve, reject } });
    init?.signal?.addEventListener("abort", () => {
      const err = new Error("aborted") as Error & { name: string };
      err.name = "AbortError";
      reject(err);
    });
    return promise;
  });
  const by = (sub: string) => calls.filter((c) => c.url.includes(sub));
  return {
    fn,
    calls,
    by,
    async settle(sub: string, index: number, body: unknown): Promise<void> {
      const call = by(sub)[index];
      if (call === undefined) throw new Error(`call #${index} for ${sub} not found`);
      await act(async () => {
        call.deferred.resolve(
          new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }) as Response & { ok: boolean },
        );
      });
    },
  };
}

const T0 = 1_786_000_000_000;

function makeStats(): Record<string, unknown> {
  return {
    period: { from: T0 - 7 * 86400000, to: T0 },
    sessions: 3,
    subagentSessions: 0,
    turns: 12,
    steps: 20,
    userMessages: 4,
    assistantMessages: 12,
    tokens: { input: 1000, output: 500, cacheRead: 200, reasoning: 0 },
    toolCalls: {},
    toolCallsTotal: 8,
    toolErrors: 0,
    commands: 0,
    dangerousCommands: [],
    hourHistogram: new Array(24).fill(0),
    halfHourHistogram: new Array(48).fill(0),
    dailySeries: [],
    dayHourSeries: [],
    activeDays: 2,
    busiestDay: null,
    titles: [],
    totalEvents: 30,
    models: {},
    retryBursts: 0,
    sessionsDetail: [],
  };
}

function makeReport(costTotal: number, preset: string): Record<string, unknown> {
  return {
    id: `whale-test-${preset}`,
    preset,
    from: T0 - 7 * 86400000,
    to: T0,
    createdAt: T0,
    sessions: 3,
    turns: 12,
    totalEvents: 30,
    stats: makeStats(),
    markdown: "",
    cost: { perModel: {}, total: costTotal, currency: "CNY", source: "peak-offpeak" },
    insights: [],
    improvements: [],
    reportGeneration: { mode: "local", inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, estimatedCostCny: 0 },
  };
}

const okOverview = (preset: string, costTotal: number, ageMs: number): Record<string, unknown> => ({
  ok: true,
  snapshot: true,
  fresh: ageMs < 5 * 60 * 1000,
  lastUpdated: T0,
  ageMs,
  report: makeReport(costTotal, preset),
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount(router: ReturnType<typeof makeRouter>): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<WhaleContent />);
  });
  return host;
}

async function unmount(): Promise<void> {
  if (root !== null) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
  if (host !== null) {
    host.remove();
    host = null;
  }
}

const q = (el: HTMLElement, sel: string): Element | null => el.querySelector(sel);
const text = (el: Element | null): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof window.requestAnimationFrame !== "function") {
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16)) as unknown as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as unknown as typeof window.cancelAnimationFrame;
  }
});

afterEach(async () => {
  await unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("P0 不变量：DISPLAYED PERIOD === DISPLAYED REPORT PERIOD", () => {
  it("切到 24h 后、24h 数据返回前，Hero 不得展示 weekly 数据（failing：当前实现违反）", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    // weekly 快照渲染（cost=111.11）
    await router.settle("/whale/api/overview", 0, okOverview("weekly", 111.11, 60_000));
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥111.11");
    // 点击「24小时」chip —— 24h overview 挂起（模拟无快照/慢网络）
    const chips = el.querySelectorAll("[data-whale-report-chip]");
    const chip24 = Array.from(chips).find((c) => (c.textContent ?? "").trim() === "24小时");
    expect(chip24).toBeDefined();
    await act(async () => {
      (chip24 as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // UI 已声明 24小时 选中
    expect((chip24 as HTMLElement).getAttribute("data-active")).toBe("true");
    const hero = q(el, "[data-whale-report-heroval]");
    // 不变量：24h 数据未返回前，hero 绝不允许显示 weekly 的 111.11。
    // 期望：hero 为 null（未渲染数字）或非 111.11 的其他值。
    expect(hero === null || text(hero) !== "¥111.11").toBe(true);
  });

  it("24h 数据返回后，Hero 显示 24h 数据（正确路径）", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.settle("/whale/api/overview", 0, okOverview("weekly", 111.11, 60_000));
    const chips = el.querySelectorAll("[data-whale-report-chip]");
    const chip24 = Array.from(chips).find((c) => (c.textContent ?? "").trim() === "24小时");
    await act(async () => {
      (chip24 as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await router.settle("/whale/api/overview", 1, okOverview("24h", 222.22, 60_000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700); // count-up 动画完成
    });
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥222.22");
  });
});
