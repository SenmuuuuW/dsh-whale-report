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
export declare function isLoopbackHostname(hostname: string): boolean;
/** 仅本机 + 同源标记（无跨站 Origin / Sec-Fetch-Site）的请求可以通过。 */
export declare function isTrustedApiRequest(request: ApiTrustRequest): boolean;
//# sourceMappingURL=trust-fence.d.ts.map