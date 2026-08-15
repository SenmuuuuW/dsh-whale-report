/**
 * 鲸鱼娘统一规则（whale-notes）单元测试：
 * 表情与鲸评触发必须同源（单一阈值），锁定以下语义：
 * - danger 仅致命级（red）→ angry；需留意级（amber）不改变语气；
 * - retry ≥ 3 → dazed；night ≥ 15 → sleepy；
 * - 表情优先级跟随 triggerNotes（danger > retry > night > fragment）。
 */

import { describe, expect, it } from "vitest";
import { triggerNotes, whaleMood, nightShare, type WhaleInput } from "../src/whale-notes.js";

function input(partial: Partial<WhaleInput>): WhaleInput {
  return {
    dangerousCommands: [],
    retryBursts: 0,
    totalEvents: 100,
    hourHistogram: Array.from({ length: 24 }, () => 0),
    sessions: 1,
    turns: 4,
    ...partial,
  };
}

/** 把 h 个事件放到 0-6 点时段，制造 night 占比 h%。 */
function nightInput(nightEvents: number, total = 100): WhaleInput {
  const hist = Array.from({ length: 24 }, () => 0);
  hist[2] = nightEvents; // 凌晨 2 点
  return input({ totalEvents: total, hourHistogram: hist });
}

describe("nightShare", () => {
  it("0-6 点事件占比（整数）", () => {
    expect(nightShare(nightInput(15))).toBe(15);
    expect(nightShare(nightInput(0))).toBe(0);
  });
  it("无事件时返回 0", () => {
    expect(nightShare(input({ totalEvents: 0 }))).toBe(0);
  });
});

describe("triggerNotes 阈值", () => {
  it("retry >= 3 触发，< 3 不触发", () => {
    expect(triggerNotes(input({ retryBursts: 3 }))).toContain("retry");
    expect(triggerNotes(input({ retryBursts: 2 }))).not.toContain("retry");
  });
  it("night >= 15 触发，< 15 不触发", () => {
    expect(triggerNotes(nightInput(15))).toContain("night");
    expect(triggerNotes(nightInput(14))).not.toContain("night");
  });
  it("red danger 与 amber danger 都触发 danger（red 权重更高）", () => {
    expect(triggerNotes(input({ dangerousCommands: [{ sev: "red" }] }))[0]).toBe("danger");
    expect(triggerNotes(input({ dangerousCommands: [{ sev: "amber" }] }))[0]).toBe("danger");
  });
  it("会话碎片化：>=5 会话且平均回合 < 2", () => {
    expect(triggerNotes(input({ sessions: 5, turns: 9 }))).toContain("fragment");
    expect(triggerNotes(input({ sessions: 5, turns: 11 }))).not.toContain("fragment");
    expect(triggerNotes(input({ sessions: 4, turns: 4 }))).not.toContain("fragment");
  });
});

describe("whaleMood 与 triggerNotes 同源", () => {
  it("retry 3（旧 mood 阈值 5 不触发）现在也 dazed——表情与文案一致", () => {
    expect(triggerNotes(input({ retryBursts: 3 }))[0]).toBe("retry");
    expect(whaleMood(input({ retryBursts: 3 }))).toBe("dazed");
  });
  it("night 15-24（旧 mood 阈值 25 不触发）现在也 sleepy", () => {
    expect(whaleMood(nightInput(15))).toBe("sleepy");
    expect(whaleMood(nightInput(24))).toBe("sleepy");
  });
  it("red danger → angry", () => {
    expect(whaleMood(input({ dangerousCommands: [{ sev: "red" }] }))).toBe("angry");
  });
  it("amber-only danger 不改变语气（保持 happy，同原产品逻辑）", () => {
    expect(whaleMood(input({ dangerousCommands: [{ sev: "amber" }] }))).toBe("happy");
  });
  it("干净数据 → happy", () => {
    expect(whaleMood(input({}))).toBe("happy");
    expect(whaleMood(nightInput(14))).toBe("happy");
  });
  it("表情优先级跟随 triggerNotes：red danger 压过 retry/night", () => {
    expect(
      whaleMood({ ...nightInput(30), dangerousCommands: [{ sev: "red" }], retryBursts: 9 }),
    ).toBe("angry");
  });
  it("retry 压过 night（表情与 top 文案一致）", () => {
    expect(whaleMood({ ...nightInput(30), retryBursts: 3 })).toBe("dazed");
  });
});
