import { whaleDomain } from "./state.js";
import { registerApiRoutes } from "./api.js";
import { registerReportTools } from "./tools.js";
export const name = "whale-report-core";
export const inject = ["tools", "sessionQuery", "storageDomain"];
export function apply(ctx) {
    const sessionQuery = ctx.sessionQuery;
    const toolServices = { sessionQuery };
    registerReportTools(ctx, toolServices);
    ctx.inject(["storageDomain"], async (domainCtx) => {
        const facility = domainCtx.storageDomain;
        const domain = await facility.open(whaleDomain);
        ctx.effect(() => () => {
            void domain.close();
        });
        const apiServices = { sessionQuery, domain };
        // 两个历史服务名都试一次；只注册一遍（防止未来某快照同时提供两个名字）。
        let registered = false;
        const tryRegister = (serverCtx) => {
            if (registered)
                return;
            const server = (serverCtx.webServer ?? serverCtx.httpServer);
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