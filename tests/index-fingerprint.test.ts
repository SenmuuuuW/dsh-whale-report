/**
 * P0.1 / P0.2 — session_index 指纹失效 + salvage 缓存。
 *
 * 验收语义：
 *  - 未变化的持久化会话：第二次生成复用索引，不再 read/decompress；
 *  - 文件 mtime/size 变化：仅该会话失效重建；
 *  - salvage 成功结果写入索引：同一损坏文件第二次不再重复解压 22MB；
 *  - 旧条目（无指纹）按"最后写入时间 vs 最后索引事件"判定并回填指纹；
 *  - 无法 stat 源文件 → 保守重建；
 *  - live 会话永远即时读取；
 *  - 索引必须全量（不带 stopAfter），跨周期生成不漏新追加事件。
 */
import { afterEach, describe, expect, it } from "vitest";
import { zstdCompressSync as compress } from "node:zlib";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectEvents, isIndexFresh, newGenerationPerf, type ReportServices, type SessionQueryLike } from "../src/tools.js";
import { buildSessionPathMap, statSessionFile } from "../src/salvage.js";
import { aggregateBuckets, bucketizeOwnEvents, emptyPartial, type HourBucket } from "../src/stats.js";
import type { SessionIndexRecord } from "../src/state.js";

const T0 = 1785999600000;
const PERIOD = { from: T0, to: T0 + 10 * 24 * 3600 * 1000 };
const HOMES: string[] = [];
const OLD_HOME = process.env.DSH_HOME;

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "whale-fp-"));
  HOMES.push(dir);
  process.env.DSH_HOME = dir;
  return dir;
}

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

function eventsOf(count: number, base = T0 + 60_000): string[] {
  return Array.from({ length: count }, (_, i) => JSON.stringify({ type: "turn/start", seq: i, time: base + i * 1000 }));
}

const HEADER = (id: string): string => JSON.stringify({ type: "session", version: 0, id, createdAt: T0, cwd: "/tmp" });

interface Harness {
  svc: ReportServices;
  readCalls: string[];
  index: Map<string, SessionIndexRecord>;
}

function makeSvc(opts: {
  throwing?: Record<string, Error>;
  live?: Record<string, boolean>;
  files: Record<string, { path: string; lines: string[] }>;
}): Harness {
  const index = new Map<string, SessionIndexRecord>();
  const readCalls: string[] = [];
  const query: SessionQueryLike = {
    async listSessions() {
      const ids = [...new Set([...Object.keys(opts.files), ...Object.keys(opts.throwing ?? {})])].sort();
      return ids.map((id) => ({
        header: { id, createdAt: T0 },
        live: opts.live?.[id] ?? false,
      }));
    },
    async readSession(sessionId: string) {
      readCalls.push(sessionId);
      const err = opts.throwing?.[sessionId];
      if (err !== undefined) throw err;
      const file = opts.files[sessionId];
      // 与真实宿主一致：readSession 返回事件流，不含 session header 行。
      const lines = (file?.lines ?? []).filter((l) => !l.startsWith('{"type":"session"'));
      const events = lines.map((l, i) => ({ type: "turn/start" as const, seq: i, time: T0 + 60_000 + i * 1000, data: {} }));
      return { session: { id: sessionId }, events };
    },
  };
  const svc: ReportServices = {
    sessionQuery: query,
    index: {
      get: (k) => index.get(k),
      put: async (k, v) => {
        index.set(k, v);
      },
    },
    periodStats: undefined,
  };
  return { svc, readCalls, index };
}

