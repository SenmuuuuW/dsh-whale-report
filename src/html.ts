/**
 * 独立 HTML 报告页生成器：宿主渲染一张自包含、可打印的 A4 页面
 * （浏览器 Ctrl+P → 另存为 PDF），面板的"导出 PDF"打开它。
 *
 * 视觉语言：深海研究日志 × 数据杂志。所有图表仍由纯 HTML/CSS 构成，
 * 无客户端数据处理与 JS 依赖；打印时保留颜色并避免关键行被分页切断。
 */
import { formatTokens } from "./stats.js";
import { usageTotalTokens } from "./usage.js";
import type { ReportRecord } from "./state.js";
import type { ReportStats, SessionDetail } from "./stats.js";
import type { CostBreakdown } from "./pricing.js";
import { whaleMood } from "./whale-notes.js";
import { TOOL_HEALTH_MIN_CALLS, TOOL_HEALTH_MIN_FAILED, TOOL_HEALTH_MIN_FAILURE_RATE } from "./insights.js";
import { computeCollaborationInsights } from "./collaboration.js";

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n: number): string {
  return formatTokens(n);
}

function dateStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function timeStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function sumTokens(stats: ReportStats): number {
  return usageTotalTokens(stats.tokens);
}

function nightRatio(stats: ReportStats): number {
  if (stats.totalEvents === 0) return 0;
  const night = stats.hourHistogram.slice(0, 6).reduce((sum, value) => sum + value, 0);
  return Math.round((night / stats.totalEvents) * 100);
}

function cacheRate(stats: ReportStats): number {
  const total = stats.tokens.input + stats.tokens.cacheRead;
  return total === 0 ? 0 : Math.round((stats.tokens.cacheRead / total) * 1000) / 10;
}

type PrintableInsight = {
  id: string;
  level: "info" | "tip" | "warning" | "critical";
  title: string;
  detail: string;
  action: string;
  estimate?: string;
};

function printableInsights(value: unknown): PrintableInsight[] {
  if (!Array.isArray(value)) return [];
  const output: PrintableInsight[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.title !== "string" || typeof row.detail !== "string" || typeof row.action !== "string") continue;
    const level = row.level === "critical" || row.level === "warning" || row.level === "tip" || row.level === "info"
      ? row.level
      : "info";
    output.push({
      id: typeof row.id === "string" ? row.id : `finding-${output.length + 1}`,
      level,
      title: row.title,
      detail: row.detail,
      action: row.action,
      estimate: typeof row.estimate === "string" ? row.estimate : undefined,
    });
  }
  return output;
}

function previousCost(record: ReportRecord): number | null {
  if (typeof record.prev !== "object" || record.prev === null) return null;
  const cost = (record.prev as Record<string, unknown>).cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : null;
}

function heroHtml(stats: ReportStats, record: ReportRecord, cost?: CostBreakdown): string {
  const totalTokens = sumTokens(stats);
  const totalCost = cost?.total;
  const prevCost = previousCost(record);
  const delta = totalCost !== undefined && prevCost !== null
    ? Math.round(((totalCost - prevCost) / prevCost) * 100)
    : null;
  const mood = whaleMood(stats);
  const deltaHtml = delta === null
    ? `<span class="headline-delta headline-delta--muted">BASELINE / NO PRIOR PERIOD</span>`
    : `<span class="headline-delta ${delta > 0 ? "headline-delta--up" : "headline-delta--down"}">${delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} ${Math.abs(delta)}% <small>VS PREVIOUS</small></span>`;
  return `
  <header class="opening">
    <div class="opening-rule"></div>
    <div class="opening-top">
      <div class="wordmark">
        <span class="wordmark-cn">深迹</span>
        <span class="wordmark-en">DeepTrace</span>
      </div>
      <div class="opening-index">
        <span>TRACE / ${esc(record.preset.toUpperCase())}</span>
        <span>${dateStr(record.from)} — ${dateStr(record.to)}</span>
      </div>
    </div>
    <div class="opening-main">
      <div class="opening-copy">
        <p class="eyebrow">YOUR AGENT, IN NUMBERS.</p>
        <p class="headline-label">ESTIMATED TOKEN BURN / CNY</p>
        <div class="headline-value">${totalCost === undefined ? `<span class="currency">¥</span>—` : `<span class="currency">¥</span>${totalCost.toFixed(2)}`}</div>
        ${deltaHtml}
      </div>
      <div class="observer" aria-label="DeepTrace 数据观察员">
        <span class="sonar-ring sonar-ring--outer"></span>
        <span class="sonar-ring sonar-ring--inner"></span>
        <span class="sonar-cross sonar-cross--h"></span>
        <span class="sonar-cross sonar-cross--v"></span>
        <img src="/whale/assets/whale-hero.png" alt="DeepTrace 鲸鱼娘数据观察员">
        <span class="observer-id">OBSERVER / ${mood.toUpperCase()}</span>
      </div>
    </div>
    <div class="telemetry" aria-label="报告关键数据">
      <div><span>SESSIONS</span><b>${stats.sessions}</b><small>SUB ${stats.subagentSessions}</small></div>
      <div><span>TURNS</span><b>${stats.turns}</b><small>STEP ${stats.steps}</small></div>
      <div><span>TOOL CALL</span><b>${fmt(stats.toolCallsTotal)}</b><small>ERR ${stats.toolErrors}</small></div>
      <div><span>TOKEN</span><b>${fmt(totalTokens)}</b><small>CACHE ${cacheRate(stats)}%</small></div>
      <div><span>COMMAND</span><b>${fmt(stats.commands)}</b><small>RETRY ${stats.retryBursts}</small></div>
    </div>
    ${stats.partial !== undefined && (stats.partial.skippedCount > 0 || stats.partial.salvage !== undefined)
      ? `<div class="partial-banner">⚠️ <b>DATA PARTIAL</b> · ${stats.partial.skippedCount > 0 ? `${stats.partial.skippedCount} 个会话日志损坏/无法读取，已跳过${stats.partial.skippedSessionIds.length > 0 ? `（${esc(stats.partial.skippedSessionIds.join(" · "))}${stats.partial.skippedSessionIds.length < stats.partial.skippedCount ? " …" : ""}）` : ""}。` : ""}${stats.partial.salvage !== undefined ? htmlSalvageLine(stats.partial.salvage) : ""}${stats.partial.skippedCount > 0 || (stats.partial.salvage?.droppedRecords ?? 0) > 0 ? "缺失数据<b>不按 0 计</b>。" : "数据已完整恢复。"}</div>`
      : ""}
    <div class="opening-status"><span>DEPTH 4,096m</span><span>CONTEXT ${cacheRate(stats)}%</span><span>PING OK</span><span>/think RESOLVED</span></div>
  </header>`;
}

