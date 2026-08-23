/**
 * P0 salvage — 只读恢复被官方读取器拒读的会话日志。
 *
 * 背景（usage reconciliation audit）：
 *   session-79fa1012… 的 zstd 日志含 60,963 个独立 frame，全部可解压；
 *   拼接后 81,453 条 JSONL record 全部完整。官方 reader 因尾部
 *   agent/inbox/spliced 记录的 seq 连续性校验失败（issue 置位后跳过全部
 *   后续行且无 turn/end 兜底）而整体抛 "complete frame contains a torn
 *   JSONL record"，导致整 session 被拒 —— 但数据本身 100% 可恢复。
 *
 * 本模块：逐帧解压 → 按 newline 解析 JSONL →
 *   - 所有完整 record 正常返回（recoveredRecords）
 *   - 仅最后一条残缺 → 丢弃（droppedRecords=1，不猜测、不补全）
 *   - 中间出现无法安全恢复的 corruption → failure="unsafe"（整 session skip）
 *   - zstd 无法解压 → failure="unsafe"
 * 绝不修改 ~/.dsh 原文件（只读）。
 */
import { decompress } from "fzstd";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
/** zstd frame 魔数（小端 0xFD2FB528）。 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
/** 按魔数切分多帧 zstd 缓冲（与官方持久化格式一致）。 */
export function splitZstdFrames(buf) {
    const starts = [];
    for (let i = 0; i <= buf.length - 4; i++) {
        if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd)
            starts.push(i);
    }
    const frames = [];
    for (let k = 0; k < starts.length; k++) {
        const end = k + 1 < starts.length ? starts[k + 1] : buf.length;
        frames.push(buf.subarray(starts[k], end));
    }
    return frames;
}
/** 在 $DSH_HOME/sessions 下按会话 id 定位日志文件（只读扫描）。 */
export function findSessionLogPath(dshHome, sessionId) {
    const sessionsRoot = join(dshHome, "sessions");
    if (!existsSync(sessionsRoot))
        return null;
    const stack = [sessionsRoot];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const p = join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(p);
            }
            else if (entry.name === "session.jsonl.zstd" && dir.endsWith(`/${sessionId}`)) {
                return p;
            }
        }
    }
    return null;
}
/** 当前 DSH home（与 harness 同源；读取失败返回 ~/.dsh）。 */
export function resolveDshHome() {
    return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}
/**
 * 只读 salvage 一个会话日志文件。
 * 严格规则：
 *   - 任一 zstd frame 解压失败 → unsafe（整 session skip）；
 *   - 中间任意行 JSON 解析失败 → unsafe（无法确定 record 边界，不静默越过）；
 *   - 仅最后一条 record 残缺 → 丢弃该条，droppedRecords=1；
 *   - 全部完整 → droppedRecords=0，照常恢复。
 */
export function salvageSessionFile(path) {
    let buf;
    try {
        buf = readFileSync(path);
    }
    catch {
        return { ok: false, failure: "read-error", events: [], recoveredRecords: 0, droppedRecords: 0 };
    }
    const frames = splitZstdFrames(buf);
    if (frames.length === 0)
        return { ok: false, failure: "unsafe", events: [], recoveredRecords: 0, droppedRecords: 0 };
    const decoded = [];
    for (const frame of frames) {
        try {
            decoded.push(Buffer.from(decompress(frame)));
        }
        catch {
            // zstd 本身无法解压 → 无法安全恢复 → 整 session skip
            return { ok: false, failure: "unsafe", events: [], recoveredRecords: 0, droppedRecords: 0 };
        }
    }
    const text = Buffer.concat(decoded).toString("utf8");
    const lines = text.split("\n");
    // "最后一条 record" = 最后一个非空行（尾部可能有残留的换行/空白）。
    let lastNonEmpty = lines.length - 1;
    while (lastNonEmpty >= 0 && lines[lastNonEmpty].trim() === "")
        lastNonEmpty -= 1;
    const events = [];
    let sessionId;
    let recovered = 0;
    let dropped = 0;
    let sawHeader = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === "")
            continue;
        const isLast = i === lastNonEmpty;
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch {
            if (isLast) {
                // 仅容忍尾部残缺：不猜测、不补全、不按 0 处理。
                dropped += 1;
                continue;
            }
            return { ok: false, failure: "unsafe", events: [], recoveredRecords: 0, droppedRecords: 0 };
        }
        recovered += 1;
        if (parsed.type === "session") {
            sawHeader = true;
            if (typeof parsed.id === "string")
                sessionId = parsed.id;
            continue;
        }
        if (parsed.time !== undefined && typeof parsed.time === "number") {
            events.push({
                type: typeof parsed.type === "string" ? parsed.type : "unknown",
                time: parsed.time,
                data: parsed.data,
                ...(typeof parsed.seq === "number" ? { seq: parsed.seq } : {}),
            });
        }
    }
    if (!sawHeader) {
        // 无 header → 无法确认归属 → 视为不可安全恢复
        return { ok: false, failure: "unsafe", events: [], recoveredRecords: 0, droppedRecords: 0 };
    }
    return {
        ok: true,
        sessionId,
        events,
        recoveredRecords: recovered,
        droppedRecords: dropped,
    };
}
//# sourceMappingURL=salvage.js.map