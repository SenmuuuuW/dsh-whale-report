/**
 * 鲸鱼娘状态（表情）与鲸评触发（吐槽条目）的统一规则来源。
 *
 * 表情和文案必须由同一套阈值驱动，避免出现「happy 表情 + retry 吐槽」的错位：
 * - 之前 client 的 whaleMood 维护 night≥25 / retry≥5，
 * - 而 triggerNotes 维护 night≥15 / retry≥3，
 * 两套阈值并存导致中间区间表情与文案互相矛盾。
 *
 * 这里只保留一套确定性规则（无随机），client 面板与 HTML 导出共用，
 * 任何一侧都不再各自维护阈值。
 */

export type NoteKind = "danger" | "retry" | "night" | "fragment";
export type WhaleMood = "happy" | "angry" | "sleepy" | "dazed";

/** 触发规则所需的 stats 字段（客户端 StatsJson 与宿主 ReportStats 结构兼容）。 */
export interface WhaleInput {
  dangerousCommands: ReadonlyArray<{ sev?: string }>;
  retryBursts?: number;
  totalEvents: number;
  hourHistogram: ReadonlyArray<number>;
  sessions: number;
  turns: number;
}

/** 深夜占比（0-6 点事件百分比，整数）。 */
export function nightShare(input: WhaleInput): number {
  if (input.totalEvents === 0) return 0;
  const night = input.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0);
  return Math.round((night / input.totalEvents) * 100);
}

/**
 * 规则触发：返回命中的吐槽项，按优先级排序。
 * danger（最需关注）→ retry → night → fragment。
 */
export function triggerNotes(input: WhaleInput): NoteKind[] {
  const hits: { kind: NoteKind; weight: number }[] = [];
  if ((input.dangerousCommands ?? []).some((d) => d.sev === "red")) hits.push({ kind: "danger", weight: 0 });
  else if (input.dangerousCommands.length > 0) hits.push({ kind: "danger", weight: 1 });
  if ((input.retryBursts ?? 0) >= 3) hits.push({ kind: "retry", weight: 2 });
  if (nightShare(input) >= 15) hits.push({ kind: "night", weight: 3 });
  if (input.sessions >= 5 && input.sessions > 0 && input.turns / input.sessions < 2) {
    hits.push({ kind: "fragment", weight: 4 });
  }
  return hits.sort((a, b) => a.weight - b.weight).map((h) => h.kind);
}

/**
 * 表情：由同一套触发规则推导（与鲸评文案同源）。
 * 危险仅致命级（red）生气；需留意级（amber）不改变语气，保持原产品逻辑。
 */
export function whaleMood(input: WhaleInput): WhaleMood {
  const top = triggerNotes(input)[0];
  if (top === "danger") {
    return (input.dangerousCommands ?? []).some((d) => d.sev === "red") ? "angry" : "happy";
  }
  if (top === "retry") return "dazed";
  if (top === "night") return "sleepy";
  return "happy";
}
