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

export type BalanceStatus = "connected" | "invalid-key" | "timeout" | "unavailable" | "error";

/** 返回给前端的余额快照（绝不含任何凭据）。 */
export interface ProviderBalance {
  provider: string;
  name: string;
  status: BalanceStatus;
  /** connected 时有效。 */
  balance?: { currency: string; total: number; granted: number; toppedUp: number };
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
export function readDotenvKey(filePath: string, name: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    const re = new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, "m");
    const match = raw.match(re);
    if (match === null) return null;
    let value = match[1];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/**
 * 从 DSH 凭据文件（~/.dsh/.credentials.yaml）读取 key。
 * 该文件是 DSH 官方凭据源（`.env` 可能是残留/过期值），格式为 YAML：
 *   { DEEPSEEK_API_KEY: sk-xxx }   （flow style，单行）
 *   DEEPSEEK_API_KEY: sk-xxx        （block style）
 * 宽松正则解析，取不带引号的 key 值。
 */
export function readCredentialsKey(filePath: string, name: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    const re = new RegExp(`${name}\\s*[:=]\\s*['"]?([A-Za-z0-9._-]{8,})['"]?`);
    const match = raw.match(re);
    if (match === null) return null;
    return match[1] === "" ? null : match[1];
  } catch {
    return null;
  }
}

const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
const BALANCE_TIMEOUT_MS = 12000;

/** 解析官方 GET /user/balance 响应（金额字段为字符串）。结构不合法返回 null。 */
export function parseDeepSeekBalance(
  json: unknown,
): { isAvailable: boolean; balance: { currency: string; total: number; granted: number; toppedUp: number } } | null {
  if (typeof json !== "object" || json === null) return null;
  const d = json as Record<string, unknown>;
  if (typeof d.is_available !== "boolean") return null;
  if (!Array.isArray(d.balance_infos) || d.balance_infos.length === 0) return null;
  // 多币种选择：官方可能同时返回 USD/CNY 等多个条目。
  // 优先 CNY（产品定价口径），其次第一个非零余额，最后第一个条目。
  const infos = d.balance_infos as Record<string, unknown>[];
  const pick = (info: Record<string, unknown>): { currency: string; total: number; granted: number; toppedUp: number } | null => {
    if (typeof info !== "object" || info === null) return null;
    const currency = typeof info.currency === "string" ? info.currency : "CNY";
    const toNum = (v: unknown): number => (typeof v === "string" ? Number.parseFloat(v) : Number.NaN);
    const total = toNum(info.total_balance);
    const granted = toNum(info.granted_balance);
    const toppedUp = toNum(info.topped_up_balance);
    if (!Number.isFinite(total)) return null;
    return {
      currency,
      total,
      granted: Number.isFinite(granted) ? granted : 0,
      toppedUp: Number.isFinite(toppedUp) ? toppedUp : 0,
    };
  };
  const parsed = infos.map(pick).filter((p): p is NonNullable<typeof p> => p !== null);
  if (parsed.length === 0) return null;
  const info =
    parsed.find((p) => p.currency === "CNY") ??
    parsed.find((p) => p.total > 0) ??
    parsed[0];
  return {
    isAvailable: d.is_available,
    balance: { currency: info.currency, total: info.total, granted: info.granted, toppedUp: info.toppedUp },
  };
}

export const deepseekAdapter: BalanceAdapter = {
  id: "deepseek",
  name: "DeepSeek",
  readKey() {
    // DSH 凭据源优先：~/.dsh/.credentials.yaml（官方凭据文件）。
    // .env 里的 DEEPSEEK_API_KEY 可能是残留/过期值（实测存在 102 字符无效 key），
    // 所以 .credentials.yaml → .env → 进程环境变量 三级回退。
    const dshRoot = join(homedir(), ".dsh");
    const fromCredentials = readCredentialsKey(join(dshRoot, ".credentials.yaml"), "DEEPSEEK_API_KEY");
    if (fromCredentials !== null) return fromCredentials;
    const fromDsh = readDotenvKey(join(dshRoot, ".env"), "DEEPSEEK_API_KEY");
    if (fromDsh !== null) return fromDsh;
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
      const parsed = parseDeepSeekBalance((await res.json()) as unknown);
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
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { provider: "deepseek", name: "DeepSeek", status: "timeout", checkedAt, error: "TIMEOUT" };
      }
      return { provider: "deepseek", name: "DeepSeek", status: "unavailable", checkedAt, error: "NETWORK" };
    } finally {
      clearTimeout(timer);
    }
  },
};

/** 已实现的适配器注册表（未来：glm / openai-compatible 追加到这里）。 */
export const BALANCE_ADAPTERS: readonly BalanceAdapter[] = [deepseekAdapter];

export function adapterOf(id: string): BalanceAdapter | undefined {
  return BALANCE_ADAPTERS.find((a) => a.id === id);
}

/** 内存缓存（TTL 60s）：避免每次面板渲染/切换周期都请求 provider。 */
export const BALANCE_CACHE_TTL_MS = 60 * 1000;
const balanceCache = new Map<string, { at: number; result: ProviderBalance }>();

export function getCachedBalance(provider: string): ProviderBalance | null {
  const hit = balanceCache.get(provider);
  if (hit === undefined || Date.now() - hit.at > BALANCE_CACHE_TTL_MS) return null;
  return hit.result;
}

export function setCachedBalance(provider: string, result: ProviderBalance): void {
  balanceCache.set(provider, { at: Date.now(), result });
}

export function clearBalanceCache(): void {
  balanceCache.clear();
}

/** 稳定状态（可缓存 60s）：连接成功 / key 明确无效 / 未配置。
 *  瞬时错误（timeout/unavailable/error）不缓存——网络抖动不该让面板长期显示过期错误。 */
const STABLE_STATUSES: readonly BalanceStatus[] = ["connected", "invalid-key", "unavailable"];

/** 查询入口：缓存命中直接返回；refresh=true 强制重查（前端"刷新"按钮）。 */
export async function queryBalance(adapter: BalanceAdapter, refresh = false): Promise<ProviderBalance> {
  if (!refresh) {
    const cached = getCachedBalance(adapter.id);
    if (cached !== null) return cached;
  }
  const key = adapter.readKey();
  if (key === null) {
    const result: ProviderBalance = {
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
  if (STABLE_STATUSES.includes(result.status)) {
    setCachedBalance(adapter.id, result);
  }
  return result;
}
