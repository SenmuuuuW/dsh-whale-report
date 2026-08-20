export const PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
/** 内置回退价（官方当前价，CNY / 1M）。 */
/**
 * DeepSeek 官方峰谷价（2026-08-17 起，CNY / 1M token）。
 * 高峰时段（北京时间 9:00–12:00、14:00–18:00）价格为空闲时段两倍。
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
 * 高峰时段判定：北京时间（UTC+8）9:00–12:00、14:00–18:00。
 * 确定性纯函数；输入为 epoch ms 或本地小时。
 */
export function isPeakHourCST(ms) {
    // 北京时间 = UTC + 8
    const cstHour = (new Date(ms).getUTCHours() + 8) % 24;
    return (cstHour >= 9 && cstHour < 12) || (cstHour >= 14 && cstHour < 18);
}
/** 当前时刻价格（峰/谷）。 */
export function pricesForTime(ms) {
    return isPeakHourCST(ms) ? PEAK_PRICES : OFFPEAK_PRICES;
}
export function computeCostTimed(perHourModelTokens) {
    const perModel = {};
    let total = 0;
    let peakCost = 0;
    let peakTokens = 0;
    let allTokens = 0;
    for (const { hour, modelTokens } of perHourModelTokens) {
        // hour 为本地小时；峰谷按北京时间（UTC+8）判定——本地为 UTC+8 时一致。
        const priceSet = isPeakHourCST(hour * 3600_000) ? PEAK_PRICES : OFFPEAK_PRICES;
        for (const [model, usage] of Object.entries(modelTokens)) {
            const provider = model.includes("/") ? model.slice(0, model.indexOf("/")) : "deepseek";
            const tier = modelTier(model);
            const prices = provider === "opencode-go" ? OPENCODE_GO_PRICES : priceSet;
            const cost = modelCost(usage, prices[tier]);
            perModel[model] = (perModel[model] ?? 0) + cost;
            total += cost;
            const tokens = usage.input + usage.output + usage.cacheRead + usage.reasoning;
            allTokens += tokens;
            if (priceSet === PEAK_PRICES) {
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
        prices: isPeakHourCST(now) ? priceCache.peak : priceCache.offpeak,
        source: priceCache.source,
        fetchedAt: priceCache.fetchedAt,
    };
}
/** 单模型费用：缓存命中 + 缓存未命中 + 输出。输入扣除已命中部分避免重复计费。 */
export function modelCost(usage, prices) {
    const cacheRead = usage.cacheRead / 1_000_000 * prices.cacheReadPerMillion;
    const miss = Math.max(0, usage.input - usage.cacheRead) / 1_000_000 * prices.inputPerMillion;
    const output = usage.output / 1_000_000 * prices.outputPerMillion;
    return cacheRead + miss + output;
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