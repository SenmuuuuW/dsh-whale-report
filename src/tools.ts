/**
 * 工具层：whale_report —— 立即生成任意区间的鲸鱼报告。
 *
 * 数据来源是官方的会话查询服务（ctx.sessionQuery）：
 *   listSessions() → 全部会话头
 *   readSession(id) → 单会话完整事件日志（含 data 载荷）
 * 引擎只读，不写回任何会话数据。
 */
import { defineTool, type ToolDefinition, type ToolRunContext } from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-session";
import type { SessionIndexRecord, PeriodStatsRecord, SettingsRecord } from "./state.js";
import { computeCost, type CostBreakdown } from "./pricing.js";
import { computeInsights, periodKey, previousPeriodKey, cacheHitRate, nightRatio, type Insight } from "./insights.js";
import { aggregateBuckets, bucketizeOwnEvents, type RawEvent, type RawSessionHeader, type ReportStats, type SessionBucketView } from "./stats.js";
import { renderReport, presetRange, PRESET_LABELS, type ReportPreset } from "./report.js";

/**
 * 结构化类型：只依赖 sessionQuery 的行为面，不依赖具体类名。
 *
 * 为什么不用官方导出的类（SessionQueryEngine / SessionQueryService）：
 * DSH 处于 developer preview，同一个接缝在不同快照里改了类名
 * （npm 0.1.0-rc.6 是 SessionQueryEngine，source 快照是 SessionQueryService）。
 * 我们只用它的两个方法，结构兼容 = 两个快照都能编译、都能跑。
 */
export interface SessionQueryLike {
  listSessions(signal?: AbortSignal): Promise<
    { header: { id: string; createdAt: number; cwd?: string; delegationDepth?: number }; live: boolean }[]
  >;
  readSession(sessionId: string): Promise<{
    session: { id: string; seedLength?: number };
    events: { type: string; seq: number; time: number; data: unknown }[];
  }>;
}

/** 报告事件写回会话日志（声明合并进官方事件表）。 */
export interface WhaleReportEvent {
  preset: string;
  from: number;
  to: number;
  sessions: number;
  turns: number;
  totalEvents: number;
}

declare module "@deepseek-ai/dsh-session/types" {
  interface SessionEventMap {
    "whale/report": WhaleReportEvent;
  }
}

/** 会话索引表（whale 存储域 sessionIndex 的最小结构视图）。 */
export interface IndexTable {
  get(key: string): SessionIndexRecord | undefined;
  put(key: string, value: SessionIndexRecord): Promise<void>;
}

export interface ReportServices {
  sessionQuery: SessionQueryLike;
  index: IndexTable;
  periodStats?: {
    get(key: string): PeriodStatsRecord | undefined;
    put(key: string, value: PeriodStatsRecord): Promise<void>;
  };
  settings?: {
    get(key: string): SettingsRecord | undefined;
    put(key: string, value: SettingsRecord): Promise<void>;
  };
}

export interface ToolsHost {
  tools: { register(definition: ToolDefinition): unknown };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseTime(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`无法解析时间：${value}（请用 ISO 格式，如 2026-08-14）`);
  }
  return ms;
}

/** 有限并发映射：报告生成要读几十个会话的完整日志，串行太慢。 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 索引新鲜度窗口：窗口内的持久化会话索引直接复用，过期才重读完整日志。 */
export const INDEX_TTL_MS = 10 * 60 * 1000;
/** 索引结构版本：结构变更（如新增 modelUsage）时递增，旧记录自然失效重建。 */
export const INDEX_VERSION = 6;

/**
 * 收集区间统计。两条数据路径：
 * - live 会话：readSession 走内存快照，直接分桶；
 * - 持久化会话：优先读 whale 域的会话索引（10 分钟新鲜度窗口），
 *   过期才读完整日志（zstd 解压重放，实测 60s+）并回写索引。
 * 返回与 aggregate(events, …) 等价的 ReportStats。
 */
