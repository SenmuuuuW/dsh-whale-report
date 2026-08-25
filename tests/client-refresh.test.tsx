// @vitest-environment jsdom
/**
 * WhaleContent 刷新韧性回归测试（v0.5.1 刷新卡死修复）。
 *
 * 场景：
 *  - 首页 summary 悬挂 → 60s 超时后 loading 回落、出现 REFRESH FAILED + 重试；
 *  - 重试成功后报告渲染、提示消失；
 *  - stale-while-refresh：刷新失败保留上次数据；
 *  - 周期快速切换：旧响应（或旧请求）不得覆盖新周期数据；
 *  - INVALID KEY（余额）与报告加载完全解耦：余额提示不阻塞报告，报告悬挂不阻塞余额。
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
  balanceCalls(): FetchCall[];
  settleSummary(index: number, body: unknown, ok?: boolean, status?: number): Promise<void>;
}

/** 可控 fetch 路由：每个请求挂起，由测试按序 resolve/reject；abort 行为可切换。 */
function makeFetchRouter(): FetchRouter {
  const router: FetchRouter = {
    fn: vi.fn(),
    calls: [],
    autoAbortReject: true,
    summaryCalls() {
      return this.calls.filter((c) => c.url.includes("/whale/api/summary"));
    },
    balanceCalls() {
      return this.calls.filter((c) => c.url.includes("/whale/api/balance"));
    },
    async settleSummary(index, body, ok = true, status = 200) {
      const call = this.summaryCalls()[index];
      if (call === undefined) throw new Error(`summary call #${index} not found`);
      await act(async () => {
        call.deferred.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }) as Response & { ok: boolean });
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

const now = Date.now();

function makeStats(): Record<string, unknown> {
  return {
    period: { from: now - 7 * 86400000, to: now },
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
    from: now - 7 * 86400000,
    to: now,
    createdAt: now,
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

const okBody = (report: Record<string, unknown>): Record<string, unknown> => ({ ok: true, report });
const failBody = (message: string): Record<string, unknown> => ({ ok: false, error: { message } });

function balanceBody(status: string, error?: string): Record<string, unknown> {
  return {
    ok: true,
    balance: { provider: "deepseek", name: "DeepSeek", status, checkedAt: Date.now(), error },
  };
}

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

describe("WhaleContent 刷新韧性", () => {
  it("首载 summary 悬挂 → 60s 超时后 loading 回落，出现 REFRESH FAILED + 重试（不再永久「更新中…」）", async () => {
    const router = makeFetchRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    // 初始：更新中 + 骨架屏
    expect(q(el, "[data-whale-report-loadingbar]")).not.toBeNull();
    expect(q(el, "[data-whale-report-skeleton]")).not.toBeNull();
    // 不响应 summary，推进 60s 超时预算
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    const err = q(el, "[data-whale-report-refresherr]");
    expect(err).not.toBeNull();
    expect(text(err)).toContain("REFRESH FAILED");
    expect(text(err)).toContain("请求超时（60 秒无响应）");
    expect(q(el, "[data-whale-report-retry]")).not.toBeNull();
    // loading 必须回落：更新中与骨架屏消失
    expect(q(el, "[data-whale-report-loadingbar]")).toBeNull();
    expect(q(el, "[data-whale-report-skeleton]")).toBeNull();
  });

  it("超时后点「重试」→ 成功渲染报告，失败提示消失", async () => {
    const router = makeFetchRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(q(el, "[data-whale-report-refresherr]")).not.toBeNull();
    // 点重试
    await act(async () => {
      (q(el, "[data-whale-report-retry]") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(router.summaryCalls().length).toBe(2);
    await router.settleSummary(1, okBody(makeReport(123.45)));
    expect(q(el, "[data-whale-report-refresherr]")).toBeNull();
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥123.45");
  });

  it("stale-while-refresh：刷新失败保留上次数据并提示「保留上次数据」", async () => {
    const router = makeFetchRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.settleSummary(0, okBody(makeReport(111.11)));
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥111.11");
    // 切换到「日报」触发刷新，服务端失败（ok:false）
    await act(async () => {
      (q(el, "[data-whale-report-chip][data-active='false']") as HTMLButtonElement | null)?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await router.settleSummary(1, failBody("生成失败"), false, 400);
    const err = q(el, "[data-whale-report-refresherr]");
    expect(err).not.toBeNull();
    expect(text(err)).toContain("REFRESH FAILED · 保留上次数据");
    expect(text(err)).toContain("生成失败");
    // 旧数据仍在（未被清空，也未跳到「暂无数据」）
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥111.11");
    expect(q(el, "[data-whale-report-loading]")).toBeNull();
  });

  it("周期快速切换：旧请求被 abort，旧响应不覆盖新周期", async () => {
    const router = makeFetchRouter();
    router.autoAbortReject = false; // 模拟不尊重 abort 的极端实现，验证 seq 门兜底
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    // 第一次请求（weekly）挂起；切到 daily 触发第二次请求
    await act(async () => {
      (q(el, "[data-whale-report-chip][data-active='false']") as HTMLButtonElement | null)?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(router.summaryCalls().length).toBe(2);
    // 新请求（#2）先返回 daily 数据
    await router.settleSummary(1, okBody(makeReport(222.22, "daily")));
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥222.22");
    // 旧请求（#1）的信号已被中止（AbortController 联动）
    expect(router.summaryCalls()[0].init?.signal?.aborted).toBe(true);
    // 旧请求（#1）迟到返回 weekly 数据 → 必须被 seq 门忽略
    await router.settleSummary(0, okBody(makeReport(999.99, "weekly")));
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥222.22");
  });

  it("INVALID KEY 与报告链路完全解耦：余额提示即时渲染，报告悬挂不阻塞余额、余额失败不阻塞报告", async () => {
    const router = makeFetchRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    // 余额先返回 INVALID KEY（报告 summary 仍悬挂）
    const balanceCall = router.balanceCalls()[0];
    await act(async () => {
      balanceCall.deferred.resolve(
        new Response(JSON.stringify(balanceBody("invalid-key", "INVALID KEY")), {
          status: 200,
          headers: { "content-type": "application/json" },
        }) as Response & { ok: boolean },
      );
    });
    // 余额提示照常渲染（不被报告悬挂阻塞）
    const balance = q(el, "[data-whale-report-balance]");
    expect(balance).not.toBeNull();
    expect(text(balance)).toContain("余额不可用，本期费用仍按本地事件估算");
    // 报告侧仍在等待（更新中仍在），证明两条链路互不阻塞
    expect(q(el, "[data-whale-report-loadingbar]")).not.toBeNull();
    // 报告超时后出现失败提示，余额提示依然在（反向也不影响）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(q(el, "[data-whale-report-refresherr]")).not.toBeNull();
    expect(text(q(el, "[data-whale-report-balance]"))).toContain("余额不可用，本期费用仍按本地事件估算");
  });

  it("余额请求悬挂 → 15s 超时后余额区回落到可重试状态，不拖累报告", async () => {
    const router = makeFetchRouter();
    vi.stubGlobal("fetch", router.fn);
    const el = await mount(router);
    await router.settleSummary(0, okBody(makeReport(55.55)));
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥55.55");
    // 余额一直不返回（balance call 仍挂起）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    const balance = q(el, "[data-whale-report-balance]");
    expect(balance).not.toBeNull();
    // 超时态：显示 请求超时 文案，不再停留在读取中骨架
    expect(text(balance)).toContain("请求超时");
    // 报告数据完好
    expect(text(q(el, "[data-whale-report-heroval]"))).toBe("¥55.55");
  });
});
