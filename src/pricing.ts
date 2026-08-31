/**
 * DeepSeek 官方计费：价格获取 + 费用计算。
 *
 * 价格来源与 dsh-balance-meter 相同的官方定价页
 * （api-docs.deepseek.com/zh-cn/quick_start/pricing/），宽容解析：
 * 页面改版/涨价时解析失败自动回退内置价，不需要发插件更新。
 * 计费口径与官方一致：只按三个桶计费 ——
 *   输入（缓存命中）× 命中价 + 输入（缓存未命中）× 未命中价 + 输出 × 输出价。
 *
 * 价格沿革（CNY / 1M token）：
 *   - 2026-08-17 前统一价（BUILTIN_PRICES，历史回溯用）：
 *     v4-flash: 命中 0.02 · 未命中 1 · 输出 2；v4-pro: 命中 0.025 · 未命中 3 · 输出 6
 *   - 2026-08-17 起峰谷价（PEAK/OFFPEAK；空闲 = 高峰一半）
 *
 * 峰谷规则（v0.5.4 起）：
 * - 2026-08-23T00:00:00+08:00 之前：北京 9–12 / 14–18 高峰，其余低谷（不分周末）
 * - 2026-08-23T00:00:00+08:00 起：工作日保持上述窗口；周六/周日全天低谷
 * - 历史数据按事件所属真实时间回溯计价（pricingTierForTime 是唯一 truth source）
 */
import type { ModelUsage } from "./stats.js";
import { usageTotalTokens } from "./usage.js";
import { shanghaiDayOfWeek, shanghaiHour } from "./shanghai.js";

export interface Prices {
  cacheReadPerMillion: number;
  inputPerMillion: number;
  outputPerMillion: number;
}

export const PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";

/** 内置回退价（官方当前价，CNY / 1M）。 */
/**
 * DeepSeek 官方峰谷价（2026-08-17 起，CNY / 1M token）。
 * 高峰时段（北京时间 9:00–12:00、14:00–18:00，工作日）价格为空闲时段两倍；
 * 2026-08-23 起周末（周六/周日）全天按空闲价（见 pricingTierForTime）。
 */
export const PEAK_PRICES: Record<"flash" | "pro", Prices> = {
  flash: { cacheReadPerMillion: 0.1, inputPerMillion: 3.0, outputPerMillion: 9.0 },
  pro: { cacheReadPerMillion: 0.3, inputPerMillion: 9.0, outputPerMillion: 27.0 },
};
export const OFFPEAK_PRICES: Record<"flash" | "pro", Prices> = {
  flash: { cacheReadPerMillion: 0.05, inputPerMillion: 1.5, outputPerMillion: 4.5 },
  pro: { cacheReadPerMillion: 0.15, inputPerMillion: 4.5, outputPerMillion: 13.5 },
};
/** 旧内置价（峰谷定价前，仅历史兼容参考）。 */
export const BUILTIN_PRICES: Record<"flash" | "pro", Prices> = {
  flash: { cacheReadPerMillion: 0.02, inputPerMillion: 1, outputPerMillion: 2 },
  pro: { cacheReadPerMillion: 0.025, inputPerMillion: 3, outputPerMillion: 6 },
};

/**
 * 高峰窗口判定（北京时间小时）：9–12、14–18。
 * 纯小时窗口，无 weekday / 生效日期语义 —— 正式历史计费必须走 pricingTierForTime。
 */
/** 北京时间小时（0-23）是否高峰窗口（9-12、14-18）。纯小时判定（仅窗口语义；正式计费见 pricingTierForTime）。 */
export function isPeakCstHour(hour: number): boolean {
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}

/** 高峰窗口判定（epoch ms → 北京时间小时）。纯窗口语义；正式计费见 pricingTierForTime。 */
export function isPeakHourCST(ms: number): boolean {
  return isPeakCstHour(shanghaiHour(ms));
}

/** 定价时段（peak / offpeak）。 */
export type PricingTier = "peak" | "offpeak";

