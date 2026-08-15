/**
 * Provider Balance 单元测试：
 * - DeepSeek 官方响应解析（字符串金额）
 * - success / invalid key / timeout / network failure / malformed
 * - 缓存 TTL 与 refresh 强制重查
 * - key 不泄露：错误响应与异常路径均不含 key
 * - 未配置 key 时不再发起网络请求
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deepseekAdapter,
  parseDeepSeekBalance,
  queryBalance,
  clearBalanceCache,
  type BalanceAdapter,
} from "../src/balance.js";

const KEY = "sk-test-secret-key-abcdef";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearBalanceCache();
  vi.useRealTimers();
});

describe("parseDeepSeekBalance", () => {
  it("解析官方结构（金额为字符串）", () => {
    const parsed = parseDeepSeekBalance({
      is_available: true,
      balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }],
    });
    expect(parsed).toEqual({
      isAvailable: true,
      balance: { currency: "CNY", total: 110, granted: 10, toppedUp: 100 },
    });
  });

  it("非法结构返回 null（缺 is_available / 空 balance_infos / 非数字金额）", () => {
    expect(parseDeepSeekBalance({ balance_infos: [] })).toBeNull();
    expect(parseDeepSeekBalance({ is_available: true, balance_infos: [] })).toBeNull();
    expect(parseDeepSeekBalance({ is_available: true, balance_infos: [{ currency: "CNY" }] })).toBeNull();
    expect(parseDeepSeekBalance("nope")).toBeNull();
    expect(parseDeepSeekBalance(null)).toBeNull();
  });
});

describe("deepseekAdapter.fetchBalance", () => {
  it("success → connected + 余额（含充值/赠送拆分）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          is_available: true,
          balance_infos: [{ currency: "CNY", total_balance: "1704.52", granted_balance: "104.52", topped_up_balance: "1600.00" }],
        }),
      ),
    );
    const result = await deepseekAdapter.fetchBalance(KEY);
    expect(result.status).toBe("connected");
    expect(result.balance).toEqual({ currency: "CNY", total: 1704.52, granted: 104.52, toppedUp: 1600 });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain("sk-test");
  });

  it("401 → invalid-key，错误信息不含 key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { error: { message: `invalid key ${KEY}` } })));
    const result = await deepseekAdapter.fetchBalance(KEY);
    expect(result.status).toBe("invalid-key");
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("HTTP 5xx → error（固定状态码文案）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(503, {})));
    const result = await deepseekAdapter.fetchBalance(KEY);
    expect(result.status).toBe("error");
    expect(result.error).toBe("HTTP 503");
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("网络异常 → unavailable，不抛异常", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error(`network to ${KEY}`))));
    const result = await deepseekAdapter.fetchBalance(KEY);
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("超时 → timeout（AbortController 生效）", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    const pending = deepseekAdapter.fetchBalance(KEY);
    vi.advanceTimersByTime(8000);
    const result = await pending;
    expect(result.status).toBe("timeout");
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("malformed response → error，不抛异常", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { foo: 1 })));
    const result = await deepseekAdapter.fetchBalance(KEY);
    expect(result.status).toBe("error");
    expect(result.error).toBe("MALFORMED RESPONSE");
  });
});

describe("queryBalance 缓存与配置", () => {
  it("TTL 内命中缓存，不重复请求；refresh 强制重查", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { is_available: true, balance_infos: [{ currency: "CNY", total_balance: "10.00", granted_balance: "0.00", topped_up_balance: "10.00" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter: BalanceAdapter = { ...deepseekAdapter, readKey: () => KEY };
    const first = await queryBalance(adapter);
    const second = await queryBalance(adapter);
    expect(second.checkedAt).toBe(first.checkedAt);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await queryBalance(adapter, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("未配置 key → NOT CONFIGURED，且不发网络请求", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    const adapter: BalanceAdapter = { ...deepseekAdapter, readKey: () => null };
    const result = await queryBalance(adapter);
    expect(result.status).toBe("unavailable");
    expect(result.error).toBe("NOT CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("余额查询失败不影响其他调用（返回不可用态而非抛出）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    const adapter: BalanceAdapter = { ...deepseekAdapter, readKey: () => KEY };
    await expect(queryBalance(adapter)).resolves.toMatchObject({ status: "unavailable" });
  });
});
