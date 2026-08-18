/**
 * Tool Health（第 9 条确定性洞察）测试：
 * - call/result 配对（正常 / 乱序 / 无 result / 无 call）
 * - health 计算（success/failed/duration/avg/p50/p95/errorCodes）
 * - 样本门槛（小样本不触发；高频失败触发；2/5 与 40/100 不等同）
 * - 双路径等价（aggregate / aggregateBuckets）
 * - 隐私（不含 arguments / error body）
 * - 排序（异常优先）
 * - 历史兼容（旧 report 无 toolHealth）
 */

import { describe, expect, it } from "vitest";
import { aggregate, aggregateBuckets, bucketizeOwnEvents, type RawEvent, type ToolHealth } from "../src/stats.js";
import { toolHealthInsight, toolHealthAttention, TOOL_HEALTH_MIN_CALLS, TOOL_HEALTH_MIN_FAILED } from "../src/insights.js";
import { sortToolHealth } from "../src/client/index.js";

const T0 = Date.parse("2026-08-10T08:00:00Z");
const PERIOD = { from: T0 - 60_000, to: T0 + 3600_000 };

function ev(type: string, time: number, data: Record<string, unknown> = {}): RawEvent {
  return { type, time, data: { ...data, sessionId: "s1" } };
}

function call(id: string, name: string, time: number): RawEvent {
  return ev("tool/call", time, { callId: id, name, arguments: "{\"command\":\"ls\"}" });
}

function result(id: string, time: number, failed = false): RawEvent {
  const data: Record<string, unknown> = {
    message: {
      source: { kind: "tool", callId: id },
      content: [{ type: "tool-result", toolCallId: id, content: [{ type: "text", text: "ok" }] }],
    },
  };
  if (failed) data.error = { name: "WebError", code: "WEB_PROVIDER_ERROR" };
  return ev("tool/result", time, data);
}

function healthOf(stats: { toolHealth: ToolHealth[] }, name: string): ToolHealth | undefined {
  return stats.toolHealth.find((t) => t.name === name);
}

// ─────────────────────────── 配对 ───────────────────────────

describe("tool/call ↔ tool/result 配对", () => {
  it("正常配对：completed + duration", () => {
    const stats = aggregate([call("c1", "bash", T0), result("c1", T0 + 500)], PERIOD);
    const h = healthOf(stats, "bash")!;
    expect(h.calls).toBe(1);
    expect(h.completed).toBe(1);
    expect(h.failed).toBe(0);
    expect(h.incomplete).toBe(0);
    expect(h.avgDurationMs).toBe(500);
    expect(h.p50DurationMs).toBe(500);
    expect(h.p95DurationMs).toBe(500);
  });

  it("并发/乱序 result：按 callId 配对，不依赖顺序", () => {
    const stats = aggregate(
      [
        call("c1", "bash", T0),
        call("c2", "edit", T0 + 10),
        call("c3", "bash", T0 + 20),
        result("c3", T0 + 100), // 先回 c3
        result("c1", T0 + 300), // 再回 c1
        result("c2", T0 + 400), // 最后 c2
      ],
      PERIOD,
    );
    expect(healthOf(stats, "bash")!.completed).toBe(2);
    expect(healthOf(stats, "edit")!.completed).toBe(1);
    expect(healthOf(stats, "bash")!.avgDurationMs).toBe(190); // (300-0 + 100-20)/2
    expect(healthOf(stats, "edit")!.avgDurationMs).toBe(390);
  });

  it("call 无 result → incomplete，不算 failed", () => {
    const stats = aggregate([call("c1", "bash", T0), call("c2", "bash", T0 + 10), result("c2", T0 + 50)], PERIOD);
    const h = healthOf(stats, "bash")!;
    expect(h.calls).toBe(2);
    expect(h.completed).toBe(1);
    expect(h.incomplete).toBe(1);
    expect(h.failed).toBe(0);
  });

  it("result 无对应 call → 忽略（不计入）", () => {
    const stats = aggregate([result("orphan", T0)], PERIOD);
    expect(stats.toolHealth).toEqual([]);
  });

  it("失败 result → failed + errorCodes（只存 code，不存 body）", () => {
    const stats = aggregate([call("c1", "browser", T0), result("c1", T0 + 100, true)], PERIOD);
    const h = healthOf(stats, "browser")!;
    expect(h.failed).toBe(1);
    expect(h.errorCodes).toEqual({ WEB_PROVIDER_ERROR: 1 });
    expect(JSON.stringify(h)).not.toContain("fetch failed");
    expect(JSON.stringify(h)).not.toContain("arguments");
  });
});

