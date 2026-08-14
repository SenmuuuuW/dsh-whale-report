import { isTrustedApiRequest } from "./trust-fence.js";
import { aggregate } from "./stats.js";
import { renderReport, presetRange } from "./report.js";
const DAY_MS = 24 * 60 * 60 * 1000;
function writeJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
}
async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length === 0)
        return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch {
        throw new Error("请求体不是合法 JSON");
    }
}
function parseTime(value, fallback) {
    if (typeof value !== "string" || value === "")
        return fallback;
    const ms = Date.parse(value);
    if (Number.isNaN(ms))
        throw new Error(`无法解析时间：${String(value)}`);
    return ms;
}
/** 生成一份报告（与聊天工具同一引擎），并落库。 */
async function generateReport(svc, payload) {
    const preset = payload.preset ?? "weekly";
    if (!["daily", "weekly", "monthly", "yearly", "custom"].includes(preset)) {
        throw new Error(`未知预设：${String(preset)}`);
    }
    const now = Date.now();
    const range = preset === "custom"
        ? {
            from: parseTime(payload.from, now - 7 * DAY_MS),
            to: parseTime(payload.to, now),
        }
        : presetRange(preset, now);
    if (range.to <= range.from)
        throw new Error("时间区间无效：to 必须晚于 from");
    const { collectEvents } = await import("./tools.js");
    const { events, headers } = await collectEvents(svc, range);
    const stats = aggregate(events, range, headers);
    const markdown = renderReport(stats, preset);
    const record = {
        id: `whale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        preset,
        from: range.from,
        to: range.to,
        createdAt: now,
        sessions: stats.sessions,
        turns: stats.turns,
        totalEvents: stats.totalEvents,
        stats: stats,
        markdown,
    };
    await svc.domain.table("reports").put(record.id, record);
    return record;
}
/** 注册 /whale/api 路由（经 ctx.effect 挂载，卸载自动摘除）。 */
export function registerApiRoutes(ctx, svc) {
    const webServer = ctx.webServer;
    ctx.effect(() => webServer.register({
        kind: "prefix",
        path: "/whale/api",
        handler: async (req, res) => {
            if (!isTrustedApiRequest({ headers: req.headers })) {
                writeJson(res, 403, { ok: false, error: { code: "forbidden", message: "forbidden" } });
                return;
            }
            const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
            const method = pathname.startsWith("/whale/api/") ? pathname.slice("/whale/api/".length) : "";
            const table = svc.domain.table("reports");
            try {
                if (req.method === "GET" && method === "list") {
                    const items = [...table.entries()]
                        .map(([, record]) => ({
                        id: record.id,
                        preset: record.preset,
                        from: record.from,
                        to: record.to,
                        createdAt: record.createdAt,
                        sessions: record.sessions,
                        turns: record.turns,
                        totalEvents: record.totalEvents,
                    }))
                        .sort((a, b) => b.createdAt - a.createdAt);
                    writeJson(res, 200, { ok: true, reports: items });
                    return;
                }
                if (req.method === "GET" && method === "get") {
                    const url = new URL(req.url ?? "/", "http://dsh.internal");
                    const id = url.searchParams.get("id") ?? "";
                    const record = table.get(id);
                    if (!record) {
                        writeJson(res, 404, { ok: false, error: { code: "not-found", message: "报告不存在" } });
                        return;
                    }
                    writeJson(res, 200, { ok: true, report: record });
                    return;
                }
                if (req.method === "POST") {
                    const payload = (await readJsonBody(req));
                    if (method === "generate") {
                        const record = await generateReport(svc, payload);
                        writeJson(res, 200, { ok: true, report: record });
                        return;
                    }
                    if (method === "delete") {
                        const id = typeof payload.id === "string" ? payload.id : "";
                        const existed = await table.delete(id);
                        writeJson(res, existed ? 200 : 404, {
                            ok: existed,
                            error: existed ? undefined : { code: "not-found", message: "报告不存在" },
                        });
                        return;
                    }
                }
                writeJson(res, 404, { ok: false, error: { code: "not-found", message: `未知方法 ${method}` } });
            }
            catch (error) {
                writeJson(res, 400, {
                    ok: false,
                    error: { code: "bad-request", message: error instanceof Error ? error.message : String(error) },
                });
            }
        },
    }), "dsh-whale-report: /whale/api routes");
}
//# sourceMappingURL=api.js.map