/** P0 salvage 文案（HTML 版，不泄路径/堆栈）。 */
function htmlSalvageLine(salvage: NonNullable<ReportStats["partial"]>["salvage"]): string {
  if (salvage === undefined) return "";
  if (salvage.droppedRecords > 0) {
    return `${salvage.recoveredSessions} 个会话尾部损坏。已恢复 ${salvage.recoveredRecords} 条完整记录，${salvage.droppedRecords} 条残缺记录未计入。`;
  }
  return `${salvage.recoveredSessions} 个会话的全部 ${salvage.recoveredRecords} 条记录（0 条丢弃）。`;
}

function whaleNoteHtml(stats: ReportStats): string {
  const mood = whaleMood(stats);
  const redDanger = stats.dangerousCommands.filter((item) => item.sev === "red").length;
  const note = mood === "angry"
    ? `“（认真检查）${redDanger} 条致命级操作。删库、强推、格式化……下次动手前，先让我看一眼。”`
    : mood === "sleepy"
      ? `“凌晨的 PING 占了 ${nightRatio(stats)}%。上下文还在线，但你最好先去睡，我替你守着进度条。”`
      : mood === "dazed"
        ? `“检测到 ${stats.retryBursts} 次重试风暴。重试不是一种缓存策略——先看报错第一行，好吗？”`
        : `“本期轨迹很干净。数据会留下足迹，而我的工作，就是替你把足迹看清楚。”`;
  return `
  <aside class="whale-note">
    <div class="note-label"><span>WHALE NOTE</span><b>本期鲸评</b><small>DATA OBSERVER / 只读</small></div>
    <blockquote>${esc(note)}</blockquote>
    <img src="/whale/assets/whale-${mood}.png" alt="">
    <div class="note-sign">— DeepTrace / NOTE ${String(stats.retryBursts + stats.dangerousCommands.length).padStart(3, "0")}</div>
  </aside>`;
}

function findingsHtml(record: ReportRecord): string {
  const insights = printableInsights(record.insights).slice(0, 8);
  if (insights.length === 0) {
    return `<div class="finding finding--clear"><span class="finding-no">00</span><span class="finding-signal"></span><div><p class="finding-type">CLEAR</p><h3>本期未触发需处理的异常信号</h3><p>Agent trajectory is within the observable baseline.</p></div><span class="finding-state">NO ACTION</span></div>`;
  }
  const levelLabel = (level: PrintableInsight["level"]): string =>
    level === "critical" ? "CRITICAL" : level === "warning" ? "WATCH" : level === "tip" ? "NOTE" : "INFO";
  return insights
    .map((insight, index) => `
      <div class="finding finding--${insight.level}">
        <span class="finding-no">${String(index + 1).padStart(2, "0")}</span>
        <span class="finding-signal"></span>
        <div class="finding-copy">
          <p class="finding-type">${levelLabel(insight.level)}</p>
          <h3>${esc(insight.title)}</h3>
          <p>${esc(insight.detail)}</p>
          <p class="finding-action"><b>ACTION</b> ${esc(insight.action)}</p>
          ${insight.estimate === undefined ? "" : `<p class="finding-estimate">${esc(insight.estimate)}</p>`}
        </div>
        <span class="finding-state">${insight.level === "info" ? "LOGGED" : "REVIEW"}</span>
      </div>`)
    .join("");
}

type PrintableImprovement = {
  id: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  summary: string;
  evidence: {
    metrics: Record<string, number>;
    affectedSessions: string[];
    occurrences: number;
    confidence: number;
    experimental?: boolean;
  };
  recommendation: string;
  verificationPlan: { targetMetric: string; baseline: number | null; target: string; window: string };
};

function printableImprovements(value: unknown): PrintableImprovement[] {
  if (!Array.isArray(value)) return [];
  const items: PrintableImprovement[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const evidence = (item.evidence ?? {}) as Record<string, unknown>;
    const plan = (item.verificationPlan ?? {}) as Record<string, unknown>;
    const severity = item.severity === "HIGH" || item.severity === "MEDIUM" || item.severity === "LOW" ? item.severity : "MEDIUM";
    const metrics = (evidence.metrics ?? {}) as Record<string, number>;
    items.push({
      id: typeof item.id === "string" ? item.id : "improve-unknown",
      severity,
      title: typeof item.title === "string" ? item.title : "",
      summary: typeof item.summary === "string" ? item.summary : "",
      evidence: {
        metrics: Object.fromEntries(Object.entries(metrics).filter(([, v]) => typeof v === "number")),
        affectedSessions: Array.isArray(evidence.affectedSessions) ? evidence.affectedSessions.filter((s): s is string => typeof s === "string") : [],
        occurrences: typeof evidence.occurrences === "number" ? evidence.occurrences : 0,
        confidence: typeof evidence.confidence === "number" ? evidence.confidence : 0,
        experimental: evidence.experimental === true,
      },
      recommendation: typeof item.recommendation === "string" ? item.recommendation : "",
      verificationPlan: {
        targetMetric: typeof plan.targetMetric === "string" ? plan.targetMetric : "",
        baseline: typeof plan.baseline === "number" ? plan.baseline : null,
        target: typeof plan.target === "string" ? plan.target : "",
        window: typeof plan.window === "string" ? plan.window : "",
      },
    });
  }
  return items.slice(0, 4);
}

