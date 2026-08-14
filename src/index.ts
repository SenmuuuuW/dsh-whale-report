/**
 * 「鲸鱼记事本」插件入口 —— cordis 三件套。
 *
 * 与 dsh-study 一样的骨架，但依赖的是另一个官方接缝：
 *   sessionQuery —— 会话查询服务（列表 + 完整日志读取）。
 * 默认 web profile 已挂载（dsh-session-query + sqlite 后端），
 * 所以 bundle patch 里除了插入自己，什么都不用带。
 */
import type { Context } from "@deepseek-ai/cordis";
import { registerReportTools, type ReportServices, type SessionQueryLike, type ToolsHost } from "./tools.js";

export const name = "whale-report-core";
export const inject = ["tools", "sessionQuery"];

export function apply(ctx: Context) {
  const services: ReportServices = {
    // 结构化断言：兼容不同快照里 sessionQuery 实现的类名差异。
    sessionQuery: (ctx as Context & { sessionQuery: unknown }).sessionQuery as SessionQueryLike,
  };
  registerReportTools(ctx as unknown as ToolsHost, services);
}
