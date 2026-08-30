/**
 * SettingsAdapter —— DSH settings seam 的 allowlist 封装（Phase 1 唯一允许:
 * namespace "shell" × path "timeoutMs"）。
 *
 * 设计约束（RFC §3/§29）:
 * - 任意 namespace / 任意 patch 的 mutation 在类型与运行时两层都不可达;
 * - 只读 allowlisted 路径(shell.timeoutMs / shell.maxTimeoutMs)与 revision;
 * - 写入必须携带 expectedRevision + expectedValue,seam 原生 revision fence
 *   (SETTINGS_CONFLICT) 映射为结构化 CONFIG_CHANGED;
 * - settings seam 不可用 → 优雅降级(SETTINGS_UNAVAILABLE),不 crash 插件。
 */
import { ApplyError, APPLY_ERROR_CODES } from "./types.js";

/** DSH settings seam 的最小结构化视图(Phase 0.5 实测 shape)。 */
export interface SettingsSeam {
  writable: boolean;
  documentPath?: string;
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptor[];
  update(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<void>;
}

export interface SettingsDescriptor {
  ns: string;
  value: unknown;
  revision: number;
  applies?: string;
  secrets?: { path: string[]; set: boolean }[];
}

/** shell 命名空间可读结果(allowlist 数值 + revision)。 */
export interface ShellTimeoutRead {
  value: number;
  maxTimeoutMs: number;
  revision: number;
}

export const SHELL_NS = "shell";

/**
 * allowlist-only settings 适配器。
 * 关键：持有 getter 而非值 —— settings seam 可能是懒注入（插件启动后某时刻才提供），
 * 每次操作时解析当前 seam，避免构造时拿到 null 后永久降级。
 */
export class SettingsAdapter {
  constructor(private readonly getSettings: () => SettingsSeam | null) {}

  private seam(): SettingsSeam | null {
    const s = this.getSettings();
    return s !== null && typeof s.describe === "function" ? s : null;
  }

  available(): boolean {
    return this.seam() !== null;
  }

  writable(): boolean {
    return this.seam()?.writable === true;
  }

  /** 只读 allowlisted 路径: shell.timeoutMs / shell.maxTimeoutMs + revision。 */
  readShellTimeout(): ShellTimeoutRead | null {
    const settings = this.seam();
    if (settings === null) return null;
    const d = settings.describe({ redactSecrets: true }).find((x) => String(x.ns) === SHELL_NS);
    if (d === undefined) return null;
    const v = d.value as Record<string, unknown> | undefined;
    if (typeof v !== "object" || v === null) return null;
    const t = v.timeoutMs;
    const m = v.maxTimeoutMs;
    if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return null;
    const max = typeof m === "number" && Number.isFinite(m) && m > 0 ? m : Number.POSITIVE_INFINITY;
    return { value: t, maxTimeoutMs: max, revision: d.revision };
  }

  /**
   * 唯一允许的 mutation: shell.timeoutMs。
   * expectedValue + expectedRevision 双校验(先自检,再靠 seam 原生 fence)。
   */
  async updateShellTimeout(opts: { expectedRevision: number; expectedValue: number; nextValue: number }): Promise<{ value: number; revision: number }> {
    const settings = this.seam();
    if (settings === null) throw new ApplyError(APPLY_ERROR_CODES.SETTINGS_UNAVAILABLE, "settings seam unavailable");
    if (!settings.writable) throw new ApplyError(APPLY_ERROR_CODES.SETTINGS_UNAVAILABLE, "settings provider is read-only");
    const before = this.readShellTimeout();
    if (before === null) throw new ApplyError(APPLY_ERROR_CODES.SETTINGS_UNAVAILABLE, "shell namespace unreadable");
    if (before.value !== opts.expectedValue) {
      throw new ApplyError(APPLY_ERROR_CODES.CONFIG_CHANGED, `value changed since read (expected ${opts.expectedValue}, now ${before.value})`);
    }
    try {
      await settings.update(SHELL_NS, { timeoutMs: opts.nextValue }, opts.expectedRevision);
    } catch (error) {
      // seam 原生 stale-write 拒绝: SettingsConflictError { code:'SETTINGS_CONFLICT', expected, actual }
      if (error instanceof Error && "code" in error && (error as { code?: string }).code === "SETTINGS_CONFLICT") {
        throw new ApplyError(APPLY_ERROR_CODES.CONFIG_CHANGED, `settings changed since read (${String((error as { expected?: number }).expected)} -> ${String((error as { actual?: number }).actual)})`);
      }
      throw new ApplyError(APPLY_ERROR_CODES.APPLY_FAILED, `settings update failed: ${error instanceof Error ? error.name : "unknown"}`);
    }
    const after = this.readShellTimeout();
    if (after === null) throw new ApplyError(APPLY_ERROR_CODES.APPLY_FAILED, "shell namespace unreadable after update");
    return { value: after.value, revision: after.revision };
  }
}
