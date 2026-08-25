/**
 * refresh.ts 单元测试（v0.5.1 刷新卡死修复）。
 *
 * 覆盖：超时中止（AbortError）、成功时清理定时器、外部 signal 联动取消、
 * 错误文案翻译、竞态门、超时预算边界。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FETCH_TIMEOUT_MS, createRequestGate, describeFetchError, fetchWithTimeout } from "../src/client/refresh.js";

/** 永不 resolve、但尊重 abort signal 的 fetch 桩。 */
function pendingFetch(respectSignal = true): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (respectSignal) {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The user aborted a request.") as Error & { name: string };
            err.name = "AbortError";
            reject(err);
          });
        }
      }),
  );
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }) as Response & { ok: boolean };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

describe("fetchWithTimeout", () => {
  it("A. 请求超时后以 AbortError 拒绝（永不响应的 fetch 不再悬挂）", async () => {
    vi.stubGlobal("fetch", pendingFetch());
    const promise = fetchWithTimeout("/x", {}, 60_000);
    const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it("B. 请求成功时清理超时定时器，不留下悬挂任务", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    const promise = fetchWithTimeout("/x", {}, 60_000);
    expect(vi.getTimerCount()).toBe(1);
    await promise;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("C. 外部 signal 中止会立刻拒绝请求（旧请求取消）", async () => {
    vi.stubGlobal("fetch", pendingFetch());
    const controller = new AbortController();
    const promise = fetchWithTimeout("/x", {}, 60_000, controller.signal);
    const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await assertion;
  });

  it("D. 超时不会早于预算触发（计时精度）", async () => {
    vi.stubGlobal("fetch", pendingFetch());
    const promise = fetchWithTimeout("/x", {}, 15_000);
    let settled = false;
    promise.catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTicks();
    expect(settled).toBe(true);
  });
});

describe("describeFetchError", () => {
  it("E. AbortError 翻译为带秒数的超时文案", () => {
    const err = new Error("The user aborted a request.") as Error & { name: string };
    err.name = "AbortError";
    expect(describeFetchError(err, 60_000)).toBe("请求超时（60 秒无响应）");
  });

  it("F. 普通错误原样透出（服务端错误信息不吞）", () => {
    expect(describeFetchError(new Error("生成失败"), 60_000)).toBe("生成失败");
  });
});

describe("createRequestGate", () => {
  it("G. 只有最新请求可以写入状态（旧响应作废）", () => {
    const gate = createRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isLatest(first)).toBe(false);
    expect(gate.isLatest(second)).toBe(true);
    const third = gate.begin();
    expect(gate.isLatest(second)).toBe(false);
    expect(gate.isLatest(third)).toBe(true);
  });
});

describe("超时预算边界（产品约定）", () => {
  it("H. 余额 10–15s、报告生成 30–60s、轻量接口有正预算", () => {
    expect(FETCH_TIMEOUT_MS.balance).toBeGreaterThanOrEqual(10_000);
    expect(FETCH_TIMEOUT_MS.balance).toBeLessThanOrEqual(15_000);
    expect(FETCH_TIMEOUT_MS.summary).toBeGreaterThanOrEqual(30_000);
    expect(FETCH_TIMEOUT_MS.summary).toBeLessThanOrEqual(60_000);
    expect(FETCH_TIMEOUT_MS.report).toBeGreaterThanOrEqual(30_000);
    expect(FETCH_TIMEOUT_MS.report).toBeLessThanOrEqual(60_000);
    expect(FETCH_TIMEOUT_MS.light).toBeGreaterThan(0);
  });
});
