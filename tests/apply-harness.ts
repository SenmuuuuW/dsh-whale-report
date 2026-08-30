/**
 * v0.6 Apply & Verify 测试共享 harness（非测试文件）。
 * FakeSettingsSeam 复刻 Phase 0.5 实测的 seam 语义:
 * - monotonic revision, 仅在有实质变化时 +1(同值写不增)
 * - stale write 抛 {code:'SETTINGS_CONFLICT', expected, actual}
 * - describe 返回 redacted view
 */
import type { SettingsSeam } from "../src/apply/settings-adapter.js";
import { emptyStats, type Period, type ReportStats } from "../src/stats.js";
import type { ImprovementItem } from "../src/improvements.js";

export class FakeSettingsSeam implements SettingsSeam {
  writable = true;
  documentPath = "/tmp/fake/settings.yaml";
  revision = 0;

  constructor(private current: Record<string, unknown>) {}

  describe() {
    return [{ ns: "shell", value: { ...this.current }, revision: this.revision, applies: "live", secrets: [] }];
  }

  async update(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<void> {
    if (ns !== "shell") throw new Error(`unknown namespace ${ns}`);
    if (expectedRevision !== undefined && expectedRevision !== this.revision) {
      const err = new Error(
        `settings namespace "shell" changed since it was read (expected revision ${expectedRevision}, now ${this.revision})`,
      ) as Error & { code: string; expected: number; actual: number };
      err.code = "SETTINGS_CONFLICT";
      err.expected = expectedRevision;
      err.actual = this.revision;
      throw err;
    }
    const next = { ...this.current, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.current)) return; // 同值写不增 revision（实测语义）
    this.current = next;
    this.revision += 1;
  }
}

export interface TableLike {
  put(key: string, value: unknown): void;
  get(key: string): unknown | undefined;
  entries(): [string, unknown][];
}

export function fakeTable(): TableLike {
  const m = new Map<string, unknown>();
  return {
    put: (k, v) => void m.set(k, v),
    get: (k) => m.get(k),
    entries: () => [...m.entries()],
  };
}

export function fakeDomain(): { table(name: string): TableLike } {
  const tables = new Map<string, TableLike>();
  return {
    table(name: string): TableLike {
      let t = tables.get(name);
      if (t === undefined) {
        t = fakeTable();
        tables.set(name, t);
      }
      return t;
    },
  };
}

export function makeStats(): ReportStats {
  return emptyStats({ from: 0, to: Date.now() } as Period);
}

/** 构造 improve-tool-bash 形态的 ImprovementItem。 */
export function makeBashImprovement(overrides: Partial<ImprovementItem> = {}): ImprovementItem {
  return {
    id: "improve-tool-bash",
    period: "wk-2026-W34",
    category: "TOOL",
    severity: "MEDIUM",
    title: "bash 工具重复失败（12.3%）",
    summary: "失败跨 3 个会话重复出现。",
    evidence: {
      metrics: { calls: 100, failures: 12, failureRate: 12, sessions: 3, mainCodeCount: 8, p95Ms: 8000 },
      affectedTools: ["bash"],
      affectedSessions: ["s1", "s2", "s3"],
      affectedModels: [],
      affectedProviders: [],
      occurrences: 3,
      confidence: 0.8,
    },
    recommendation: "为 bash 调用增加前置条件检查。",
    verificationPlan: { targetMetric: "bash failure rate", baseline: 12, target: "< 9.6%", window: "next 7 days" },
    status: "DETECTED",
    createdAt: 1_789_000_000_000,
    ...overrides,
  };
}

export interface RawEv {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
}

export function ev(type: string, time: number, data: Record<string, unknown>): RawEv {
  return { type, seq: 0, time, data };
}

/** bash 预算超时文本结果（Path B 形态,isError=false）。 */
export function bashTimedOutResult(callId: string, budgetMs: number): Record<string, unknown> {
  return {
    message: {
      source: { callId },
      content: [{ type: "text", text: `(no output)\n[timed out after ${budgetMs}ms]\n[killed by signal: SIGTERM]` }],
    },
  };
}

/** wrapper 超时错误结果（Path A 形态,isError=true）。 */
export function codeTimedOutResult(callId: string): Record<string, unknown> {
  return {
    error: { code: "TOOL_TIMEOUT", message: "tool call timed out", info: { name: "ToolTimeoutError", code: "TOOL_TIMEOUT" } },
    message: { source: { callId }, content: [{ type: "text", text: "Error: tool call timed out" }] },
  };
}

/** 普通 bash 失败(非 timeout)结果。 */
export function bashFailedResult(callId: string, text: string): Record<string, unknown> {
  return {
    error: { code: "ENOENT", message: "no such file" },
    message: { source: { callId }, content: [{ type: "text", text }] },
  };
}

/** 会话事件序列: tool/call + tool/result。 */
export function toolPair(tool: string, callId: string, time: number, result: Record<string, unknown>): RawEv[] {
  return [
    ev("tool/call", time, { name: tool, callId }),
    ev("tool/result", time + 1000, result),
  ];
}
