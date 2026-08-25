/**
 * 刷新韧性层：超时预算 + 竞态门（request gate）。
 *
 * 背景（v0.5.1 修复）：/whale/api/summary 在服务端冷生成时可长达 60–120s
 * （zstd 重放 + 损坏会话 salvage），客户端此前无超时、无 finally —— 一旦
 * fetch 迟迟不 resolve，loading 永久为 true，页面停留在「更新中…」+ 骨架屏。
 * 这里把所有请求管道的超时与竞态语义集中到一处，便于测试与复用。
 *
 * 预算（与产品约定一致）：
 *   - balance       15s（余额探针；失败绝不影响报告链路）
 *   - summary       60s（报告生成，冷启动可达分钟级）
 *   - report(get)   30s（历史报告读取，命中即毫秒级）
 *   - light         20s（trends / live-session / list / delete 等轻量接口）
 */
export declare const FETCH_TIMEOUT_MS: {
    readonly balance: 15000;
    readonly summary: 60000;
    readonly report: 30000;
    readonly light: 20000;
};
/** 带超时预算的 fetch：超时 → 以 AbortError 拒绝；支持外部 signal（竞态取消旧请求）。 */
export declare function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, extraSignal?: AbortSignal): Promise<Response>;
/** 是否中止错误（AbortError）。注意 Safari 的 DOMException 不继承 Error，需按 name 判定。 */
export declare function isAbortError(error: unknown): boolean;
/** 把 fetch 错误翻译成用户可读文案（超时与网络/HTTP 错误区分开）。 */
export declare function describeFetchError(error: unknown, timeoutMs: number): string;
/** 竞态门：只允许最新一次请求写入状态（周期快速切换 / 重复点击时旧响应作废）。 */
export interface RequestGate {
    /** 开始新请求，返回其序号。 */
    begin(): number;
    /** 该序号是否仍是最新请求。 */
    isLatest(seq: number): boolean;
}
export declare function createRequestGate(): RequestGate;
//# sourceMappingURL=refresh.d.ts.map