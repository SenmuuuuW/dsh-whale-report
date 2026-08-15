/**
 * 独立 HTML 报告页生成器：宿主渲染一张自包含、可打印的 A4 页面
 * （浏览器 Ctrl+P → 另存为 PDF），面板的"导出 PDF"打开它。
 *
 * 设计：白底 + DS 蓝强调色，图表用纯 HTML/CSS（无 JS 依赖），
 * 打印时每个分区卡片自动分页不切断。
 */
import { formatTokens } from "./stats.js";
function esc(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function fmt(n) {
    return formatTokens(n);
}
function dateStr(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}
function heroHtml(stats, record, cost) {
    const totalTokens = stats.tokens.input + stats.tokens.output + stats.tokens.cacheRead + stats.tokens.reasoning;
    const items = [
        ["会话", String(stats.sessions)],
        ["回合", String(stats.turns)],
        ["工具调用", fmt(stats.toolCallsTotal)],
        ["命令", fmt(stats.commands)],
        ["Token", fmt(totalTokens)],
    ];
    if (cost !== undefined)
        items.push(["预估费用", `¥${cost.total.toFixed(2)}`]);
    return `
  <div class="hero">
    <div class="hero-title">深迹报告 · ${esc(record.preset)}</div>
    <div class="hero-sub">${dateStr(record.from)} ~ ${dateStr(record.to)}</div>
    <div class="hero-stats">
      ${items.map(([k, v]) => `<div class="hs"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join("")}
    </div>
  </div>`;
}
function gridHtml(stats) {
    const series = stats.dayHourSeries ?? [];
    if (series.length === 0)
        return "";
    const max = Math.max(1, ...series.flatMap((s) => s.hours));
    const cell = (count) => {
        if (count === 0)
            return '<i style="background:#f1f3f9"></i>';
        const level = Math.max(0.15, Math.min(1, count / max));
        return `<i style="background:rgba(77,107,254,${level.toFixed(2)})"></i>`;
    };
    const cols = series.slice(-30);
    return `
  <div class="grid">
    <div class="grid-hours">
      ${Array.from({ length: 24 }, (_, h) => `<span>${h % 6 === 0 ? String(h).padStart(2, "0") : ""}</span>`).join("")}
    </div>
    ${cols.map((day) => `<div class="grid-col">${day.hours.map((c) => cell(c)).join("")}</div>`).join("")}
  </div>
  <div class="grid-dates">${cols.map((d) => `<span>${esc(d.date.slice(5))}</span>`).join("")}</div>`;
}
function retryDiagnoseHtml(stats) {
    const bursts = stats.burstSamples ?? [];
    if (bursts.length === 0)
        return "";
    return `
  <div class="card"><h2>重试诊断</h2>
    <ul class="samples">
      ${bursts
        .slice(0, 8)
        .map((b) => `<li>${esc(b.cmd)}<span>重复 ${b.count} 次 · ${esc(new Date(b.time).toISOString().slice(0, 16).replace("T", " "))}${b.error !== undefined ? ` · ${esc(b.error.slice(0, 80))}` : ""}</span></li>`)
        .join("")}
    </ul>
    ${bursts.length > 8 ? `<p class="muted">……共 ${bursts.length} 条</p>` : ""}
  </div>`;
}
function modelTableHtml(stats, cost) {
    const entries = Object.entries(stats.models).sort((a, b) => b[1].input + b[1].output + b[1].cacheRead + b[1].reasoning - (a[1].input + a[1].output + a[1].cacheRead + a[1].reasoning));
    if (entries.length === 0)
        return `<p>无模型用量数据。</p>`;
    return `
  <table class="models">
    <thead><tr><th>模型</th><th>输入</th><th>输出</th><th>缓存命中</th><th>思考</th><th>费用</th></tr></thead>
    <tbody>
      ${entries
        .map(([model, u]) => {
        const c = cost?.perModel[model];
        return `<tr><td>${esc(model)}</td><td>${fmt(u.input)}</td><td>${fmt(u.output)}</td><td>${fmt(u.cacheRead)}</td><td>${fmt(u.reasoning)}</td><td>${typeof c === "number" ? `¥${c.toFixed(2)}` : "-"}</td></tr>`;
    })
        .join("")}
    </tbody>
  </table>
  ${cost !== undefined && cost.total > 0 ? `<p class="muted">预估合计 ¥${cost.total.toFixed(2)} · ${cost.source === "official-page" ? "官方定价页实时价" : "内置价"} · 以平台账单为准</p>` : ""}`;
}
function dangerHtml(stats) {
    const danger = stats.dangerousCommands.map((d) => ({ ...d, label: d.label ?? "未分类", command: d.command ?? "" }));
    if (danger.length === 0)
        return `<p>无危险操作。</p>`;
    const byLabel = new Map();
    for (const d of danger)
        byLabel.set(d.label, (byLabel.get(d.label) ?? 0) + 1);
    const top = [...byLabel.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = Math.round((top[1] / danger.length) * 100);
    const cats = [...byLabel.entries()].sort((a, b) => b[1] - a[1]);
    return `
  <p class="dsum">共 ${danger.length} 条，以「${esc(top[0])}」为主（${top[1]} 条，占 ${share}%）。</p>
  <div class="cats">${cats.map(([l, n]) => `<span class="cat">${esc(l)} <b>${n}</b></span>`).join("")}</div>
  <ul class="samples">
    ${danger.slice(0, 8).map((d) => `<li><code>${esc(d.command.replace(/\\s+/g, " ").slice(0, 80))}</code><span>${esc(d.label)} · ${esc(new Date(d.time).toISOString().slice(0, 16).replace("T", " "))}</span></li>`).join("")}
  </ul>`;
}
function tokenBarHtml(stats) {
    const t = stats.tokens;
    const total = t.input + t.output + t.cacheRead + t.reasoning;
    if (total === 0)
        return "";
    const seg = (value, color, name) => `<i title="${name} ${fmt(value)}" style="width:${((value / total) * 100).toFixed(2)}%;background:${color}"></i>`;
    return `
  <div class="tbar">${seg(t.input, "#4d6bfe", "输入")}${seg(t.output, "#38bdf8", "输出")}${seg(t.cacheRead, "#94a3b8", "缓存命中")}${seg(t.reasoning, "#c4b5fd", "思考")}</div>
  <p class="muted">输入 ${fmt(t.input)} · 输出 ${fmt(t.output)} · 缓存命中 ${fmt(t.cacheRead)} · 思考 ${fmt(t.reasoning)} · 合计 ${fmt(total)}</p>`;
}
export function renderHtmlReport(record) {
    const stats = record.stats;
    // 旧版本报告可能缺新字段，全部兜底。
    stats.models = stats.models ?? {};
    stats.titles = stats.titles ?? [];
    stats.dayHourSeries = stats.dayHourSeries ?? [];
    stats.dailySeries = stats.dailySeries ?? [];
    stats.dangerousCommands = stats.dangerousCommands ?? [];
    stats.tokens = stats.tokens ?? { input: 0, output: 0, cacheRead: 0, reasoning: 0 };
    stats.toolCalls = stats.toolCalls ?? {};
    const cost = record.cost;
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>深迹报告 · ${esc(record.preset)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; background: #f6f7fb; color: #111827; }
  .page { max-width: 820px; margin: 0 auto; padding: 24px 20px 48px; }
  .hero { background: #4d6bfe; color: #fff; border-radius: 14px; padding: 22px 24px; margin-bottom: 14px; }
  .hero-title { font-size: 20px; font-weight: 800; }
  .hero-sub { font-size: 12.5px; opacity: .85; margin-top: 4px; }
  .hero-stats { display: flex; flex-wrap: wrap; gap: 22px; margin-top: 16px; }
  .hs b { font-size: 20px; font-weight: 800; display: block; }
  .hs span { font-size: 11px; opacity: .8; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 18px; margin-bottom: 12px; break-inside: avoid; }
  h2 { font-size: 14px; margin: 0 0 12px; padding-left: 9px; border-left: 3px solid #4d6bfe; }
  .muted { color: #6b7280; font-size: 12px; }
  .grid { display: flex; gap: 3px; margin: 6px 0 2px; }
  .grid-hours { display: flex; flex-direction: column; gap: 3px; margin-right: 5px; }
  .grid-hours span { height: 10px; font-size: 8px; color: #9ca3af; line-height: 10px; text-align: right; width: 22px; }
  .grid-col { display: flex; flex-direction: column; gap: 3px; flex: 1; }
  .grid-col i { height: 10px; border-radius: 2px; }
  .grid-dates { display: flex; gap: 3px; margin: 6px 0 0 27px; }
  .grid-dates span { flex: 1; font-size: 8px; color: #9ca3af; text-align: center; overflow: hidden; white-space: nowrap; }
  .tbar { display: flex; height: 14px; border-radius: 7px; overflow: hidden; background: #f3f4f6; margin: 8px 0 6px; }
  .models { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .models th, .models td { text-align: right; padding: 7px 10px; border-bottom: 1px solid #f3f4f6; }
  .models th:first-child, .models td:first-child { text-align: left; font-weight: 600; }
  .models thead th { color: #6b7280; font-weight: 600; font-size: 11.5px; }
  .dsum { background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 10px; padding: 10px 12px; font-size: 12.5px; color: #3730a3; }
  .cats { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
  .cat { display: inline-flex; gap: 5px; align-items: center; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .samples { margin: 6px 0 0; padding-left: 0; list-style: none; }
  .samples li { font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 7px 9px; margin: 5px 0; color: #b91c1c; word-break: break-all; }
  .samples li span { display: block; color: #dc2626; opacity: .75; font-size: 10.5px; margin-top: 3px; }
  ul.titles { margin: 4px 0 0; padding-left: 18px; font-size: 12.5px; }
  ul.titles li { margin: 4px 0; }
  .foot { font-size: 11px; color: #9ca3af; margin-top: 16px; text-align: center; }
  @media print {
    body { background: #fff; }
    .page { max-width: none; padding: 0; }
    .card { border: 1px solid #e5e7eb; box-shadow: none; }
  }
</style>
</head>
<body>
<div class="page">
  ${heroHtml(stats, record, cost)}
  <div class="card"><h2>活跃时段</h2>${gridHtml(stats)}</div>
  <div class="card"><h2>Token 构成</h2>${tokenBarHtml(stats)}</div>
  <div class="card"><h2>模型用量</h2>${modelTableHtml(stats, cost)}</div>
  ${retryDiagnoseHtml(stats)}
  <div class="card"><h2>危险操作</h2>${dangerHtml(stats)}</div>
  ${stats.titles.length > 0 ? `<div class="card"><h2>会话标题</h2><ul class="titles">${stats.titles.slice(0, 10).map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
  <div class="foot">基于 ${stats.totalEvents} 条会话事件 · 只读 · 深迹 DeepTrace · 生成于 ${dateStr(record.createdAt)}</div>
</div>
</body>
</html>`;
}
//# sourceMappingURL=html.js.map