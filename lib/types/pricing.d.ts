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
export declare const BUILTIN_PRICES: Record<"flash" | "pro", Prices>;
/** 模型名 → 档位（v4 系列按 flash/pro 识别，未知回退 flash）。 */
export declare function modelTier(model: string): "flash" | "pro";
export interface CostBreakdown {
    perModel: Record<string, number>;
    total: number;
    currency: string;
    source: "official-page" | "builtin";
    fetchedAt: number;
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