/**
 * 洞察引擎：确定性规则把统计变成"可行动的卡片"。
 *
 * 设计原则：
 * 1. 不用 LLM —— 规则是纯函数，可测试、可复算、可对质；
 * 2. 每条洞察 = 发生了什么（数据）→ 建议怎么做（行动）→ 量化参考（诚实估算）；
 * 3. 阈值宁可保守：只有真实信号才触发，避免"狼来了"毁掉可信度。
 */
import type { ReportStats } from "./stats.js";
import type { PeriodStatsRecord } from "./state.js";
import type { CostBreakdown } from "./pricing.js";

export type InsightLevel = "info" | "tip" | "warning" | "critical";

export interface Insight {
  id: string;
  level: InsightLevel;
  title: string;
  detail: string;
  action: string;
  /** 量化收益（参考口径，明确标注估算）。 */
  estimate?: string;
}

export interface InsightInput {
  stats: ReportStats;
  prev?: PeriodStatsRecord;
  cost?: CostBreakdown;
}

/** 缓存命中率：缓存命中占输入+命中的比例。 */
export function cacheHitRate(stats: ReportStats): number {
  const input = stats.tokens.input;
  const cache = stats.tokens.cacheRead;
  if (input + cache === 0) return 0;
  return Math.round((cache / (input + cache)) * 1000) / 10;
}

/** 凌晨（0-6 点）事件占比。 */
export function nightRatio(stats: ReportStats): number {
  if (stats.totalEvents === 0) return 0;
  const night = stats.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0);
  return Math.round((night / stats.totalEvents) * 1000) / 10;
}

/** 费用涨跌（相对上一周期），百分比。prev 缺失时返回 null。 */
export function costDeltaPct(input: InsightInput): number | null {
  if (input.prev === undefined || input.cost === undefined || input.prev.cost <= 0) return null;
  return Math.round(((input.cost.total - input.prev.cost) / input.prev.cost) * 100);
}

const RED_LABELS = ["删除根目录/家目录", "删库", "关机/重启", "格式化磁盘", "dd 写设备", "fork 炸弹"];

