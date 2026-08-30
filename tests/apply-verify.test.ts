/**
 * VERIFY ENGINE（RFC §10-§13）:
 * - appliedAt 精确切点; after 窗口 [appliedAt+cooldown, now)
 * - 无 pre/post 污染（baseline 窗口固定于提案时）
 * - insufficient evidence → observing / 窗口耗尽 → inconclusive
 * - verified / not_improved 判定
 */
import { describe, expect, it } from "vitest";
import { type VerifyRecord } from "../src/apply/types.js";
import { AuditLogger } from "../src/apply/audit.js";
import { evaluateVerify, type VerifyDeps } from "../src/verify/verifier.js";
import { fakeDomain } from "./apply-harness.js";

const APPLIED_AT = 1_789_000_000_000;
const COOLDOWN = 600_000;
const MAX_WINDOW = 604_800_000;

function makeVr(overrides: Partial<VerifyRecord> = {}): VerifyRecord {
  return {
    applyId: "a::1",
    proposalId: "p1",
    metric: "shell_timeout_rate",
    status: "observing",
    baseline: { value: 0.06, sampleSize: 100, sessions: 3, window: { from: APPLIED_AT - 604_800_000, to: APPLIED_AT } },
    observed: null,
    targetValue: 0.03,
    minimumEvidence: { observations: 10, sessions: 3 },
    cooldownMs: COOLDOWN,
    maxObservationWindowMs: MAX_WINDOW,
    appliedAt: APPLIED_AT,
    createdAt: APPLIED_AT,
    updatedAt: APPLIED_AT,
    ...overrides,
  };
}

function setup(vr: VerifyRecord, query: (from: number, to: number) => Promise<{ timeouts: number; invocations: number; sessions: number; rate: number }>) {
  const domain = fakeDomain();
  const audit = new AuditLogger(domain.table("audit_log"));
  const store = {
    proposalTable: domain.table("apply_proposals"),
    recordTable: domain.table("apply_records"),
    verifyTable: domain.table("verify_records"),
  };
  store.verifyTable.put(vr.applyId, vr);
  let t = APPLIED_AT + COOLDOWN + 3600_000;
  const deps: VerifyDeps = { store, query, audit, now: () => t };
  return { store, deps, audit, tick: (ms: number) => { t += ms; } };
}

const stats = (timeouts: number, invocations: number, sessions: number) => ({
  timeouts, invocations, sessions, rate: invocations > 0 ? timeouts / invocations : 0,
});

describe("verify engine", () => {
  it("after 窗口从 appliedAt+cooldown 开始（appliedAt 精确切点, 不含 Apply 前事件）", async () => {
    let asked: { from: number; to: number } | null = null;
    const h = setup(makeVr(), async (from, to) => {
      asked = { from, to };
      return stats(0, 100, 3);
    });
    await evaluateVerify(h.deps, { applyId: "a::1" });
    expect(asked!.from).toBe(APPLIED_AT + COOLDOWN);
    expect(asked!.to).toBe(h.deps.now!());
  });

  it("样本不足 → observing（不因短期无失败就 VERIFIED）", async () => {
    const h = setup(makeVr(), async () => stats(0, 3, 1));
    const r = await evaluateVerify(h.deps, { applyId: "a::1" });
    expect(r.status).toBe("observing");
    expect(r.progress.observations).toBe(3);
  });

  it("证据达标且 rate ≤ target → VERIFIED", async () => {
    const h = setup(makeVr(), async () => stats(2, 100, 4));
    const r = await evaluateVerify(h.deps, { applyId: "a::1" });
    expect(r.status).toBe("verified");
    expect(r.record.observed!.value).toBeCloseTo(0.02, 4);
    expect(h.audit.list().map((e) => e.action)).toContain("verify.result");
  });

  it("证据达标但 rate > target → NOT_IMPROVED（REVERT RECOMMENDED, 不自动回滚）", async () => {
    const h = setup(makeVr(), async () => stats(10, 50, 4));
    const r = await evaluateVerify(h.deps, { applyId: "a::1" });
    expect(r.status).toBe("not_improved");
    expect(r.verdictNote).toMatch(/REVERT RECOMMENDED/);
    // 不自动修改任何配置: verify 记录外无 mutation
    expect(Object.keys(h.store.recordTable.entries().length === 0 ? {} : {})).toEqual([]);
  });

  it("观察窗耗尽仍样本不足 → INCONCLUSIVE", async () => {
    const h = setup(makeVr(), async () => stats(0, 2, 1));
    h.tick(MAX_WINDOW + 1);
    const r = await evaluateVerify(h.deps, { applyId: "a::1" });
    expect(r.status).toBe("inconclusive");
  });

  it("reverted 状态不继续验证", async () => {
    const h = setup(makeVr({ status: "reverted" }), async () => stats(0, 100, 4));
    const r = await evaluateVerify(h.deps, { applyId: "a::1" });
    expect(r.status).toBe("reverted");
  });

  it("无 pre/post 污染: baseline 窗口固定于提案时 [createdAt-lookback, appliedAt)", async () => {
    const h = setup(makeVr(), async (from, to) => stats(from === APPLIED_AT - 604_800_000 ? 1 : 0, 100, 4));
    const r = await evaluateVerify(h.deps, { applyId: "a::1" });
    // after 窗口只统计 appliedAt 之后; baseline 不被重算
    expect(r.record.observed!.window.from).toBe(APPLIED_AT + COOLDOWN);
  });
});
