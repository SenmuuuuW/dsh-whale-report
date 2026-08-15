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
export type BalanceStatus = "connected" | "invalid-key" | "timeout" | "unavailable" | "error";
/** 返回给前端的余额快照（绝不含任何凭据）。 */
export interface ProviderBalance {
    provider: string;
    name: string;
    status: BalanceStatus;
    /** connected 时有效。 */
    balance?: {
        currency: string;
        total: number;
        granted: number;
        toppedUp: number;
    };
    isAvailable?: boolean;
    checkedAt: number;
    /** 简短状态码，绝不包含 key。 */
    error?: string;
}
export interface BalanceAdapter {
    readonly id: string;
    readonly name: string;
    /** 宿主端读取凭据（DSH 配置 / 环境变量）。返回 null = 未配置。 */
    readKey(): string | null;
    /** 查询余额。实现必须保证任何错误路径都不泄露 key。 */
    fetchBalance(key: string): Promise<ProviderBalance>;
}
/** dotenv 最小解析：读取 <file> 中 <name>=<value>（支持引号包裹）。 */
export declare function readDotenvKey(filePath: string, name: string): string | null;
/**
 * 从 DSH 凭据文件（~/.dsh/.credentials.yaml）读取 key。
 * 该文件是 DSH 官方凭据源（`.env` 可能是残留/过期值），格式为 YAML：
 *   { DEEPSEEK_API_KEY: sk-xxx }   （flow style，单行）
 *   DEEPSEEK_API_KEY: sk-xxx        （block style）
 * 宽松正则解析，取不带引号的 key 值。
 */
export declare function readCredentialsKey(filePath: string, name: string): string | null;
/** 解析官方 GET /user/balance 响应（金额字段为字符串）。结构不合法返回 null。 */
export declare function parseDeepSeekBalance(json: unknown): {
    isAvailable: boolean;
    balance: {
        currency: string;
        total: number;
        granted: number;
        toppedUp: number;
    };
} | null;
export declare const deepseekAdapter: BalanceAdapter;
/** 已实现的适配器注册表（未来：glm / openai-compatible 追加到这里）。 */
export declare const BALANCE_ADAPTERS: readonly BalanceAdapter[];
export declare function adapterOf(id: string): BalanceAdapter | undefined;
/** 内存缓存（TTL 60s）：避免每次面板渲染/切换周期都请求 provider。 */
export declare const BALANCE_CACHE_TTL_MS: number;
export declare function getCachedBalance(provider: string): ProviderBalance | null;
export declare function setCachedBalance(provider: string, result: ProviderBalance): void;
export declare function clearBalanceCache(): void;
/** 查询入口：缓存命中直接返回；refresh=true 强制重查（前端"刷新"按钮）。 */
export declare function queryBalance(adapter: BalanceAdapter, refresh?: boolean): Promise<ProviderBalance>;
//# sourceMappingURL=balance.d.ts.map