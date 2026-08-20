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
export declare const PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
/** 内置回退价（官方当前价，CNY / 1M）。 */
/**
 * DeepSeek 官方峰谷价（2026-08-17 起，CNY / 1M token）。
 * 高峰时段（北京时间 9:00–12:00、14:00–18:00）价格为空闲时段两倍。
 */
export declare const PEAK_PRICES: Record<"flash" | "pro", Prices>;
export declare const OFFPEAK_PRICES: Record<"flash" | "pro", Prices>;
/** 旧内置价（峰谷定价前，仅历史兼容参考）。 */
export declare const BUILTIN_PRICES: Record<"flash" | "pro", Prices>;
/**
 * 高峰时段判定：北京时间（UTC+8）9:00–12:00、14:00–18:00。
 * 确定性纯函数；输入为 epoch ms 或本地小时。
 */
export declare function isPeakHourCST(ms: number): boolean;
/** 当前时刻价格（峰/谷）。 */
export declare function pricesForTime(ms: number): Record<"flash" | "pro", Prices>;
/**
 * 按时段分段计价：输入 小时 → 模型用量，按各自时段价格累加。
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
export declare function computeCostTimed(perHourModelTokens: {
    hour: number;
    modelTokens: Record<string, ModelUsage>;
}[]): TimedCostResult;
/**
 * opencode-go 订阅的计价（CNY / 1M token）。
 * 默认先用 DeepSeek 官方价作为估算；可通过环境变量覆盖为订阅实际单价：
 *   OPENCODE_GO_CACHE_READ_PRICE_PER_M
 *   OPENCODE_GO_INPUT_PRICE_PER_M
 *   OPENCODE_GO_OUTPUT_PRICE_PER_M
 */
/** 读取价格环境变量：非法（非有限数 / 负数 / NaN）一律回退默认值，绝不产生 NaN 价格。 */
export declare function priceEnv(name: string, fallback: number): number;
export declare const OPENCODE_GO_PRICES: Record<"flash" | "pro", Prices>;
/** 模型名 → 档位（v4 系列按 flash/pro 识别，未知回退 flash；兼容 provider/ 前缀）。 */
export declare function modelTier(model: string): "flash" | "pro";
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
export declare const PRICING_TTL_MS: number;
/** 取价格（6 小时缓存；失败回退内置价）。 */
export declare function getPrices(): Promise<{
    prices: Record<"flash" | "pro", Prices>;
    source: "official-page" | "builtin";
    fetchedAt: number;
}>;
/** 单模型费用：缓存命中 + 缓存未命中 + 输出。输入扣除已命中部分避免重复计费。 */
export declare function modelCost(usage: ModelUsage, prices: Prices): number;
/** 全部模型的费用拆解。 */
export declare function computeCost(models: Record<string, ModelUsage>): Promise<CostBreakdown>;
//# sourceMappingURL=pricing.d.ts.map