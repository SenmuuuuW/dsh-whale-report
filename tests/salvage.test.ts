/**
 * P0 salvage — 只读恢复官方读取器拒读的会话日志。
 *
 * 覆盖（验收要求）：
 * 1. torn tail JSONL：100 条完整 + 1 条残缺 → 100 条全部统计、droppedRecords=1、partial=true
 * 2. 中间 corruption → 不静默越过 → unsafe（整 session skip fallback）
 * 3. 完全无效 zstd → whole-session skip
 * 4. salvage 前后原始文件 hash 完全不变
 * 5. 无 header / 空文件 → unsafe
 * 6. collectEvents 集成：官方 readSession 抛错 → 直读恢复进入聚合
 */
import { afterEach, describe, expect, it } from "vitest";
import { zstdCompressSync as compress } from "node:zlib";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findSessionLogPath, salvageSessionFile, splitZstdFrames, type SalvageResult } from "../src/salvage.js";
import { collectEvents, type ReportServices } from "../src/tools.js";

const HOMES: string[] = [];
function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "whale-salvage-"));
  HOMES.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of HOMES.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 写入一个多帧 zstd 会话日志（每帧一条或多条 record，模拟 harness append）。 */
function writeSessionLog(home: string, sessionId: string, lines: string[]): string {
  const dir = join(home, "sessions", "--cwd--", sessionId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "session.jsonl.zstd");
  const frames: Buffer[] = [];
  for (const line of lines) {
    if (line === "") continue;
    frames.push(Buffer.from(compress(Buffer.from(line + "\n"))));
  }
  writeFileSync(path, Buffer.concat(frames));
  return path;
}

const HEADER = JSON.stringify({ type: "session", version: 0, id: "s-salvage", createdAt: 1785999600000, cwd: "/tmp" });

function eventsOf(lines: string[]): string[] {
  return lines.map((_, i) => JSON.stringify({ type: "turn/start", seq: i, time: 1785999600000 + i * 1000 }));
}

describe("salvageSessionFile — 基础规则", () => {
  it("torn tail：100 条完整 + 1 条残缺 → 100 条全部恢复，droppedRecords=1，不猜残缺", () => {
    const home = tempHome();
    const lines = [HEADER, ...eventsOf(Array.from({ length: 100 })), '{"type":"turn/start","seq":100,"time":1']; // 截断的 tail
    const path = writeSessionLog(home, "s-salvage", lines);
    const r = salvageSessionFile(path);
    expect(r.ok).toBe(true);
    expect(r.sessionId).toBe("s-salvage");
    expect(r.recoveredRecords).toBe(101); // header + 100 完整
    expect(r.events.length).toBe(100);
    expect(r.droppedRecords).toBe(1); // 残缺 tail 丢弃，不按 0 处理
  });

  it("全部完整（无残缺）→ droppedRecords=0", () => {
    const home = tempHome();
    const lines = [HEADER, ...eventsOf(Array.from({ length: 5 }))];
    const r = salvageSessionFile(writeSessionLog(home, "s-ok", lines));
    expect(r.ok).toBe(true);
    expect(r.recoveredRecords).toBe(6);
    expect(r.droppedRecords).toBe(0);
  });

  it("中间 corruption → unsafe（不静默越过无法确认的区域）", () => {
    const home = tempHome();
    const lines = [HEADER, ...eventsOf(Array.from({ length: 3 })), '{"type":"turn/start","seq":3,"tim', ...eventsOf(Array.from({ length: 3 }))];
    const r = salvageSessionFile(writeSessionLog(home, "s-mid", lines));
    expect(r.ok).toBe(false);
    expect(r.failure).toBe("unsafe");
    expect(r.events).toEqual([]);
  });

  it("完全无效 zstd → unsafe（whole-session skip）", () => {
    const home = tempHome();
    const path = join(home, "sessions", "--cwd--", "s-bad", "session.jsonl.zstd");
    mkdirSync(join(home, "sessions", "--cwd--", "s-bad"), { recursive: true });
    writeFileSync(path, Buffer.from("this is definitely not zstd data........"));
    const r = salvageSessionFile(path);
    expect(r.ok).toBe(false);
    expect(r.failure).toBe("unsafe");
  });

  it("无 header 行 → unsafe", () => {
    const home = tempHome();
    const r = salvageSessionFile(writeSessionLog(home, "s-nohdr", eventsOf(Array.from({ length: 3 }))));
    expect(r.ok).toBe(false);
    expect(r.failure).toBe("unsafe");
  });

  it("文件不存在 → read-error", () => {
    const r = salvageSessionFile("/nonexistent/session.jsonl.zstd");
    expect(r.ok).toBe(false);
    expect(r.failure).toBe("read-error");
  });

  it("salvage 前后原始文件 hash 完全不变（只读）", () => {
    const home = tempHome();
    const lines = [HEADER, ...eventsOf(Array.from({ length: 20 })), '{"type":"turn/start","seq":20,"t'];
    const path = writeSessionLog(home, "s-hash", lines);
    const before = createHash("sha256").update(readFileSync(path)).digest("hex");
    const r = salvageSessionFile(path);
    expect(r.ok).toBe(true);
    const after = createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(after).toBe(before);
  });

  it("splitZstdFrames：多帧识别", () => {
    const home = tempHome();
    const path = writeSessionLog(home, "s-frames", [HEADER, ...eventsOf(Array.from({ length: 4 }))]);
    const frames = splitZstdFrames(readFileSync(path));
    expect(frames.length).toBe(5); // header + 4 事件，每帧一条
  });
});