export function computeInsights(input: InsightInput): Insight[] {
  const { stats, prev, cost } = input;
  const insights: Insight[] = [];
  const totalCost = cost?.total ?? 0;
  const night = nightRatio(stats);
  const hitRate = cacheHitRate(stats);
  const redDanger = stats.dangerousCommands.filter((d) => d.sev === "red").length;
  const amberDanger = stats.dangerousCommands.filter((d) => d.sev === "amber").length;

  // ── 1. 深夜消耗 ──
  if (night >= 15 && totalCost >= 3) {
    const nightCost = totalCost * (night / 100);
    insights.push({
      id: "night-cost",
      level: night >= 30 ? "warning" : "tip",
      title: `深夜时段消耗 ¥${nightCost.toFixed(1)}（占 ${night}%）`,
      detail: `凌晨 0-6 点事件占比 ${night}%。深夜多为无人值守任务。`,
      action: "深夜的长任务加超时控制。",
      estimate: `一半深夜任务移到白天，约省 ¥${(nightCost * 0.5).toFixed(1)}/周期（估算）。`,
    });
  }

  // ── 2. 重试风暴 ──
  if (stats.retryBursts >= 3) {
    const repeatedShare = Math.min(100, Math.round(((stats.retryBursts * 3) / Math.max(1, stats.commands)) * 100));
    insights.push({
      id: "retry-storm",
      level: stats.retryBursts >= 10 ? "warning" : "tip",
      title: `检测到 ${stats.retryBursts} 次重试风暴`,
      detail: `同一命令连续重复 ≥3 次，共 ${stats.retryBursts} 次，占总命令约 ${repeatedShare}%。`,
      action: "检查失败命令的前置条件（路径/依赖/权限）。",
      estimate: `重复执行约 ¥${(totalCost * (repeatedShare / 100)).toFixed(1)}/周期（估算）。`,
    });
  }

  // ── 3. 缓存命中率 ──
  if (prev !== undefined && hitRate < 75 && prev.cacheHitRate - hitRate >= 5) {
    insights.push({
      id: "cache-drop",
      level: "warning",
      title: `缓存命中率下降 ${(prev.cacheHitRate - hitRate).toFixed(1)}pt`,
      detail: `命中率 ${hitRate}%，上周期 ${prev.cacheHitRate}%。`,
      action: "减少会话重启；改 AGENTS.md/系统提示词会清缓存。",
      estimate: `命中率每提升 10pt 约省 ¥${(totalCost * 0.1).toFixed(1)}/周期（估算）。`,
    });
  } else if (hitRate >= 85 && totalCost > 0) {
    insights.push({
      id: "cache-good",
      level: "info",
      title: `缓存命中率 ${hitRate}%`,
      detail: "无行动项。",
      action: "无行动项。",
    });
  }

  // ── 4. 危险操作红色警报 ──
  if (redDanger > 0) {
    insights.push({
      id: "danger-red",
      level: "critical",
      title: `${redDanger} 条致命级操作`,
      detail: `包括：${RED_LABELS.filter((l) => stats.dangerousCommands.some((d) => d.label === l)).join("、")}。`,
      action: "审批设置里对这些模式加二次确认。",
    });
  } else if (amberDanger > 0) {
    insights.push({
      id: "danger-amber",
      level: "tip",
      title: `${amberDanger} 条需留意操作`,
      detail: "均为常规开发操作。",
      action: "可忽略。",
    });
  }

  // ── 6. 会话碎片化 ──
  const avgTurns = stats.sessions > 0 ? stats.turns / stats.sessions : 0;
  if (stats.sessions >= 5 && avgTurns < 2) {
    insights.push({
      id: "session-fragmentation",
      level: "tip",
      title: `会话碎片化：平均每会话仅 ${avgTurns.toFixed(1)} 回合`,
      detail: `新会话会清空上下文缓存（当前命中率 ${hitRate}%）。`,
      action: "同主题续聊，批量任务合并会话。",
    });
  }

  // ── 7. 疑似密钥 ──
  if (stats.secretHits.length > 0) {
    const labels = [...new Set(stats.secretHits.map((h) => h.label))].join("、");
    insights.push({
      id: "secret-hit",
      level: "critical",
      title: `${stats.secretHits.length} 处疑似密钥/令牌出现在会话中`,
      detail: `类型：${labels}。只记录存在性，不展示原文。`,
      action: "尽快轮换对应密钥。",
    });
  }

  // ── 8. 费用趋势 ──
  const delta = costDeltaPct(input);
  if (delta !== null && Math.abs(delta) >= 20) {
    insights.push({
      id: "cost-trend",
      level: delta > 0 ? "warning" : "tip",
      title: `费用较上一周期${delta > 0 ? "上涨" : "下降"} ${Math.abs(delta)}%`,
      detail: `¥${prev!.cost.toFixed(2)} → ¥${totalCost.toFixed(2)}。`,
      action: delta > 0 ? "对照命中率与重试洞察定位增量。" : "无行动项。",
    });
  }

  // ── 9. 工具健康 ──
  const healthInsight = toolHealthInsight(stats.toolHealth);
  if (healthInsight !== null) insights.push(healthInsight);

  return insights;
}

/**
 * 工具健康门槛（确定性）：
 * - 样本：calls >= 5（小样本不制造"最不稳定"假象）
 * - 失败：failed >= 3 且失败率 >= 15%
 * 关注度 = failed × (1 + failureRate)：绝对失败数 + 比例加权（2/5 与 40/100 不等同）。
 */
/**
 * 门槛（基于真实周报数据校准）：高频线 30 次、失败 ≥5、失败率 ≥8%。
 * 真实数据参考：edit 543/53/9.8% 应触发；write 350/11/3.1% 与
 * bash 3506/13/0.4% 不应触发——8% 明显高于其余高频工具（≤3.1%）。
 */
export const TOOL_HEALTH_MIN_CALLS = 30;
export const TOOL_HEALTH_MIN_FAILED = 5;
export const TOOL_HEALTH_MIN_FAILURE_RATE = 0.08;

export function toolHealthAttention(t: ToolHealthLike): number {
  return t.failed * (1 + t.failureRate);
}

interface ToolHealthLike {
  name: string;
  calls: number;
  failed: number;
  failureRate: number;
  avgDurationMs: number;
}

