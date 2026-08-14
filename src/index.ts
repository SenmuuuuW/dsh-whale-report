/**
 * 「鲸鱼记事本」插件入口 —— cordis 三件套。
 *
 * 宿主 half 的四个接缝：
 *   tools        —— whale_report 聊天工具（对话路径）
 *   sessionQuery —— 会话日志读取（数据源）
 *   storageDomain—— 报告历史持久化（whale 域）
 *   web 路由服务 —— /whale/api 面板数据通道（专属界面路径）
 *
 * ⚠️ web 路由服务名随快照漂移：npm 0.1.0-rc.6 提供 "webServer"，
 * 较新的 source 快照改名为 "httpServer"。因此它不进顶层 inject
 * （顶层 inject 缺失会让整个插件 pending → 插件树启动失败），
 * 而是用两个惰性 ctx.inject 兜底：哪个服务存在就用哪个。
 * 惰性注入在服务缺失时只是不执行回调，绝不会卡住启动。
 */
import type { Context } from "@deepseek-ai/cordis";
import type { DomainFacility } from "@deepseek-ai/dsh-storage-domain";
import { whaleDomain } from "./state.js";
import { registerApiRoutes, type ApiServices, type WebServerLike } from "./api.js";
import { registerReportTools, warmIndex, type ReportServices, type SessionQueryLike, type ToolsHost } from "./tools.js";

export const name = "whale-report-core";
export const inject = ["tools", "sessionQuery", "storageDomain"];

export function apply(ctx: Context) {
  const sessionQuery = (ctx as Context & { sessionQuery: unknown }).sessionQuery as SessionQueryLike;

  ctx.inject(["storageDomain"], async (domainCtx) => {
    const facility = (domainCtx as Context & { storageDomain: DomainFacility }).storageDomain;
    const domain = await facility.open(whaleDomain);
    ctx.effect(() => () => {
      void domain.close();
    });

    const services: ReportServices = {
      sessionQuery,
      index: domain.table("session_index"),
    };
    registerReportTools(ctx as unknown as ToolsHost, services);

    // 启动后台预热：索引建立期间不阻塞 UI，完成后生成报告秒级返回。
    setTimeout(() => {
      void warmIndex(services).catch(() => {});
    }, 3000);

    const apiServices: ApiServices = { sessionQuery, domain, index: services.index };

    // 两个历史服务名都试一次；只注册一遍（防止未来某快照同时提供两个名字）。
    // 关键：cordis 注入上下文是 Proxy，访问不存在的服务属性会直接抛异常
    // （而不是返回 undefined），所以必须先用 `in` 探测，绝不能 `??` 连读。
    let registered = false;
    const tryRegister = (serverCtx: Context & { webServer?: unknown; httpServer?: unknown }) => {
      if (registered) return;
      const has = (key: string) => key in (serverCtx as unknown as Record<string, unknown>);
      const server = (has("httpServer") ? serverCtx.httpServer : has("webServer") ? serverCtx.webServer : undefined) as
        | WebServerLike
        | undefined;
      if (server === undefined) return;
      registered = true;
      registerApiRoutes(ctx, server, apiServices);
    };
    ctx.inject(["webServer"], (c) => tryRegister(c as Context & { webServer?: unknown }));
    ctx.inject(["httpServer"], (c) => tryRegister(c as Context & { httpServer?: unknown }));
  });
}
