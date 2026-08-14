import { whaleDomain } from "./state.js";
import { registerApiRoutes } from "./api.js";
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
            settings: domain.table("settings"),
        };
        registerReportTools(ctx, services);
        // 启动后台预热：索引建立期间不阻塞 UI，完成后生成报告秒级返回。
        setTimeout(() => {
            void warmIndex(services).catch(() => { });
        }, 3000);
        const apiServices = { domain, ...services };
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
        };
        ctx.inject(["webServer"], (c) => tryRegister(c));
        ctx.inject(["httpServer"], (c) => tryRegister(c));
    });
}
//# sourceMappingURL=index.js.map