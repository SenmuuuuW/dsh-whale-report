/**
 * 真实数据验收分析（只读）：读取 ~/.dsh/sessions 全部 zstd 日志，
 * 复用 lib/ 引擎（与插件逐字节一致），输出 Improve / correction / partial 明细。
 * 不写任何文件到 ~/.dsh，不修改原始数据。
 */
import { decompress } from "fzstd";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const { aggregate } = await import("../lib/stats.js");
const { computeImprovements } = await import("../lib/improvements.js");

const DAY = 24 * 60 * 60 * 1000;
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
function decompressFrames(buf) {
  const starts = [];
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) starts.push(i);
  }
  let out = "";
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length;
    try { out += Buffer.from(decompress(buf.subarray(starts[k], end))).toString("utf8"); } catch { /* 尾部损坏帧跳过 */ }
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
  let lines;
  try {
    lines = decompressFrames(readFileSync(path)).trim().split("\n").filter(Boolean);
  } catch {
    return { header: null, events: [], broken: true };
  }
  let header = null;
  const events = [];
  for (const line of lines) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed.type === "session") header = parsed;
    else if (parsed.time !== undefined) events.push({ type: parsed.type, time: parsed.time, data: parsed.data });
  }
  return { header, events };
}

const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const sessionsRoot = join(home, "sessions");
const files = findSessionFiles(sessionsRoot);
const allEvents = [];
const headers = [];
let broken = 0;
for (const file of files) {
  const { header, events, broken: isBroken } = readSessionFile(file);
  if (header) {
    headers.push({ id: header.id, createdAt: header.createdAt, cwd: header.cwd, delegationDepth: header.delegationDepth });
    for (const event of events) allEvents.push({ ...event, data: { ...(event.data ?? {}), sessionId: header.id } });
  }
  if (isBroken) broken += 1;
}

const now = Date.now();
const window = process.argv[2] === "monthly" ? 30 : process.argv[2] === "daily" ? 1 : 7;
const from = now - window * DAY;
const stats = aggregate(allEvents, { from, to: now }, headers);

console.log(`\n===== 周期 ${window} 天 · 扫描 ${files.length} 个会话文件（损坏 ${broken}）=====`);
console.log(`sessions=${stats.sessions} events=${stats.totalEvents} turns=${stats.turns} commands=${stats.commands}`);
console.log(`retryBursts=${stats.retryBursts} toolErrors=${stats.toolErrors}`);

console.log(`\n-- correctionSignals（类别 · sessions · counts · 命中该类的 session ids）--`);
for (const c of stats.correctionSignals) {
  console.log(`  ${c.category} · ${c.sessions} sessions · ${c.count} counts · ${JSON.stringify(c.sampleSessionIds)}`);
}

console.log(`\n-- toolFailedSessions --`);
for (const [tool, sids] of Object.entries(stats.toolFailedSessions)) {
  console.log(`  ${tool}: ${sids.length} sessions ${JSON.stringify(sids)}`);
}

console.log(`\n-- burstSamples（重试风暴样本，cmd 脱敏后）--`);
for (const b of stats.burstSamples.slice(0, 10)) {
  console.log(`  [${b.sessionId}] ${b.cmd.slice(0, 60)} × ${b.count}${b.error !== undefined ? ` · err:${b.error.slice(0, 40)}` : ""}`);
}

const items = computeImprovements({ stats, period: `window-${window}`, now: 1234567890000 });
console.log(`\n-- computeImprovements（${items.length} 条）--`);
for (const it of items) {
  console.log(JSON.stringify({
    id: it.id,
    category: it.category,
    severity: it.severity,
    title: it.title,
    metrics: it.evidence.metrics,
    occurrences: it.evidence.occurrences,
    confidence: it.evidence.confidence,
    experimental: it.evidence.experimental ?? false,
    affectedTools: it.evidence.affectedTools,
    affectedSessions: it.evidence.affectedSessions,
    summary: it.summary,
    recommendation: it.recommendation,
    verificationPlan: it.verificationPlan,
  }, null, 1));
}

// 夜间占比（Peak Cost 规则依赖）
const night = stats.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0);
console.log(`\n-- 夜间(0-6点)事件占比: ${((night / Math.max(1, stats.totalEvents)) * 100).toFixed(2)}% (${night}/${stats.totalEvents})`);
