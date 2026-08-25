// @vitest-environment jsdom
/**
 * v0.5.2 Overview Fast Path 回归测试。
 *
 * 覆盖（验收清单）：
 *  1. fresh snapshot → mount 不调用 summary
 *  2. stale snapshot → 先渲染旧数据，再后台 summary
 *  3. 无 snapshot → full summary fallback
 *  4. background summary timeout → snapshot 保留
 *  5. live 30s refresh 不触发 summary
 *  6. balance 60s refresh 不触发 summary
 *  7. manual refresh 强制 summary
 *  8. period switch 只处理当前 period
 *  9. 旧 overview 迟到响应不覆盖当前 period
 * 10. LAST UPDATED 正确（快照时间 → 完整数据后更新）
 * 11. snapshot/live 数据口径 UI 明确
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
      const err = new Error("The user aborted a request.") as Error & { name: string };
      err.name = "AbortError";
      reject(err);
    });
    return promise;
  });
  const by = (sub: string): FetchCall[] => calls.filter((c) => c.url.includes(sub));
  return {
    fn,
    calls,
    overviews: () => by("/whale/api/overview"),
    summaries: () => by("/whale/api/summary"),
    balances: () => by("/whale/api/balance"),
    lives: () => by("/whale/api/live-session"),
    async settle(urlSub: string, index: number, body: unknown, status = 200): Promise<void> {
      const call = by(urlSub)[index];
      if (call === undefined) throw new Error(`call #${index} for ${urlSub} not found`);
      await act(async () => {
        call.deferred.resolve(
          new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }) as Response & { ok: boolean },
        );
      });
    },
    async resolveOverview(index: number, snapshot: boolean, ageMs: number | null, report?: unknown, lastUpdated?: number): Promise<void> {
      await this.settle("/whale/api/overview", index, {
        ok: true,
        snapshot,
        fresh: ageMs !== null && ageMs < 5 * 60 * 1000,
        lastUpdated: lastUpdated ?? (snapshot ? 1_786_000_000_000 : null),
        ageMs,
        report,
      });
    },
  };
}

const T0 = 1_786_000_000_000; // 固定"现在"（测试用假时间）
const NOW = T0 + 120_000;

function makeStats(): Record<string, unknown> {
  return {
    period: { from: T0 - 7 * 86400000, to: NOW },
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

function makeReport(costTotal: number, createdAt = NOW, preset = "weekly"): Record<string, unknown> {
  return {
    id: "whale-test-1",
    preset,
    from: T0 - 7 * 86400000,
    to: NOW,
    createdAt,
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

const okSummary = (report: Record<string, unknown>): Record<string, unknown> => ({ ok: true, report });
const okBalance = (): Record<string, unknown> => ({
  ok: true,
  balance: { provider: "deepseek", name: "DeepSeek", status: "connected", checkedAt: Date.now(), balance: { currency: "CNY", total: 100, granted: 100, toppedUp: 0 } },
});
const okLive = (): Record<string, unknown> => ({ ok: true, sessions: [] });

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

describe("Overview Fast Path", () => {
  it("1. fresh snapshot（<5min）→ mount 不调用 summary，立即显示快照", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.resolveOverview(0, true, 60_000, makeReport(111.11, T0));
    expect(router.summaries().length).toBe(0);
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥111.11");
    expect(text(q(el, "[data-whale-report-snapmeta]"))).toContain("LAST COMPLETED SNAPSHOT");
    expect(q(el, "[data-whale-report-loadingbar]")).toBeNull();
  });

  it("2. stale snapshot（>5min）→ 先渲染旧数据，再后台 summary", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.resolveOverview(0, true, 8 * 60_000, makeReport(111.11, T0));
    // 旧数据先显示
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥111.11");
    // 后台 summary 已触发
    expect(router.summaries().length).toBe(1);
    // summary 完成后静默更新为新数据（count-up 动画 600ms，推进定时器完成）
    await router.settle("/whale/api/summary", 0, okSummary(makeReport(222.22, NOW)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥222.22");
    expect(text(q(el, "[data-whale-report-snapmeta]"))).toContain("LAST UPDATED");
  });

  it("3. 无 snapshot → full summary fallback（骨架屏）", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.resolveOverview(0, false, null);
    expect(router.summaries().length).toBe(1);
    expect(q(el, "[data-whale-report-skeleton]")).not.toBeNull();
    await router.settle("/whale/api/summary", 0, okSummary(makeReport(333.33, NOW)));
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥333.33");
    expect(q(el, "[data-whale-report-skeleton]")).toBeNull();
  });

  it("4. background summary 超时 → snapshot 保留 + 失败提示", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.resolveOverview(0, true, 20 * 60_000, makeReport(111.11, T0));
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥111.11");
    // summary 悬挂 → 60s 超时
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    const err = q(el, "[data-whale-report-refresherr]");
    expect(err).not.toBeNull();
    expect(text(err)).toContain("请求超时");
    // 快照保留
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥111.11");
    expect(text(q(el, "[data-whale-report-snapmeta]"))).toContain("LAST COMPLETED SNAPSHOT");
  });

  it("5. live 30s refresh 不触发 summary", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    await mount(router);
    await router.resolveOverview(0, true, 60_000, makeReport(111.11, T0));
    const livesBefore = router.lives().length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    // 30s interval × 3（90s）+ 首载 1 = 4 次 live 请求；summary 仍为 0
    expect(router.lives().length).toBe(livesBefore + 3);
    expect(router.summaries().length).toBe(0);
  });

  it("6. balance 60s refresh 不触发 summary", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    await mount(router);
    await router.resolveOverview(0, true, 60_000, makeReport(111.11, T0));
    await router.settle("/whale/api/balance", 0, okBalance());
    const balancesBefore = router.balances().length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(router.balances().length).toBe(balancesBefore + 1);
    expect(router.summaries().length).toBe(0);
  });

  it("7. manual refresh 强制 summary（即使 snapshot fresh）", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.resolveOverview(0, true, 60_000, makeReport(111.11, T0));
    expect(router.summaries().length).toBe(0);
    await act(async () => {
      (q(el, "[data-whale-report-refresh]") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(router.summaries().length).toBe(1);
  });

  it("8. period switch 只处理当前 period（不预生成其他 period）", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.resolveOverview(0, true, 60_000, makeReport(111.11, T0)); // weekly fresh
    expect(router.overviews().length).toBe(1);
    // 切到 daily：只请求 daily overview
    await act(async () => {
      (q(el, "[data-whale-report-chip][data-active='false']") as HTMLButtonElement | null)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(router.overviews().length).toBe(2);
    expect(router.overviews()[1].url).toContain("preset=daily");
    // daily 快照 fresh → 不触发任何 summary（weekly/daily 都没有）
    await router.resolveOverview(1, true, 60_000, makeReport(222.22, T0, "daily"));
    expect(router.summaries().length).toBe(0);
  });

  it("9. 旧 overview 迟到响应不覆盖当前 period（seq 门）", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    // weekly overview 挂起；切 daily
    await act(async () => {
      (q(el, "[data-whale-report-chip][data-active='false']") as HTMLButtonElement | null)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await router.resolveOverview(1, true, 60_000, makeReport(222.22, T0, "daily"));
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥222.22");
    // 旧 weekly overview 迟到返回 → 必须被忽略
    await router.resolveOverview(0, true, 60_000, makeReport(999.99, T0, "weekly"));
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥222.22");
  });

  it("10. LAST UPDATED：快照时间显示，完整数据后更新", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    const snapshotAt = 1_786_000_500_000;
    await router.resolveOverview(0, true, 8 * 60_000, makeReport(111.11, snapshotAt), snapshotAt);
    const snap = text(q(el, "[data-whale-report-snapmeta]"));
    expect(snap).toContain("LAST COMPLETED SNAPSHOT");
    expect(snap).toContain(new Date(snapshotAt).toLocaleTimeString("zh-CN", { hour12: false }));
    // summary 完成后 → LAST UPDATED
    await router.settle("/whale/api/summary", 0, okSummary(makeReport(222.22, NOW)));
    expect(text(q(el, "[data-whale-report-snapmeta]"))).toContain("LAST UPDATED");
    expect(text(q(el, "[data-whale-report-snapmeta]"))).not.toContain("LAST COMPLETED SNAPSHOT");
  });

  it("11. snapshot/live 口径 UI 明确（快照数字 vs 实时活动）", async () => {
    const router = makeRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.resolveOverview(0, true, 60_000, makeReport(111.11, T0));
    const snap = text(q(el, "[data-whale-report-snapmeta]"));
    expect(snap).toContain("LAST COMPLETED SNAPSHOT");
    expect(snap).toContain("快照后实时活动见 LIVE SESSION");
    // live 卡口径文案
    const live = text(q(el, "[data-whale-report-live]"));
    if (live !== "") {
      expect(live).toContain("快照后仍在发生的实时活动");
    }
  });
});
