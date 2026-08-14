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
import { aggregate, type RawEvent, type RawSessionHeader } from "./stats.js";
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
    { header: { id: string; createdAt: number; cwd?: string; delegationDepth?: number } }[]
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

export interface ReportServices {
  sessionQuery: SessionQueryLike;
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

/** 从会话查询服务收集区间内的所有事件（宽容模式：单会话失败不阻塞整体）。 */
export async function collectEvents(
  svc: ReportServices,
  period: { from: number; to: number },
): Promise<{ events: RawEvent[]; headers: RawSessionHeader[] }> {
  const sessions = await svc.sessionQuery.listSessions();
  const headers: RawSessionHeader[] = sessions.map((record) => ({
    id: record.header.id,
    createdAt: record.header.createdAt,
    cwd: record.header.cwd,
    delegationDepth: record.header.delegationDepth,
  }));

  const events: RawEvent[] = [];
  let failed = 0;
  // 关键：readSession 返回"完整逻辑日志"，其中子代理/续聊会话的前缀是
  // 继承自父会话的种子事件（seed，seq < header.seedLength）。若不去重，
  // 一个父会话的事件会被它的每个后代重复计数（实测放大了 50 倍）。
  // 正解：只统计每个会话"自己的"事件（seedLength 之后的），
  // 这样每个事件恰好在其属主会话被计一次。
  for (const record of sessions) {
    try {
      const snapshot = await svc.sessionQuery.readSession(record.header.id);
      const ownStart = snapshot.session.seedLength ?? 0;
      for (const event of snapshot.events) {
        if (event.seq < ownStart) continue;
        if (event.time < period.from || event.time >= period.to) continue;
        events.push({
          type: event.type,
          time: event.time,
          data: { ...(event.data as Record<string, unknown>), sessionId: snapshot.session.id },
        });
      }
    } catch {
      failed += 1;
    }
  }
  return { events, headers };
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

      const { events, headers } = await collectEvents(svc, range);
      const stats = aggregate(events, range, headers);
      const report = renderReport(stats, preset);

      // 报告本身也写进会话日志 —— 鲸鱼记事本记下它自己写的账。
      // （读与写同源：下次报告会数到这一次。）
      if (exec.agent) {
        exec.agent.session.append("whale/report", {
          preset,
          from: range.from,
          to: range.to,
          sessions: stats.sessions,
          turns: stats.turns,
          totalEvents: stats.totalEvents,
        });
      }

      return {
        preset,
        label: PRESET_LABELS[preset],
        from: new Date(range.from).toISOString(),
        to: new Date(range.to).toISOString(),
        sessions: stats.sessions,
        turns: stats.turns,
        totalEvents: stats.totalEvents,
        report,
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
