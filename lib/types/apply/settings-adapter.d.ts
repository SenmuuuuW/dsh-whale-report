/** DSH settings seam 的最小结构化视图(Phase 0.5 实测 shape)。 */
export interface SettingsSeam {
    writable: boolean;
    documentPath?: string;
    describe(options?: {
        redactSecrets?: boolean;
    }): SettingsDescriptor[];
    update(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<void>;
}
export interface SettingsDescriptor {
    ns: string;
    value: unknown;
    revision: number;
    applies?: string;
    secrets?: {
        path: string[];
        set: boolean;
    }[];
}
/** shell 命名空间可读结果(allowlist 数值 + revision)。 */
export interface ShellTimeoutRead {
    value: number;
    maxTimeoutMs: number;
    revision: number;
}
export declare const SHELL_NS = "shell";
/**
 * allowlist-only settings 适配器。
 * 关键：持有 getter 而非值 —— settings seam 可能是懒注入（插件启动后某时刻才提供），
 * 每次操作时解析当前 seam，避免构造时拿到 null 后永久降级。
 */
export declare class SettingsAdapter {
    private readonly getSettings;
    constructor(getSettings: () => SettingsSeam | null);
    private seam;
    available(): boolean;
    writable(): boolean;
    /** 只读 allowlisted 路径: shell.timeoutMs / shell.maxTimeoutMs + revision。 */
    readShellTimeout(): ShellTimeoutRead | null;
    /**
     * 唯一允许的 mutation: shell.timeoutMs。
     * expectedValue + expectedRevision 双校验(先自检,再靠 seam 原生 fence)。
     */
    updateShellTimeout(opts: {
        expectedRevision: number;
        expectedValue: number;
        nextValue: number;
    }): Promise<{
        value: number;
        revision: number;
    }>;
}
//# sourceMappingURL=settings-adapter.d.ts.map