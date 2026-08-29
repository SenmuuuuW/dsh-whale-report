import { usageTotalTokens } from "./usage.js";
import { shanghaiDayOfWeek, shanghaiHour } from "./shanghai.js";
export const PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
/** 内置回退价（官方当前价，CNY / 1M）。 */
/**
 * DeepSeek 官方峰谷价（2026-08-17 起，CNY / 1M token）。
 * 高峰时段（北京时间 9:00–12:00、14:00–18:00，工作日）价格为空闲时段两倍；
 * 2026-08-23 起周末（周六/周日）全天按空闲价（见 pricingTierForTime）。
 */
export const PEAK_PRICES = {
    flash: { cacheReadPerMillion: 0.1, inputPerMillion: 3.0, outputPerMillion: 9.0 },
    pro: { cacheReadPerMillion: 0.3, inputPerMillion: 9.0, outputPerMillion: 27.0 },
};
export const OFFPEAK_PRICES = {
    flash: { cacheReadPerMillion: 0.05, inputPerMillion: 1.5, outputPerMillion: 4.5 },
    pro: { cacheReadPerMillion: 0.15, inputPerMillion: 4.5, outputPerMillion: 13.5 },
};
/** 旧内置价（峰谷定价前，仅历史兼容参考）。 */
export const BUILTIN_PRICES = {
    flash: { cacheReadPerMillion: 0.02, inputPerMillion: 1, outputPerMillion: 2 },
    pro: { cacheReadPerMillion: 0.025, inputPerMillion: 3, outputPerMillion: 6 },
};
/**
 * 高峰窗口判定（北京时间小时）：9–12、14–18。
 * 纯小时窗口，无 weekday / 生效日期语义 —— 正式历史计费必须走 pricingTierForTime。
 */
/** 北京时间小时（0-23）是否高峰窗口（9-12、14-18）。纯小时判定（仅窗口语义；正式计费见 pricingTierForTime）。 */
export function isPeakCstHour(hour) {
    return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}
/** 高峰窗口判定（epoch ms → 北京时间小时）。纯窗口语义；正式计费见 pricingTierForTime。 */
export function isPeakHourCST(ms) {
    return isPeakCstHour(shanghaiHour(ms));
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
export function pricingTierForTime(ms) {
    if (ms < WEEKEND_OFFPEAK_EFFECTIVE_AT)
        return isPeakHourCST(ms) ? "peak" : "offpeak";
    const dow = shanghaiDayOfWeek(ms); // 0=周日 … 6=周六
    if (dow === 0 || dow === 6)
        return "offpeak";
    return isPeakHourCST(ms) ? "peak" : "offpeak";
}
/** 当前时刻价格（峰/谷）。 */
export function pricesForTime(ms) {
    return pricingTierForTime(ms) === "peak" ? PEAK_PRICES : OFFPEAK_PRICES;
}
export function computeCostTimed(perTimeModelTokens) {
    const perModel = {};
    let total = 0;
    let peakCost = 0;
    let peakTokens = 0;
    let allTokens = 0;
    for (const { time, modelTokens } of perTimeModelTokens) {
        // 时段由 pricingTierForTime（Asia/Shanghai + 周末规则 + 生效边界）唯一决定。
        const tier = pricingTierForTime(time);
        const priceSet = tier === "peak" ? PEAK_PRICES : OFFPEAK_PRICES;
        for (const [model, usage] of Object.entries(modelTokens)) {
            const provider = model.includes("/") ? model.slice(0, model.indexOf("/")) : "deepseek";
            const mTier = modelTier(model);
            const prices = provider === "opencode-go" ? OPENCODE_GO_PRICES : priceSet;
            const cost = modelCost(usage, prices[mTier]);
            perModel[model] = (perModel[model] ?? 0) + cost;
            total += cost;
            const tokens = usageTotalTokens(usage);
            allTokens += tokens;
            if (tier === "peak") {
                peakCost += cost;
                peakTokens += tokens;
            }
        }
    }
    return { perModel, total, peakShare: peakCost, peakRatio: allTokens > 0 ? peakTokens / allTokens : 0 };
}
/**
 * opencode-go 订阅的计价（CNY / 1M token）。
 * 默认先用 DeepSeek 官方价作为估算；可通过环境变量覆盖为订阅实际单价：
 *   OPENCODE_GO_CACHE_READ_PRICE_PER_M
 *   OPENCODE_GO_INPUT_PRICE_PER_M
 *   OPENCODE_GO_OUTPUT_PRICE_PER_M
 */
/** 读取价格环境变量：非法（非有限数 / 负数 / NaN）一律回退默认值，绝不产生 NaN 价格。 */
export function priceEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === "")
        return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}
