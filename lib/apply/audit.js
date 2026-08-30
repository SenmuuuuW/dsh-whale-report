export class AuditLogger {
    table;
    seq = 0;
    /** 实例随机段：防多 logger 同表时 id 碰撞（生产单例，测试可多实例）。 */
    instance = Math.random().toString(36).slice(2, 6);
    constructor(table) {
        this.table = table;
    }
    /** 追加一条审计事件(append-only: 只 put,永不覆盖既有 id)。 */
    async append(event) {
        this.seq += 1;
        const id = `${Date.now().toString(36)}-${this.instance}-${this.seq.toString(36)}`;
        const full = { id, ts: Date.now(), ...event };
        await this.table.put(id, full);
    }
    list(limit = 200) {
        const raw = this.table.entries?.() ?? [];
        const entries = [...raw];
        return entries
            .map(([, v]) => v)
            .sort((a, b) => (a.ts === b.ts ? (a.id < b.id ? -1 : 1) : a.ts - b.ts))
            .slice(-limit);
    }
}
//# sourceMappingURL=audit.js.map