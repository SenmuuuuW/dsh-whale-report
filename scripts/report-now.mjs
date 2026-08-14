#!/usr/bin/env node
/**
 * 立即生成一份真实的鲸鱼报告 —— 直接读取本机会话存档（session.jsonl.zstd）。
 *
 * 这是给"等不及装插件"的你用的：不需要重启 dsh，一条命令看报告。
 * 插件本体走官方 ctx.sessionQuery 接缝；本脚本只是绕过 harness 的独立读取器，
 * 与插件共享同一个报告引擎（tests 保证引擎可信）。
 *
 * 用法：
 *   node scripts/report-now.mjs --weekly            # 最近 7 天（默认）
 *   node scripts/report-now.mjs --daily|--monthly|--yearly|--all
 *   node scripts/report-now.mjs --from 2026-08-01 --to 2026-08-14
 */
import { decompress } from "fzstd";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// —— 复用插件同款引擎（跑 lib/ 构建产物，保证与插件行为逐字节一致）——
const { aggregate } = await import("../lib/stats.js");
const { renderReport } = await import("../lib/report.js");

const DAY = 24 * 60 * 60 * 1000;
const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i === -1 || i + 1 >= args.length ? undefined : args[i + 1];
};

function range(earliest) {
  const now = Date.now();
  if (value("--from") || value("--to")) {
    const from = Date.parse(value("--from") ?? new Date(now - 7 * DAY).toISOString());
    const to = Date.parse(value("--to") ?? new Date(now).toISOString());
    return { from, to, preset: "custom" };
  }
  const preset = has("--daily") ? "daily"
    : has("--monthly") ? "monthly"
    : has("--yearly") ? "yearly"
    : has("--all") ? "all"
    : "weekly";
  if (preset === "all") return { from: earliest, to: now, preset: "yearly" };
  const days = preset === "daily" ? 1 : preset === "monthly" ? 30 : preset === "yearly" ? 365 : 7;
  return { from: now - days * DAY, to: now, preset };
}

// —— zstd 多帧解压：按帧头魔数切分（与官方持久化格式一致的实操方案）——
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
function decompressFrames(buf) {
  const starts = [];
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) starts.push(i);
  }
  let out = "";
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length;
    try {
      out += Buffer.from(decompress(buf.subarray(starts[k], end))).toString("utf8");
    } catch {
      /* 尾部损坏帧直接跳过 */
    }
  }
  return out;
}

function findSessionFiles(root) {
  const files = [];
  if (!existsSync(root)) return files;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".jsonl.zstd")) files.push(p);
    }
  };
  walk(root);
  return files;
}

function readSessionFile(path) {
  const lines = decompressFrames(readFileSync(path)).trim().split("\n").filter(Boolean);
  let header = null;
  const events = [];
  for (const line of lines) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed.type === "session") {
      header = parsed;
    } else if (parsed.time !== undefined) {
      events.push({ type: parsed.type, time: parsed.time, data: parsed.data });
    }
  }
  return { header, events };
}

const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const sessionsRoot = join(home, "sessions");
const files = findSessionFiles(sessionsRoot);

if (files.length === 0) {
  console.error(`没有找到会话存档（${sessionsRoot}）。先用官方 dsh 跑几轮再来看报告吧。`);
  process.exit(1);
}

const allEvents = [];
const headers = [];
for (const file of files) {
  const { header, events } = readSessionFile(file);
  if (header) {
    headers.push({ id: header.id, createdAt: header.createdAt, cwd: header.cwd, delegationDepth: header.delegationDepth });
    for (const event of events) {
      allEvents.push({ ...event, data: { ...(event.data ?? {}), sessionId: header.id } });
    }
  }
}

const { from, to, preset } = range(
  allEvents.length > 0 ? Math.min(...allEvents.map((e) => e.time)) : Date.now(),
);
const stats = aggregate(allEvents, { from, to }, headers);
console.log(renderReport(stats, preset));
console.log(`\n（扫描了 ${files.length} 个会话存档文件）`);
