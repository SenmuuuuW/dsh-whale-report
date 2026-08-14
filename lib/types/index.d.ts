/**
 * 「鲸鱼记事本」插件入口 —— cordis 三件套。
 *
 * 宿主 half 的四个接缝：
 *   tools        —— whale_report 聊天工具（对话路径）
 *   sessionQuery —— 会话日志读取（数据源）
 *   storageDomain—— 报告历史持久化（whale 域）
 *   web 路由服务 —— /whale/api 面板数据通道（专属界面路径）
 *
 * ⚠️ web 路由服务名随快照漂移：npm 0.1.0-rc.6 提供 "webServer"，
 * 较新的 source 快照改名为 "httpServer"。因此它不进顶层 inject
 * （顶层 inject 缺失会让整个插件 pending → 插件树启动失败），
 * 而是用两个惰性 ctx.inject 兜底：哪个服务存在就用哪个。
 * 惰性注入在服务缺失时只是不执行回调，绝不会卡住启动。
 */
import type { Context } from "@deepseek-ai/cordis";
export declare const name = "whale-report-core";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map