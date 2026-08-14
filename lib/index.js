import { registerReportTools } from "./tools.js";
export const name = "whale-report-core";
export const inject = ["tools", "sessionQuery"];
export function apply(ctx) {
    const services = {
        // 结构化断言：兼容不同快照里 sessionQuery 实现的类名差异。
        sessionQuery: ctx.sessionQuery,
    };
    registerReportTools(ctx, services);
}
//# sourceMappingURL=index.js.map