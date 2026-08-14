/**
 * 「鲸鱼记事本」插件入口 —— cordis 三件套。
 *
 * 与 dsh-study 一样的骨架，但依赖的是另一个官方接缝：
 *   sessionQuery —— 会话查询服务（列表 + 完整日志读取）。
 * 默认 web profile 已挂载（dsh-session-query + sqlite 后端），
 * 所以 bundle patch 里除了插入自己，什么都不用带。
 */
import type { Context } from "@deepseek-ai/cordis";
export declare const name = "whale-report-core";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map