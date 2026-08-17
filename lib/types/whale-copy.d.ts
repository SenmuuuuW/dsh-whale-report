/**
 * 鲸鱼娘鲸评文案（canonical copy）—— 确定性模板，与 whale-notes.ts 的
 * 触发规则同源配套（triggerNotes / whaleMood 决定 mood 与 kind，
 * 本模块决定具体文案）。
 *
 * 说明：Web 客户端（src/client/index.tsx）历史上自带一份 NOTE_TEMPLATES /
 * NOTE_OPENERS / NOTE_CLOSERS。本文件是新增的 canonical 副本，供
 * core 消费者（TUI、导出端等）使用；Web 客户端迁移到本文件是后续工作
 * （不动现有稳定客户端，避免本轮重构）。
 *
 * 每条 = 一段完整独白（4-5 句，起承转合），配开场白与收尾。确定性生成。
 */
import type { NoteKind, WhaleMood } from "./whale-notes.js";
/** 轻 / 毒舌双模式。 */
export type WhaleNoteMode = "light" | "spicy";
/** 按触发类型组织的模板（{n} 会被替换为具体计数）。 */
export declare const NOTE_TEMPLATES: Record<NoteKind, Record<WhaleNoteMode, readonly string[]>>;
/** 开场白（按心情）。 */
export declare const NOTE_OPENERS: Record<WhaleMood, readonly string[]>;
/** 收尾（按模式）。 */
export declare const NOTE_CLOSERS: Record<WhaleNoteMode, readonly string[]>;
/** 无触发时的默认鲸评（数据干净）。 */
export declare const NOTE_CLEAN: readonly string[];
/** 页脚：风味评论声明。 */
export declare const NOTE_FOOTER = "\u57FA\u4E8E\u672C\u671F\u4F7F\u7528\u6570\u636E\u81EA\u52A8\u751F\u6210\u7684\u98CE\u5473\u8BC4\u8BBA\uFF0C\u4E0D\u5F71\u54CD\u6B63\u5F0F\u62A5\u544A\u7ED3\u8BBA\u3002";
export interface WhaleNoteLine {
    /** 行内文本（{n} 已替换）。 */
    text: string;
    /** 行类型：开场白 / 正文 / 次要提示 / 收尾 / 页脚。 */
    kind: "opener" | "body" | "aside" | "closer" | "footer";
}
/**
 * 确定性生成鲸评行（与 Web 客户端同一套模板与触发规则）。
 * @param kinds - triggerNotes 的输出（空数组 = 数据干净）。
 * @param mood - whaleMood 的输出。
 * @param mode - 轻 / 毒舌。
 * @param n - 计数占位（retry 次数等；不传则用 0）。
 */
export declare function buildWhaleNote(kinds: readonly NoteKind[], mood: WhaleMood, mode?: WhaleNoteMode, n?: number): WhaleNoteLine[];
//# sourceMappingURL=whale-copy.d.ts.map