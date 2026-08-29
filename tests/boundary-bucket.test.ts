/**
 * v0.5.x architecture repair — P0 数据正确性 bug #2（failing）。
 *
 * aggregateBuckets 的窗口裁剪对"跨 from/to 边界的 10 分钟桶"直接 continue 跳过：
 * 由于 period.to = now 几乎永远不是 10min 边界，每个窗口都会
 * 稳定丢失最近 0–10 分钟的全部事件（TODAY 的最近活动整体消失）。
 *
 * 注释声称"边界桶按比例近似计入"，但实现是整桶跳过 —— 注释与实现不符。
 * Raw Oracle 对账证明：oracle(TODAY)=9,846,937 canonical vs API(daily)=0。
 */
import { describe, expect, it } from "vitest";
import { aggregateBuckets, bucketizeOwnEvents, emptyPartial } from "../src/stats.js";

const BUCKET = 10 * 60 * 1000;
// T 对齐 10min 边界（00:00 起）；窗口 to 故意取非边界（now 语义）
const T = 1_786_000_000_000; // 对齐边界
const TO = T + 6 * 60 * 1000; // 窗口 to = T+6min（非边界，真实 now 语义）

function eventsInLastBucket(count: number): { type: string; seq: number; time: number; data: unknown }[] {
  // 全部事件落在最后一个 10min 桶 [T, T+BUCKET) 内，且 < TO
  return Array.from({ length: count }, (_, i) => ({
    type: "turn/start",
    seq: i,
    time: T + i * 1000, // T .. T+count-1 秒，都在 T+6min 之前
    data: {},
  }));
}

describe("P0 bug #2：边界桶事件不得被整桶丢弃", () => {
  it("窗口 [T, T+6min) 内的事件必须计入（failing：当前整桶被跳过）", () => {
    const events = eventsInLastBucket(50);
    const built = bucketizeOwnEvents("s-edge", events, 0);
    expect(built.buckets.length).toBe(1); // 单一 10min 桶
    const stats = aggregateBuckets(
      [{ sessionId: "s-edge", buckets: built.buckets, titles: [] }],
      { from: T, to: TO },
      [],
      emptyPartial(),
    );
    // 不变量：50 条事件全部在 [from, to) 内，必须全部计入
    expect(stats.totalEvents).toBe(50);
  });

  it("窗口 [T, T+6min) 的边界桶 turns 也必须计入", () => {
    const events = eventsInLastBucket(20);
    const built = bucketizeOwnEvents("s-edge2", events, 0);
    const stats = aggregateBuckets(
      [{ sessionId: "s-edge2", buckets: built.buckets, titles: [] }],
      { from: T, to: TO },
      [],
      emptyPartial(),
    );
    expect(stats.turns).toBe(20);
  });
});
