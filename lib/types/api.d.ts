/**
 * 宿主 API 层：/whale/api —— 面板的数据通道。
 *
 * 方法（POST JSON，或 GET 查询）：
 *   report.generate {preset, from?, to?} → 生成并保存，返回完整报告
 *   report.list    → 历史摘要列表（新到旧）
 *   report.get     {id} → 单份完整报告
 *   report.delete  {id} → 删除
 *
 * 全部经过信任围栏（仅本机同源）。这是面板（client half）与
 * 聊天工具（whale_report）共享同一引擎的第二个消费端。
 */
import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Domain } from "@deepseek-ai/dsh-storage-domain";
import { whaleDomain } from "./state.js";
import type { ReportServices } from "./tools.js";
export interface WebServerLike {
    register(route: {
        kind: "prefix";
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
    }): () => void;
}
export interface ApiServices extends ReportServices {
    domain: Domain<typeof whaleDomain>;
}
/** 注册 /whale/api 路由（经 ctx.effect 挂载，卸载自动摘除）。 */
export declare function registerApiRoutes(ctx: Context, server: WebServerLike, svc: ApiServices): void;
//# sourceMappingURL=api.d.ts.map