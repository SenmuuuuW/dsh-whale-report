/**
 * Salvage worker（v0.5.x Phase 3）：把 zstd 解压 + JSONL 解析移出主线程。
 *
 * 主线程只做 coordination：postMessage(path) → await 结果。
 * 22MB / 14.5s 的解压不再阻塞事件循环 —— QUERY 永远不等 INGEST。
 */
import { parentPort } from "node:worker_threads";
import { decompress } from "fzstd";
import { readFileSync } from "node:fs";
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
function splitFrames(buf) {
    const starts = [];
    for (let i = 0; i <= buf.length - 4; i++) {
        if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd)
            starts.push(i);
    }
    return starts.map((s, k) => buf.subarray(s, k + 1 < starts.length ? starts[k + 1] : buf.length));
}
parentPort?.on("message", (msg) => {
    const id = typeof msg?.id === "number" ? msg.id : -1;
    const path = typeof msg?.path === "string" ? msg.path : "";
    const reply = (result) => {
        parentPort?.postMessage({ ...result, id });
    };
    let result;
    if (path === "") {
        result = { ok: false, failure: "not-found", events: [], recoveredRecords: 0, droppedRecords: 0 };
    }
    else {
        try {
            let buf;
            try {
                buf = readFileSync(path);
            }
            catch {
                result = { ok: false, failure: "read-error", events: [], recoveredRecords: 0, droppedRecords: 0 };
                reply(result);
                return;
            }
            const frames = splitFrames(buf);
            if (frames.length === 0) {
                result = { ok: false, failure: "unsafe", events: [], recoveredRecords: 0, droppedRecords: 0 };
                reply(result);
                return;
            }
            const decoded = [];
            for (const frame of frames) {
                try {
                    decoded.push(Buffer.from(decompress(frame)));
                }
                catch {
                    result = { ok: false, failure: "unsafe", events: [], recoveredRecords: 0, droppedRecords: 0 };
                    reply(result);
                    return;
                }
            }
            const text = Buffer.concat(decoded).toString("utf8");
            const lines = text.split("\n");
            let lastNonEmpty = lines.length - 1;
            while (lastNonEmpty >= 0 && lines[lastNonEmpty].trim() === "")
                lastNonEmpty -= 1;
            const events = [];
            let sessionId;
            let recovered = 0;
            let dropped = 0;
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
                        dropped += 1;
                        continue;
                    }
                    result = { ok: false, failure: "unsafe", events: [], recoveredRecords: 0, droppedRecords: 0 };
                    reply(result);
                    return;
                }
                recovered += 1;
                if (parsed.type === "session") {
                    if (typeof parsed.id === "string")
                        sessionId = parsed.id;
                    continue;
                }
                if (typeof parsed.type === "string" && typeof parsed.time === "number") {
                    events.push({
                        type: parsed.type,
                        seq: typeof parsed.seq === "number" ? parsed.seq : undefined,
                        time: parsed.time,
                        data: parsed.data,
                    });
                }
            }
            if (sessionId === undefined) {
                result = { ok: false, failure: "unsafe", events: [], recoveredRecords: 0, droppedRecords: 0 };
            }
            else {
                result = { ok: true, sessionId, events, recoveredRecords: recovered, droppedRecords: dropped };
            }
        }
        catch {
            result = { ok: false, failure: "unsafe", events: [], recoveredRecords: 0, droppedRecords: 0 };
        }
    }
    reply(result);
});
//# sourceMappingURL=salvage-worker.js.map