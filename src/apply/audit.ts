/**
 * Audit —— append-only 审计日志（RFC §10/§29）。
 * 只记录: timestamp / applyId / improvementId / target 路径 / action / result / code。
 * 不存: before/after 值、secret、完整 prompt、session payload、错误正文。
 */
import type { AuditAction, AuditEvent } from "./types.js";

export interface KvTableLike {
  put(key: string, value: unknown): Promise<void> | void;
  get(key: string): unknown | undefined;
}

export class AuditLogger {
  private seq = 0;
  /** 实例随机段：防多 logger 同表时 id 碰撞（生产单例，测试可多实例）。 */
  private readonly instance = Math.random().toString(36).slice(2, 6);

  constructor(private readonly table: KvTableLike) {}

  /** 追加一条审计事件(append-only: 只 put,永不覆盖既有 id)。 */
  async append(event: Omit<AuditEvent, "id" | "ts">): Promise<void> {
    this.seq += 1;
    const id = `${Date.now().toString(36)}-${this.instance}-${this.seq.toString(36)}`;
    const full: AuditEvent = { id, ts: Date.now(), ...event };
    await this.table.put(id, full);
  }

  list(limit = 200): AuditEvent[] {
    const raw = (this.table as unknown as { entries?: () => IterableIterator<[string, AuditEvent]> | [string, AuditEvent][] }).entries?.() ?? [];
    const entries = [...raw];
    return entries
      .map(([, v]) => v)
      .sort((a, b) => (a.ts === b.ts ? (a.id < b.id ? -1 : 1) : a.ts - b.ts))
      .slice(-limit);
  }
}