export async function collectEvents(
  svc: ReportServices,
  period: { from: number; to: number },
): Promise<ReportStats> {
  const sessions = await svc.sessionQuery.listSessions();
  const headers: RawSessionHeader[] = sessions.map((record) => ({
    id: record.header.id,
    createdAt: record.header.createdAt,
    cwd: record.header.cwd,
    delegationDepth: record.header.delegationDepth,
  }));

  const candidates = sessions.filter((record) => record.header.createdAt < period.to);
  const views: SessionBucketView[] = [];
  let failed = 0;

  await mapWithConcurrency(candidates, 12, async (record) => {
    const now = Date.now();
    // 持久化会话：索引新鲜直接复用
    if (!record.live) {
      const cached = svc.index.get(record.header.id);
      if (cached !== undefined && cached.v === INDEX_VERSION && now - cached.builtAt < INDEX_TTL_MS) {
        views.push({
          sessionId: cached.sessionId,
          buckets: cached.buckets as SessionBucketView["buckets"],
          titles: cached.titles,
        });
        return;
      }
    }
    try {
      const snapshot = await svc.sessionQuery.readSession(record.header.id);
      const built = bucketizeOwnEvents(
        snapshot.session.id,
        snapshot.events,
        snapshot.session.seedLength ?? 0,
        period.to,
      );
      views.push({ sessionId: snapshot.session.id, buckets: built.buckets, titles: built.titles });
      if (!record.live) {
        await svc.index.put(record.header.id, {
          sessionId: snapshot.session.id,
          v: INDEX_VERSION,
          builtAt: now,
          lastSeq: built.lastSeq,
          lastMs: built.lastMs,
          buckets: built.buckets,
          titles: built.titles,
        });
      }
    } catch {
      failed += 1;
    }
  });

  return aggregateBuckets(views, period, headers);
}

/**
 * 后台预热：为所有持久化会话预建索引（无时间上限）。
 * 首次生成报告的 50s 成本移到启动后的一次性后台任务里，
 * 之后的每次生成都命中索引（实测 0.1-0.3s）。
 */
export async function warmIndex(svc: ReportServices): Promise<void> {
  const sessions = await svc.sessionQuery.listSessions();
  const toBuild = sessions.filter((record) => !record.live && svc.index.get(record.header.id) === undefined);
  await mapWithConcurrency(toBuild, 4, async (record) => {
    try {
      const snapshot = await svc.sessionQuery.readSession(record.header.id);
      const built = bucketizeOwnEvents(snapshot.session.id, snapshot.events, snapshot.session.seedLength ?? 0);
      await svc.index.put(record.header.id, {
        sessionId: snapshot.session.id,
        v: INDEX_VERSION,
        builtAt: Date.now(),
        lastSeq: built.lastSeq,
        lastMs: built.lastMs,
        buckets: built.buckets,
        titles: built.titles,
      });
    } catch {
      // 单会话失败不影响预热整体
    }
  });
}

/** 一次完整生成：统计 + 费用 + 基线对比 + 洞察。工具与 API 共用同一管线。 */
export interface ReportGeneration {
  stats: ReturnType<typeof collectEvents> extends Promise<infer S> ? S : never;
  cost: CostBreakdown;
  key: string;
  prev: PeriodStatsRecord | null;
  insights: Insight[];
  budgetWeeklyCny?: number;
}

export async function generateReportData(
  svc: ReportServices,
  preset: string,
  range: { from: number; to: number },
): Promise<ReportGeneration> {
  const stats = await collectEvents(svc, range);
  const cost = await computeCost(stats.models);
  const key = periodKey(preset, range.to);
  const prevKey = previousPeriodKey(preset, range.to);
  const prev = svc.periodStats?.get(prevKey) ?? null;
  const budgetWeeklyCny = svc.settings?.get("user")?.budgetWeeklyCny;
  const insights = computeInsights({ stats, prev: prev ?? undefined, cost, budgetWeeklyCny });
  return { stats, cost, key, prev, insights, budgetWeeklyCny };
}

