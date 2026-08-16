/**
 * DeepSeek 官方计费：价格获取 + 费用计算。
 *
 * 价格来源与 dsh-balance-meter 相同的官方定价页
 * （api-docs.deepseek.com/zh-cn/quick_start/pricing/），宽容解析：
 * 页面改版/涨价时解析失败自动回退内置价，不需要发插件更新。
 * 计费口径与官方一致：只按三个桶计费 ——
 *   输入（缓存命中）× 命中价 + 输入（缓存未命中）× 未命中价 + 输出 × 输出价。
 *
 * 官方价格（2026-08-17 前，CNY / 1M token）：
 *   v4-flash: 命中 0.02 · 未命中 1 · 输出 2
 *   v4-pro:   命中 0.025 · 未命中 3 · 输出 6
 */
import type { ModelUsage } from "./stats.js";

export interface Prices {
  cacheReadPerMillion: number;
  inputPerMillion: number;
  outputPerMillion: number;
}

export const PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";

/** 内置回退价（官方当前价，CNY / 1M）。 */
export const BUILTIN_PRICES: Record<"flash" | "pro", Prices> = {
  flash: { cacheReadPerMillion: 0.02, inputPerMillion: 1, outputPerMillion: 2 },
  pro: { cacheReadPerMillion: 0.025, inputPerMillion: 3, outputPerMillion: 6 },
};

/**
 * opencode-go 订阅的计价（CNY / 1M token）。
 * 默认先用 DeepSeek 官方价作为估算；可通过环境变量覆盖为订阅实际单价：
 *   OPENCODE_GO_CACHE_READ_PRICE_PER_M
 *   OPENCODE_GO_INPUT_PRICE_PER_M
 *   OPENCODE_GO_OUTPUT_PRICE_PER_M
 */
export const OPENCODE_GO_PRICES: Record<"flash" | "pro", Prices> = {
  flash: {
    cacheReadPerMillion: Number(process.env.OPENCODE_GO_CACHE_READ_PRICE_PER_M ?? 0.02),
    inputPerMillion: Number(process.env.OPENCODE_GO_INPUT_PRICE_PER_M ?? 1),
    outputPerMillion: Number(process.env.OPENCODE_GO_OUTPUT_PRICE_PER_M ?? 2),
  },
  pro: {
    cacheReadPerMillion: Number(process.env.OPENCODE_GO_CACHE_READ_PRICE_PER_M ?? 0.025),
    inputPerMillion: Number(process.env.OPENCODE_GO_INPUT_PRICE_PER_M ?? 3),
    outputPerMillion: Number(process.env.OPENCODE_GO_OUTPUT_PRICE_PER_M ?? 6),
  },
};

/** 模型名 → 档位（v4 系列按 flash/pro 识别，未知回退 flash；兼容 provider/ 前缀）。 */
export function modelTier(model: string): "flash" | "pro" {
  const base = typeof model === "string" && model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  return /pro/i.test(base) ? "pro" : "flash";
}

export interface CostBreakdown {
  perModel: Record<string, number>;
  total: number;
  currency: string;
  source: "official-page" | "builtin";
  fetchedAt: number;
}

/** 缓存的价格快照 + 过期时间。 */
let priceCache: { prices: Record<"flash" | "pro", Prices>; source: "official-page" | "builtin"; fetchedAt: number } | null = null;
export const PRICING_TTL_MS = 6 * 60 * 60 * 1000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const PRICE_RE = /(\d+(?:\.\d+)?)\s*元/;
function parsePriceCell(text: string): number | undefined {
  const m = PRICE_RE.exec(text);
  if (m === null) return undefined;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : undefined;
}

/** 解析官方定价页（当前单价格表：缓存命中 / 未命中 / 输出 三行 × flash/pro 两列）。 */
async function fetchOfficialPrices(): Promise<Record<"flash" | "pro", Prices>> {
  const response = await fetch(PRICING_URL, {
    headers: { "user-agent": "dsh-whale-report/0.1 (cost estimation)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`pricing page ${response.status}`);
  const html = await response.text();
  const text = stripHtml(html);
  const hit = /百万tokens输入（缓存命中）([\s\S]{0,400}?)百万tokens输入（缓存未命中）([\s\S]{0,400}?)百万tokens输出([\s\S]{0,400}?)(?:并发限制|<\/table)/i.exec(text);
  if (hit === null) throw new Error("pricing table not found");
  const cell = (raw: string) => {
    const first = parsePriceCell(raw);
    const second = parsePriceCell(raw.replace(/^\s*\d+(?:\.\d+)?元/, ""));
    return { first, second };
  };
  const cache = cell(hit[1]);
  const input = cell(hit[2]);
  const output = cell(hit[3]);
  if (cache.first === undefined || input.first === undefined || output.first === undefined) {
    throw new Error("pricing cells missing");
  }
  return {
    flash: {
      cacheReadPerMillion: cache.first,
      inputPerMillion: input.first,
      outputPerMillion: output.first,
    },
    pro: {
      cacheReadPerMillion: cache.second ?? cache.first,
      inputPerMillion: input.second ?? input.first,
      outputPerMillion: output.second ?? output.first,
    },
  };
}

/** 取价格（6 小时缓存；失败回退内置价）。 */
export async function getPrices(): Promise<{ prices: Record<"flash" | "pro", Prices>; source: "official-page" | "builtin"; fetchedAt: number }> {
  const now = Date.now();
  if (priceCache !== null && now - priceCache.fetchedAt < PRICING_TTL_MS) return priceCache;
  try {
    const prices = await fetchOfficialPrices();
    priceCache = { prices, source: "official-page", fetchedAt: now };
  } catch {
    priceCache = { prices: BUILTIN_PRICES, source: "builtin", fetchedAt: now };
  }
  return priceCache;
}

/** 单模型费用：缓存命中 + 缓存未命中 + 输出。输入扣除已命中部分避免重复计费。 */
export function modelCost(usage: ModelUsage, prices: Prices): number {
  const cacheRead = usage.cacheRead / 1_000_000 * prices.cacheReadPerMillion;
  const miss = Math.max(0, usage.input - usage.cacheRead) / 1_000_000 * prices.inputPerMillion;
  const output = usage.output / 1_000_000 * prices.outputPerMillion;
  return cacheRead + miss + output;
}

/** 全部模型的费用拆解。 */
export async function computeCost(models: Record<string, ModelUsage>): Promise<CostBreakdown> {
  const { prices, source, fetchedAt } = await getPrices();
  const perModel: Record<string, number> = {};
  let total = 0;
  for (const [model, usage] of Object.entries(models)) {
    const provider = model.includes("/") ? model.slice(0, model.indexOf("/")) : "deepseek";
    const priceSet = provider === "opencode-go" ? OPENCODE_GO_PRICES : prices;
    const cost = modelCost(usage, priceSet[modelTier(model)]);
    perModel[model] = cost;
    total += cost;
  }
  return { perModel, total, currency: "CNY", source, fetchedAt };
}
