/**
 * PR #1 review 修复的回归测试：
 * - P0: whale_report output.schema 能通过真实含动态 perModel 键的 payload
 *       （用 @deepseek-ai/dsh-tools 的真实校验器 validateJsonSchemaValue）
 * - provider 识别/归一化/别名（providerOf / modelKey / normalizeProvider）
 * - 计价：官方 / opencode-go / env override / 非法 env 回退（priceEnv）
 * - 双路径等价：带 provider 的 request/header 事件下 aggregate 与 aggregateBuckets 一致
 * - Issue #2: whale_report 执行路径绝不调用 session.append
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import { aggregate, aggregateBuckets, bucketizeOwnEvents, providerOf, modelKey, normalizeProvider, type RawEvent } from "../src/stats.js";
import { computeCost, modelTier, priceEnv, OPENCODE_GO_PRICES } from "../src/pricing.js";
import type { ModelUsage } from "../src/stats.js";
import { whaleReportTool } from "../src/tools.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const USAGE: ModelUsage = { input: 1_000_000, output: 500_000, cacheRead: 300_000, reasoning: 100_000 };

// ─────────────────────────── P0: schema 校验 ───────────────────────────

describe("whale_report output.schema（P0 回归）", () => {
  it("真实含动态 perModel 键的 payload 能通过 DSH 校验器", () => {
    const svc = mockSvc();
    const tool = whaleReportTool(svc);
    const schema = tool.output.schema as never;
    const payload = {
      preset: "weekly",
      label: "周报",
      from: "2026-08-09T16:00:00.000Z",
      to: "2026-08-16T15:00:00.000Z",
      sessions: 97,
      turns: 305,
      totalEvents: 3453633,
      report: "# 深迹周报\n\n正文",
      cost: {
        perModel: { "opencode-go/deepseek-v4-flash": 1.2345, "deepseek-v4-flash": 0.5 },
        total: 1.7345,
        currency: "CNY",
        source: "official-page",
      },
      insights: [
        { id: "retry-storm", level: "warning", title: "t", detail: "d", action: "a", estimate: "¥0.1（估算）" },
        { id: "secret-hit", level: "critical", title: "t", detail: "d", action: "a" },
      ],
      prevCost: 2.0,
    };
    expect(validateJsonSchemaValue(schema, payload)).toEqual([]);
  });

  it("prevCost 允许 null（首次记录无上周期）", () => {
    const tool = whaleReportTool(mockSvc());
    const payload = {
      preset: "daily",
      label: "日报",
      from: "2026-08-16T00:00:00.000Z",
      to: "2026-08-16T15:00:00.000Z",
      sessions: 1,
      turns: 1,
      totalEvents: 10,
      report: "r",
      cost: { perModel: {}, total: 0, currency: "CNY", source: "official-page" },
      insights: [],
      prevCost: null,
    };
    expect(validateJsonSchemaValue(tool.output.schema as never, payload)).toEqual([]);
  });
});

// ─────────────────────────── provider 识别与归一化 ───────────────────────────

describe("providerOf", () => {
  it("config.provider / upstream / route 识别", () => {
    expect(providerOf({ header: { config: { provider: "deepseek" } } })).toBe("deepseek");
    expect(providerOf({ header: { config: { upstream: "opencode-go" } } })).toBe("opencode-go");
    expect(providerOf({ header: { config: { route: "glm" } } })).toBe("glm");
    expect(providerOf({ header: { route: "route-a" } })).toBe("route-a");
    expect(providerOf({ provider: "top-level" })).toBe("top-level");
    expect(providerOf({ source: "src" })).toBe("src");
  });

  it("大小写与空白归一化：OpenCode-Go / OPENCODE-GO → opencode-go", () => {
    expect(providerOf({ header: { config: { provider: "OpenCode-Go" } } })).toBe("opencode-go");
    expect(providerOf({ header: { config: { provider: "  OPENCODE-GO  " } } })).toBe("opencode-go");
  });

  it("baseURL 启发式：opencode / api.deepseek.com / deepseek", () => {
    expect(providerOf({ header: { config: { baseURL: "https://opencode.example.com/v1" } } })).toBe("opencode-go");
    expect(providerOf({ header: { config: { baseURL: "https://api.deepseek.com" } } })).toBe("deepseek");
    expect(providerOf({ header: { baseURL: "https://deepseek.internal" } })).toBe("deepseek");
  });

  it("识别不到 → unknown", () => {
    expect(providerOf({})).toBe("unknown");
    expect(providerOf(null)).toBe("unknown");
    expect(providerOf("nope")).toBe("unknown");
    expect(providerOf({ header: {} })).toBe("unknown");
  });

  it("无 alias 配置时 deepseek-modlens 不误判为 opencode-go（默认行为对所有用户安全）", () => {
    expect(providerOf({ header: { config: { provider: "deepseek-modlens" } } })).toBe("deepseek-modlens");
  });

  it("配置 WHALE_PROVIDER_ALIASES 后 deepseek-modlens 归一为 opencode-go", async () => {
    vi.stubEnv("WHALE_PROVIDER_ALIASES", "deepseek-modlens, my-wrapper");
    // @ts-ignore vitest 支持 query import（强制模块重载以应用 stubEnv），TS 类型无法解析 query 路径
    const mod = await import("../src/stats.js?alias=1");
    expect(mod.providerOf({ header: { config: { provider: "deepseek-modlens" } } })).toBe("opencode-go");
    expect(mod.providerOf({ header: { config: { provider: "MY-WRAPPER" } } })).toBe("opencode-go");
    expect(mod.providerOf({ header: { config: { provider: "glm" } } })).toBe("glm");
  });
});

describe("modelKey / normalizeProvider / modelTier", () => {
  it("modelKey：带前缀 / 无前缀历史键 / unknown 不带前缀", () => {
    expect(modelKey("opencode-go", "deepseek-v4-flash")).toBe("opencode-go/deepseek-v4-flash");
    expect(modelKey("unknown", "deepseek-v4-flash")).toBe("deepseek-v4-flash");
    expect(modelKey("", "deepseek-v4-flash")).toBe("deepseek-v4-flash");
  });

  it("normalizeProvider：trim + lowercase", () => {
    expect(normalizeProvider("  OpenCode-Go ")).toBe("opencode-go");
    expect(normalizeProvider("DEEPSEEK")).toBe("deepseek");
  });

  it("modelTier 对带前缀 key 仍正确（pro/flash 判定只看模型名）", () => {
    expect(modelTier("opencode-go/deepseek-v4-pro")).toBe("pro");
    expect(modelTier("opencode-go/deepseek-v4-flash")).toBe("flash");
    expect(modelTier("deepseek-v4-flash")).toBe("flash");
    expect(modelTier("deepseek-v4-pro")).toBe("pro");
  });
});

// ─────────────────────────── 计价 ───────────────────────────

describe("pricing", () => {
  it("OPENCODE_GO_PRICES 默认沿用 DeepSeek 官方价", () => {
    expect(OPENCODE_GO_PRICES.flash).toEqual({ cacheReadPerMillion: 0.02, inputPerMillion: 1, outputPerMillion: 2 });
    expect(OPENCODE_GO_PRICES.pro).toEqual({ cacheReadPerMillion: 0.025, inputPerMillion: 3, outputPerMillion: 6 });
  });

  it("priceEnv：非法输入一律回退默认", () => {
    vi.stubEnv("WHALE_TEST_PRICE", "abc");
    expect(priceEnv("WHALE_TEST_PRICE", 1.5)).toBe(1.5);
    vi.stubEnv("WHALE_TEST_PRICE", "-5");
    expect(priceEnv("WHALE_TEST_PRICE", 1.5)).toBe(1.5);
    vi.stubEnv("WHALE_TEST_PRICE", "");
    expect(priceEnv("WHALE_TEST_PRICE", 1.5)).toBe(1.5);
    vi.stubEnv("WHALE_TEST_PRICE", "0");
    expect(priceEnv("WHALE_TEST_PRICE", 1.5)).toBe(0);
    vi.stubEnv("WHALE_TEST_PRICE", "2.5");
    expect(priceEnv("WHALE_TEST_PRICE", 1.5)).toBe(2.5);
    delete process.env.WHALE_TEST_PRICE;
    expect(priceEnv("WHALE_TEST_PRICE", 1.5)).toBe(1.5);
  });

  it("computeCost：官方流量走官方价，opencode-go 流量走订阅价，无前缀回退官方", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("no network in tests"))));
    const models = {
      "deepseek-v4-flash": USAGE,
      "opencode-go/deepseek-v4-flash": USAGE,
      "opencode-go/deepseek-v4-pro": USAGE,
    };
    const cost = await computeCost(models);
    // modelCost 口径：cache×cache价 + (input-cache)×input价 + output×output价
    // flash 官方价：0.3M×0.02 + 0.7M×1 + 0.5M×2 = 1.706
    expect(cost.perModel["deepseek-v4-flash"]).toBeCloseTo(1.706, 6);
    // opencode-go flash 默认同官方价（env 未配置）
    expect(cost.perModel["opencode-go/deepseek-v4-flash"]).toBeCloseTo(1.706, 6);
    // opencode-go pro：0.3M×0.025 + 0.7M×3 + 0.5M×6 = 5.1075
    expect(cost.perModel["opencode-go/deepseek-v4-pro"]).toBeCloseTo(5.1075, 6);
    expect(cost.total).toBeCloseTo(8.5195, 6);
  });

  it("env override 后 opencode-go 按订阅价计算", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("no network"))));
    vi.stubEnv("OPENCODE_GO_INPUT_PRICE_PER_M", "0.8");
    vi.stubEnv("OPENCODE_GO_OUTPUT_PRICE_PER_M", "1.6");
    // @ts-ignore 同上：query import 重载模块以读取新 env
    const mod = await import("../src/pricing.js?envprice=1");
    const cost = await mod.computeCost({ "opencode-go/deepseek-v4-flash": USAGE });
    // cache 0.3M×0.02 + miss 0.7M×0.8 + output 0.5M×1.6 = 1.366
    expect(cost.perModel["opencode-go/deepseek-v4-flash"]).toBeCloseTo(1.366, 6);
  });
});

// ─────────────────────────── 双路径等价（带 provider） ───────────────────────────

describe("provider-aware 双路径等价", () => {
  it("带 request/header provider 的事件：aggregate 与 aggregateBuckets 的模型键与 token 一致", () => {
    const base = new Date(2026, 7, 10, 0, 0, 0).getTime();
    const events: RawEvent[] = [
      ev(base, "request/header", { header: { config: { provider: "OpenCode-Go", model: "deepseek-v4-flash" } } }),
      ev(base + 1, "turn/start", {}),
      ev(base + 2, "user/message", { content: [] }),
      ev(base + 3, "assistant/message", { usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, reasoningTokens: 5 } }),
      ev(base + 4, "request/header", { header: { config: { provider: "deepseek", model: "deepseek-v4-pro" } } }),
      ev(base + 5, "assistant/message", { usage: { inputTokens: 20, outputTokens: 10, cacheReadTokens: 0, reasoningTokens: 2 } }),
    ];
    const period = { from: base - 60_000, to: base + 3600_000 };
    const direct = aggregate(events, period, [{ id: "s1", createdAt: base }]);
    const built = bucketizeOwnEvents("s1", events.map((e) => ({ ...e, seq: 0 })), 0);
    const indexed = aggregateBuckets([{ sessionId: "s1", buckets: built.buckets, titles: built.titles }], period, [
      { id: "s1", createdAt: base },
    ]);

    expect(Object.keys(direct.models).sort()).toEqual(["deepseek/deepseek-v4-pro", "opencode-go/deepseek-v4-flash"]);
    expect(indexed.models).toEqual(direct.models);
    expect(indexed.tokens).toEqual(direct.tokens);
    expect(indexed.sessionsDetail[0].modelTokens).toEqual(direct.sessionsDetail[0].modelTokens);
  });

  it("无 provider 的历史事件：键不带前缀（兼容）", () => {
    const base = new Date(2026, 7, 10, 0, 0, 0).getTime();
    const events: RawEvent[] = [
      ev(base, "request/header", { header: { config: { model: "deepseek-v4-flash" } } }),
      ev(base + 1, "assistant/message", { usage: { inputTokens: 10, outputTokens: 5 } }),
    ];
    const stats = aggregate(events, { from: base - 1, to: base + 1000 }, [{ id: "s1", createdAt: base }]);
    expect(Object.keys(stats.models)).toEqual(["deepseek-v4-flash"]);
  });
});

// ─────────────────────────── Issue #2: 不再写会话日志 ───────────────────────────

describe("whale_report 不污染会话日志（Issue #2 回归）", () => {
  it("执行路径绝不调用 session.append", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("no network"))));
    const append = vi.fn();
    const svc = mockSvc();
    const tool = whaleReportTool(svc);
    const result = await tool.execute!({ preset: "daily" }, { agent: { session: { append } } } as never);
    expect(append).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      preset: "daily",
      sessions: 0,
      turns: 0,
      totalEvents: 0,
      report: expect.any(String),
      cost: expect.objectContaining({ total: expect.any(Number) }),
      insights: expect.any(Array),
      prevCost: null,
    });
    expect(validateJsonSchemaValue(tool.output.schema as never, result)).toEqual([]);
  });

  it("全仓不再有 session.append 自定义事件写入", () => {
    // 静态检查：tools.ts 不应再包含 session.append 调用。
    const fs = require("node:fs");
    const toolsSrc = fs.readFileSync("src/tools.ts", "utf8");
    expect(toolsSrc).not.toContain('session.append');
  });
});

// ─────────────────────────── helpers ───────────────────────────

function ev(time: number, type: string, data: unknown): RawEvent {
  return { type, time, data: { ...(data as object), sessionId: "s1" } };
}

function mockSvc(): never {
  const emptyTable = {
    get: async () => undefined,
    put: async () => {},
    entries: () => new Map().entries(),
    delete: async () => true,
  };
  return {
    sessionQuery: { listSessions: async () => [], readSession: async () => { throw new Error("no session"); } },
    index: emptyTable,
    periodStats: emptyTable,
    domain: { table: () => emptyTable },
  } as never;
}
