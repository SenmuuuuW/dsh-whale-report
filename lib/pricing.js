export const PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
/** 内置回退价（官方当前价，CNY / 1M）。 */
export const BUILTIN_PRICES = {
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
function parsePriceCell(text) {
    const m = PRICE_RE.exec(text);
    if (m === null)
        return undefined;
    const value = Number(m[1]);
    return Number.isFinite(value) ? value : undefined;
}
/** 解析官方定价页（当前单价格表：缓存命中 / 未命中 / 输出 三行 × flash/pro 两列）。 */
async function fetchOfficialPrices() {
    const response = await fetch(PRICING_URL, {
        headers: { "user-agent": "dsh-whale-report/0.1 (cost estimation)" },
        signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
        throw new Error(`pricing page ${response.status}`);
    const html = await response.text();
    const text = stripHtml(html);
    const hit = /百万tokens输入（缓存命中）([\s\S]{0,400}?)百万tokens输入（缓存未命中）([\s\S]{0,400}?)百万tokens输出([\s\S]{0,400}?)(?:并发限制|<\/table)/i.exec(text);
    if (hit === null)
        throw new Error("pricing table not found");
    const cell = (raw) => {
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
export async function getPrices() {
    const now = Date.now();
    if (priceCache !== null && now - priceCache.fetchedAt < PRICING_TTL_MS)
        return priceCache;
    try {
        const prices = await fetchOfficialPrices();
        priceCache = { prices, source: "official-page", fetchedAt: now };
    }
    catch {
        priceCache = { prices: BUILTIN_PRICES, source: "builtin", fetchedAt: now };
    }
    return priceCache;
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