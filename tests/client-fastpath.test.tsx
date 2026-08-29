// @vitest-environment jsdom
/**
 * v0.5.x architecture repair — Fast Path 回归（query engine 语义）。
 * 覆盖：立即渲染 / LAST UPDATED / INDEXING 提示 / 手动刷新 / period switch 只当前周期 / 旧响应不覆盖 / 口径 UI。
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
        call.deferred.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }) as Response & { ok: boolean });
      });
    },
    async resolveOverview(index: number, report: unknown, opts?: { indexing?: boolean; lastUpdated?: number }): Promise<void> {
      await this.settle("/whale/api/overview", index, {
        ok: true,
        snapshot: true,
        fresh: !(opts?.indexing === true),
        lastUpdated: opts?.lastUpdated ?? 1_786_000_000_000,
        ageMs: 0,
        indexing: opts?.indexing === true,
        missing: opts?.indexing === true ? 3 : 0,
        indexedThrough: opts?.lastUpdated ?? 1_786_000_000_000,
        report,
      });
    },
  };
}

const NOW = 1_786_000_000_000;

function makeStats(): Record<string, unknown> {
  return {
    period: { from: NOW - 7 * 86400000, to: NOW },
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
    from: NOW - 7 * 86400000,
    to: NOW,
    createdAt: NOW,
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

describe("Overview Fast Path（query engine）", () => {
  it("query 返回 → 立即渲染 + LAST UPDATED", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.resolveOverview(0, makeReport(111.11, "weekly"), { lastUpdated: 1_786_000_500_000 });
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥111.11");
    const snap = text(q(el, "[data-whale-report-snapmeta]"));
    expect(snap).toContain("LAST UPDATED");
    expect(snap).toContain("完整统计");
  });

  it("INDEXING 提示（indexing=true）", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.resolveOverview(0, makeReport(1.0, "weekly"), { indexing: true });
    expect(text(q(el, "[data-whale-report-snapmeta]"))).toContain("INDEXING LIVE DATA");
  });

  it("manual refresh 强制重新 query（不触发 summary）", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.resolveOverview(0, makeReport(111.11, "weekly"));
    expect(router.by("/whale/api/overview").length).toBe(1);
    await act(async () => {
      (q(el, "[data-whale-report-refresh]") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(router.by("/whale/api/overview").length).toBe(2);
    expect(router.by("/whale/api/summary").length).toBe(0);
  });

  it("period switch：只请求当前 period overview", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.resolveOverview(0, makeReport(111.11, "weekly"));
    const chips = el.querySelectorAll("[data-whale-report-chip]");
    const chipDaily = Array.from(chips).find((c) => (c.textContent ?? "").trim() === "日报");
    await act(async () => {
      (chipDaily as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const calls = router.by("/whale/api/overview");
    expect(calls.length).toBe(2);
    expect(calls[1].url).toContain("preset=daily");
    expect(router.by("/whale/api/summary").length).toBe(0);
  });

  it("24h 数据返回后显示 24h 数据；切换瞬间旧 weekly 数字不显示（P0 invariant）", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.resolveOverview(0, makeReport(111.11, "weekly"));
    const chips = el.querySelectorAll("[data-whale-report-chip]");
    const chip24 = Array.from(chips).find((c) => (c.textContent ?? "").trim() === "24小时");
    await act(async () => {
      (chip24 as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // 24h query 返回前：不得显示 weekly 111.11
    expect(text(q(el, "[data-whale-report-heroval]"))).not.toBe("¥111.11");
    await router.resolveOverview(1, makeReport(222.22, "24h"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥222.22");
  });

  it("旧 overview 迟到响应不覆盖当前 period（seq 门）", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    const chips = el.querySelectorAll("[data-whale-report-chip]");
    const chipDaily = Array.from(chips).find((c) => (c.textContent ?? "").trim() === "日报");
    await act(async () => {
      (chipDaily as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await router.resolveOverview(1, makeReport(222.22, "daily"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥222.22");
    await router.resolveOverview(0, makeReport(999.99, "weekly"));
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥222.22");
  });
});
