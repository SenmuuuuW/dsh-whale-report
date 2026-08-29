/**
 * INGEST（v0.5.x architecture repair）：session → canonical index。
 *
 * 职责（可以慢、后台、single-flight，绝不阻塞 UI）：
 * - 历史会话：source fingerprint 判定 → 仅变化/缺失者 readSession 重建；
 * - 损坏会话：salvage（只读恢复）→ 索引；
 * - live 会话：readSession 基线一次 + session/event firehose 逐事件增量；
 * - session/flush：内存增量落盘（index.put）。
 *
 * 与 query 层彻底分离：query 只读 index，绝不 readSession / decompress。
 */
import type { SessionIndexRecord } from "./state.js";
import { type BucketizedResult } from "./stats.js";
import { classifyReadError, type SessionQueryLike } from "./tools.js";
export interface IngestHeader {
    id: string;
    createdAt: number;
    cwd?: string;
    delegationDepth?: number;
}
export interface IngestEvent {
    type: string;
    seq?: number;
    time: number;
    data?: unknown;
}
export interface IngestStatus {
    headers: IngestHeader[];
    liveIds: Set<string>;
    /** 索引覆盖到的事件时间（lastMs 最大值，UI 显示 DATA UPDATED 用）。 */
    indexedThrough: number;
    /** 有会话缺失索引（追赶中）。 */
    indexing: boolean;
    /** 缺失索引的会话数。 */
    missing: number;
    /** ingest 判定损坏且无法恢复的会话（披露进 partial）。 */
    skippedIds: Set<string>;
    skippedReasons: Set<string>;
}
export declare class IngestEngine {
    readonly svc: {
        sessionQuery: SessionQueryLike;
        index: {
            get: (k: string) => SessionIndexRecord | undefined;
            put: (k: string, v: SessionIndexRecord) => Promise<void>;
        };
    };
    private headers;
    private live;
    /** bootstrap 登记 live 之前到达的 firehose 事件（防丢：bootstrap 完成时回放）。 */
    private prebuffer;
    private skippedIds;
    private skippedReasons;
    private bootstrapped;
    private checkpointing;
    private bootstrapPromise;
    private status;
    constructor(svc: IngestEngine["svc"]);
    /** 只读状态快照（query 层用）。 */
    statusOf(): IngestStatus;
    /** 单飞 bootstrap：建立 headers 快照 + 历史索引 + live 基线。 */
    bootstrap(): Promise<void>;
    private runBootstrap;
    private entryOf;
    /** session/event firehose：只处理新增事件。 */
    handleEvent(sessionId: string, event: IngestEvent): void;
    private applyLive;
    /** session/created：新 live 会话登记（后续事件走 firehose）。 */
    handleCreated(sessionId: string, ownStart?: number): void;
    /** session/disposed：live 会话离开 —— 落盘最终态并移除内存态。 */
    handleDisposed(sessionId: string): Promise<void>;
    /** session/flush：durability hint（降频 —— 由 checkpoint 策略决定是否真正落盘）。 */
    flushSession(sessionId: string): void;
    /** 全局 checkpoint（coalesced，revision-safe，single-flight）：
     *  收集所有 dirty live 会话，串行落盘；写失败保持 dirty 下轮重试。 */
    checkpoint(force: boolean): Promise<void>;
    private persistenceFailures;
    private trackPersistenceFailure;
    /** live 会话当前聚合快照（live-session endpoint 用；零 readSession）。 */
    liveSnapshot(sessionId: string): BucketizedResult | null;
    /** query 层入口：headers 快照 + 索引视图 + skipped 披露。 */
    private buildStatus;
    get bootstrappedFlag(): boolean;
    /** 低频 fingerprint reconciliation（防御 firehose 完整性之外的兜底）：只查历史会话，绝不 readSession live。 */
    reconcile(): Promise<void>;
    /** 插件卸载/进程退出前：强制落盘所有 dirty live 桶（durability）。 */
    dispose(): Promise<void>;
}
export { classifyReadError };
//# sourceMappingURL=ingest.d.ts.map