/** 第 9 条确定性洞察：最值得关注的一个工具（最多一条，避免噪音）。 */
export function toolHealthInsight(health: readonly ToolHealthLike[] | undefined): Insight | null {
  if (health === undefined || health.length === 0) return null;
  const candidates = health.filter(
    (t) => t.calls >= TOOL_HEALTH_MIN_CALLS && t.failed >= TOOL_HEALTH_MIN_FAILED && t.failureRate >= TOOL_HEALTH_MIN_FAILURE_RATE,
  );
  if (candidates.length === 0) return null;
  const top = [...candidates].sort((a, b) => toolHealthAttention(b) - toolHealthAttention(a))[0];
  const ratePct = Math.round(top.failureRate * 1000) / 10;
  const avg = top.avgDurationMs >= 1000 ? `${(top.avgDurationMs / 1000).toFixed(1)}s` : `${Math.round(top.avgDurationMs)}ms`;
  return {
    id: "tool-health",
    level: "warning",
    title: `工具 ${top.name} 失败 ${top.failed} 次，失败率 ${ratePct}%`,
    detail: `本周调用 ${top.calls} 次，平均耗时 ${avg}。`,
    action: "该工具失败率明显高于其他高频工具，优先检查调用方式或运行环境。",
  };
}

// ─────────────────────────── 周期基线工具 ───────────────────────────

/** 周期 key：dy-YYYY-MM-DD / wk-YYYY-Www / mo-YYYY-MM / yr-YYYY（按"结束时刻"归属）。 */
/**
 * 周期 key（自然周期语义，前缀互不冲突）：
 *   day-YYYY-MM-DD  日报（自然日）
 *   24h-YYYY-MM-DD  滚动 24 小时（只存自身基线，不做"上一周期"对比）
 *   wk-YYYY-Www     周报（ISO 周）
 *   mo-YYYY-MM      月报
 *   yr-YYYY         年报
 */
export function periodKey(preset: string, toMs: number): string {
  const d = new Date(toMs);
  const iso = d.toISOString();
  if (preset === "daily") return `day-${iso.slice(0, 10)}`;
  if (preset === "24h") return `24h-${iso.slice(0, 10)}`;
  if (preset === "monthly") return `mo-${iso.slice(0, 7)}`;
  if (preset === "yearly") return `yr-${iso.slice(0, 4)}`;
  // weekly：ISO 周（周一为一周起点）
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  day.setUTCDate(day.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `wk-${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** 上一周期 key。24h 为滚动窗口，没有干净的自然"上一周期"→ 返回 null（不对比）。 */
export function previousPeriodKey(preset: string, toMs: number): string | null {
  const d = new Date(toMs);
  if (preset === "daily") return periodKey("daily", d.getTime() - 86400000);
  if (preset === "24h") return null;
  if (preset === "monthly") {
    const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    return periodKey("monthly", p.getTime());
  }
  if (preset === "yearly") {
    const p = new Date(Date.UTC(d.getUTCFullYear() - 1, 0, 1));
    return periodKey("yearly", p.getTime());
  }
  return periodKey("weekly", d.getTime() - 7 * 86400000);
}

// ─────────────────────────── 插件/工具族排行（生态向） ───────────────────────────

/** 已知工具 → 归属映射（best-effort；未识别归"其他"）。 */
const TOOL_FAMILY: [RegExp, string][] = [
  [/^whale_/, "深迹"],
  [/^study_/, "dsh-study"],
  [/^todo_write$/, "todo 工具"],
  [/^web_search$/, "web 搜索"],
  [/^session_/, "会话工具"],
  [/^(bash|read|edit|write|glob|grep|web|fs|skill|subagent|goal|jobs|spill)/, "核心工具"],
];

/** 按工具调用数归族排序（面板与 markdown 共用）。 */
export function toolFamilies(toolCalls: Record<string, number>): { family: string; count: number }[] {
  const byFamily = new Map<string, number>();
  for (const [name, count] of Object.entries(toolCalls)) {
    const family = TOOL_FAMILY.find(([re]) => re.test(name))?.[1] ?? "其他";
    byFamily.set(family, (byFamily.get(family) ?? 0) + count);
  }
  return [...byFamily.entries()].map(([family, count]) => ({ family, count })).sort((a, b) => b.count - a.count);
}