describe("findSessionLogPath", () => {
  it("按会话 id 在 sessions 树下定位日志", () => {
    const home = tempHome();
    const lines = [HEADER, ...eventsOf(Array.from({ length: 2 }))];
    const path = writeSessionLog(home, "s-find", lines);
    expect(findSessionLogPath(home, "s-find")).toBe(path);
    expect(findSessionLogPath(home, "s-missing")).toBeNull();
  });
});

describe("collectEvents 集成 — 官方读取器抛错 → 只读恢复进入聚合", () => {
  it("readSession 抛 corrupt → salvage 恢复 100 条完整记录，partial.salvage 标记", async () => {
    const home = tempHome();
    const lines = [HEADER, ...eventsOf(Array.from({ length: 100 })), '{"type":"turn/start","seq":100,"t'];
    writeSessionLog(home, "s-salvage", lines);

    const index = new Map<string, never>();
    const svc: ReportServices = {
      sessionQuery: {
        async listSessions() {
          return [
            { header: { id: "s-salvage", createdAt: 1785999600000 }, live: false },
            { header: { id: "s-healthy", createdAt: 1785999600000 }, live: false },
          ];
        },
        async readSession(id) {
          if (id === "s-salvage") throw new Error("corrupt Zstandard session log: complete frame contains a torn JSONL record (internal)");
          const evs = eventsOf(Array.from({ length: 3 })).map((l, i) => ({ type: "turn/start" as const, seq: i, time: 1785999600000 + i * 1000, data: {} }));
          return { session: { id }, events: evs };
        },
      },
      index: {
        get: (k) => index.get(k),
        put: async (k, v) => { index.set(k, v as never); },
      },
    };
    const oldHome = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    try {
      const stats = await collectEvents(svc, { from: 1785999600000, to: 1785999600000 + 10 * 24 * 3600 * 1000 });
      expect(stats.sessions).toBe(2); // 健康 + 恢复
      expect(stats.totalEvents).toBe(103);
      expect(stats.partial.skippedCount).toBe(0);
      expect(stats.partial.salvage).toEqual({ recoveredSessions: 1, recoveredRecords: 101, droppedRecords: 1 });
      expect(stats.partial.reasons).toContain("torn-jsonl-tail");
    } finally {
      if (oldHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = oldHome;
    }
  });

  it("salvage 不可恢复（无效 zstd）→ 整 session skip（fallback 保持）", async () => {
    const home = tempHome();
    const dir = join(home, "sessions", "--cwd--", "s-bad");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "session.jsonl.zstd"), Buffer.from("garbage-garbage-garbage"));

    const svc: ReportServices = {
      sessionQuery: {
        async listSessions() {
          return [{ header: { id: "s-bad", createdAt: 1786000000000 }, live: false }];
        },
        async readSession() {
          throw new Error("corrupt Zstandard session log: complete frame contains a torn JSONL record (internal)");
        },
      },
      index: { get: () => undefined, put: async () => {} },
    };
    const oldHome = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    try {
      const stats = await collectEvents(svc, { from: 1785999600000, to: 1785999600000 + 10 * 24 * 3600 * 1000 });
      expect(stats.sessions).toBe(0);
      expect(stats.partial.skippedCount).toBe(1);
      expect(stats.partial.salvage).toBeUndefined();
    } finally {
      if (oldHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = oldHome;
    }
  });
});
