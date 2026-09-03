import { buildSessionPathMap, resolveDshHome, statSessionFile } from "./salvage.js";
import { salvageInWorker } from "./salvage-pool.js";
import { createOwnEventBucketizer } from "./stats.js";
import { INDEX_VERSION, isIndexFresh, mapWithConcurrency, classifyReadError, } from "./tools.js";
/** live checkpoint 最小间隔：DSH session log 本身就是 source of truth，index 是派生数据。 */
const LIVE_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;
/**
 * 计算 bucketizer 的 ownStart（seed 边界）。
 * DSH 的 seedLength 同时覆盖两种语义：
 * - fork / subagent（有 parentSession）：seed 事件是父会话的拷贝 —— 父会话会统计，
 *   跳过以避免重复计费；
 * - resume（无 parentSession）：seed 事件是本会话恢复前的真实历史消费 —— 没有别的
 *   会话会统计它，跳过会导致该会话恢复前的 token/费用全部漏掉（v0.6.1 实测：
 *   live resume 会话只索引到恢复后的增量，8-18 起的 881M cacheRead 只剩 7M）。
 * 因此只有带 parentSession 的会话才按 seedLength 截断。
 */
function ownStartOf(snapshot) {
    return snapshot.session.parentSession === undefined ? 0 : (snapshot.session.seedLength ?? 0);
}
export class IngestEngine {
    svc;
    headers = [];
    live = new Map();
    /** bootstrap 登记 live 之前到达的 firehose 事件（防丢：bootstrap 完成时回放）。 */
    prebuffer = new Map();
    skippedIds = new Set();
    skippedReasons = new Set();
    bootstrapped = false;
    checkpointing = false;
    bootstrapPromise = null;
    status;
    constructor(svc) {
        this.svc = svc;
        this.status = this.buildStatus();
    }
    /** 只读状态快照（query 层用）。 */
    statusOf() {
        return this.buildStatus();
    }
    /** 单飞 bootstrap：建立 headers 快照 + 历史索引 + live 基线。 */
    bootstrap() {
        if (this.bootstrapPromise !== null)
            return this.bootstrapPromise;
        this.bootstrapPromise = this.runBootstrap().finally(() => {
            this.bootstrapped = true;
        });
        return this.bootstrapPromise;
    }
    async runBootstrap() {
        const sessions = await this.svc.sessionQuery.listSessions();
        this.headers = sessions.map((r) => ({
            id: r.header.id,
            createdAt: r.header.createdAt,
            cwd: r.header.cwd,
            delegationDepth: r.header.delegationDepth,
        }));
        const pathMap = buildSessionPathMap(resolveDshHome());
        const statOf = (id) => {
            const p = pathMap.get(id);
            return p === undefined ? null : statSessionFile(p);
        };
        // live 会话：先挂 buffering 再读基线（防 race 丢事件）。
        for (const record of sessions) {
            if (record.live) {
                this.live.set(record.header.id, { bucketizer: createOwnEventBucketizer(record.header.id, 0), lastSeq: -1, buffer: [], buffering: true, stat: statOf(record.header.id), dirty: false, revision: 0, persistedRevision: 0, lastPersistAt: 0 });
                // 回放登记前到达的事件（buffering 中，baseline 完成后按 seq 去重应用）
                const early = this.prebuffer.get(record.header.id);
                if (early !== undefined) {
                    this.live.get(record.header.id)?.buffer.push(...early);
                    this.prebuffer.delete(record.header.id);
                }
            }
        }
        await mapWithConcurrency(sessions, 6, async (record) => {
            const id = record.header.id;
            if (record.live) {
                try {
                    const snapshot = await this.svc.sessionQuery.readSession(id);
                    const bz = createOwnEventBucketizer(id, ownStartOf(snapshot));
                    let maxSeq = -1;
                    for (const e of snapshot.events) {
                        bz.apply(e);
                        if (e.seq !== undefined && e.seq > maxSeq)
                            maxSeq = e.seq;
                    }
                    const state = this.live.get(id);
                    if (state === undefined)
                        return;
                    state.bucketizer = bz;
                    state.lastSeq = maxSeq;
                    // 先应用 baseline 期间 buffered 的新事件（seq 去重），再落盘 —— 索引与内存一致。
                    const buffered = state.buffer;
                    state.buffer = [];
                    state.buffering = false;
                    for (const e of buffered) {
                        if (e.seq !== undefined && e.seq <= state.lastSeq)
                            continue;
                        this.applyLive(state, e);
                    }
                    const result = bz.snapshot();
                    await this.svc.index.put(id, this.entryOf(id, result, state.stat, true));
                    // baseline 落盘即视为已持久化到当前 revision（含 buffer 回放的事件）
                    state.persistedRevision = state.revision;
                    state.lastPersistAt = Date.now();
                    state.dirty = state.revision > state.persistedRevision;
                }
                catch {
                    // 基线失败（罕见）：保持 buffering 等 flush/下次 bootstrap 恢复
                }
                return;
            }
            // 历史会话：指纹判定
            const stat = statOf(id);
            const cached = this.svc.index.get(id);
            if (isIndexFresh(cached, stat)) {
                if (cached !== undefined && cached.src === undefined && stat !== null) {
                    void this.svc.index.put(id, { ...cached, src: stat }).catch(() => { });
                }
                return;
            }
            try {
                const snapshot = await this.svc.sessionQuery.readSession(id);
                const bz = createOwnEventBucketizer(id, ownStartOf(snapshot));
                for (const e of snapshot.events)
                    bz.apply(e);
                const result = bz.snapshot();
                await this.svc.index.put(id, this.entryOf(id, result, stat, false));
            }
            catch {
                // salvage：官方读取器拒读 → 只读恢复（worker 内解压，主线程不阻塞）
                const path = pathMap.get(id) ?? null;
                if (path !== null) {
                    const salvaged = await salvageInWorker(path);
                    if (salvaged.ok && salvaged.sessionId !== undefined) {
                        const bz = createOwnEventBucketizer(salvaged.sessionId, 0);
                        for (const e of salvaged.events)
                            bz.apply(e);
                        const result = bz.snapshot();
                        await this.svc.index.put(id, {
                            ...this.entryOf(id, result, stat, false),
                            salvaged: true,
                            salvagedRecords: salvaged.recoveredRecords,
                            salvagedDropped: salvaged.droppedRecords,
                        });
                        return;
                    }
                }
                this.skippedIds.add(id);
                this.skippedReasons.add("corrupt-log");
            }
        });
        this.status = this.buildStatus();
    }
    entryOf(id, result, stat, live) {
        return {
            sessionId: id,
            v: INDEX_VERSION,
            builtAt: Date.now(),
            lastSeq: result.lastSeq,
            lastMs: result.lastMs,
            buckets: result.buckets,
            titles: result.titles,
            src: stat ?? undefined,
            ...(live ? { live: true } : {}),
        };
    }
    /** session/event firehose：只处理新增事件。 */
    handleEvent(sessionId, event) {
        const state = this.live.get(sessionId);
        if (state === undefined) {
            // bootstrap 尚未登记 live：暂存，完成时回放（不静默丢）
            if (!this.bootstrapped) {
                const buf = this.prebuffer.get(sessionId) ?? [];
                buf.push(event);
                this.prebuffer.set(sessionId, buf);
            }
            return; // 已 bootstrap 且非 live → 历史会话由 fingerprint reconcile 兜底
        }
        if (state.buffering) {
            state.buffer.push(event);
            return;
        }
        this.applyLive(state, event);
    }
    applyLive(state, event) {
        if (event.seq !== undefined && event.seq <= state.lastSeq)
            return; // deterministic dedupe
        if (event.seq !== undefined)
            state.lastSeq = event.seq;
        state.bucketizer.apply(event);
        // 只标 dirty，绝不直接 persistence（flush/定时 checkpoint 负责落盘）
        state.revision += 1;
        state.dirty = true;
    }
    /** session/created：新 live 会话登记（后续事件走 firehose）。 */
    handleCreated(sessionId, ownStart = 0) {
        if (!this.live.has(sessionId)) {
            this.live.set(sessionId, { bucketizer: createOwnEventBucketizer(sessionId, ownStart), lastSeq: -1, buffer: [], buffering: false, stat: null, dirty: false, revision: 0, persistedRevision: 0, lastPersistAt: 0 });
        }
    }
    /** session/disposed：live 会话离开 —— 落盘最终态并移除内存态。 */
    async handleDisposed(sessionId) {
        const state = this.live.get(sessionId);
        if (state === undefined)
            return;
        const writingRevision = state.revision;
        const result = state.bucketizer.snapshot();
        try {
            await this.svc.index.put(sessionId, { ...this.entryOf(sessionId, result, state.stat, false), src: state.stat ?? undefined });
            state.persistedRevision = writingRevision;
        }
        catch (error) {
            this.trackPersistenceFailure(sessionId, error);
        }
        this.live.delete(sessionId);
    }
    /** session/flush：durability hint（降频 —— 由 checkpoint 策略决定是否真正落盘）。 */
    flushSession(sessionId) {
        const state = this.live.get(sessionId);
        if (state === undefined || !state.dirty)
            return;
        void this.checkpoint(false);
    }
    /** 全局 checkpoint（coalesced，revision-safe，single-flight）：
     *  收集所有 dirty live 会话，串行落盘；写失败保持 dirty 下轮重试。 */
    async checkpoint(force) {
        if (this.checkpointing)
            return;
        this.checkpointing = true;
        try {
            const now = Date.now();
            for (const [sessionId, state] of this.live) {
                if (!state.dirty)
                    continue;
                if (!force && now - state.lastPersistAt < LIVE_CHECKPOINT_INTERVAL_MS)
                    continue;
                // revision-safe：捕获写入版本；写期间新事件只增加 revision，不干扰本次写入。
                const writingRevision = state.revision;
                const result = state.bucketizer.snapshot();
                try {
                    await this.svc.index.put(sessionId, { ...this.entryOf(sessionId, result, state.stat, true), src: state.stat ?? undefined });
                    state.persistedRevision = writingRevision;
                    state.lastPersistAt = Date.now();
                    state.dirty = state.revision > state.persistedRevision;
                }
                catch (error) {
                    // 写失败：dirty 保持 true、persistedRevision 不更新 → 下轮重试；bounded 诊断。
                    this.trackPersistenceFailure(sessionId, error);
                }
            }
        }
        finally {
            this.checkpointing = false;
        }
    }
    persistenceFailures = 0;
    trackPersistenceFailure(sessionId, error) {
        this.persistenceFailures += 1;
        if (this.persistenceFailures <= 3 || this.persistenceFailures % 10 === 0) {
            console.error(`[whale] live index checkpoint 写失败（第 ${this.persistenceFailures} 次，session ${sessionId}）:`, error instanceof Error ? error.message : String(error));
        }
    }
    /** live 会话当前聚合快照（live-session endpoint 用；零 readSession）。 */
    liveSnapshot(sessionId) {
        const state = this.live.get(sessionId);
        if (state === undefined)
            return null;
        return state.bucketizer.snapshot();
    }
    /** query 层入口：headers 快照 + 索引视图 + skipped 披露。 */
    buildStatus() {
        let indexedThrough = 0;
        let missing = 0;
        const bootstrapping = !this.bootstrapped;
        for (const h of this.headers) {
            const entry = this.svc.index.get(h.id);
            if (entry === undefined || entry.v !== INDEX_VERSION) {
                missing += 1;
                continue;
            }
            if (entry.lastMs > indexedThrough)
                indexedThrough = entry.lastMs;
        }
        return {
            headers: this.headers,
            liveIds: new Set(this.live.keys()),
            indexedThrough,
            indexing: bootstrapping || missing > 0,
            missing: bootstrapping ? Math.max(missing, this.headers.length === 0 ? 1 : missing) : missing,
            skippedIds: this.skippedIds,
            skippedReasons: this.skippedReasons,
        };
    }
    get bootstrappedFlag() {
        return this.bootstrapped;
    }
    /** 低频 fingerprint reconciliation（防御 firehose 完整性之外的兜底）：只查历史会话，绝不 readSession live。 */
    async reconcile() {
        if (!this.bootstrapped)
            return;
        // v0.6.1：headers 补录 —— headers 是 bootstrap 时的静态快照；实例启动后新建的
        // 会话（含新开的主会话与子代理会话）必须追加，否则永远不进 query，
        // 报告漏算这些会话的全部 token/费用（真实数据：当天新会话占费用大头）。
        const known = new Set(this.headers.map((h) => h.id));
        const fresh = await this.svc.sessionQuery.listSessions();
        for (const record of fresh) {
            if (known.has(record.header.id))
                continue;
            this.headers.push({
                id: record.header.id,
                createdAt: record.header.createdAt,
                cwd: record.header.cwd,
                delegationDepth: record.header.delegationDepth,
            });
        }
        const pathMap = buildSessionPathMap(resolveDshHome());
        for (const h of this.headers) {
            if (this.live.has(h.id))
                continue; // live 由 firehose 负责
            const path = pathMap.get(h.id);
            const stat = path === undefined ? null : statSessionFile(path);
            const cached = this.svc.index.get(h.id);
            if (isIndexFresh(cached, stat))
                continue;
            try {
                const snapshot = await this.svc.sessionQuery.readSession(h.id);
                const bz = createOwnEventBucketizer(h.id, snapshot.session.seedLength ?? 0);
                for (const e of snapshot.events)
                    bz.apply(e);
                const result = bz.snapshot();
                await this.svc.index.put(h.id, this.entryOf(h.id, result, stat, false));
            }
            catch {
                // 读取失败留给下次 reconcile / 显式 rebuild
            }
        }
        this.status = this.buildStatus();
    }
    /** 插件卸载/进程退出前：强制落盘所有 dirty live 桶（durability）。 */
    async dispose() {
        await this.checkpoint(true);
    }
}
export { classifyReadError };
//# sourceMappingURL=ingest.js.map