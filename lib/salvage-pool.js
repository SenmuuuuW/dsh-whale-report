/**
 * Salvage worker 池（v0.5.x Phase 3）：单 worker 复用，主线程异步等待。
 * 主线程/测试同步路径仍可用 salvage.ts 的 salvageSessionFile。
 */
import { Worker } from "node:worker_threads";
let worker = null;
let seq = 0;
const pending = new Map();
function ensureWorker() {
    if (worker !== null)
        return worker;
    worker = new Worker(new URL("./salvage-worker.js", import.meta.url));
    worker.on("message", (msg) => {
        const id = msg.id;
        const resolve = id !== undefined ? pending.get(id) : undefined;
        if (resolve !== undefined && id !== undefined) {
            pending.delete(id);
            const { id: _drop, ...result } = msg;
            resolve(result);
        }
    });
    worker.on("error", (err) => {
        for (const resolve of pending.values()) {
            resolve({ ok: false, failure: "unsafe", events: [], recoveredRecords: 0, droppedRecords: 0 });
        }
        pending.clear();
    });
    return worker;
}
/** 异步 salvage（worker 内解压；主线程不阻塞）。 */
export function salvageInWorker(path) {
    const w = ensureWorker();
    const id = ++seq;
    return new Promise((resolve) => {
        pending.set(id, resolve);
        w.postMessage({ path, id });
    });
}
/** 测试/退出用：终止 worker。 */
export function disposeSalvageWorker() {
    if (worker !== null) {
        void worker.terminate();
        worker = null;
        pending.clear();
    }
}
//# sourceMappingURL=salvage-pool.js.map