// ─────────────────────────── health 计算 ───────────────────────────

describe("ToolHealth 统计", () => {
  it("successRate / failureRate / avg / p50 / p95", () => {
    const events: RawEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push(call(`c${i}`, "bash", T0 + i * 100));
      events.push(result(`c${i}`, T0 + i * 100 + i * 10, i % 5 === 0));
    }
    const stats = aggregate(events, PERIOD);
    const h = healthOf(stats, "bash")!;
    expect(h.calls).toBe(20);
    expect(h.completed).toBe(20);
    expect(h.failed).toBe(4); // i=0,5,10,15
    expect(h.failureRate).toBeCloseTo(0.2, 6);
    expect(h.successRate).toBeCloseTo(0.8, 6);
    // durations: 0,10,20,...,190 → p50≈95, p95≈180.5
    expect(h.avgDurationMs).toBe(95);
    expect(h.p50DurationMs).toBe(90); // sorted[9]
    expect(h.p95DurationMs).toBe(180);
  });
});

// ─────────────────────────── 门槛与第 9 条洞察 ───────────────────────────

describe("第 9 条 TOOL HEALTH 洞察门槛", () => {
  const t = (name: string, calls: number, failed: number, failureRate: number, avgDurationMs = 1000): ToolHealth => ({
    name,
    calls,
    completed: calls - failed,
    failed,
    incomplete: 0,
    successRate: calls > 0 ? (calls - failed) / calls : 0,
    failureRate,
    avgDurationMs,
    p50DurationMs: avgDurationMs,
    p95DurationMs: avgDurationMs,
    errorCodes: {},
  });

  it("小样本（calls<30）不触发，即使 100% 失败", () => {
    expect(toolHealthInsight([t("web", 1, 1, 1)])).toBeNull();
    expect(toolHealthInsight([t("web", 29, 29, 1)])).toBeNull();
  });

  it("failed <5 不触发", () => {
    expect(toolHealthInsight([t("web", 100, 2, 0.02)])).toBeNull();
    expect(toolHealthInsight([t("web", 100, 4, 0.1)])).toBeNull();
  });

  it("失败率 <8% 不触发（高频低失败）", () => {
    expect(toolHealthInsight([t("bash", 200, 10, 0.05)])).toBeNull();
    expect(toolHealthInsight([t("write", 350, 11, 0.031)])).toBeNull();
  });

  it("高频失败触发（真实周报数据：edit 543 次 / 53 失败 / 9.8%）", () => {
    const insight = toolHealthInsight([t("edit", 543, 53, 53 / 543)]);
    expect(insight).not.toBeNull();
    expect(insight!.id).toBe("tool-health");
    expect(insight!.title).toContain("edit");
    expect(insight!.title).toContain("53");
    expect(insight!.detail).toContain("543");
  });

  it("真实数据回归：bash 3506/13/0.4% 不触发；web_search 383/4/1.0% 不触发", () => {
    expect(toolHealthInsight([t("bash", 3506, 13, 13 / 3506)])).toBeNull();
    expect(toolHealthInsight([t("web_search", 383, 4, 4 / 383)])).toBeNull();
  });

  it("2/5 与 40/100 不等同：attention 加权（小样本被门槛排除）", () => {
    const small = t("a", 29, 2, 0.4); // calls < 30 → 不进入候选
    const big = t("b", 100, 40, 0.4);
    expect(toolHealthAttention(big)).toBeGreaterThan(toolHealthAttention(small));
    const insight = toolHealthInsight([small, big]);
    expect(insight!.title).toContain("b");
  });

  it("多个候选只输出最值得关注的一条", () => {
    const insight = toolHealthInsight([
      t("x", 50, 10, 0.2),
      t("y", 60, 30, 0.5),
      t("z", 70, 40, 0.57),
    ]);
    expect(insight!.title).toContain("z");
  });

  it("无 toolHealth（旧报告）→ 不触发", () => {
    expect(toolHealthInsight(undefined)).toBeNull();
    expect(toolHealthInsight([])).toBeNull();
  });

  it("门槛常量可核对", () => {
    expect(TOOL_HEALTH_MIN_CALLS).toBe(30);
    expect(TOOL_HEALTH_MIN_FAILED).toBe(5);
  });
});