/**
 * DeepSeek 官方峰谷定价生效时刻（北京时间 2026-08-17 00:00:00，含）。
 * 生效前官方为统一价（BUILTIN_PRICES，无峰谷）；生效后按峰谷价分段计费。
 * 历史数据按事件所属真实时间回溯计价（priceSetForTime 是唯一 truth source）。
 */
export const PEAK_OFFPEAK_EFFECTIVE_AT = Date.parse("2026-08-17T00:00:00+08:00");

/**
 * 唯一定价时刻表（v0.6.1）—— 所有计费路径的唯一 price-set truth source：
 * - ms < 峰谷生效时刻 → BUILTIN_PRICES（8-17 前统一价，无峰谷）
 * - ms ≥ 峰谷生效时刻 → 按 pricingTierForTime 取 PEAK / OFFPEAK
 * 历史回溯与当前计价共用本函数，绝不把新价格前推到旧事件。
 */
export function priceSetForTime(ms: number): Record<"flash" | "pro", Prices> {
  if (ms < PEAK_OFFPEAK_EFFECTIVE_AT) return BUILTIN_PRICES;
  return pricingTierForTime(ms) === "peak" ? PEAK_PRICES : OFFPEAK_PRICES;
}

/**
 * DeepSeek 官方周末全天低谷新规生效时刻（北京时间 2026-08-23 00:00:00，含）。
 * 生效前历史必须按旧规则回溯，绝不把新周末规则前推。
 */
export const WEEKEND_OFFPEAK_EFFECTIVE_AT = Date.parse("2026-08-23T00:00:00+08:00");

/**
 * 唯一定价时刻表（v0.5.4）—— 所有计费路径的唯一 truth source：
 * - ms < 生效时刻 → 旧规则：北京 9–12 / 14–18 高峰，其余低谷（与星期几无关）
 * - ms ≥ 生效时刻 → 新规则：工作日同旧窗口；周六/周日全天低谷
 * 全部基于 Asia/Shanghai（UTC+8 无 DST），绝不依赖机器本地时区。
 */
export function pricingTierForTime(ms: number): PricingTier {
  if (ms < WEEKEND_OFFPEAK_EFFECTIVE_AT) return isPeakHourCST(ms) ? "peak" : "offpeak";
  const dow = shanghaiDayOfWeek(ms); // 0=周日 … 6=周六
  if (dow === 0 || dow === 6) return "offpeak";
  return isPeakHourCST(ms) ? "peak" : "offpeak";
}

/** 当前时刻价格（峰/谷）。 */
export function pricesForTime(ms: number): Record<"flash" | "pro", Prices> {
  return pricingTierForTime(ms) === "peak" ? PEAK_PRICES : OFFPEAK_PRICES;
}

/**
 * 按时间分段计价：输入 小时起点 epoch ms → 模型用量，按各自时段价格累加。
 * time 必须是该小时的起点（shanghaiHourStart / shanghaiHourStartOf）——
 * 同一 hour-of-day 在不同日期（如周五 10:00 vs 周六 10:00）必须分行传入，
 * 由 pricingTierForTime(time) 按所属真实日期决定峰/谷，绝不跨天合并后定价。
 * 返回 perModel 费用（确定性）与时段统计。
 */
export interface TimedCostResult {
  perModel: Record<string, number>;
  total: number;
  /** 高峰时段费用（估算口径展示用）。 */
  peakShare: number;
  /** 高峰 token 占比（0..1）。 */
  peakRatio: number;
}

