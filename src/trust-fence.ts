/**
 * 浏览器信任围栏：只放行来自本机（loopback）的同源请求。
 *
 * 语义与官方 /api 网关的 fence 一致（@deepseek-ai/dsh-client-connection
 * 的 api-request-trust.ts / loopback-hostname.ts，BSD-3-Clause，此处按
 * 行为复刻，因为该包不导出这些工具）。这是 DNS rebinding / 跨站脚本
 * 防御：报告接口返回你的私有使用数据，绝不能允许跨站页面读取。
 */
import type { IncomingHttpHeaders } from "node:http";

export interface ApiTrustRequest {
  headers: IncomingHttpHeaders;
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
}

export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

/** 仅本机 + 同源标记（无跨站 Origin / Sec-Fetch-Site）的请求可以通过。 */
export function isTrustedApiRequest(request: ApiTrustRequest): boolean {
  const host = header(request.headers, "host");
  if (host === undefined) return false;
  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false;
  if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
  const origin = header(request.headers, "origin");
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}
