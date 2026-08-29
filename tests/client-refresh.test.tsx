// @vitest-environment jsdom
/**
 * v0.5.x architecture repair — Overview = Query Engine 语义的刷新韧性回归。
 *
 * 新语义：Refresh = 服务端只读 index 的实时查询（无 session replay）；
 * 前端只发 overview（query），不再自动触发 summary。
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

interface FetchRouter {
  fn: ReturnType<typeof vi.fn>;
  calls: FetchCall[];
  autoAbortReject: boolean;
  summaryCalls(): FetchCall[];
  overviewCalls(): FetchCall[];
  balanceCalls(): FetchCall[];
  settleOverview(index: number, body: unknown): Promise<void>;
  settleSummary(index: number, body: unknown): Promise<void>;
}

function makeFetchRouter(): FetchRouter {
  const router: FetchRouter = {
    fn: vi.fn(),
    calls: [],
    autoAbortReject: true,
    summaryCalls() {
      return this.calls.filter((c) => c.url.includes("/whale/api/summary"));
    },
    overviewCalls() {
      return this.calls.filter((c) => c.url.includes("/whale/api/overview"));
    },
    balanceCalls() {
      return this.calls.filter((c) => c.url.includes("/whale/api/balance"));
    },
    async settleOverview(index, body) {
      const call = this.overviewCalls()[index];
      if (call === undefined) throw new Error(`overview call #${index} not found`);
      await act(async () => {
        call.deferred.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }) as Response & { ok: boolean });
      });
    },
    async settleSummary(index, body) {
      const call = this.summaryCalls()[index];
      if (call === undefined) throw new Error(`summary call #${index} not found`);
      await act(async () => {
        call.deferred.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }) as Response & { ok: boolean });
      });
    },
  };
  router.fn = vi.fn((url: string, init?: RequestInit) => {
    let resolve!: Deferred["resolve"];
    let reject!: Deferred["reject"];
    const promise = new Promise<Response>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    router.calls.push({ url: String(url), init, deferred: { resolve, reject } });
    init?.signal?.addEventListener("abort", () => {
      if (router.autoAbortReject) {
        const err = new Error("The user aborted a request.") as Error & { name: string };
        err.name = "AbortError";
        reject(err);
      }
    });
    return promise;
  });
  return router;
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
    titles: ["会话 A"],
    totalEvents: 30,
    models: {},
    retryBursts: 0,
    sessionsDetail: [],
  };
}

function makeReport(costTotal: number, preset = "weekly"): Record<string, unknown> {
  return {
    id: "whale-test-1",
    preset,
    from: NOW - 7 * 86400000,
    to: NOW,
    createdAt: NOW,
    sessions: 3,
    turns: 12,
    totalEvents: 30,
    stats: makeStats(),
    markdown: "# 测试报告",
    cost: { perModel: {}, total: costTotal, currency: "CNY", source: "peak-offpeak" },
    insights: [],
    improvements: [],
    prev: { key: "wk-prev", cost: costTotal * 0.9, sessions: 2, turns: 10, cacheHitRate: 12, nightRatio: 8, dangerCount: 0 },
    reportGeneration: { mode: "local", inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, estimatedCostCny: 0 },
  };
}

const okOverview = (report: Record<string, unknown>, opts?: { indexing?: boolean; indexedThrough?: number }): Record<string, unknown> => ({
  ok: true,
  snapshot: true,
  fresh: !(opts?.indexing === true),
  lastUpdated: opts?.indexedThrough ?? NOW,
  ageMs: 0,
  indexing: opts?.indexing === true,
  missing: opts?.indexing === true ? 5 : 0,
  indexedThrough: opts?.indexedThrough ?? NOW,
  report,
});

const okBalance = (): Record<string, unknown> => ({
  ok: true,
  balance: { provider: "deepseek", name: "DeepSeek", status: "connected", checkedAt: Date.now(), balance: { currency: "CNY", total: 100, granted: 100, toppedUp: 0 } },
});
const okLive = (): Record<string, unknown> => ({ ok: true, sessions: [] });

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount(router: FetchRouter): Promise<HTMLDivElement> {
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

describe("Overview = Query Engine 刷新语义", () => {
  it("首载 overview（query）返回 → 立即渲染，无 skeleton，不触发 summary", async () => {
    const router = makeFetchRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.settleOverview(0, okOverview(makeReport(111.11)));
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥111.11");
    expect(q(el, "[data-whale-report-skeleton]")).toBeNull();
    expect(router.summaryCalls().length).toBe(0);
    expect(text(q(el, "[data-whale-report-snapmeta]"))).toContain("LAST UPDATED");
  });

  it("ingesting 状态：显示 INDEXING LIVE DATA…", async () => {
    const router = makeFetchRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.settleOverview(0, okOverview(makeReport(1.0), { indexing: true, indexedThrough: NOW - 60_000 }));
    expect(text(q(el, "[data-whale-report-snapmeta]"))).toContain("INDEXING LIVE DATA");
  });

  it("overview 悬挂 → 10s 超时 → REFRESH FAILED + 重试（不再永久加载）", async () => {
    const router = makeFetchRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const err = q(el, "[data-whale-report-refresherr]");
    expect(err).not.toBeNull();
    expect(text(err)).toContain("请求超时（10 秒无响应）");
    expect(q(el, "[data-whale-report-retry]")).not.toBeNull();
    // 点重试 → 重新 query
    await act(async () => {
      (q(el, "[data-whale-report-retry]") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(router.overviewCalls().length).toBe(2);
    await router.settleOverview(1, okOverview(makeReport(222.22)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥222.22");
  });

  it("同 period 刷新失败：保留旧数据 + REFRESH FAILED · 保留上次数据", async () => {
    const router = makeFetchRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.settleOverview(0, okOverview(makeReport(111.11)));
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥111.11");
    // 手动刷新 → overview 失败（HTTP 400）
    await act(async () => {
      (q(el, "[data-whale-report-refresh]") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const call = router.overviewCalls()[1];
    await act(async () => {
      call.deferred.resolve(new Response(JSON.stringify({ ok: false, error: { message: "查询失败" } }), { status: 400, headers: { "content-type": "application/json" } }) as Response & { ok: boolean });
    });
    const err = q(el, "[data-whale-report-refresherr]");
    expect(err).not.toBeNull();
    expect(text(err)).toContain("REFRESH FAILED · 保留上次数据");
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥111.11");
  });

  it("跨 period 切换失败：旧 period 数据绝不伪装显示（P0 invariant）", async () => {
    const router = makeFetchRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.settleOverview(0, okOverview(makeReport(111.11)));
    await act(async () => {
      (q(el, "[data-whale-report-chip][data-active='false']") as HTMLButtonElement | null)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const call = router.overviewCalls()[1];
    await act(async () => {
      call.deferred.resolve(new Response(JSON.stringify({ ok: false, error: { message: "查询失败" } }), { status: 400, headers: { "content-type": "application/json" } }) as Response & { ok: boolean });
    });
    expect(q(el, "[data-whale-report-refresherr]")).not.toBeNull();
    expect(text(q(el, "[data-whale-report-heroval]"))).not.toBe("¥111.11");
  });

  it("周期快速切换：旧 overview 迟到不覆盖新周期（seq 门）", async () => {
    const router = makeFetchRouter();
    router.autoAbortReject = false;
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await act(async () => {
      (q(el, "[data-whale-report-chip][data-active='false']") as HTMLButtonElement | null)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await router.settleOverview(1, okOverview(makeReport(222.22, "daily")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥222.22");
    // 旧 weekly overview 迟到 → 忽略
    await router.settleOverview(0, okOverview(makeReport(999.99, "weekly")));
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥222.22");
  });

  it("live 30s 不触发 overview；balance 60s 不触发；60s 只读轮询不触发 summary", async () => {
    const router = makeFetchRouter();
    vi.stubGlobal("fetch", router.fn);
    await mount(router);
    await router.settleOverview(0, okOverview(makeReport(111.11)));
    await router.balanceCalls()[0].deferred.resolve(
      new Response(JSON.stringify(okBalance()), { status: 200, headers: { "content-type": "application/json" } }) as Response & { ok: boolean },
    );
    const overviewsBefore = router.overviewCalls().length;
    // 30s：live 轮询不触发 overview
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(router.overviewCalls().length).toBe(overviewsBefore);
    // 再过 30s：60s overview 只读轮询 +1（设计行为），但绝不触发 summary
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(router.overviewCalls().length).toBe(overviewsBefore + 1);
    expect(router.summaryCalls().length).toBe(0);
  });
});
