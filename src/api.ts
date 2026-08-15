/**
 * 宿主 API 层：/whale/api —— 面板的数据通道。
 *
 * 方法（POST JSON，或 GET 查询）：
 *   report.generate {preset, from?, to?} → 生成并保存，返回完整报告
 *   report.list    → 历史摘要列表（新到旧）
 *   report.get     {id} → 单份完整报告
 *   report.delete  {id} → 删除
 *
 * 全部经过信任围栏（仅本机同源）。这是面板（client half）与
 * 聊天工具（whale_report）共享同一引擎的第二个消费端。
 */
import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Domain } from "@deepseek-ai/dsh-storage-domain";
import { isTrustedApiRequest } from "./trust-fence.js";
import { REPORT_SEM, whaleDomain, type ReportRecord } from "./state.js";

/** summary 概览新鲜度：同周期报告超过此窗口即重新计算（原地更新，不删历史）。 */
const SUMMARY_FRESHNESS_MS = 5 * 60 * 1000;
import type { ReportStats } from "./stats.js";
import { renderReport, presetRange, type ReportPreset } from "./report.js";
import { renderHtmlReport } from "./html.js";
import { periodKey } from "./insights.js";
import { computeCost } from "./pricing.js";
import { generateReportData, toPeriodRecord, type ReportServices } from "./tools.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WebServerLike {
  register(route: {
    kind: "prefix";
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
  }): () => void;
}

export interface ApiServices extends ReportServices {
  domain: Domain<typeof whaleDomain>;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

function parseTime(value: unknown, fallback: number): number {
  if (typeof value !== "string" || value === "") return fallback;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`无法解析时间：${String(value)}`);
  return ms;
}

