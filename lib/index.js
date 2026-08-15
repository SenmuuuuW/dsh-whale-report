import { whaleDomain } from "./state.js";
import { registerApiRoutes, registerAssetRoutes } from "./api.js";
import { registerReportTools, warmIndex } from "./tools.js";
export const name = "whale-report-core";
export const inject = ["tools", "sessionQuery", "storageDomain"];
export function apply(ctx) {
    const sessionQuery = ctx.sessionQuery;
    ctx.inject(["storageDomain"], async (domainCtx) => {
        const facility = domainCtx.storageDomain;
        const domain = await facility.open(whaleDomain);
        ctx.effect(() => () => {
            void domain.close();
        });
        const services = {
            sessionQuery,
            index: domain.table("session_index"),
            periodStats: domain.table("period_stats"),
        };
        // 插件环境：loader 枚举已加载第三方插件名（失败静默，降级为空列表）。
        // 注意：这是"环境清单"而非工具级归因——工具调用到插件的精确归属尚未实现。
        ctx.inject(["loader"], (loaderCtx) => {
            const loader = loaderCtx.loader;
            try {
                const raw = [...loader.entries()].map((e) => ({ id: e.options?.id, name: e.options?.name }));
                const names = raw
                    .map((e) => e.name ?? e.id ?? "")
                    .filter((n) => n !== "" && !n.startsWith("@deepseek-ai/") && !n.startsWith("cordis"));
                services.plugins = [...new Set(names)];
            }
            catch {
                services.plugins = [];
            }
        });
        registerReportTools(ctx, services);
        // 启动后台预热：索引建立期间不阻塞 UI，完成后生成报告秒级返回。
        setTimeout(() => {
            void warmIndex(services).catch(() => { });
        }, 3000);
        // 同一对象挂 domain：loader 回调后续对 services.plugins 的赋值必须可见。
        const apiServices = Object.assign(services, { domain });
        // 两个历史服务名都试一次；只注册一遍（防止未来某快照同时提供两个名字）。
        // 关键：cordis 注入上下文是 Proxy，访问不存在的服务属性会直接抛异常
        // （而不是返回 undefined），所以必须先用 `in` 探测，绝不能 `??` 连读。
        let registered = false;
        const tryRegister = (serverCtx) => {
            if (registered)
                return;
            const has = (key) => key in serverCtx;
            const server = (has("httpServer") ? serverCtx.httpServer : has("webServer") ? serverCtx.webServer : undefined);
            if (server === undefined)
                return;
            registered = true;
            registerApiRoutes(ctx, server, apiServices);
            registerAssetRoutes(ctx, server);
        };
        ctx.inject(["webServer"], (c) => tryRegister(c));
        ctx.inject(["httpServer"], (c) => tryRegister(c));
    });
}
//# sourceMappingURL=index.js.map