/** IMPROVE 章节：值得改的行为建议（只读；证据 + VERIFY 基线，0 额外 LLM token）。 */
function improveHtml(record: ReportRecord): string {
  const items = printableImprovements(record.improvements).slice(0, 3);
  if (items.length === 0) return "";
  const metricLabel: Record<string, string> = {
    calls: "调用", failures: "失败", failureRate: "失败率", sessions: "会话",
    mainCodeCount: "主错误码", p95Ms: "P95", bursts: "重试", corrections: "纠正",
    peakCost: "高峰成本", peakRatio: "高峰占比", avoidableCost: "可省", nightPct: "夜间",
  };
  const sevLabel: Record<string, string> = { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" };
  return `
    <section class="chapter">
      <div class="chapter-label"><span>02 / IMPROVE</span><b>值得改进</b><small>READ ONLY<br>NO AUTO EDIT<br>VERIFY READY</small></div>
      <div class="chapter-content">
        <div class="chapter-intro"><h2>Worth<br>changing?</h2><p>全部建议由确定性规则生成，只读、不自动修改任何 skill / workflow / 仓库文件。</p></div>
        <div class="improve-list">
          ${items.map((item, index) => {
            const metricKeys = Object.keys(item.evidence.metrics).filter((key) => metricLabel[key] !== undefined).slice(0, 5);
            const exp = item.evidence.experimental === true ? `<span class="improve-exp">EXPERIMENTAL</span>` : "";
            return `
            <div class="improve-item improve-item--${item.severity.toLowerCase()}" data-id="${esc(item.id)}">
              <div class="improve-head">
                <span class="improve-no">${String(index + 1).padStart(2, "0")}</span>
                <span class="improve-sev">${sevLabel[item.severity]}</span>
                ${exp}
                <h3>${esc(item.title)}</h3>
              </div>
              ${metricKeys.length > 0 ? `<div class="improve-metrics">${metricKeys.map((key) => `<span><b>${item.evidence.metrics[key]}</b>${esc(metricLabel[key])}</span>`).join("")}</div>` : ""}
              <p class="improve-why">${esc(item.summary)}</p>
              <p class="improve-rec"><b>建议</b> ${esc(item.recommendation)}</p>
              <p class="improve-verify"><b>VERIFY</b> ${esc(item.verificationPlan.targetMetric)} 基线 ${item.verificationPlan.baseline ?? "—"} → 目标 ${esc(item.verificationPlan.target)} · ${esc(item.verificationPlan.window)}</p>
            </div>`;
          }).join("")}
        </div>
      </div>
    </section>`;
}

function gridHtml(stats: ReportStats): string {
  const series = stats.dayHourSeries ?? [];
  if (series.length === 0) return `<p class="empty-line">该报告生成于旧版本，无逐时数据。重新生成即可。</p>`;
  const max = Math.max(1, ...series.flatMap((item) => item.hours));
  const cell = (count: number): string => {
    if (count === 0) return '<i class="scan-cell scan-cell--empty"></i>';
    const level = Math.max(0.16, Math.min(1, count / max));
    return `<i class="scan-cell" style="background:rgba(77,107,254,${level.toFixed(2)})"></i>`;
  };
  const cols = series.slice(-30);
  return `
  <div class="scan-frame">
    <div class="scan-meta"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
    <div class="grid">
      <div class="grid-hours">
        ${Array.from({ length: 24 }, (_, hour) => `<span>${hour % 6 === 0 ? String(hour).padStart(2, "0") : ""}</span>`).join("")}
      </div>
      ${cols.map((day) => `<div class="grid-col">${day.hours.map((count) => cell(count)).join("")}</div>`).join("")}
    </div>
    <div class="grid-dates">${cols.map((day, index) => `<span>${index === 0 || index === cols.length - 1 || index % 5 === 0 ? esc(day.date.slice(5)) : ""}</span>`).join("")}</div>
    <span class="scan-line"></span>
  </div>`;
}

function tokenBarHtml(stats: ReportStats): string {
  const tokens = stats.tokens;
  const total = sumTokens(stats);
  if (total === 0) return `<p class="empty-line">无 Token 用量数据。</p>`;
  const item = (label: string, sub: string, value: number, tone: string): string => `
    <div class="token-cell token-cell--${tone}">
      <span>${label}</span><b>${fmt(value)}</b><small>${sub} / ${Math.round((value / total) * 100)}%</small>
    </div>`;
  return `<div class="token-ledger">
    ${item("INPUT", "输入", tokens.input, "input")}
    ${item("OUTPUT", "输出", tokens.output, "output")}
    ${item("CACHE HIT", "缓存命中", tokens.cacheRead, "cache")}
    ${item("THINKING", "思考", tokens.reasoning, "reasoning")}
  </div>`;
}

function modelTableHtml(stats: ReportStats, cost?: CostBreakdown): string {
  const entries = Object.entries(stats.models).sort(
    (a, b) => b[1].input + b[1].output + b[1].cacheRead + b[1].reasoning - (a[1].input + a[1].output + a[1].cacheRead + a[1].reasoning),
  );
  if (entries.length === 0) return `<p class="empty-line">无模型用量数据。</p>`;
  return `
  <div class="model-ledger">
    <div class="ledger-head"><span>MODEL</span><span>INPUT</span><span>OUTPUT</span><span>CACHE</span><span>THINK</span><span>CNY</span></div>
    ${entries
      .map(([model, usage], index) => {
        const modelCost = cost?.perModel[model];
        return `<div class="model-row"><span class="model-name"><i>${String(index + 1).padStart(2, "0")}</i>${esc(model)}</span><span>${fmt(usage.input)}</span><span>${fmt(usage.output)}</span><span>${fmt(usage.cacheRead)}</span><span>${fmt(usage.reasoning)}</span><b>${typeof modelCost === "number" ? `¥${modelCost.toFixed(2)}` : "—"}</b></div>`;
      })
      .join("")}
  </div>
  ${cost !== undefined && cost.total > 0 ? `<p class="source-line">RATE SOURCE / ${cost.source === "official-page" ? "官方定价页实时价" : cost.source === "peak-offpeak" ? "官方峰谷价（按时段）" : "内置价"} · 费用为估算，以平台账单为准</p>` : ""}`;
}

function toolTableHtml(stats: ReportStats): string {
  const entries = Object.entries(stats.toolCalls).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (entries.length === 0) return `<p class="empty-line">本期无工具调用。</p>`;
  const total = Math.max(1, stats.toolCallsTotal);
  return `<div class="tool-ledger">
    ${entries.map(([name, count], index) => `<div class="tool-row"><span>${String(index + 1).padStart(2, "0")}</span><code>${esc(name)}</code><small>${Math.round((count / total) * 100)}%</small><b>${count}</b></div>`).join("")}
  </div>`;
}

/** 工具健康（PDF 区块）：异常优先，样本 ≥5，只存枚举与计数。 */
function toolHealthHtml(stats: ReportStats): string {
  const health = stats.toolHealth ?? [];
  if (health.length === 0) return "";
  const rows = health
    .filter((t) => t.calls >= 5)
    .sort((a, b) => {
      const ab = (x: typeof a) => x.calls >= TOOL_HEALTH_MIN_CALLS && x.failed >= TOOL_HEALTH_MIN_FAILED && x.failureRate >= TOOL_HEALTH_MIN_FAILURE_RATE;
      if (ab(a) !== ab(b)) return ab(a) ? -1 : 1;
      if (ab(a) && ab(b)) return b.failureRate - a.failureRate;
      return b.calls - a.calls;
    })
    .slice(0, 10);
  if (rows.length === 0) return "";
  const fmtDur = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
  return `<div class="resource-title" style="margin-top:18px"><b>TOOL HEALTH</b><span>FAILURE / LATENCY PROFILE</span></div>
  <div class="tool-ledger">
    ${rows
      .map((t, i) => {
        const abnormal = t.failed >= 3 && t.failureRate >= 0.15;
        const successPct = Math.round(t.successRate * 1000) / 10;
        const errText = Object.entries(t.errorCodes)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([code, n]) => `${esc(code)} ×${n}`)
          .join(" · ");
        return `<div class="tool-row${abnormal ? " tool-row--abnormal" : ""}">
          <span>${String(i + 1).padStart(2, "0")}</span>
          <code>${esc(t.name)}</code>
          <small>${successPct}% SUCCESS${t.failed > 0 ? ` · ${t.failed} FAILED` : ""}</small>
          <b>${t.calls} CALLS · ${fmtDur(t.avgDurationMs)}${errText !== "" ? ` · ${errText}` : ""}</b>
        </div>`;
      })
      .join("")}
  </div>`;
}

function retryDiagnoseHtml(stats: ReportStats): string {
  const bursts = stats.burstSamples ?? [];
  if (bursts.length === 0) {
    return `<div class="risk-clear"><span>RETRY</span><b>CLEAR</b><p>未检测到重试风暴。</p></div>`;
  }
  return `<div class="risk-pane risk-pane--retry">
    <div class="risk-heading"><span>RETRY STORM</span><b>${stats.retryBursts}</b><small>同命令连续重复 ≥3</small></div>
    <ul class="samples samples--retry">
      ${bursts.slice(0, 8).map((burst) => `<li><code>${esc(burst.cmd)}</code><span>× ${burst.count} · ${esc(timeStr(burst.time))}${burst.error === undefined ? "" : ` · ${esc(burst.error.slice(0, 80))}`}</span></li>`).join("")}
    </ul>
    ${bursts.length > 8 ? `<p class="source-line">SHOWING 8 / ${bursts.length} SIGNALS</p>` : ""}
  </div>`;
}

function dangerHtml(stats: ReportStats): string {
  const danger = stats.dangerousCommands.map((item) => ({ ...item, label: item.label ?? "未分类", command: item.command ?? "", sev: item.sev ?? "amber" }));
  if (danger.length === 0) {
    return `<div class="risk-clear"><span>RISK</span><b>CLEAR</b><p>无危险操作。</p></div>`;
  }
  const byLabel = new Map<string, number>();
  for (const item of danger) byLabel.set(item.label, (byLabel.get(item.label) ?? 0) + 1);
  const categories = [...byLabel.entries()].sort((a, b) => b[1] - a[1]);
  const red = danger.filter((item) => item.sev === "red").length;
  return `<div class="risk-pane risk-pane--danger">
    <div class="risk-heading"><span>DANGER OPS</span><b>${danger.length}</b><small>CRITICAL ${red} / WATCH ${danger.length - red}</small></div>
    <div class="risk-categories">${categories.map(([label, count]) => `<span>${esc(label)} <b>${count}</b></span>`).join("")}</div>
    <ul class="samples samples--danger">
      ${danger.slice(0, 8).map((item) => `<li class="sample--${item.sev}"><code>${esc(item.command.replace(/\\s+/g, " ").slice(0, 96))}</code><span>${esc(item.label)} · ${esc(timeStr(item.time))}</span></li>`).join("")}
    </ul>
  </div>`;
}

function secretHtml(stats: ReportStats): string {
  const hits = stats.secretHits ?? [];
  if (hits.length === 0) {
    return `<div class="secret-strip"><span>SECRET SCAN</span><b>CLEAR</b><p>未发现疑似密钥或令牌。</p><small>CONTENT NEVER REPRINTED</small></div>`;
  }
  const counts = new Map<string, number>();
  for (const hit of hits) counts.set(hit.label, (counts.get(hit.label) ?? 0) + 1);
  const labels = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${esc(label)} × ${count}`)
    .join(" · ");
  return `<div class="secret-strip secret-strip--hit"><span>SECRET SCAN</span><b>${hits.length} HIT</b><p>${labels}</p><small>ROTATE CREDENTIALS / 未展示原文</small></div>`;
}

function sessionTokenTotal(session: SessionDetail): number {
  return Object.values(session.modelTokens ?? {}).reduce(
    (total, usage) => total + usageTotalTokens(usage),
    0,
  );
}

/** 协作复盘章节：确定性规则，样本不足时整章不渲染。 */
/** 生成本报告消耗（旧记录缺省；结构宽松防御）。 */
interface ReportGenerationMetaLike {
  mode: "local" | "model";
  totalTokens: number;
  model?: string;
}

function collabHtml(record: ReportRecord): string {
  const stats = record.stats as unknown as ReportStats;
  const collab = stats.collab;
  if (collab === undefined) return "";
  const insights = computeCollaborationInsights({ ...collab, sessions: stats.sessions });
  if (insights.length === 0) return "";
  const rows = insights
    .map(
      (item) => `<div class="collab-row">
        <span class="collab-code">${esc(item.code)}</span>
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.observation)}</p>
        <p class="collab-tip"><b>建议</b> ${esc(item.suggestion)}</p>
      </div>`,
    )
    .join("");
  return `<section class="chapter">
    <div class="chapter-label"><span>03 / COLLAB</span><b>协作复盘</b><small>HUMAN × HARNESS<br>COLLABORATION<br>REVIEW</small></div>
    <div class="chapter-content">
      <div class="chapter-intro"><h2>Work<br>together.</h2><p>观察人机协作模式，找可能的摩擦，给可以尝试的优化——不评价人格，不归因单方。</p></div>
      ${rows}
    </div>
  </section>`;
}

function traceLogHtml(stats: ReportStats, cost?: CostBreakdown): string {
  const sessions = stats.sessionsDetail ?? [];
  if (sessions.length > 0) {
    const totalCost = Math.max(cost?.total ?? sessions.reduce((sum, item) => sum + item.cost, 0), 0.000001);
    return `<div class="trace-log">
      ${sessions.slice(0, 12).map((session, index) => {
        const share = Math.round((session.cost / totalCost) * 100);
        const flags = [
          session.redDanger > 0 ? `CRITICAL ${session.redDanger}` : "",
          session.dangerCount - session.redDanger > 0 ? `WATCH ${session.dangerCount - session.redDanger}` : "",
          session.retryBursts > 0 ? `RETRY ${session.retryBursts}` : "",
        ].filter(Boolean).join(" · ");
        return `<div class="trace-row">
          <span class="trace-no">${String(index + 1).padStart(2, "0")}</span>
          <div class="trace-main"><h3>${esc(session.title || "Untitled session")}</h3><p>${esc(timeStr(session.firstTime))} → ${esc(timeStr(session.lastTime))}</p><small>${fmt(sessionTokenTotal(session))} token · ${session.toolCalls} tools · ${session.events} events${flags === "" ? "" : ` · ${esc(flags)}`}</small><code>SID ${esc(session.sessionId)}</code></div>
          <div class="trace-cost"><b>¥${session.cost.toFixed(2)}</b><span>${share}% OF PERIOD</span></div>
        </div>`;
      }).join("")}
    </div>`;
  }
  if (stats.titles.length > 0) {
    return `<div class="trace-log">${stats.titles.slice(0, 12).map((title, index) => `<div class="trace-row trace-row--legacy"><span class="trace-no">${String(index + 1).padStart(2, "0")}</span><div class="trace-main"><h3>${esc(title)}</h3><p>Legacy report / 无会话级明细</p></div></div>`).join("")}</div>`;
  }
  return `<p class="empty-line">本期无可钻取会话。</p>`;
}

export function renderHtmlReport(record: ReportRecord): string {
  const stats = record.stats as unknown as ReportStats;
  // 旧版本报告可能缺新字段，全部兜底；只补展示层默认值，不改变统计语义。
  stats.models = stats.models ?? {};
  stats.titles = stats.titles ?? [];
  stats.dayHourSeries = stats.dayHourSeries ?? [];
  stats.dailySeries = stats.dailySeries ?? [];
  stats.dangerousCommands = stats.dangerousCommands ?? [];
  stats.tokens = stats.tokens ?? { input: 0, output: 0, cacheRead: 0, reasoning: 0 };
  stats.toolCalls = stats.toolCalls ?? {};
  stats.hourHistogram = stats.hourHistogram ?? new Array(24).fill(0) as number[];
  stats.burstSamples = stats.burstSamples ?? [];
  stats.secretHits = stats.secretHits ?? [];
  stats.sessionsDetail = stats.sessionsDetail ?? [];
  stats.subagentSessions = stats.subagentSessions ?? 0;
  stats.steps = stats.steps ?? 0;
  stats.toolErrors = stats.toolErrors ?? 0;
  stats.retryBursts = stats.retryBursts ?? 0;
  const cost = record.cost as unknown as CostBreakdown | undefined;
  const totalTokens = sumTokens(stats);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>深迹报告 · ${esc(record.preset)}</title>
<style>
  :root {
    --paper: #fbfcff;
    --fog: #f0f3f8;
    --ink: #101a2c;
    --navy: #13223d;
    --muted: #68768d;
    --hairline: #d9e0eb;
    --blue: #4d6bfe;
    --cyan: #239fc9;
    --red: #c93c45;
    --amber: #b97818;
    --safe: #31765a;
  }
  * { box-sizing: border-box; }
  html { background: var(--fog); }
  body {
    margin: 0;
    color: var(--ink);
    background: var(--fog);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    font-variant-numeric: tabular-nums;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { width: min(960px, 100%); margin: 0 auto; padding: 42px 54px 52px; background: var(--paper); }
  .opening { position: relative; padding-bottom: 30px; overflow: hidden; }
  .opening-rule { height: 6px; width: 100%; background: var(--navy); margin-bottom: 20px; }
  .opening-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 30px; }
  .wordmark { display: flex; align-items: baseline; gap: 12px; }
  .wordmark-cn { font-size: 34px; line-height: 1; font-weight: 900; letter-spacing: -.08em; }
  .wordmark-en { color: var(--blue); font-size: 17px; font-weight: 760; letter-spacing: -.02em; }
  .opening-index { display: grid; gap: 4px; text-align: right; color: var(--muted); font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; }
  .opening-main { min-height: 260px; display: grid; grid-template-columns: minmax(0, 1fr) 260px; align-items: center; gap: 20px; }
  .eyebrow { margin: 0 0 36px; color: var(--navy); font-size: 24px; line-height: 1.05; font-weight: 850; letter-spacing: -.045em; max-width: 260px; }
  .headline-label { margin: 0 0 2px; color: var(--muted); font: 10px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .1em; }
  .headline-value { color: var(--navy); font-size: clamp(66px, 10vw, 104px); line-height: .92; font-weight: 900; letter-spacing: -.075em; }
  .currency { color: var(--blue); font-size: .43em; font-weight: 800; vertical-align: top; position: relative; top: .12em; margin-right: .08em; }
  .headline-delta { display: inline-flex; align-items: baseline; gap: 7px; margin-top: 13px; font: 700 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .headline-delta small { color: var(--muted); font-size: 9px; letter-spacing: .08em; }
  .headline-delta--up { color: var(--red); }
  .headline-delta--down { color: var(--safe); }
  .headline-delta--muted { color: var(--muted); font-size: 10px; letter-spacing: .06em; }
  .observer { position: relative; width: 250px; height: 250px; justify-self: end; display: grid; place-items: center; }
  .observer img { position: relative; z-index: 2; width: 196px; height: 196px; object-fit: contain; image-rendering: pixelated; transition: transform .4s ease; }
  .observer:hover img { transform: translateY(-3px); }
  .sonar-ring, .sonar-cross { position: absolute; z-index: 0; pointer-events: none; }
  .sonar-ring { border: 1px solid rgba(77,107,254,.18); border-radius: 50%; }
  .sonar-ring--outer { inset: 8px; animation: sonar-breathe 7s ease-in-out infinite; }
  .sonar-ring--inner { inset: 44px; border-color: rgba(35,159,201,.22); }
  .sonar-cross--h { left: 0; right: 0; top: 50%; border-top: 1px solid rgba(77,107,254,.10); }
  .sonar-cross--v { top: 0; bottom: 0; left: 50%; border-left: 1px solid rgba(77,107,254,.10); }
  .observer-id { position: absolute; z-index: 3; right: 0; bottom: 18px; padding: 4px 7px; background: var(--paper); color: var(--muted); font: 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; }
  @keyframes sonar-breathe { 0%, 100% { transform: scale(.98); opacity: .7; } 50% { transform: scale(1.02); opacity: 1; } }
  .telemetry { display: grid; grid-template-columns: repeat(5, 1fr); border-top: 1px solid var(--navy); border-bottom: 1px solid var(--hairline); }
  .telemetry > div { min-width: 0; padding: 12px 12px 13px 0; }
  .telemetry > div + div { padding-left: 12px; border-left: 1px solid var(--hairline); }
  .telemetry span, .telemetry small { display: block; color: var(--muted); font: 8px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .07em; }
  .telemetry b { display: block; margin: 5px 0 3px; font-size: 22px; line-height: 1; font-weight: 850; }
  .opening-status { display: flex; justify-content: flex-end; gap: 18px; margin-top: 9px; color: #8a96a8; font: 8.5px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; }
  .partial-banner {
    margin-top: 12px; padding: 9px 12px; border: 1px solid #e8c36a; border-radius: 8px;
    background: #fffbeb; color: #7a5310; font: 600 11px/1.6 ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .partial-banner b { color: #92400e; }
  .whale-note { position: relative; display: grid; grid-template-columns: 128px 1fr; gap: 28px; margin: 18px -54px 4px; padding: 34px 154px 34px 54px; background: #edf2f9; border-top: 1px solid #ccd7e8; border-bottom: 1px solid #ccd7e8; overflow: hidden; break-inside: avoid; }
  .note-label { display: flex; flex-direction: column; align-items: flex-start; border-right: 1px solid #c9d4e4; }
  .note-label span { color: var(--blue); font: 800 9px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .1em; }
  .note-label b { margin-top: 8px; font-size: 15px; }
  .note-label small { margin-top: auto; color: var(--muted); font: 8px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .06em; }
  .whale-note blockquote { margin: 0; max-width: 520px; color: var(--navy); font-family: ui-serif, "Songti SC", "STSong", serif; font-size: 21px; line-height: 1.65; font-weight: 650; letter-spacing: .01em; }
  .whale-note img { position: absolute; right: 28px; bottom: -11px; width: 126px; height: 126px; object-fit: contain; image-rendering: pixelated; }
  .note-sign { grid-column: 2; margin-top: -4px; color: var(--muted); font: 8.5px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; }
  .chapter { display: grid; grid-template-columns: 112px minmax(0, 1fr); column-gap: 28px; padding: 42px 0 12px; border-top: 1px solid var(--navy); }
  .chapter:first-of-type { border-top: 0; }
  .chapter-label { grid-column: 1; grid-row: 1 / span 2; }
  .chapter-label span { display: block; color: var(--blue); font: 800 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .1em; }
  .chapter-label b { display: block; margin-top: 9px; font-size: 15px; line-height: 1.35; }
  .chapter-label small { display: block; margin-top: 8px; color: var(--muted); font: 8px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .05em; }
  .chapter-content { grid-column: 2; min-width: 0; }
  .chapter-intro { display: flex; justify-content: space-between; gap: 24px; margin: 0 0 19px; }
  .chapter-intro h2 { margin: 0; color: var(--navy); font-size: 28px; line-height: 1; letter-spacing: -.04em; }
  .chapter-intro p { margin: 3px 0 0; max-width: 280px; color: var(--muted); font-size: 10px; line-height: 1.5; text-align: right; }
  .finding { position: relative; display: grid; grid-template-columns: 34px 8px minmax(0, 1fr) auto; gap: 14px; padding: 18px 0; border-top: 1px solid var(--hairline); break-inside: avoid; }
  .finding:last-child { border-bottom: 1px solid var(--hairline); }
  .finding-no { color: #8a96a8; font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .finding-signal { width: 7px; height: 7px; margin-top: 4px; border-radius: 50%; background: var(--blue); }
  .finding--critical .finding-signal { background: var(--red); }
  .finding--warning .finding-signal { background: var(--amber); }
  .finding--tip .finding-signal, .finding--clear .finding-signal { background: var(--safe); }
  .finding-type { margin: 0 0 4px !important; color: var(--muted) !important; font: 800 8px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace !important; letter-spacing: .1em; }
  .finding-copy h3, .finding > div h3 { margin: 0; font-size: 15px; line-height: 1.35; }
  .finding-copy p, .finding > div p { margin: 5px 0 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
  .finding-action b { color: var(--blue); font: 800 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; }
  .finding-estimate { color: #7b8799 !important; font-style: italic; }
  .finding-state { align-self: start; color: var(--muted); font: 8px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; }
  .improve-list { display: flex; flex-direction: column; gap: 12px; }
  .improve-item { padding: 14px 14px 12px; border-left: 3px solid var(--cyan); border-radius: 4px; background: #f6f9fb; break-inside: avoid; }
  .improve-item--high { border-left-color: var(--red); background: #fdf6f6; }
  .improve-item--medium { border-left-color: var(--amber); background: #fdfaf3; }
  .improve-head { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .improve-no { color: #8a96a8; font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .improve-sev { color: var(--red); font: 800 8px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .1em; padding: 1px 6px; border: 1px solid #f0b9bd; border-radius: 4px; background: #fff; }
  .improve-item--medium .improve-sev { color: var(--amber); border-color: #e8c36a; }
  .improve-item--low .improve-sev { color: var(--cyan); border-color: #9fd7e8; }
  .improve-exp { color: var(--muted); font: 800 7px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .1em; border: 1px dashed var(--hairline); border-radius: 4px; padding: 1px 5px; }
  .improve-head h3 { margin: 0; font-size: 13.5px; line-height: 1.4; }
  .improve-metrics { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; }
  .improve-metrics span { color: var(--muted); font-size: 10px; }
  .improve-metrics b { color: var(--ink); font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums; margin-right: 4px; }
  .improve-why { margin: 8px 0 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
  .improve-rec { margin: 7px 0 0; color: var(--ink); font-size: 11px; line-height: 1.55; }
  .improve-rec b, .improve-verify b { color: var(--blue); font: 800 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; margin-right: 6px; }
  .improve-verify { margin: 6px 0 0; color: #7b8799; font: 9px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .scan-frame { position: relative; padding: 16px 12px 12px 0; border-top: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline); overflow: hidden; break-inside: avoid; }
  .scan-meta { display: flex; justify-content: space-between; margin: 0 0 8px 30px; color: #8c98a9; font: 7px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .05em; }
  .grid { position: relative; z-index: 1; display: flex; gap: 3px; }
  .grid-hours { display: flex; flex-direction: column; gap: 2px; margin-right: 5px; }
  .grid-hours span { width: 20px; height: 7px; color: #919cab; font: 6px/7px ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; }
  .grid-col { display: flex; flex: 1; min-width: 1px; flex-direction: column; gap: 2px; }
  .scan-cell { display: block; height: 7px; }
  .scan-cell--empty { background: #edf0f5; }
  .grid-dates { display: flex; gap: 3px; margin: 7px 0 0 28px; }
  .grid-dates span { flex: 1; min-width: 0; color: #929dad; font: 6.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
  .scan-line { position: absolute; z-index: 0; top: 38%; left: 27px; right: 0; border-top: 1px solid rgba(35,159,201,.25); }
  .token-ledger { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline); }
  .token-cell { min-width: 0; padding: 14px 10px 14px 0; border-top: 3px solid var(--blue); }
  .token-cell + .token-cell { padding-left: 12px; border-left: 1px solid var(--hairline); }
  .token-cell--output { border-top-color: var(--cyan); }
  .token-cell--cache { border-top-color: #8490a5; }
  .token-cell--reasoning { border-top-color: #263c72; }
  .token-cell span, .token-cell small { display: block; color: var(--muted); font: 7.5px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .06em; }
  .token-cell b { display: block; margin: 8px 0 5px; color: var(--navy); font-size: 22px; line-height: 1; letter-spacing: -.035em; }
  .resource-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(180px, .75fr); gap: 32px; }
  .resource-title { display: flex; justify-content: space-between; align-items: baseline; margin: 26px 0 8px; }
  .resource-title b { font-size: 12px; }
  .resource-title span { color: var(--muted); font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; }
  .ledger-head, .model-row { display: grid; grid-template-columns: minmax(120px, 1.5fr) repeat(5, minmax(42px, .58fr)); gap: 8px; align-items: center; }
  .ledger-head { padding: 7px 0; border-top: 1px solid var(--navy); color: var(--muted); font: 7px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; }
  .ledger-head span:first-child { text-align: left; }
  .model-row { min-height: 43px; border-top: 1px solid var(--hairline); font: 9px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; break-inside: avoid; }
  .model-row:last-child { border-bottom: 1px solid var(--hairline); }
  .model-row .model-name { overflow: hidden; color: var(--ink); font: 700 10px/1.2 ui-sans-serif, system-ui, sans-serif; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
  .model-name i { margin-right: 9px; color: #929dad; font: normal 7px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .model-row b { color: var(--blue); }
  .source-line { margin: 8px 0 0; color: #8a96a8; font: 7px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .05em; }
  .tool-ledger { border-top: 1px solid var(--navy); }
  .tool-row { display: grid; grid-template-columns: 20px 1fr 30px 36px; gap: 8px; align-items: center; min-height: 34px; border-bottom: 1px solid var(--hairline); }
  .tool-row > span, .tool-row small { color: var(--muted); font: 7.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .tool-row code { overflow: hidden; color: var(--navy); font: 9px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
  .tool-row b { color: var(--blue); font: 800 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; }
  .risk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 34px; }
  .risk-pane, .risk-clear { border-top: 3px solid var(--amber); }
  .risk-pane--danger { border-top-color: var(--red); }
  .risk-clear { padding: 16px 0; border-top-color: var(--safe); }
  .risk-clear span { color: var(--muted); font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; }
  .risk-clear b { display: block; margin-top: 8px; color: var(--safe); font-size: 30px; }
  .risk-clear p { margin: 5px 0 0; color: var(--muted); font-size: 10px; }
  .risk-heading { display: grid; grid-template-columns: 1fr auto; align-items: end; padding: 12px 0; border-bottom: 1px solid var(--hairline); }
  .risk-heading span { color: var(--muted); font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; }
  .risk-heading b { grid-row: 1 / span 2; grid-column: 2; color: var(--navy); font-size: 34px; line-height: 1; }
  .risk-heading small { margin-top: 5px; color: var(--muted); font: 7px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .risk-categories { display: flex; flex-wrap: wrap; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--hairline); }
  .risk-categories span { color: var(--muted); font-size: 8px; }
  .risk-categories b { color: var(--red); }
  .samples { margin: 0; padding: 0; list-style: none; }
  .samples li { position: relative; padding: 10px 0 10px 11px; border-bottom: 1px solid var(--hairline); word-break: break-word; break-inside: avoid; }
  .samples li::before { content: ""; position: absolute; top: 14px; left: 0; width: 4px; height: 4px; border-radius: 50%; background: var(--amber); }
  .samples--danger li::before { background: var(--red); }
  .samples li.sample--amber::before { background: var(--amber); }
  .samples code { display: block; color: var(--navy); font: 8.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .samples span { display: block; margin-top: 4px; color: var(--muted); font: 7px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .secret-strip { display: grid; grid-template-columns: 94px 72px minmax(0, 1fr) auto; gap: 14px; align-items: center; margin-top: 18px; padding: 13px 0; border-top: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline); break-inside: avoid; }
  .secret-strip > span, .secret-strip > small { color: var(--muted); font: 8px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; }
  .secret-strip > b { color: var(--safe); font-size: 13px; }
  .secret-strip > p { margin: 0; color: var(--muted); font-size: 9px; line-height: 1.45; }
  .secret-strip--hit { border-left: 3px solid #6750a4; padding-left: 12px; }
  .secret-strip--hit > b { color: #6750a4; }
  .trace-log { border-top: 1px solid var(--navy); }
  .trace-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) 92px; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--hairline); break-inside: avoid; }
  .trace-no { color: #8d98a8; font: 8px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .trace-main { min-width: 0; }
  .trace-main h3 { margin: 0; overflow: hidden; color: var(--navy); font-size: 13px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
  .trace-main p, .trace-main small, .trace-main code { display: block; margin: 4px 0 0; color: var(--muted); font: 7.5px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .trace-main code { color: #8c97a8; font-size: 6.5px; }
  .trace-cost { text-align: right; }
  .trace-cost b { display: block; color: var(--blue); font-size: 15px; }
  .trace-cost span { display: block; margin-top: 4px; color: var(--muted); font: 6.5px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .04em; }
  .trace-row--legacy { grid-template-columns: 34px minmax(0, 1fr); }
  .empty-line { margin: 0; padding: 18px 0; border-top: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline); color: var(--muted); font-size: 10px; }
  .report-foot { display: flex; justify-content: space-between; gap: 30px; margin-top: 44px; padding-top: 13px; border-top: 5px solid var(--navy); color: var(--muted); font: 8px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .05em; }
  .report-foot b { color: var(--navy); }
  @media (max-width: 700px) {
    .page { padding: 26px 22px 36px; }
    .opening-main { grid-template-columns: 1fr 160px; min-height: 220px; }
    .observer { width: 160px; height: 160px; }
    .observer img { width: 132px; height: 132px; }
    .telemetry { grid-template-columns: repeat(3, 1fr); }
    .telemetry > div:nth-child(4) { border-left: 0; }
    .whale-note { margin-inline: -22px; padding: 28px 104px 28px 22px; grid-template-columns: 92px 1fr; gap: 18px; }
    .whale-note img { right: 6px; width: 96px; height: 96px; }
    .whale-note blockquote { font-size: 17px; }
    .chapter { grid-template-columns: 82px minmax(0, 1fr); gap: 16px; }
    .resource-grid, .risk-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 500px) {
    .opening-main { grid-template-columns: 1fr; }
    .observer { position: absolute; right: -42px; top: 58px; opacity: .34; }
    .eyebrow { margin-bottom: 28px; }
    .telemetry { grid-template-columns: repeat(2, 1fr); }
    .telemetry > div:nth-child(odd) { padding-left: 0; border-left: 0; }
    .opening-status { flex-wrap: wrap; justify-content: flex-start; }
    .whale-note { display: block; padding-right: 88px; }
    .note-label { border-right: 0; margin-bottom: 18px; }
    .note-label small { margin-top: 6px; }
    .note-sign { margin-top: 10px; }
    .chapter { display: block; padding-top: 28px; }
    .chapter-label { margin-bottom: 20px; }
    .chapter-label small { display: none; }
    .chapter-intro h2 { font-size: 23px; }
    .finding { grid-template-columns: 24px 7px 1fr; }
    .finding-state { display: none; }
    .token-ledger { grid-template-columns: repeat(2, 1fr); }
    .token-cell:nth-child(3) { border-left: 0; }
    .ledger-head, .model-row { grid-template-columns: minmax(100px, 1.5fr) repeat(2, minmax(38px, .5fr)); }
    .ledger-head span:nth-child(2), .ledger-head span:nth-child(3), .ledger-head span:nth-child(4), .model-row span:nth-child(2), .model-row span:nth-child(3), .model-row span:nth-child(4) { display: none; }
    .trace-row { grid-template-columns: 24px minmax(0, 1fr); }
    .trace-cost { grid-column: 2; text-align: left; }
    .secret-strip { grid-template-columns: 1fr auto; }
    .secret-strip > p, .secret-strip > small { grid-column: 1 / -1; }
    .report-foot { display: block; }
  }
  @media print {
    @page { size: A4; margin: 14mm 13mm 15mm; }
    html, body { background: #fff; }
    .page { width: auto; margin: 0; padding: 0; background: #fff; }
    .opening { min-height: 0; padding-bottom: 12px; break-inside: avoid; }
    .opening-main { min-height: 235px; }
    .eyebrow { margin-bottom: 24px; }
    .observer img { transition: none; }
    .sonar-ring--outer { animation: none; }
    .whale-note { padding-top: 24px; padding-bottom: 24px; }
    .whale-note blockquote { font-size: 18px; }
    .chapter { padding-top: 28px; }
    .chapter:nth-of-type(4) { break-before: page; }
    .chapter-intro, .chapter-label, .resource-title { break-after: avoid; }
    .finding { padding-top: 13px; padding-bottom: 13px; }
    .whale-note { margin-inline: -13mm; padding-inline: 13mm 42mm; }
    .report-foot { margin-bottom: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
</style>
</head>
<body>
<main class="page">
  ${heroHtml(stats, record, cost)}
  ${whaleNoteHtml(stats)}

  <section class="chapter">
    <div class="chapter-label"><span>01 / FINDINGS</span><b>值得注意</b><small>AGENT<br>INVESTIGATION<br>LOG</small></div>
    <div class="chapter-content">
      <div class="chapter-intro"><h2>Signals,<br>not noise.</h2><p>规则引擎只展示有依据的信号。展开前，先看结论；需要行动时，再看证据。</p></div>
      <div class="findings">${findingsHtml(record)}</div>
    </div>
  </section>

  ${improveHtml(record)}

  ${collabHtml(record)}

  <section class="chapter">
    <div class="chapter-label"><span>04 / ACTIVITY</span><b>活跃轨迹</b><small>SONAR<br>SCAN LOG<br>UTC+08</small></div>
    <div class="chapter-content">
      <div class="chapter-intro"><h2>Agent<br>trajectory.</h2><p>${stats.activeDays} 个活跃日 · 峰值 ${stats.busiestDay === null ? "—" : `${esc(stats.busiestDay.date)} / ${stats.busiestDay.events} events`} · 深夜 ${nightRatio(stats)}%</p></div>
      ${gridHtml(stats)}
      <div class="resource-title"><b>TOKEN ALLOCATION</b><span>TOTAL ${fmt(totalTokens)} / CACHE HIT ${cacheRate(stats)}%</span></div>
      ${tokenBarHtml(stats)}
    </div>
  </section>

  <section class="chapter">
    <div class="chapter-label"><span>05 / RESOURCES</span><b>模型与工具</b><small>MODEL<br>TOOL CALL<br>/think</small></div>
    <div class="chapter-content">
      <div class="chapter-intro"><h2>Dive<br>profile.</h2><p>模型、Token 与工具调用按同一周期口径汇总；费用仅作观察，不替代平台账单。</p></div>
      <div class="resource-grid">
        <div><div class="resource-title"><b>MODEL LEDGER</b><span>RESOURCE ALLOCATION</span></div>${modelTableHtml(stats, cost)}</div>
        <div><div class="resource-title"><b>TOOL CALL</b><span>${Object.keys(stats.toolCalls).length > 10 ? "TOP 10" : "ALL"}</span></div>${toolTableHtml(stats)}${toolHealthHtml(stats)}</div>
      </div>
    </div>
  </section>

  <section class="chapter">
    <div class="chapter-label"><span>06 / RISKS</span><b>风险记录</b><small>READ ONLY<br>NO SECRET<br>CONTENT</small></div>
    <div class="chapter-content">
      <div class="chapter-intro"><h2>Check before<br>you dive.</h2><p>只记录危险模式与疑似密钥的存在性；不会在报告中复现敏感信息原文。</p></div>
      <div class="risk-grid">${dangerHtml(stats)}${retryDiagnoseHtml(stats)}</div>
      ${secretHtml(stats)}
    </div>
  </section>

  <section class="chapter">
    <div class="chapter-label"><span>07 / TRACE LOG</span><b>会话钻取</b><small>SESSION<br>INVESTIGATION<br>TARGET</small></div>
    <div class="chapter-content">
      <div class="chapter-intro"><h2>Follow the<br>trace.</h2><p>按费用排序的会话级轨迹。成本、重试与危险信号在同一行对齐，便于回到原会话复盘。</p></div>
      ${traceLogHtml(stats, cost)}
    </div>
  </section>

  <footer class="report-foot">
    <span><b>深迹 DeepTrace</b> · YOUR AGENT, IN NUMBERS.</span>
    <span>${(() => {
      const gen = record.reportGeneration as ReportGenerationMetaLike | undefined;
      return gen === undefined
        ? `${stats.totalEvents} EVENTS · READ ONLY · GENERATED ${dateStr(record.createdAt)}`
        : `REPORT GENERATION ${gen.totalTokens} TOKENS · ${gen.mode === "local" ? "LOCAL DETERMINISTIC" : `MODEL${gen.model !== undefined ? ` ${gen.model}` : ""}`} · ${stats.totalEvents} EVENTS · READ ONLY`;
    })()}</span>
  </footer>
</main>
</body>
</html>`;
}
