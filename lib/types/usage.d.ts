/**
 * DeepTrace usage semantics（canonical，全仓唯一口径）。
 *
 * DSH 核心保证（llm/llm/src/types.ts + llm-deepseek/src/translate.ts）：
 *   inputTokens     = cache miss（未缓存输入，独占）
 *   cacheReadTokens = cache hit
 *   outputTokens    = completion（【包含】reasoning）
 *   reasoningTokens = completion 中 reasoning 部分（output 的子集）
 *
 * 因此：
 *   billed/合计 total = input + cacheRead + output（reasoning 绝不重复加）
 *   reasoning 只作为 output 的 breakdown 展示。
 *
 * 所有 UI / 导出 / 报告合计必须走 usageTotalTokens，禁止自行拼公式。
 */
import type { ModelUsage } from "./stats.js";
export interface UsageLike {
    input: number;
    output: number;
    cacheRead: number;
    reasoning?: number;
}
/** 唯一合计口径：input(miss) + cacheRead(hit) + output（含 reasoning，不重复计）。 */
export declare function usageTotalTokens(usage: UsageLike): number;
/** 计费输入 = miss + hit（平台口径 prompt_tokens）。 */
export declare function billedInputTokens(usage: UsageLike): number;
export interface ProviderUsage {
    input: number;
    output: number;
    cacheRead: number;
    reasoning: number;
    total: number;
    requests: number;
}
/**
 * 按 provider 拆分用量（P1 comparison scope）：
 * 统计键形如 `provider/model`（如 deepseek-official/deepseek-v4-flash），
 * 无前缀历史键归 deepseek。与 DeepSeek Platform 对账时只取 deepseek-official。
 */
export declare function buildProviderBreakdown(models: Record<string, ModelUsage>): Record<string, ProviderUsage>;
//# sourceMappingURL=usage.d.ts.map