export function computeCostTimed(
  perTimeModelTokens: { time: number; modelTokens: Record<string, ModelUsage> }[],
): TimedCostResult {
  const perModel: Record<string, number> = {};
  let total = 0;
  let peakCost = 0;
  let peakTokens = 0;
  let allTokens = 0;
  for (const { time, modelTokens } of perTimeModelTokens) {
    // 价格集由 priceSetForTime 唯一决定（8-17 前旧统一价回溯；之后按峰谷时段）。
    const tier = pricingTierForTime(time);
    const priceSet = priceSetForTime(time);
    for (const [model, usage] of Object.entries(modelTokens)) {
      const provider = model.includes("/") ? model.slice(0, model.indexOf("/")) : "deepseek";
      const mTier = modelTier(model);
      const prices = provider === "opencode-go" ? OPENCODE_GO_PRICES : priceSet;
      const cost = modelCost(usage, prices[mTier]);
      perModel[model] = (perModel[model] ?? 0) + cost;
      total += cost;
      const tokens = usageTotalTokens(usage);
      allTokens += tokens;
      // peakShare/peakRatio 只统计峰谷价期（8-17 起）的高峰行：旧统一价期无峰谷语义。
      if (tier === "peak" && time >= PEAK_OFFPEAK_EFFECTIVE_AT) {
        peakCost += cost;
        peakTokens += tokens;
      }
    }
  }
  return { perModel, total, peakShare: peakCost, peakRatio: allTokens > 0 ? peakTokens / allTokens : 0 };
}

/**
 * opencode-go 订阅的计价（CNY / 1M token）。
 * 默认沿用 DeepSeek 官方空闲时段价作为估算（v0.6.1：自 8-17 峰谷价起同步，
 * 不再停留在 8-17 前旧价）；可通过环境变量覆盖为订阅实际单价：
 *   OPENCODE_GO_CACHE_READ_PRICE_PER_M
 *   OPENCODE_GO_INPUT_PRICE_PER_M
 *   OPENCODE_GO_OUTPUT_PRICE_PER_M
 */
/** 读取价格环境变量：非法（非有限数 / 负数 / NaN）一律回退默认值，绝不产生 NaN 价格。 */
export function priceEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const OPENCODE_GO_PRICES: Record<"flash" | "pro", Prices> = {
  flash: {
    cacheReadPerMillion: priceEnv("OPENCODE_GO_CACHE_READ_PRICE_PER_M", 0.05),
    inputPerMillion: priceEnv("OPENCODE_GO_INPUT_PRICE_PER_M", 1.5),
    outputPerMillion: priceEnv("OPENCODE_GO_OUTPUT_PRICE_PER_M", 4.5),
  },
  pro: {
    cacheReadPerMillion: priceEnv("OPENCODE_GO_CACHE_READ_PRICE_PER_M", 0.15),
    inputPerMillion: priceEnv("OPENCODE_GO_INPUT_PRICE_PER_M", 4.5),
    outputPerMillion: priceEnv("OPENCODE_GO_OUTPUT_PRICE_PER_M", 13.5),
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
  /** official-page = 官方页实时抓取；builtin = 内置价；peak-offpeak = 官方峰谷价分段计算。 */
  source: "official-page" | "builtin" | "peak-offpeak";
  fetchedAt: number;
  /** 高峰时段 token 占比（峰谷计价时提供）。 */
  peakRatio?: number;
  /** 高峰时段费用（峰谷计价时提供；谷时费用 = total − peakShare）。 */
  peakShare?: number;
}

/** 缓存的价格快照 + 过期时间。 */
let priceCache: { peak: Record<"flash" | "pro", Prices>; offpeak: Record<"flash" | "pro", Prices>; source: "official-page" | "builtin"; fetchedAt: number } | null = null;
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

/** 官方峰谷两套价：peak = 高峰时段（北京 9–12、14–18），offpeak = 空闲时段。 */
export interface OfficialPeakPrices {
  peak: Record<"flash" | "pro", Prices>;
  offpeak: Record<"flash" | "pro", Prices>;
}

/**
 * 解析官方定价页（2026-08-17 峰谷定价后：每类费用下 空闲时段 / 高峰时段 两行 × flash/pro 两列，
 * 人民币元/百万 token）。纯函数，便于离线测试；抓不到表格即抛错。
 */
export function parsePricingPage(html: string): OfficialPeakPrices {
  const text = stripHtml(html);
  // 宽容空白：真实页面在标签边界会产生 “输入 （缓存命中）” 这类空格（2026-08-31 实测）。
  const hit = /百万tokens输入\s*（\s*缓存命中\s*）([\s\S]{0,300}?)百万tokens输入\s*（\s*缓存未命中\s*）([\s\S]{0,300}?)百万tokens输出([\s\S]{0,300}?)(?:并发|Concurrency|<\/table)/i.exec(text);
  if (hit === null) throw new Error("pricing table not found");
  const four = (raw: string) => {
    const nums = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*元/g)].map((m) => Number(m[1]));
    return {
      offpeakFlash: nums[0],
      offpeakPro: nums[1],
      peakFlash: nums[2],
      peakPro: nums[3],
    };
  };
  const cache = four(hit[1]);
  const input = four(hit[2]);
  const output = four(hit[3]);
  const valid = (c: ReturnType<typeof four>): boolean =>
    [c.offpeakFlash, c.offpeakPro, c.peakFlash, c.peakPro].every((v) => Number.isFinite(v));
  if (!valid(cache) || !valid(input) || !valid(output)) throw new Error("pricing cells missing");
  const mk = (pick: (c: ReturnType<typeof four>) => { flash: number; pro: number }): Record<"flash" | "pro", Prices> => {
    const p = pick(cache);
    return {
      flash: { cacheReadPerMillion: p.flash, inputPerMillion: pick(input).flash, outputPerMillion: pick(output).flash },
      pro: { cacheReadPerMillion: p.pro, inputPerMillion: pick(input).pro, outputPerMillion: pick(output).pro },
    };
  };
  return {
    offpeak: mk((c) => ({ flash: c.offpeakFlash, pro: c.offpeakPro })),
    peak: mk((c) => ({ flash: c.peakFlash, pro: c.peakPro })),
  };
}

