/**
 * QUERY（v0.5.x architecture repair）：PeriodSpec + indexed buckets → ReportStats。
 *
 * 铁律：query 只读 index，绝不 readSession / salvage / decompress。
 * 复杂度与 bucket 数相关，与原始 event 总量无关。
 * 边界桶由 rows 逐事件精确过滤（[from,to) 语义）。
 */
import { aggregateBuckets, emptyPartial, type RawSessionHeader, type ReportStats, type SessionBucketView } from "./stats.js";
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
export function queryPeriod(index: QueryIndex, spec: PeriodSpec, headers: RawSessionHeader[], meta: QueryMeta): QueryOutput {
  const views: SessionBucketView[] = [];
  let indexedThrough = 0;
  let missing = 0;
  for (const h of headers) {
    const entry = index.get(h.id);
    if (entry === undefined || entry.v !== 16 || !Array.isArray(entry.buckets)) {
      missing += 1;
      continue;
    }
    views.push({ sessionId: entry.sessionId, buckets: entry.buckets as SessionBucketView["buckets"], titles: entry.titles });
    if (entry.lastMs > indexedThrough) indexedThrough = entry.lastMs;
  }
  // 跳过披露：ingest 判定损坏且无法恢复的会话（缺失索引不在此列 —— 那是 indexing 追赶）。
  const skippedCount = meta.skippedIds.size;
  const partial = skippedCount > 0
    ? { skippedSessionIds: [...meta.skippedIds], skippedCount, reasons: [...meta.skippedReasons].sort() }
    : emptyPartial();
  const stats = aggregateBuckets(views, spec, headers, partial);
  return {
    stats,
    meta: { ...meta, indexedThrough, indexing: missing > 0, missing },
  };
}
