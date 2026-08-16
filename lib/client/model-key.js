/**
 * provider/model 前缀键拆分（供 UI 展示用）。
 *
 * stats.models 的键在 provider-aware 后形如 `opencode-go/deepseek-v4-flash`：
 * UI 不应把整个键当模型名显示，而应拆分为「来源 provider」与「模型名」。
 * 纯函数、无依赖，独立文件避免与主 UI 文件冲突。
 */
/** `opencode-go/deepseek-v4-flash` → `{ provider: "opencode-go", model: "deepseek-v4-flash" }`；
 *  无前缀历史键（`deepseek-v4-flash`）→ `{ provider: null, model: "deepseek-v4-flash" }`。 */
export function splitModelKey(key) {
    const idx = key.indexOf("/");
    if (idx < 0)
        return { provider: null, model: key };
    return { provider: key.slice(0, idx), model: key.slice(idx + 1) };
}
//# sourceMappingURL=model-key.js.map