export function toPeriodRecord(
  key: string,
  preset: string,
  range: { from: number; to: number },
  gen: ReportGeneration,
): PeriodStatsRecord {
  const s = gen.stats;
  return {
    key,
    preset,
    from: range.from,
    to: range.to,
    createdAt: Date.now(),
    sessions: s.sessions,
    turns: s.turns,
    toolCallsTotal: s.toolCallsTotal,
    commands: s.commands,
    toolErrors: s.toolErrors,
    totalEvents: s.totalEvents,
    tokens: { ...s.tokens },
    cost: gen.cost.total,
    nightRatio: nightRatio(s),
    cacheHitRate: cacheHitRate(s),
    dangerCount: s.dangerousCommands.length,
    redDanger: s.dangerousCommands.filter((d) => d.sev === "red").length,
    retryBursts: s.retryBursts,
    activeDays: s.activeDays,
  };
}

export function registerReportTools(ctx: ToolsHost, svc: ReportServices): void {
  ctx.tools.register(whaleReportTool(svc));
}

function whaleReportTool(svc: ReportServices): ToolDefinition {
  return defineTool({
    name: "whale_report",
    description:
      "Generate a DeepTrace report (深迹 日报/周报/月报/年报) from the user's session event history over any time range. " +
      "Presets: daily (last 1 day), weekly (7 days), monthly (30 days), yearly (365 days), or custom with explicit from/to dates. " +
      "The report is read-only and covers: activity volume, token burn, work-hours profile, dangerous commands, and session titles. " +
      "Call this when the user asks for a report of their agent usage ('给我一份周报', '这个月我干了啥', '年报'). " +
      "After receiving the result, present the markdown report to the user with light commentary — do not fabricate numbers.",
    parameters: {
      preset: {
        type: "string",
        required: true,
        enum: ["daily", "weekly", "monthly", "yearly", "custom"],
        description: "Report period preset. Use custom for arbitrary ranges.",
      },
      from: {
        type: "string",
        description: "Start time in ISO format (e.g. 2026-08-01). Required when preset is custom.",
      },
      to: {
        type: "string",
        description: "End time in ISO format (e.g. 2026-08-14). Required when preset is custom. Defaults to now.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          preset: { type: "string", required: true },
          label: { type: "string", required: true },
          from: { type: "string", required: true },
          to: { type: "string", required: true },
          sessions: { type: "integer", required: true },
          turns: { type: "integer", required: true },
          totalEvents: { type: "integer", required: true },
          report: { type: "string", required: true },
        },
      },
      render: (_args, value) => [
        {
          type: "text",
          text: (value as { report: string }).report,
        },
      ],
    },
    execute: async (args, exec) => {
      const { preset, from, to } = args as {
        preset: ReportPreset;
        from?: string;
        to?: string;
      };
      const now = Date.now();
      const range =
        preset === "custom"
          ? { from: parseTime(from, now - 7 * DAY_MS), to: parseTime(to, now) }
          : presetRange(preset, now);
      if (range.to <= range.from) {
        throw new Error("时间区间无效：to 必须晚于 from");
      }

      const gen = await generateReportData(svc, preset, range);
      if (svc.periodStats !== undefined) {
        await svc.periodStats.put(gen.key, toPeriodRecord(gen.key, preset, range, gen));
      }
      const report = renderReport(gen.stats, preset, gen.cost, gen.prev, gen.insights);

      // 报告本身也写进会话日志 —— 鲸鱼记事本记下它自己写的账。
      // （读与写同源：下次报告会数到这一次。）
      if (exec.agent) {
        exec.agent.session.append("whale/report", {
          preset,
          from: range.from,
          to: range.to,
          sessions: gen.stats.sessions,
          turns: gen.stats.turns,
          totalEvents: gen.stats.totalEvents,
        });
      }

      return {
        preset,
        label: PRESET_LABELS[preset],
        from: new Date(range.from).toISOString(),
        to: new Date(range.to).toISOString(),
        sessions: gen.stats.sessions,
        turns: gen.stats.turns,
        totalEvents: gen.stats.totalEvents,
        report,
        cost: { perModel: gen.cost.perModel, total: gen.cost.total, currency: gen.cost.currency, source: gen.cost.source },
        insights: gen.insights,
        prevCost: gen.prev?.cost ?? null,
      };
    },
    presentCall: (args) => ({
      card: "generic",
      title: `生成深迹${PRESET_LABELS[(args as { preset: ReportPreset }).preset] ?? "报告"}`,
      kind: "other",
      rawInput: args,
    }),
  });
}
