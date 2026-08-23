/** 唯一合计口径：input(miss) + cacheRead(hit) + output（含 reasoning，不重复计）。 */
export function usageTotalTokens(usage) {
    return usage.input + usage.cacheRead + usage.output;
}
/** 计费输入 = miss + hit（平台口径 prompt_tokens）。 */
export function billedInputTokens(usage) {
    return usage.input + usage.cacheRead;
}
/**
 * 按 provider 拆分用量（P1 comparison scope）：
 * 统计键形如 `provider/model`（如 deepseek-official/deepseek-v4-flash），
 * 无前缀历史键归 deepseek。与 DeepSeek Platform 对账时只取 deepseek-official。
 */
export function buildProviderBreakdown(models) {
    const out = {};
    for (const [key, usage] of Object.entries(models)) {
        const provider = key.includes("/") ? key.slice(0, key.indexOf("/")) : "deepseek";
        const acc = (out[provider] ??= {
            input: 0,
            output: 0,
            cacheRead: 0,
            reasoning: 0,
            total: 0,
            requests: 0,
        });
        acc.input += usage.input;
        acc.output += usage.output;
        acc.cacheRead += usage.cacheRead;
        acc.reasoning += usage.reasoning ?? 0;
        acc.total += usageTotalTokens(usage);
        acc.requests += 1;
    }
    return out;
}
//# sourceMappingURL=usage.js.map