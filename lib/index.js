import { aggregate, presetRange, registerReportTools, renderReport } from "./tools-2Vcv7F5-.js";
import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";

//#region src/state.ts
const ReportRecordSchema = z.object({
	id: z.string().min(1),
	preset: z.string(),
	from: z.number(),
	to: z.number(),
	createdAt: z.number(),
	sessions: z.number().int().min(0),
	turns: z.number().int().min(0),
	totalEvents: z.number().int().min(0),
	stats: z.unknown(),
	markdown: z.string()
});
const whaleDomain = defineDomain({
	name: "whale",
	version: 1,
	tables: { reports: domainTable(ReportRecordSchema) }
});

//#endregion
//#region src/trust-fence.ts
function header(headers, name$1) {
	const value = headers[name$1];
	return typeof value === "string" ? value : void 0;
}
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** 仅本机 + 同源标记（无跨站 Origin / Sec-Fetch-Site）的请求可以通过。 */
function isTrustedApiRequest(request) {
	const host = header(request.headers, "host");
	if (host === void 0) return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (!isLoopbackHostname(hostUrl.hostname)) return false;
	if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}

//#endregion
//#region src/api.ts
const DAY_MS = 24 * 60 * 60 * 1e3;
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"content-length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
async function readJsonBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	if (chunks.length === 0) return {};
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new Error("请求体不是合法 JSON");
	}
}
function parseTime(value, fallback) {
	if (typeof value !== "string" || value === "") return fallback;
	const ms = Date.parse(value);
	if (Number.isNaN(ms)) throw new Error(`无法解析时间：${String(value)}`);
	return ms;
}
/** 生成一份报告（与聊天工具同一引擎），并落库。 */
async function generateReport(svc, payload) {
	const preset = payload.preset ?? "weekly";
	if (![
		"daily",
		"weekly",
		"monthly",
		"yearly",
		"custom"
	].includes(preset)) throw new Error(`未知预设：${String(preset)}`);
	const now = Date.now();
	const range = preset === "custom" ? {
		from: parseTime(payload.from, now - 7 * DAY_MS),
		to: parseTime(payload.to, now)
	} : presetRange(preset, now);
	if (range.to <= range.from) throw new Error("时间区间无效：to 必须晚于 from");
	const { collectEvents } = await import("./tools-DlR-8fTI.js");
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
		stats,
		markdown
	};
	await svc.domain.table("reports").put(record.id, record);
	return record;
}
/** 注册 /whale/api 路由（经 ctx.effect 挂载，卸载自动摘除）。 */
function registerApiRoutes(ctx, svc) {
	const webServer = ctx.webServer;
	ctx.effect(() => webServer.register({
		kind: "prefix",
		path: "/whale/api",
		handler: async (req, res) => {
			if (!isTrustedApiRequest({ headers: req.headers })) {
				writeJson(res, 403, {
					ok: false,
					error: {
						code: "forbidden",
						message: "forbidden"
					}
				});
				return;
			}
			const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
			const method = pathname.startsWith("/whale/api/") ? pathname.slice(11) : "";
			const table = svc.domain.table("reports");
			try {
				if (req.method === "GET" && method === "list") {
					const items = [...table.entries()].map(([, record]) => ({
						id: record.id,
						preset: record.preset,
						from: record.from,
						to: record.to,
						createdAt: record.createdAt,
						sessions: record.sessions,
						turns: record.turns,
						totalEvents: record.totalEvents
					})).sort((a, b) => b.createdAt - a.createdAt);
					writeJson(res, 200, {
						ok: true,
						reports: items
					});
					return;
				}
				if (req.method === "GET" && method === "get") {
					const url = new URL(req.url ?? "/", "http://dsh.internal");
					const id = url.searchParams.get("id") ?? "";
					const record = table.get(id);
					if (!record) {
						writeJson(res, 404, {
							ok: false,
							error: {
								code: "not-found",
								message: "报告不存在"
							}
						});
						return;
					}
					writeJson(res, 200, {
						ok: true,
						report: record
					});
					return;
				}
				if (req.method === "POST") {
					const payload = await readJsonBody(req);
					if (method === "generate") {
						const record = await generateReport(svc, payload);
						writeJson(res, 200, {
							ok: true,
							report: record
						});
						return;
					}
					if (method === "delete") {
						const id = typeof payload.id === "string" ? payload.id : "";
						const existed = await table.delete(id);
						writeJson(res, existed ? 200 : 404, {
							ok: existed,
							error: existed ? void 0 : {
								code: "not-found",
								message: "报告不存在"
							}
						});
						return;
					}
				}
				writeJson(res, 404, {
					ok: false,
					error: {
						code: "not-found",
						message: `未知方法 ${method}`
					}
				});
			} catch (error) {
				writeJson(res, 400, {
					ok: false,
					error: {
						code: "bad-request",
						message: error instanceof Error ? error.message : String(error)
					}
				});
			}
		}
	}), "dsh-whale-report: /whale/api routes");
}

//#endregion
//#region src/index.ts
const name = "whale-report-core";
const inject = [
	"tools",
	"sessionQuery",
	"storageDomain",
	"webServer"
];
function apply(ctx) {
	const sessionQuery = ctx.sessionQuery;
	const toolServices = { sessionQuery };
	registerReportTools(ctx, toolServices);
	ctx.inject(["storageDomain"], async (domainCtx) => {
		const facility = domainCtx.storageDomain;
		const domain = await facility.open(whaleDomain);
		ctx.effect(() => () => {
			domain.close();
		});
		registerApiRoutes(ctx, {
			sessionQuery,
			domain
		});
	});
}

//#endregion
export { apply, inject, name };