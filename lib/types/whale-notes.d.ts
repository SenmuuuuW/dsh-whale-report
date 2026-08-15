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
    dangerousCommands: ReadonlyArray<{
        sev?: string;
    }>;
    retryBursts?: number;
    totalEvents: number;
    hourHistogram: ReadonlyArray<number>;
    sessions: number;
    turns: number;
}
/** 深夜占比（0-6 点事件百分比，整数）。 */
export declare function nightShare(input: WhaleInput): number;
/**
 * 规则触发：返回命中的吐槽项，按优先级排序。
 * danger（最需关注）→ retry → night → fragment。
 */
export declare function triggerNotes(input: WhaleInput): NoteKind[];
/**
 * 表情：由同一套触发规则推导（与鲸评文案同源）。
 * 危险仅致命级（red）生气；需留意级（amber）不改变语气，保持原产品逻辑。
 */
export declare function whaleMood(input: WhaleInput): WhaleMood;
//# sourceMappingURL=whale-notes.d.ts.map