import { whaleDomain } from "./state.js";
import { registerApiRoutes, registerAssetRoutes } from "./api.js";
import { registerReportTools } from "./tools.js";
import { IngestEngine } from "./ingest.js";
import { ApplyService } from "./apply/service.js";
import { customPeriodKey } from "./period.js";
import { queryPeriod } from "./query-engine.js";
/** 直接构造 custom PeriodSpec（epoch ms 精确窗口；绕过字符串解析的 NaN 回退陷阱）。 */
function customSpec(from, to) {
    return { preset: "custom", from, to, queryId: customPeriodKey(from, to), label: "custom", rolling: false };
}
export const name = "whale-report-core";
export const inject = ["tools", "sessionQuery", "storageDomain"];
export function apply(ctx) {
    const sessionQuery = ctx.sessionQuery;
    // v0.6 Apply：settings seam 惰性注入（缺失 → 优雅降级 read-only，不阻塞插件树）。
    let settingsSeam = null;
    ctx.inject(["settings"], (settingsCtx) => {
        settingsSeam = settingsCtx.settings ?? null;
    });
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
        // v0.5.x repair：INGEST ONCE → QUERY MANY。
        const ingest = new IngestEngine({ sessionQuery, index: domain.table("session_index") });
        // v0.6 Apply：精确 [from,to) 窗口 stats 查询（verify 与 proposal 共用 Query Engine）。
        // 注意：直接构造 PeriodSpec —— 不能用 resolvePeriod 的字符串解析（Date.parse 对纯数字串返回 NaN，
        // 会静默回退到默认窗口，破坏 verify 的精确切点语义）。
        const queryStats = async (from, to) => {
            const meta = ingest.statusOf();
            const spec = customSpec(from, to);
            const { stats } = queryPeriod(domain.table("session_index"), spec, meta.headers, meta);
            return stats;
        };
        const applyService = new ApplyService({ domain, getSettings: () => settingsSeam, queryStats });
        // 官方增量 firehose（rc.2）：session/event 逐事件 → 只处理新增事件。
        ctx.effect(() => {
            const offEvent = ctx.on("session/event", (session, event) => {
                ingest.handleEvent(session.id, event);
            });
            const offCreated = ctx.on("session/created", (session) => {
                ingest.handleCreated(session.id, session.header.seedLength ?? 0);
            });
            const offDisposed = ctx.on("session/disposed", (session) => {
                void ingest.handleDisposed(session.id);
            });
            const offFlush = ctx.on("session/flush", (session) => {
                void ingest.flushSession(session.id);
            });
            return () => {
                offEvent();
                offCreated();
                offDisposed();
                offFlush();
            };
        });
        // 启动后台 ingest：索引建立期间不阻塞 UI（live 会话先挂缓冲再读基线，防丢事件）。
        setTimeout(() => {
            void ingest.bootstrap().catch(() => { });
            // v0.6 crash reconciliation（RFC §16）：PREPARED/MUTATING 恢复为 APPLIED/FAILED/CONFLICTED。
            void applyService.reconcile().catch(() => { });
        }, 3000);
        // 低频 fingerprint reconciliation（防御 firehose 之外的完整性兜底）。
        const reconcileTimer = setInterval(() => {
            void ingest.reconcile().catch(() => { });
            // live checkpoint（coalesced，≥5min 间隔；flush 只是 hint，这里兜底）
            void ingest.checkpoint(false).catch(() => { });
        }, 5 * 60_000);
        ctx.effect(() => () => {
            clearInterval(reconcileTimer);
            void ingest.dispose().catch(() => { });
        });
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
        // 同一对象挂 domain：loader 回调后续对 services.plugins 的赋值必须可见。
        const apiServices = Object.assign(services, { domain, ingest, apply: applyService });
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