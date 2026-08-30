/**
 * PROPOSAL BUILDER（RFC §5/§29-C/D）:
 * - resolved 当前值(before=运行时值,不假设源码默认)
 * - after = min(before*2, maxTimeoutMs), cap 600000
 * - at cap 不生成
 * - revision 捕获
 * - web_search timeout 绝不生成 shell proposal; bash 可以
 * - 阈值 <5 事件 / <3 会话不生成
 */
import { describe, expect, it } from "vitest";
import { buildShellTimeoutProposal, DEEPTRACE_SAFETY_CAP_MS, SHELL_TIMEOUT_MIN_EVENTS, SHELL_TIMEOUT_MIN_SESSIONS } from "../src/apply/proposal.js";
import { makeBashImprovement, makeStats } from "./apply-harness.js";

const NOW = 1_789_000_000_000;

function shellStats(counts: Record<string, number>, sessions: Record<string, string[]> = {}): ReturnType<typeof makeStats> {
  const s = makeStats();
  s.toolTimeouts = counts;
  s.toolTimeoutSessions = sessions;
  s.toolCalls = { ...counts, bash: Math.max(100, Object.values(counts).reduce((a, b) => a + b, 0)) };
  return s;
}

describe("proposal builder（shell.timeoutMs allowlist）", () => {
  it("满足全部条件 → 生成; after = min(before*2, maxTimeoutMs); before 取运行时 resolved 值", () => {
    const stats = shellStats({ bash: 6 }, { bash: ["s1", "s2", "s3"] });
    const p = buildShellTimeoutProposal({
      improvement: makeBashImprovement(),
      stats,
      settings: { value: 60_000, maxTimeoutMs: 600_000, revision: 3 },
      now: NOW,
    });
    expect(p).not.toBeNull();
    expect(p!.expectedBefore).toBe(60_000); // runtime resolved, 不是源码默认 120000
    expect(p!.proposedAfter).toBe(120_000);
    expect(p!.diff).toEqual({ op: "set", path: ["timeoutMs"], before: 60_000, after: 120_000 });
    expect(p!.revisionAtProposal).toBe(3);
    expect(p!.risk).toBe("low");
    expect(p!.reversible).toBe(true);
    expect(p!.rollbackPlan.value).toBe(60_000);
    expect(p!.verificationPlan.metric).toBe("shell_timeout_rate");
  });

  it("runtime cap 低于 DeepTrace cap 时取 min(runtime, cap)", () => {
    const stats = shellStats({ bash: 8 }, { bash: ["s1", "s2", "s3", "s4"] });
    const p = buildShellTimeoutProposal({
      improvement: makeBashImprovement(),
      stats,
      settings: { value: 100_000, maxTimeoutMs: 150_000, revision: 0 },
      now: NOW,
    });
    expect(p!.proposedAfter).toBe(150_000); // min(200k, 150k)
  });

  it("before >= cap 不生成; after 不超 cap", () => {
    const stats = shellStats({ bash: 8 }, { bash: ["s1", "s2", "s3"] });
    const p = buildShellTimeoutProposal({
      improvement: makeBashImprovement(),
      stats,
      settings: { value: DEEPTRACE_SAFETY_CAP_MS, maxTimeoutMs: 1_200_000, revision: 0 },
      now: NOW,
    });
    expect(p).toBeNull();
    const p2 = buildShellTimeoutProposal({
      improvement: makeBashImprovement(),
      stats,
      settings: { value: 400_000, maxTimeoutMs: 1_200_000, revision: 0 },
      now: NOW,
    });
    expect(p2!.proposedAfter).toBe(DEEPTRACE_SAFETY_CAP_MS); // min(800k, 600k cap)
  });

  it("web_search timeout 绝不生成 shell proposal（错误 target attribution 防护）", () => {
    const stats = shellStats({ web_search: 20 }, { web_search: ["s1", "s2", "s3", "s4", "s5"] });
    stats.toolTimeouts.bash = 0;
    const p = buildShellTimeoutProposal({
      improvement: makeBashImprovement(), // improve 命中的是 bash
      stats,
      settings: { value: 60_000, maxTimeoutMs: 600_000, revision: 0 },
      now: NOW,
    });
    // bash 自身无 timeout evidence → 不生成（web_search 的 timeout 不能驱动 shell proposal）
    expect(p).toBeNull();
    // 即使 improve 是 web_search（非 shell 家族），也不生成 shell proposal
    const wsStats = shellStats({ web_search: 20 }, { web_search: ["s1", "s2", "s3", "s4", "s5"] });
    const wsItem = makeBashImprovement({ id: "improve-tool-web-search", title: "web_search 工具重复失败", evidence: { ...makeBashImprovement().evidence, affectedTools: ["web_search"] } });
    const p2 = buildShellTimeoutProposal({ improvement: wsItem, stats: wsStats, settings: { value: 60_000, maxTimeoutMs: 600_000, revision: 0 }, now: NOW });
    expect(p2).toBeNull();
  });

  it(`阈值: <${SHELL_TIMEOUT_MIN_EVENTS} 事件不生成; <${SHELL_TIMEOUT_MIN_SESSIONS} 会话不生成`, () => {
    const statsFew = shellStats({ bash: SHELL_TIMEOUT_MIN_EVENTS - 1 }, { bash: ["s1", "s2", "s3"] });
    expect(buildShellTimeoutProposal({ improvement: makeBashImprovement(), stats: statsFew, settings: { value: 60_000, maxTimeoutMs: 600_000, revision: 0 }, now: NOW })).toBeNull();
    const statsFewSess = shellStats({ bash: 8 }, { bash: ["s1", "s2"] });
    expect(buildShellTimeoutProposal({ improvement: makeBashImprovement(), stats: statsFewSess, settings: { value: 60_000, maxTimeoutMs: 600_000, revision: 0 }, now: NOW })).toBeNull();
  });

  it("无 improve 项 / 非 TOOL 类别 / 非 bash 工具 → 不生成", () => {
    const stats = shellStats({ bash: 8 }, { bash: ["s1", "s2", "s3"] });
    expect(buildShellTimeoutProposal({ improvement: null, stats, settings: { value: 60_000, maxTimeoutMs: 600_000, revision: 0 }, now: NOW })).toBeNull();
    const costItem = makeBashImprovement({ id: "improve-cost-peak-shift", category: "COST" });
    expect(buildShellTimeoutProposal({ improvement: costItem, stats, settings: { value: 60_000, maxTimeoutMs: 600_000, revision: 0 }, now: NOW })).toBeNull();
    const editItem = makeBashImprovement({ id: "improve-tool-edit", evidence: { ...makeBashImprovement().evidence, affectedTools: ["edit"] } });
    expect(buildShellTimeoutProposal({ improvement: editItem, stats, settings: { value: 60_000, maxTimeoutMs: 600_000, revision: 0 }, now: NOW })).toBeNull();
  });

  it("settings 不可读 / before 非法 → 不生成", () => {
    const stats = shellStats({ bash: 8 }, { bash: ["s1", "s2", "s3"] });
    expect(buildShellTimeoutProposal({ improvement: makeBashImprovement(), stats, settings: null, now: NOW })).toBeNull();
    expect(buildShellTimeoutProposal({ improvement: makeBashImprovement(), stats, settings: { value: -5, maxTimeoutMs: 600_000, revision: 0 }, now: NOW })).toBeNull();
  });

  it("普通 bash failure（非 timeout）绝不生成 timeout proposal", () => {
    const stats = makeStats();
    stats.toolTimeouts = {};
    stats.toolCalls = { bash: 500 };
    stats.toolTimeoutSessions = {};
    stats.toolFailedSessions = { bash: ["s1", "s2", "s3", "s4"] };
    const p = buildShellTimeoutProposal({
      improvement: makeBashImprovement(),
      stats,
      settings: { value: 60_000, maxTimeoutMs: 600_000, revision: 0 },
      now: NOW,
    });
    expect(p).toBeNull();
  });

  it("proposal 不保存敏感内容（只存数字 + 会话 id）", () => {
    const stats = shellStats({ bash: 8 }, { bash: ["s1", "s2", "s3"] });
    const p = buildShellTimeoutProposal({ improvement: makeBashImprovement(), stats, settings: { value: 60_000, maxTimeoutMs: 600_000, revision: 0 }, now: NOW });
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/command|content|output|secret|session正文|ssh-|ghp_/i);
    expect(p!.evidence.timeoutSessions).toEqual(["s1", "s2", "s3"]);
  });
});
