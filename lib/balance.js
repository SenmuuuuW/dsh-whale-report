/**
 * Provider Balance：模型平台账户余额查询（服务端只读探针）。
 *
 * 安全约束（硬性）：
 * - API Key 只在宿主进程内读取与使用，绝不下发浏览器；
 * - 不写入 report / 历史 / 导出 / 日志；
 * - 错误信息一律固定文案，绝不包含 key。
 *
 * 架构：ProviderBalanceAdapter 可扩展（deepseek 已实现；glm / openai-compatible 未来接入）。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
/** dotenv 最小解析：读取 <file> 中 <name>=<value>（支持引号包裹）。 */
export function readDotenvKey(filePath, name) {
    if (!existsSync(filePath))
        return null;
    try {
        const raw = readFileSync(filePath, "utf8");
        const re = new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, "m");
        const match = raw.match(re);
        if (match === null)
            return null;
        let value = match[1];
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        return value === "" ? null : value;
    }
    catch {
        return null;
    }
}
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
const BALANCE_TIMEOUT_MS = 8000;
/** 解析官方 GET /user/balance 响应（金额字段为字符串）。结构不合法返回 null。 */
export function parseDeepSeekBalance(json) {
    if (typeof json !== "object" || json === null)
        return null;
    const d = json;
    if (typeof d.is_available !== "boolean")
        return null;
    if (!Array.isArray(d.balance_infos) || d.balance_infos.length === 0)
        return null;
    const info = d.balance_infos[0];
    if (typeof info !== "object" || info === null)
        return null;
    const currency = typeof info.currency === "string" ? info.currency : "CNY";
    const toNum = (v) => (typeof v === "string" ? Number.parseFloat(v) : Number.NaN);
    const total = toNum(info.total_balance);
    const granted = toNum(info.granted_balance);
    const toppedUp = toNum(info.topped_up_balance);
    if (!Number.isFinite(total))
        return null;
    return {
        isAvailable: d.is_available,
        balance: {
            currency,
            total,
            granted: Number.isFinite(granted) ? granted : 0,
            toppedUp: Number.isFinite(toppedUp) ? toppedUp : 0,
        },
    };
}
export const deepseekAdapter = {
    id: "deepseek",
    name: "DeepSeek",
    readKey() {
        // DSH 官方配置优先：~/.dsh/.env 的 DEEPSEEK_API_KEY（复用已有配置，不要求用户再输入）。
        const fromDsh = readDotenvKey(join(homedir(), ".dsh", ".env"), "DEEPSEEK_API_KEY");
        if (fromDsh !== null)
            return fromDsh;
        // 兜底：宿主进程环境变量。
        const env = process.env.DEEPSEEK_API_KEY;
        return env !== undefined && env !== "" ? env : null;
    },
    async fetchBalance(key) {
        const checkedAt = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), BALANCE_TIMEOUT_MS);
        try {
            const res = await fetch(DEEPSEEK_BALANCE_URL, {
                headers: { Authorization: `Bearer ${key}` },
                signal: controller.signal,
            });
            if (res.status === 401 || res.status === 403) {
                return { provider: "deepseek", name: "DeepSeek", status: "invalid-key", checkedAt, error: "INVALID KEY" };
            }
            if (!res.ok) {
                return { provider: "deepseek", name: "DeepSeek", status: "error", checkedAt, error: `HTTP ${res.status}` };
            }
            const parsed = parseDeepSeekBalance((await res.json()));
            if (parsed === null) {
                return { provider: "deepseek", name: "DeepSeek", status: "error", checkedAt, error: "MALFORMED RESPONSE" };
            }
            return {
                provider: "deepseek",
                name: "DeepSeek",
                status: "connected",
                checkedAt,
                isAvailable: parsed.isAvailable,
                balance: parsed.balance,
            };
        }
        catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                return { provider: "deepseek", name: "DeepSeek", status: "timeout", checkedAt, error: "TIMEOUT" };
            }
            return { provider: "deepseek", name: "DeepSeek", status: "unavailable", checkedAt, error: "NETWORK" };
        }
        finally {
            clearTimeout(timer);
        }
    },
};
/** 已实现的适配器注册表（未来：glm / openai-compatible 追加到这里）。 */
export const BALANCE_ADAPTERS = [deepseekAdapter];
export function adapterOf(id) {
    return BALANCE_ADAPTERS.find((a) => a.id === id);
}
/** 内存缓存（TTL 60s）：避免每次面板渲染/切换周期都请求 provider。 */
export const BALANCE_CACHE_TTL_MS = 60 * 1000;
const balanceCache = new Map();
export function getCachedBalance(provider) {
    const hit = balanceCache.get(provider);
    if (hit === undefined || Date.now() - hit.at > BALANCE_CACHE_TTL_MS)
        return null;
    return hit.result;
}
export function setCachedBalance(provider, result) {
    balanceCache.set(provider, { at: Date.now(), result });
}
export function clearBalanceCache() {
    balanceCache.clear();
}
/** 查询入口：缓存命中直接返回；refresh=true 强制重查（前端"刷新"按钮）。 */
export async function queryBalance(adapter, refresh = false) {
    if (!refresh) {
        const cached = getCachedBalance(adapter.id);
        if (cached !== null)
            return cached;
    }
    const key = adapter.readKey();
    if (key === null) {
        const result = {
            provider: adapter.id,
            name: adapter.name,
            status: "unavailable",
            checkedAt: Date.now(),
            error: "NOT CONFIGURED",
        };
        setCachedBalance(adapter.id, result);
        return result;
    }
    const result = await adapter.fetchBalance(key);
    setCachedBalance(adapter.id, result);
    return result;
}
//# sourceMappingURL=balance.js.map