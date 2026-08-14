/**
 * 「鲸鱼记事本」插件入口 —— cordis 三件套。
 *
 * 宿主 half 现在有四个接缝：
 *   tools        —— whale_report 聊天工具（对话路径）
 *   sessionQuery —— 会话日志读取（数据源）
 *   storageDomain—— 报告历史持久化（whale 域）
 *   webServer    —— /whale/api 面板数据通道（专属界面路径）
 * 浏览器 half（src/client）通过 package.json 的 dsh.client 声明注册，
 * 由官方 client-modules 接缝装载。
 */
import type { Context } from "@deepseek-ai/cordis";
import type { DomainFacility } from "@deepseek-ai/dsh-storage-domain";
import { whaleDomain } from "./state.js";
import { registerApiRoutes, type ApiServices } from "./api.js";
import { registerReportTools, type ReportServices, type SessionQueryLike, type ToolsHost } from "./tools.js";

export const name = "whale-report-core";
export const inject = ["tools", "sessionQuery", "storageDomain", "webServer"];

export function apply(ctx: Context) {
  const sessionQuery = (ctx as Context & { sessionQuery: unknown }).sessionQuery as SessionQueryLike;
  const toolServices: ReportServices = { sessionQuery };
  registerReportTools(ctx as unknown as ToolsHost, toolServices);

  ctx.inject(["storageDomain"], async (domainCtx) => {
    const facility = (domainCtx as Context & { storageDomain: DomainFacility }).storageDomain;
    const domain = await facility.open(whaleDomain);
    ctx.effect(() => () => {
      void domain.close();
    });
    registerApiRoutes(ctx, { sessionQuery, domain });
  });
}
