/**
 * DeepTrace Core 公开入口（稳定导出子路径：`dsh-whale-report/core`）。
 *
 * 只做 re-export，不做任何实现改动：
 *  - stats / insights / collaboration / whale-notes / pricing / report 全部
 *    与插件宿主、CLI 共用同一份实现（单一数据来源）；
 *  - state.ts 只 re-export 类型（其运行时会 import dsh-storage-domain，
 *    纯逻辑消费者不应触发该依赖加载）；
 *  - balance.ts 为 Node-only（node:fs / fetch），随 core 提供，供
 *    Web 面板之外的消费者（TUI 等）复用 Provider Balance 能力。
 *
 * 消费者：dsh-deeptrace-tui（终端版）。Web 面板行为不受影响。
 */
export * from "./stats.js";
export * from "./insights.js";
export * from "./collaboration.js";
export * from "./whale-notes.js";
export * from "./pricing.js";
export * from "./report.js";
export * from "./whale-copy.js";
export * from "./balance.js";
//# sourceMappingURL=core.js.map