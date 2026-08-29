/**
 * QUERY（v0.5.x architecture repair）：PeriodSpec + indexed buckets → ReportStats。
 *
 * 铁律：query 只读 index，绝不 readSession / salvage / decompress。
 * 复杂度与 bucket 数相关，与原始 event 总量无关。
 * 边界桶由 rows 逐事件精确过滤（[from,to) 语义）。
 */
import { type RawSessionHeader, type ReportStats } from "./stats.js";
import type { SessionIndexRecord } from "./state.js";
import type { PeriodSpec } from "./period.js";
export interface QueryIndex {
    get(key: string): SessionIndexRecord | undefined;
}
export interface QueryMeta {
    indexedThrough: number;
    indexing: boolean;
    missing: number;
    skippedIds: Set<string>;
    skippedReasons: Set<string>;
}
export interface QueryOutput {
    stats: ReportStats;
    meta: QueryMeta;
}
/** 从 canonical index 查询一个精确周期。零会话 IO。 */
export declare function queryPeriod(index: QueryIndex, spec: PeriodSpec, headers: RawSessionHeader[], meta: QueryMeta): QueryOutput;
//# sourceMappingURL=query-engine.d.ts.map