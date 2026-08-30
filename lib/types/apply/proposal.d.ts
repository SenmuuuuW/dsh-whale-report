/**
 * Proposal Builder（RFC §5/§29-C/D）。
 * 只有全部条件满足才生成 shell.timeoutMs proposal:
 * - 现有 Repeated Tool Failure(improve-tool-bash)存在
 * - tool family = shell/bash(Phase 1: 'bash')
 * - timeout evidence ≥ 5 事件 且 ≥ 3 会话(§29-C,真实数据校准)
 * - shell.timeoutMs 可读、before positive finite、before < safety cap
 * - after = min(before * 2, maxTimeoutMs) > before
 * - reversible = true
 * web_search 等非 shell 工具的 timeout 绝不可能生成 shell proposal(§29-A)。
 */
import type { ReportStats } from "../stats.js";
import type { ImprovementItem } from "../improvements.js";
import type { ApplyProposal } from "./types.js";
import type { ShellTimeoutRead } from "./settings-adapter.js";
/** shell/bash 工具家族(Phase 1 唯一: bash 工具注册名)。 */
export declare const SHELL_TOOLS: ReadonlySet<string>;
/** Proposal eligibility 阈值(§29-C,真实数据校准: 41 例/6 会话)。 */
export declare const SHELL_TIMEOUT_MIN_EVENTS = 5;
export declare const SHELL_TIMEOUT_MIN_SESSIONS = 3;
/** DeepTrace 自身 safety cap(不是 DSH 官方 hard cap;DSH 仅 positive-finite 校验 + clampTimeout)。 */
export declare const DEEPTRACE_SAFETY_CAP_MS = 600000;
/** Verify 默认参数。 */
export declare const VERIFY_COOLDOWN_MS: number;
export declare const VERIFY_MAX_OBSERVATION_MS: number;
export declare const VERIFY_BASELINE_LOOKBACK_MS: number;
export declare const VERIFY_MIN_OBSERVATIONS = 10;
export declare const VERIFY_MIN_SESSIONS = 3;
export declare const VERIFY_TARGET_ABSOLUTE_CAP = 0.08;
export declare function buildShellTimeoutProposal(input: {
    improvement: ImprovementItem | null;
    stats: ReportStats;
    settings: ShellTimeoutRead | null;
    now: number;
}): ApplyProposal | null;
//# sourceMappingURL=proposal.d.ts.map