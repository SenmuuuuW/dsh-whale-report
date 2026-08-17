import { describe, expect, it } from "vitest";
import { buildWhaleNote, NOTE_CLOSERS, NOTE_OPENERS, NOTE_TEMPLATES } from "../src/whale-copy.js";
import { triggerNotes, whaleMood, type WhaleInput } from "../src/whale-notes.js";

function input(over: Partial<WhaleInput>): WhaleInput {
  return {
    dangerousCommands: [],
    retryBursts: 0,
    totalEvents: 100,
    hourHistogram: new Array(24).fill(5),
    sessions: 10,
    turns: 40,
    ...over,
  };
}

describe("whale-copy", () => {
  it("数据干净时输出默认鲸评（无正文模板）", () => {
    const lines = buildWhaleNote([], "happy", "light");
    expect(lines[0]).toMatchObject({ kind: "opener" });
    expect(lines.some((l) => l.text.includes("这期数据很干净"))).toBe(true);
    expect(lines.at(-1)).toMatchObject({ kind: "closer", text: NOTE_CLOSERS.light[0] });
  });

  it("模板计数占位 {n} 被替换", () => {
    const lines = buildWhaleNote(["retry"], "dazed", "spicy", 7);
    const spicy = lines.find((l) => l.text.includes("连续敲了"));
    expect(spicy?.text).toContain("连续敲了 7 遍");
  });

  it("与触发规则同源：retry 触发 → dazed 开场白", () => {
    const i = input({ retryBursts: 5 });
    const kinds = triggerNotes(i);
    const mood = whaleMood(i);
    expect(kinds[0]).toBe("retry");
    const lines = buildWhaleNote(kinds, mood, "light");
    expect(lines[0].text).toBe(NOTE_OPENERS.dazed[0]);
    expect(lines.some((l) => NOTE_TEMPLATES.retry.light.includes(l.text))).toBe(true);
  });

  it("确定性：同输入两次生成逐字节一致", () => {
    const i = input({ dangerousCommands: [{ sev: "red" }], retryBursts: 9 });
    const kinds = triggerNotes(i);
    const mood = whaleMood(i);
    const a = buildWhaleNote(kinds, mood, "spicy", 9).map((l) => l.text);
    const b = buildWhaleNote(kinds, mood, "spicy", 9).map((l) => l.text);
    expect(a).toEqual(b);
    expect(a.join("\n")).toContain("第 9 次");
  });

  it("次要触发以 aside 形式出现", () => {
    const i = input({ retryBursts: 5, hourHistogram: new Array(24).fill(0).map((_, h) => (h < 6 ? 30 : 1)) });
    const kinds = triggerNotes(i);
    const mood = whaleMood(i);
    const lines = buildWhaleNote(kinds, mood, "light");
    expect(lines.some((l) => l.kind === "aside")).toBe(true);
  });
});
