/**
 * Audit —— append-only 审计日志（RFC §10/§29）。
 * 只记录: timestamp / applyId / improvementId / target 路径 / action / result / code。
 * 不存: before/after 值、secret、完整 prompt、session payload、错误正文。
 */
import type { AuditEvent } from "./types.js";
export interface KvTableLike {
    put(key: string, value: unknown): Promise<void> | void;
    get(key: string): unknown | undefined;
}
export declare class AuditLogger {
    private readonly table;
    private seq;
    /** 实例随机段：防多 logger 同表时 id 碰撞（生产单例，测试可多实例）。 */
    private readonly instance;
    constructor(table: KvTableLike);
    /** 追加一条审计事件(append-only: 只 put,永不覆盖既有 id)。 */
    append(event: Omit<AuditEvent, "id" | "ts">): Promise<void>;
    list(limit?: number): AuditEvent[];
}
//# sourceMappingURL=audit.d.ts.map