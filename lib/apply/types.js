/**
 * v0.6 Apply & Verify — 共享类型（RFC §7-§13 + §29 修订）。
 * 只允许一种 mutation：settings `shell.timeoutMs`（allowlist 单字段）。
 */
/** Apply/Verify 结构化错误(不把 raw DSH error 抛给前端)。 */
export class ApplyError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ApplyError";
    }
}
export const APPLY_ERROR_CODES = {
    CONFIG_CHANGED: "CONFIG_CHANGED",
    IN_PROGRESS: "IN_PROGRESS",
    INVALID_PROPOSAL: "INVALID_PROPOSAL",
    TARGET_CHANGED: "TARGET_CHANGED",
    SETTINGS_CONFLICT: "SETTINGS_CONFLICT",
    APPLY_FAILED: "APPLY_FAILED",
    REVERT_FAILED: "REVERT_FAILED",
    SETTINGS_UNAVAILABLE: "SETTINGS_UNAVAILABLE",
    NOT_APPLICABLE: "NOT_APPLICABLE",
    ALREADY_APPLIED: "ALREADY_APPLIED",
    ALREADY_REVERTED: "ALREADY_REVERTED",
};
//# sourceMappingURL=types.js.map