afterEach(() => {
  for (const dir of HOMES.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (OLD_HOME === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = OLD_HOME;
});

describe("isIndexFresh（指纹判定，纯函数）", () => {
  const stat = { mtimeMs: 1000, size: 100 };
  const entry: SessionIndexRecord = { sessionId: "s", v: 14, builtAt: 5000, lastSeq: 1, lastMs: 900, buckets: [], titles: [], src: { mtimeMs: 1000, size: 100 } };

  it("指纹完全一致 → 新鲜", () => {
    expect(isIndexFresh(entry, stat)).toBe(true);
  });

  it("mtime 变化 → 失效", () => {
    expect(isIndexFresh(entry, { mtimeMs: 2000, size: 100 })).toBe(false);
  });

  it("size 变化 → 失效", () => {
    expect(isIndexFresh(entry, { mtimeMs: 1000, size: 101 })).toBe(false);
  });

  it("版本不匹配 → 失效", () => {
    expect(isIndexFresh({ ...entry, v: 13 }, stat)).toBe(false);
  });

  it("无条目 → 失效", () => {
    expect(isIndexFresh(undefined, stat)).toBe(false);
  });

  it("旧条目（无指纹）：文件最后写入 ≤ 最后索引事件/建索引时刻 → 复用", () => {
    const legacy = { sessionId: "s", v: 14, builtAt: 5000, lastSeq: 1, lastMs: 9000, buckets: [], titles: [] };
    expect(isIndexFresh(legacy, { mtimeMs: 8000, size: 100 })).toBe(true);
    expect(isIndexFresh(legacy, { mtimeMs: 9000, size: 100 })).toBe(true);
    // 最后写入晚于最后索引事件 → 可能漏新事件 → 失效重建
    expect(isIndexFresh(legacy, { mtimeMs: 9001, size: 100 })).toBe(false);
  });

  it("无法 stat 源文件 → 保守失效（无法证明未变）", () => {
    expect(isIndexFresh(entry, null)).toBe(false);
    expect(isIndexFresh({ ...entry, src: undefined }, null)).toBe(false);
  });
});

describe("collectEvents 指纹复用（P0.2）", () => {
  it("未变化会话第二次生成：索引命中，零 read / 零 salvage", async () => {
    const home = tempHome();
    const lines = [HEADER("s-a"), ...eventsOf(20)];
    const path = writeSessionLog(home, "s-a", lines);
    const { svc, readCalls } = makeSvc({ files: { "s-a": { path, lines } } });
    // 预建带指纹的索引（模拟 warmIndex 已完成）
    const built = bucketizeOwnEvents("s-a", lines.map((l, i) => ({ type: "turn/start", seq: i, time: T0 + 60_000 + i * 1000, data: {} })), 0);
    await svc.index.put("s-a", {
      sessionId: "s-a",
      v: 14,
      builtAt: Date.now(),
      lastSeq: built.lastSeq,
      lastMs: built.lastMs,
      buckets: built.buckets,
      titles: built.titles,
      src: statSessionFile(path)!,
    });
    const perf = newGenerationPerf();
    const stats = await collectEvents(svc, PERIOD, perf);
    expect(stats.sessions).toBe(1);
    expect(readCalls).not.toContain("s-a");
    expect(perf.indexHits).toBe(1);
    expect(perf.reads).toBe(0);
    expect(perf.invalidations).toBe(0);
  });

  it("文件 mtime 变化 → 仅该会话失效重建（invalidations=1）", async () => {
    const home = tempHome();
    const lines = [HEADER("s-a"), ...eventsOf(20)];
    const path = writeSessionLog(home, "s-a", lines);
    const { svc, readCalls } = makeSvc({ files: { "s-a": { path, lines } } });
    const built = bucketizeOwnEvents("s-a", lines.map((l, i) => ({ type: "turn/start", seq: i, time: T0 + 60_000 + i * 1000, data: {} })), 0);
    await svc.index.put("s-a", {
      sessionId: "s-a",
      v: 14,
      builtAt: Date.now(),
      lastSeq: built.lastSeq,
      lastMs: built.lastMs,
      buckets: built.buckets,
      titles: built.titles,
      src: statSessionFile(path)!,
    });
    // 模拟源文件被追加/改写：更新 mtime
    const future = new Date(Date.now() + 60_000);
    utimesSync(path, future, future);
    const perf = newGenerationPerf();
    const stats = await collectEvents(svc, PERIOD, perf);
    expect(readCalls).toContain("s-a");
    expect(perf.invalidations).toBe(1);
    expect(perf.reads).toBe(1);
    expect(perf.indexHits).toBe(0);
    expect(stats.sessions).toBe(1);
  });

  it("旧条目（无指纹）且文件未变 → 复用并回填指纹", async () => {
    const home = tempHome();
    const lines = [HEADER("s-a"), ...eventsOf(20)];
    const path = writeSessionLog(home, "s-a", lines);
    const { svc, readCalls, index } = makeSvc({ files: { "s-a": { path, lines } } });
    // 把文件 mtime 拨到事件之前（模拟旧代码建的条目 + 未被改写的文件）
    utimesSync(path, new Date(T0), new Date(T0));
    const built = bucketizeOwnEvents("s-a", lines.map((l, i) => ({ type: "turn/start", seq: i, time: T0 + 60_000 + i * 1000, data: {} })), 0);
    await svc.index.put("s-a", {
      sessionId: "s-a",
      v: 14,
      builtAt: Date.now(),
      lastSeq: built.lastSeq,
      lastMs: built.lastMs,
      buckets: built.buckets,
      titles: built.titles,
      // 无 src（旧格式）
    });
    const perf = newGenerationPerf();
    const stats = await collectEvents(svc, PERIOD, perf);
    expect(stats.sessions).toBe(1);
    expect(readCalls).not.toContain("s-a");
    expect(perf.indexHits).toBe(1);
    // 指纹已回填
    expect(index.get("s-a")?.src).toEqual(statSessionFile(path));
  });

  it("无源文件（非常规宿主）→ 即使有条目也重建", async () => {
    const home = tempHome();
    void home; // 不写任何文件
    const { svc, readCalls } = makeSvc({ files: {}, throwing: { "s-ghost": new Error("corrupt") } });
    // 注入一个"看起来新鲜"的条目（src 与实际文件无关）
    await svc.index.put("s-ghost", {
      sessionId: "s-ghost",
      v: 14,
      builtAt: Date.now(),
      lastSeq: 1,
      lastMs: T0 + 60_000,
      buckets: [],
      titles: [],
      src: { mtimeMs: Date.now(), size: 123 },
    });
    const perf = newGenerationPerf();
    const stats = await collectEvents(svc, PERIOD, perf);
    expect(stats.partial.skippedCount).toBe(1); // 重建失败 → 跳过并披露
    expect(readCalls).toContain("s-ghost");
    expect(perf.invalidations).toBe(1);
  });

  it("live 会话永远即时读取，不入索引复用", async () => {
    const home = tempHome();
    const lines = [HEADER("s-live"), ...eventsOf(5)];
    const path = writeSessionLog(home, "s-live", lines);
    const { svc, readCalls } = makeSvc({ files: { "s-live": { path, lines } }, live: { "s-live": true } });
    // 即使有条目（理论上不会发生），live 也必须重读
    await svc.index.put("s-live", {
      sessionId: "s-live",
      v: 14,
      builtAt: Date.now(),
      lastSeq: 5,
      lastMs: T0 + 60_000 + 5000,
      buckets: [],
      titles: [],
    });
    const perf = newGenerationPerf();
    const stats = await collectEvents(svc, PERIOD, perf);
    expect(readCalls).toContain("s-live");
    expect(stats.sessions).toBe(1);
  });
});

describe("salvage 缓存（P0.1）", () => {
  it("损坏会话 salvage 一次后写入索引：第二次不再重复解压，仍披露来源；文件变化后重新 salvage", async () => {
    const home = tempHome();
    // 有效 zstd 帧 + 残缺尾部 → 可 salvage（readSession 抛 corrupt）
    const corruptId = "s-corrupt";
    const lines = [HEADER(corruptId), ...eventsOf(50), '{"type":"turn/start","seq":50,"t'];
    const path = writeSessionLog(home, corruptId, lines);
    const { svc, readCalls, index } = makeSvc({
      files: { [corruptId]: { path, lines } },
      throwing: { [corruptId]: new Error("corrupt Zstandard session log: complete frame contains a torn JSONL record (internal)") },
    });

    // 第一次：salvage 发生，且结果写入索引（带指纹 + salvaged 标记）
    const perf1 = newGenerationPerf();
    const stats1 = await collectEvents(svc, PERIOD, perf1);
    expect(perf1.salvages).toBe(1);
    expect(stats1.partial.salvage).toEqual({ recoveredSessions: 1, recoveredRecords: 51, droppedRecords: 1 });
    const entry = index.get(corruptId);
    expect(entry).toBeDefined();
    expect(entry!.salvaged).toBe(true);
    expect(entry!.salvagedRecords).toBe(51);
    expect(entry!.salvagedDropped).toBe(1);
    expect(entry!.src).toEqual(statSessionFile(path));

    // 第二次（未变化）：索引命中，salvage 不再重跑（14.5s → 0）
    const readCallsAfterFirst = readCalls.length;
    const perf2 = newGenerationPerf();
    const stats2 = await collectEvents(svc, PERIOD, perf2);
    expect(perf2.indexHits).toBe(1);
    expect(perf2.salvages).toBe(0);
    expect(perf2.salvageMs).toBe(0);
    expect(readCalls.length).toBe(readCallsAfterFirst); // 未触发 readSession
    // 来源披露保留（缓存复用仍计入 recovered）
    expect(stats2.partial.salvage).toEqual({ recoveredSessions: 1, recoveredRecords: 51, droppedRecords: 1 });

    // 第三次：文件被改写（追加新事件 → mtime/size 变化）→ 失效 → 重新 salvage，不漏新事件
    const future = new Date(Date.now() + 120_000);
    utimesSync(path, future, future);
    const perf3 = newGenerationPerf();
    const stats3 = await collectEvents(svc, PERIOD, perf3);
    expect(perf3.invalidations).toBe(1);
    expect(perf3.salvages).toBe(1);
    expect(stats3.partial.salvage?.recoveredSessions).toBe(1);
  });

  it("salvage 失败的会话不写索引（下次仍走 salvage 尝试/跳过路径）", async () => {
    const home = tempHome();
    const corruptId = "s-bad";
    const path = writeSessionLog(home, corruptId, [HEADER(corruptId), ...eventsOf(3)]);
    // 用不可解压的垃圾覆盖 → salvage unsafe
    writeFileSync(path, Buffer.from("not a zstd file at all"));
    const { svc, index } = makeSvc({
      files: { [corruptId]: { path, lines: [] } },
      throwing: { [corruptId]: new Error("corrupt") },
    });
    const perf = newGenerationPerf();
    const stats = await collectEvents(svc, PERIOD, perf);
    expect(perf.salvages).toBe(0);
    expect(stats.partial.skippedCount).toBe(1);
    expect(index.get(corruptId)).toBeUndefined();
  });
});

describe("索引完整性（P0.2：不得截断到生成时刻）", () => {
  it("索引桶覆盖会话全部事件（lastMs = 最后事件），跨周期生成不漏新追加事件", async () => {
    const home = tempHome();
    const sessionId = "s-full";
    const lines = [HEADER(sessionId), ...eventsOf(40)];
    const path = writeSessionLog(home, sessionId, lines);
    const { svc, index } = makeSvc({ files: { [sessionId]: { path, lines } } });

    // 第一次生成：period 只覆盖前 2 分钟
    const earlyPeriod = { from: T0, to: T0 + 2 * 60_000 };
    await collectEvents(svc, earlyPeriod);
    const entry = index.get(sessionId)!;
    // 全量分桶：lastMs 必须是最后一条事件，而不是 earlyPeriod.to
    const lastEventTime = T0 + 60_000 + 39 * 1000;
    expect(entry.lastMs).toBe(lastEventTime);
    expect(entry.src).toEqual(statSessionFile(path));

    // 第二次生成：更晚的 period（覆盖全部 40 条）—— 从缓存复用，不漏事件
    // （period.to 取分桶边界，避开边界桶裁剪的既有近似规则）
    const perf = newGenerationPerf();
    const stats = await collectEvents(svc, { from: T0, to: T0 + 600_000 }, perf);
    expect(perf.indexHits).toBe(1);
    expect(stats.totalEvents).toBe(40);
  });
});

describe("toolHealth.failedSessions 持久化形态（custom/月/年 400 根因回归）", () => {
  /** 带失败工具调用的会话（tool/call + tool/result error）。 */
  function failingToolEvents(): { type: string; seq: number; time: number; data: unknown }[] {
    const evs: { type: string; seq: number; time: number; data: unknown }[] = [];
    const base = T0 + 60_000;
    for (let i = 0; i < 4; i += 1) {
      evs.push({ type: "turn/start", seq: evs.length, time: base + i * 60_000, data: {} });
      evs.push({ type: "tool/call", seq: evs.length, time: base + i * 60_000, data: { name: "edit", callId: `c${i}` } });
      evs.push({ type: "tool/result", seq: evs.length, time: base + i * 60_000 + 1000, data: { message: { source: { callId: `c${i}` } }, error: { code: "FS_EDIT_NOT_FOUND" } } });
    }
    return evs;
  }

  it("bucketize 输出 failedSessions 为数组（JSON 持久化安全）", () => {
    const built = bucketizeOwnEvents("s-th", failingToolEvents(), 0);
    const acc = Object.values(built.buckets[0].toolHealth)[0];
    expect(Array.isArray(acc.failedSessions)).toBe(true);
    expect(acc.failedSessions).toContain("s-th");
    // JSON 往返后仍是数组（不是 {}）
    const roundTripped = JSON.parse(JSON.stringify(built.buckets)) as { toolHealth: Record<string, { failedSessions: unknown }> }[];
    const acc2 = Object.values(roundTripped[0].toolHealth)[0];
    expect(Array.isArray(acc2.failedSessions)).toBe(true);
  });

  it("新持久化形态（数组）聚合正常，failedSessions 进入会话级证据", () => {
    const built = bucketizeOwnEvents("s-th", failingToolEvents(), 0);
    const roundTripped = JSON.parse(JSON.stringify(built.buckets));
    const stats = aggregateBuckets(
      [{ sessionId: "s-th", buckets: roundTripped, titles: [] }],
      { from: T0, to: T0 + 600_000 },
      [],
      emptyPartial(),
    );
    expect(stats.sessions).toBe(1);
    expect(stats.toolHealth?.[0]?.failed).toBe(4);
    expect(Object.keys(stats.toolFailedSessions ?? {})).toContain("edit");
    expect(stats.toolFailedSessions?.edit).toContain("s-th");
  });

  it("旧持久化形态（failedSessions={}，Set 被 JSON 序列化）不再抛 object is not iterable", () => {
    const built = bucketizeOwnEvents("s-legacy", failingToolEvents(), 0);
    const legacyBuckets = JSON.parse(JSON.stringify(built.buckets)) as { h: number; toolHealth?: Record<string, { failedSessions: unknown }> }[];
    for (const b of legacyBuckets) {
      for (const name of Object.keys(b.toolHealth ?? {})) b.toolHealth![name].failedSessions = {};
    }
    // 旧代码在此抛 TypeError: object is not iterable（宽窗口触发）
    const stats = aggregateBuckets(
      [{ sessionId: "s-legacy", buckets: legacyBuckets as unknown as HourBucket[], titles: [] }],
      { from: T0, to: T0 + 600_000 },
      [],
      emptyPartial(),
    );
    expect(stats.sessions).toBe(1);
    // 旧条目无成员可恢复：证据不引用该会话，但不崩
    expect(Object.keys(stats.toolFailedSessions ?? {})).toHaveLength(0);
  });

  it("宽窗口（月/自定义）不再 400：真实 405 个 toolHealth 桶形态的索引可聚合", async () => {
    const home = tempHome();
    const lines = [HEADER("s-th"), ...eventsOf(2)];
    const path = writeSessionLog(home, "s-th", lines);
    const { svc, index } = makeSvc({ files: { "s-th": { path, lines } } });
    const built = bucketizeOwnEvents("s-th", failingToolEvents(), 0);
    // 模拟旧版本持久化的桶：failedSessions 全部为 {}，且分桶时间落在"宽窗口内、窄窗口外"
    const legacyBuckets = JSON.parse(JSON.stringify(built.buckets)) as { h: number; toolHealth?: Record<string, { failedSessions: unknown }> }[];
    for (const b of legacyBuckets) {
      for (const name of Object.keys(b.toolHealth ?? {})) b.toolHealth![name].failedSessions = {};
    }
    await svc.index.put("s-th", {
      sessionId: "s-th",
      v: 14,
      builtAt: Date.now(),
      lastSeq: 1,
      lastMs: T0 + 60_000,
      buckets: legacyBuckets as unknown as HourBucket[],
      titles: [],
      src: statSessionFile(path)!,
    });
    // 30 天宽窗口（月报/自定义语义）：旧代码会抛 object is not iterable
    const perf = newGenerationPerf();
    const stats = await collectEvents(svc, { from: T0 - 10 * 86400000, to: Date.now() }, perf);
    expect(perf.indexHits).toBe(1);
    expect(stats.sessions).toBe(1);
  });
});