// ─────────────────────────── 排序 ───────────────────────────

describe("sortToolHealth（异常优先，确定性）", () => {
  const t = (name: string, calls: number, failed: number, rate: number): ToolHealth => ({
    name, calls, completed: calls - failed, failed, incomplete: 0,
    successRate: 1 - rate, failureRate: rate, avgDurationMs: 0, p50DurationMs: 0, p95DurationMs: 0, errorCodes: {},
  });
  it("异常工具在前（按失败率），健康工具在后（按调用次数）", () => {
    const rows = sortToolHealth([t("bash", 381, 5, 0.013), t("browser", 47, 9, 0.191), t("edit", 204, 1, 0.005)]);
    expect(rows[0].tool.name).toBe("browser");
    expect(rows[0].abnormal).toBe(true);
    expect(rows[1].tool.name).toBe("bash");
    expect(rows[2].tool.name).toBe("edit");
  });
});

// ─────────────────────────── 双路径等价 ───────────────────────────

describe("Tool Health 双路径等价", () => {
  it("aggregate 与 aggregateBuckets 的 toolHealth 完全一致", () => {
    const base = new Date(2026, 7, 10, 0, 0, 0).getTime();
    const events: RawEvent[] = [
      call("c1", "bash", base + 1),
      call("c2", "bash", base + 2),
      call("c3", "edit", base + 3),
      result("c2", base + 50),
      result("c1", base + 80, true),
      // c3 无 result → incomplete
    ];
    // 周期需覆盖整个 10 分钟分桶（分桶路径对桶做整体裁剪）。
    const PERIOD = { from: base - 1, to: base + 600_000 };
    const direct = aggregate(events, PERIOD, [{ id: "s1", createdAt: base }]);
    const built = bucketizeOwnEvents("s1", events.map((e) => ({ ...e, seq: 0 })), 0);
    const indexed = aggregateBuckets(
      [{ sessionId: "s1", buckets: built.buckets, titles: built.titles }],
      PERIOD,
      [{ id: "s1", createdAt: base }],
    );
    expect(indexed.toolHealth).toEqual(direct.toolHealth);
    const b = indexed.toolHealth.find((x) => x.name === "bash")!;
    expect(b.calls).toBe(2);
    expect(b.completed).toBe(2);
    expect(b.failed).toBe(1);
    expect(b.avgDurationMs).toBe(63.5); // (80-1 + 50-2)/2
    const e = indexed.toolHealth.find((x) => x.name === "edit")!;
    expect(e.incomplete).toBe(1);
    // 工具健康不携带 arguments / error body
    expect(JSON.stringify(indexed.toolHealth)).not.toContain("command");
    expect(JSON.stringify(indexed.toolHealth)).not.toContain("fetch failed");
  });

  it("跨 10 分钟分桶边界的配对仍然等价（pending 会话级）", () => {
    const base = new Date(2026, 7, 10, 0, 0, 0).getTime();
    // call 在桶 A（base），result 在桶 B（base + 11 分钟）
    const events: RawEvent[] = [
      call("c1", "bash", base),
      result("c1", base + 11 * 60_000),
    ];
    const direct = aggregate(events, { from: base - 1, to: base + 20 * 60_000 }, [{ id: "s1", createdAt: base }]);
    const built = bucketizeOwnEvents("s1", events.map((e) => ({ ...e, seq: 0 })), 0);
    const indexed = aggregateBuckets(
      [{ sessionId: "s1", buckets: built.buckets, titles: built.titles }],
      { from: base - 1, to: base + 20 * 60_000 },
      [{ id: "s1", createdAt: base }],
    );
    expect(indexed.toolHealth).toEqual(direct.toolHealth);
    expect(indexed.toolHealth[0].completed).toBe(1);
  });
});