export const OPENCODE_GO_PRICES = {
    flash: {
        cacheReadPerMillion: priceEnv("OPENCODE_GO_CACHE_READ_PRICE_PER_M", 0.02),
        inputPerMillion: priceEnv("OPENCODE_GO_INPUT_PRICE_PER_M", 1),
        outputPerMillion: priceEnv("OPENCODE_GO_OUTPUT_PRICE_PER_M", 2),
    },
    pro: {
        cacheReadPerMillion: priceEnv("OPENCODE_GO_CACHE_READ_PRICE_PER_M", 0.025),
        inputPerMillion: priceEnv("OPENCODE_GO_INPUT_PRICE_PER_M", 3),
        outputPerMillion: priceEnv("OPENCODE_GO_OUTPUT_PRICE_PER_M", 6),
    },
};
/** 模型名 → 档位（v4 系列按 flash/pro 识别，未知回退 flash；兼容 provider/ 前缀）。 */
export function modelTier(model) {
    const base = typeof model === "string" && model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
    return /pro/i.test(base) ? "pro" : "flash";
}
/** 缓存的价格快照 + 过期时间。 */
let priceCache = null;
export const PRICING_TTL_MS = 6 * 60 * 60 * 1000;
function stripHtml(html) {
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
/**
 * 解析官方定价页（2026-08-17 峰谷定价后：每类费用下 空闲时段 / 高峰时段 两行 × flash/pro 两列，
 * 人民币元/百万 token）。纯函数，便于离线测试；抓不到表格即抛错。
 */
export function parsePricingPage(html) {
    const text = stripHtml(html);
    const hit = /百万tokens输入（缓存命中）([\s\S]{0,300}?)百万tokens输入（缓存未命中）([\s\S]{0,300}?)百万tokens输出([\s\S]{0,300}?)(?:并发|Concurrency|<\/table)/i.exec(text);
    if (hit === null)
        throw new Error("pricing table not found");
    const four = (raw) => {
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
    const valid = (c) => [c.offpeakFlash, c.offpeakPro, c.peakFlash, c.peakPro].every((v) => Number.isFinite(v));
    if (!valid(cache) || !valid(input) || !valid(output))
        throw new Error("pricing cells missing");
    const mk = (pick) => {
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
async function fetchOfficialPrices() {
    const response = await fetch(PRICING_URL, {
        headers: { "user-agent": "dsh-whale-report/0.1 (cost estimation)" },
        signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
        throw new Error(`pricing page ${response.status}`);
    return parsePricingPage(await response.text());
}
/** 取价格（6 小时缓存；失败回退内置价）。返回按当前时刻选定的时段价。 */
export async function getPrices() {
    const now = Date.now();
    if (priceCache === null || now - priceCache.fetchedAt >= PRICING_TTL_MS) {
        try {
            const { peak, offpeak } = await fetchOfficialPrices();
            priceCache = { peak, offpeak, source: "official-page", fetchedAt: now };
        }
        catch {
            priceCache = { peak: BUILTIN_PRICES, offpeak: BUILTIN_PRICES, source: "builtin", fetchedAt: now };
        }
    }
    return {
        prices: pricingTierForTime(now) === "peak" ? priceCache.peak : priceCache.offpeak,
        source: priceCache.source,
        fetchedAt: priceCache.fetchedAt,
    };
}
/** 单模型费用：缓存命中 + 缓存未命中 + 输出。输入扣除已命中部分避免重复计费。 */
export function modelCost(usage, prices) {
    // P0（usage reconciliation）：DSH adapter 保证 inputTokens = cache miss（disjoint），
    // cacheReadTokens = cache hit。cost = miss×inputRate + hit×cacheRate + output×outputRate。
    // reasoning 包含在 output 中，绝不重复收费。
    const miss = usage.input / 1_000_000 * prices.inputPerMillion;
    const cacheRead = usage.cacheRead / 1_000_000 * prices.cacheReadPerMillion;
    const output = usage.output / 1_000_000 * prices.outputPerMillion;
    return miss + cacheRead + output;
}
/** 全部模型的费用拆解。 */
export async function computeCost(models) {
    const { prices, source, fetchedAt } = await getPrices();
    const perModel = {};
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
//# sourceMappingURL=pricing.js.map