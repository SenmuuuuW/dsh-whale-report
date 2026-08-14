import { whaleDomain } from "./state.js";
import { registerApiRoutes } from "./api.js";
import { registerReportTools } from "./tools.js";
export const name = "whale-report-core";
export const inject = ["tools", "sessionQuery", "storageDomain", "webServer"];
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
        registerApiRoutes(ctx, { sessionQuery, domain });
    });
}
//# sourceMappingURL=index.js.map