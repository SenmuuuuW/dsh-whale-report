/**
 * 「鲸鱼记事本」插件入口 —— cordis 三件套。
 *
 * 宿主 half 现在有四个接缝：
 *   tools        —— whale_report 聊天工具（对话路径）
 *   sessionQuery —— 会话日志读取（数据源）
 *   storageDomain—— 报告历史持久化（whale 域）
 *   webServer    —— /whale/api 面板数据通道（专属界面路径）
 * 浏览器 half（src/client）通过 package.json 的 dsh.client 声明注册，
 * 由官方 client-modules 接缝装载。
 */
import type { Context } from "@deepseek-ai/cordis";
export declare const name = "whale-report-core";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map