/** 抓取官方定价页（中文版，人民币峰谷价）。 */
async function fetchOfficialPrices(): Promise<OfficialPeakPrices> {
  const response = await fetch(PRICING_URL, {
    headers: { "user-agent": "dsh-whale-report/0.1 (cost estimation)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`pricing page ${response.status}`);
  return parsePricingPage(await response.text());
}

/** 取价格（6 小时缓存；失败回退内置价）。返回按当前时刻选定的时段价。 */
export async function getPrices(): Promise<{ prices: Record<"flash" | "pro", Prices>; source: "official-page" | "builtin"; fetchedAt: number }> {
  const now = Date.now();
  if (priceCache === null || now - priceCache.fetchedAt >= PRICING_TTL_MS) {
    try {
      const { peak, offpeak } = await fetchOfficialPrices();
      priceCache = { peak, offpeak, source: "official-page", fetchedAt: now };
    } catch {
      // 抓取失败回退内置的当前官方峰谷价（v0.6.1：绝不再回退到 8-17 前旧价）。
      priceCache = { peak: PEAK_PRICES, offpeak: OFFPEAK_PRICES, source: "builtin", fetchedAt: now };
    }
  }
  return {
    prices: pricingTierForTime(now) === "peak" ? priceCache.peak : priceCache.offpeak,
    source: priceCache.source,
    fetchedAt: priceCache.fetchedAt,
  };
}

/** 单模型费用：缓存命中 + 缓存未命中 + 输出。输入扣除已命中部分避免重复计费。 */
export function modelCost(usage: ModelUsage, prices: Prices): number {
  // P0（usage reconciliation）：DSH adapter 保证 inputTokens = cache miss（disjoint），
  // cacheReadTokens = cache hit。cost = miss×inputRate + hit×cacheRate + output×outputRate。
  // reasoning 包含在 output 中，绝不重复收费。
  const miss = usage.input / 1_000_000 * prices.inputPerMillion;
  const cacheRead = usage.cacheRead / 1_000_000 * prices.cacheReadPerMillion;
  const output = usage.output / 1_000_000 * prices.outputPerMillion;
  return miss + cacheRead + output;
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
