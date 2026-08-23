import type { RawEvent } from "./stats.js";
/** 按魔数切分多帧 zstd 缓冲（与官方持久化格式一致）。 */
export declare function splitZstdFrames(buf: Buffer): Buffer[];
export type SalvageFailure = "unsafe" | "not-found" | "read-error";
export interface SalvageResult {
    ok: boolean;
    failure?: SalvageFailure;
    /** 会话 id（来自日志首行 header）。 */
    sessionId?: string;
    /** 完整记录（不含 header；含残缺被丢弃后的全部）。 */
    events: RawEvent[];
    /** 解析出的完整 record 数（含 header 之外的所有行）。 */
    recoveredRecords: number;
    /** 被丢弃的残缺尾部 record 数（0 或 1；绝不猜测）。 */
    droppedRecords: number;
}
/** 在 $DSH_HOME/sessions 下按会话 id 定位日志文件（只读扫描）。 */
export declare function findSessionLogPath(dshHome: string, sessionId: string): string | null;
/** 当前 DSH home（与 harness 同源；读取失败返回 ~/.dsh）。 */
export declare function resolveDshHome(): string;
/**
 * 只读 salvage 一个会话日志文件。
 * 严格规则：
 *   - 任一 zstd frame 解压失败 → unsafe（整 session skip）；
 *   - 中间任意行 JSON 解析失败 → unsafe（无法确定 record 边界，不静默越过）；
 *   - 仅最后一条 record 残缺 → 丢弃该条，droppedRecords=1；
 *   - 全部完整 → droppedRecords=0，照常恢复。
 */
export declare function salvageSessionFile(path: string): SalvageResult;
//# sourceMappingURL=salvage.d.ts.map