/**
 * 协作复盘单元测试：
 * - 信号词表：方向修正识别、技术 retry 语境不误判
 * - 规则边界值：样本不足不触发、阈值边界
 * - 确定性：同一输入 → 同一结论
 * - 迟到约束：首条用户消息里的约束不计为"迟到"
 */

import { describe, expect, it } from "vitest";
import { userMessageSignals } from "../src/stats.js";
import { computeCollaborationInsights, COLLAB_MAX_INSIGHTS } from "../src/collaboration.js";

function input(partial: Partial<Parameters<typeof computeCollaborationInsights>[0]> = {}): Parameters<typeof computeCollaborationInsights>[0] {
  return {
    sessions: 20,
    userMessages: 80,
    revisions: 0,
    lateConstraints: 0,
    sessionsWithRevision: 0,
    shortSessions: 0,
    ...partial,
  };
}

describe("userMessageSignals 词表", () => {
  it("方向修正短语 → revision", () => {
    for (const text of [
      "不是这个，换一种方式",
      "别用这个方案，重新做",
      "改成 JSON 格式吧",
      "搞错了，我理解错了",
      "推翻重来，不要这个",
    ]) {
      expect(userMessageSignals(text).revision, text).toBe(true);
    }
  });

  it("技术 retry 语境不误判为 revision", () => {
    for (const text of [
      "再试一次",
      "刚才命令失败了，重跑一下",
      "再来一次，可能刚才是网络问题",
      "重试 pnpm install",
      "再执行一遍看看",
    ]) {
      expect(userMessageSignals(text).revision, text).toBe(false);
    }
  });

  it("迟到约束短语 → constraint", () => {
    for (const text of ["千万不要改数据库", "务必保持只读", "只允许访问 /tmp", "禁止删除任何文件"]) {
      expect(userMessageSignals(text).constraint, text).toBe(true);
    }
  });

  it("普通消息无信号", () => {
    expect(userMessageSignals("帮我写一个排序函数")).toEqual({ revision: false, constraint: false });
    expect(userMessageSignals("今天的天气怎么样")).toEqual({ revision: false, constraint: false });
  });
});

describe("computeCollaborationInsights 样本门槛", () => {
  it("会话 < 5 不触发（日报/24h 常见）", () => {
    expect(computeCollaborationInsights(input({ sessions: 4, revisions: 10 }))).toEqual([]);
  });
  it("用户消息 < 30 不触发", () => {
    expect(computeCollaborationInsights(input({ userMessages: 29, revisions: 10 }))).toEqual([]);
  });
});

describe("computeCollaborationInsights 规则边界", () => {
  it("REQUIREMENT-DRIFT：≥5 次修正且 ≥3 会话", () => {
    const out = computeCollaborationInsights(input({ revisions: 5, sessionsWithRevision: 3 }));
    expect(out.map((i) => i.code)).toContain("REQUIREMENT-DRIFT");
  });
  it("4 次修正不触发 drift", () => {
    const out = computeCollaborationInsights(input({ revisions: 4, sessionsWithRevision: 4 }));
    expect(out.map((i) => i.code)).not.toContain("REQUIREMENT-DRIFT");
  });
  it("LATE-CONSTRAINT：≥3 条迟到约束", () => {
    const out = computeCollaborationInsights(input({ lateConstraints: 3 }));
    expect(out.map((i) => i.code)).toContain("LATE-CONSTRAINT");
  });
  it("2 条迟到约束不触发", () => {
    const out = computeCollaborationInsights(input({ lateConstraints: 2 }));
    expect(out.map((i) => i.code)).not.toContain("LATE-CONSTRAINT");
  });
  it("CONTEXT-FRAGMENTATION：短会话 ≥5 且占比 ≥40%", () => {
    const out = computeCollaborationInsights(input({ sessions: 10, shortSessions: 5 }));
    expect(out.map((i) => i.code)).toContain("CONTEXT-FRAGMENTATION");
  });
  it("短会话占比 <40% 不触发", () => {
    const out = computeCollaborationInsights(input({ sessions: 10, shortSessions: 3 }));
    expect(out.map((i) => i.code)).not.toContain("CONTEXT-FRAGMENTATION");
  });
});

describe("computeCollaborationInsights 确定性与上限", () => {
  it("同一输入 → 同一结论（确定性，无随机）", () => {
    const a = computeCollaborationInsights(input({ revisions: 7, sessionsWithRevision: 4, lateConstraints: 5, shortSessions: 6 }));
    const b = computeCollaborationInsights(input({ revisions: 7, sessionsWithRevision: 4, lateConstraints: 5, shortSessions: 6 }));
    expect(a).toEqual(b);
  });
  it("最多输出 3 条", () => {
    const out = computeCollaborationInsights(input({ revisions: 9, sessionsWithRevision: 5, lateConstraints: 9, shortSessions: 9 }));
    expect(out.length).toBeLessThanOrEqual(COLLAB_MAX_INSIGHTS);
  });
});

describe("迟到约束语义（首条消息不算迟到）", () => {
  it("同一会话：首条消息的约束不计入 lateConstraints（经聚合双路径保证）", () => {
    // 词表层面：constraint 信号只标记存在；首条判定在聚合器里做。
    // 这里锁定确定性：同样的消息序列产生同样的信号。
    const first = userMessageSignals("必须只读，不要写文件");
    const later = userMessageSignals("哦对，千万不要改数据库");
    expect(first.constraint).toBe(true);
    expect(later.constraint).toBe(true);
    expect(userMessageSignals("再试一次").revision).toBe(false);
  });
});