/** 生成一份报告（与聊天工具同一引擎），并落库。 */
async function generateReport(
  svc: ApiServices,
  payload: { preset?: unknown; from?: unknown; to?: unknown },
): Promise<ReportRecord> {
  const preset = (payload.preset as ReportPreset) ?? "weekly";
  if (!["daily", "24h", "weekly", "monthly", "yearly", "custom"].includes(preset)) {
    throw new Error(`未知预设：${String(preset)}`);
  }
  const now = Date.now();
  const range =
    preset === "custom"
      ? {
          from: parseTime(payload.from, now - 7 * DAY_MS),
          to: parseTime(payload.to, now),
        }
      : presetRange(preset, now);
  if (range.to <= range.from) throw new Error("时间区间无效：to 必须晚于 from");

  const gen = await generateReportData(svc, preset, range);
  await svc.periodStats!.put(gen.key, toPeriodRecord(gen.key, preset, range, gen));
  const stats = gen.stats;
  const cost = gen.cost;
  const markdown = renderReport(stats, preset, cost, gen.prev, gen.insights);

  const record: ReportRecord = {
    sem: REPORT_SEM,
    id: `whale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    preset,
    from: range.from,
    to: range.to,
    createdAt: now,
    sessions: stats.sessions,
    turns: stats.turns,
    totalEvents: stats.totalEvents,
    stats: stats as unknown,
    markdown,
    cost,
    insights: gen.insights,
    prev: gen.prev
      ? {
          key: gen.prev.key,
          cost: gen.prev.cost,
          sessions: gen.prev.sessions,
          turns: gen.prev.turns,
          tokens: gen.prev.tokens,
          cacheHitRate: gen.prev.cacheHitRate,
          nightRatio: gen.prev.nightRatio,
          dangerCount: gen.prev.dangerCount,
        }
      : undefined,
  };
  await svc.domain.table("reports").put(record.id, record);
  return record;
}

/** 注册 /whale/api 路由（经 ctx.effect 挂载，卸载自动摘除）。 */
export function registerApiRoutes(ctx: Context, server: WebServerLike, svc: ApiServices): void {
  ctx.effect(
    () =>
      server.register({
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
            if (req.method === "GET" && method === "html") {
              // 独立可打印 HTML 页（面板"导出 PDF"用；浏览器打印 → 另存为 PDF）
              const url = new URL(req.url ?? "/", "http://dsh.internal");
              const id = url.searchParams.get("id") ?? "";
              const record = table.get(id);
              if (!record) {
                writeJson(res, 404, { ok: false, error: { code: "not-found", message: "报告不存在" } });
                return;
              }
              const html = renderHtmlReport(record);
              res.writeHead(200, {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
                "content-length": Buffer.byteLength(html),
              });
              res.end(html);
              return;
            }
            if (req.method === "POST" && method === "summary") {
              // 仪表盘数据：当前周期已有报告则复用，否则现场生成并落库。
              const payload = (await readJsonBody(req)) as { preset?: unknown; from?: unknown; to?: unknown };
              const preset = (payload.preset as ReportPreset) ?? "weekly";
              const now = Date.now();
              const range =
                preset === "custom"
                  ? { from: parseTime(payload.from, now - 7 * DAY_MS), to: parseTime(payload.to, now) }
                  : presetRange(preset, now);
              // 自定义区间每次重新生成（key 语义与周期预设不同，不复用）。
              if (preset === "custom") {
                const gen = await generateReportData(svc, preset, range);
                await svc.periodStats!.put(gen.key, toPeriodRecord(gen.key, preset, range, gen));
                const record: ReportRecord = {
                  sem: REPORT_SEM,
                  id: `whale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                  preset,
                  from: range.from,
                  to: range.to,
                  createdAt: now,
                  sessions: gen.stats.sessions,
                  turns: gen.stats.turns,
                  totalEvents: gen.stats.totalEvents,
                  stats: gen.stats as unknown,
                  markdown: renderReport(gen.stats, preset, gen.cost, gen.prev, gen.insights),
                  cost: gen.cost,
                  insights: gen.insights,
                  prev: gen.prev
                    ? { key: gen.prev.key, cost: gen.prev.cost, sessions: gen.prev.sessions, turns: gen.prev.turns, cacheHitRate: gen.prev.cacheHitRate, nightRatio: gen.prev.nightRatio, dangerCount: gen.prev.dangerCount }
                    : undefined,
                };
                await table.put(record.id, record);
                writeJson(res, 200, { ok: true, fresh: true, report: record });
                return;
              }
              const key = periodKey(preset, range.to);
              // 复用条件：周期匹配 + 语义版本匹配 + 含 cost + 在新鲜度窗口内
              // （超过 5 分钟视为过期：本周进行中，新会话要能反映出来）。
              let found: ReportRecord | undefined;
              for (const [, record] of table.entries()) {
                if (
                  record.preset === preset &&
                  record.sem === REPORT_SEM &&
                  record.cost !== undefined &&
                  periodKey(record.preset, record.to) === key &&
                  (found === undefined || record.createdAt > found.createdAt)
                ) {
                  found = record;
                }
              }
              if (found !== undefined && now - found.createdAt < SUMMARY_FRESHNESS_MS) {
                writeJson(res, 200, { ok: true, fresh: false, report: found });
                return;
              }
              const gen = await generateReportData(svc, preset, range);
              await svc.periodStats!.put(gen.key, toPeriodRecord(gen.key, preset, range, gen));
              const record: ReportRecord = {
                sem: REPORT_SEM,
                id: found !== undefined ? found.id : `whale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                preset,
                from: range.from,
                to: range.to,
                createdAt: now,
                sessions: gen.stats.sessions,
                turns: gen.stats.turns,
                totalEvents: gen.stats.totalEvents,
                stats: gen.stats as unknown,
                markdown: renderReport(gen.stats, preset, gen.cost, gen.prev, gen.insights),
                cost: gen.cost,
                insights: gen.insights,
                prev: gen.prev
                  ? { key: gen.prev.key, cost: gen.prev.cost, sessions: gen.prev.sessions, turns: gen.prev.turns, cacheHitRate: gen.prev.cacheHitRate, nightRatio: gen.prev.nightRatio, dangerCount: gen.prev.dangerCount }
                  : undefined,
              };
              await table.put(record.id, record);
              writeJson(res, 200, { ok: true, fresh: true, report: record });
              return;
            }
            if (req.method === "POST") {
              const payload = (await readJsonBody(req)) as Record<string, unknown>;
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
          } catch (error) {
            writeJson(res, 400, {
              ok: false,
              error: { code: "bad-request", message: error instanceof Error ? error.message : String(error) },
            });
          }
        },
      }),
    "dsh-whale-report: /whale/api routes",
  );
}
