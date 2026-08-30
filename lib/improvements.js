export const CORRECTION_CATEGORIES = [
    "COMMIT_CONTROL",
    "REPO_SCOPE",
    "UI_SCOPE",
    "NO_EXTRA_CHANGES",
    "NO_REPEAT_QUESTION",
    "OUTPUT_FORMAT",
];
export const CORRECTION_LABEL = {
    COMMIT_CONTROL: "commit 控制",
    REPO_SCOPE: "仓库范围",
    UI_SCOPE: "UI 范围",
    NO_EXTRA_CHANGES: "不做额外改动",
    NO_REPEAT_QUESTION: "不要反复确认",
    OUTPUT_FORMAT: "输出格式",
};
/** 归一化：lowercase → 去引号段 → 去数字/hash/路径（只用于匹配，不存储原文）。 */
export function normalizeCorrectionText(text) {
    return text
        .toLowerCase()
        .replace(/["'`][^"'`\n]*["'`]/g, " ")
        .replace(/\b[0-9a-f]{8,}\b/g, " ")
        .replace(/\d+/g, " ")
        .replace(/\/[\w.@-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
/** 有限分类白名单（保守：每类只收明确指令句式，宁缺毋滥；\s* 容忍"不要 push"式空格）。 */
const CORRECTION_PATTERNS = [
    {
        category: "COMMIT_CONTROL",
        patterns: [
            /(?:先)?不要\s*(?:去|要|自动)?\s*(?:commit|提交|push)/,
            /别\s*(?:commit|提交|push)/,
            /先别\s*(?:commit|提交|push)/,
            /不要\s*(?:自动)?\s*(?:commit|提交)/,
        ],
    },
    {
        category: "REPO_SCOPE",
        patterns: [
            /只\s*(?:能|要)?\s*(?:改|动|碰|管)\s*(?:这个|当前|本)?\s*(?:repo|仓库|项目|目录)/,
            /不要\s*(?:改|动|碰|管)\s*(?:别的|其他|无关)?\s*(?:repo|仓库|项目|目录|文件)/,
            /只允许.*(?:repo|仓库)/,
            /别\s*(?:动|碰|改)\s*(?:别的|其他)?\s*(?:repo|仓库|项目)/,
        ],
    },
    {
        category: "UI_SCOPE",
        patterns: [
            /不要\s*(?:改|动|碰).*(?:ui|界面|前端|页面)/,
            /只\s*(?:改|动|碰).*(?:ui|界面|前端|页面)/,
            /别\s*(?:改|动|碰).*(?:ui|界面|前端)/,
        ],
    },
    {
        category: "NO_EXTRA_CHANGES",
        patterns: [
            /不要\s*(?:做|加|改|顺便)\s*(?:任何)?\s*(?:多余|额外|无关)/,
            /只做\s*(?:需要|必要)的/,
            /别\s*(?:做|加)\s*(?:多余|额外|无关)/,
            /不要\s*(?:顺手|顺便)/,
        ],
    },
    {
        category: "NO_REPEAT_QUESTION",
        patterns: [
            /不要\s*(?:再|反复|一直)?\s*问\s*(?:我|了)?/,
            /别\s*问\s*(?:了|我)?/,
            /不要再问/,
            /不要\s*(?:再)?\s*次次确认/,
            /别\s*(?:再|反复)?\s*确认/,
        ],
    },
    {
        category: "OUTPUT_FORMAT",
        patterns: [
            /用\s*(?:中文|英文|json|markdown|md|表格|列表).*\s*(?:输出|回答|写)/,
            /输出.*(?:格式|为|成)\s*(?:中文|英文|json|markdown|md)/,
            /不要.*(?:表格|列表|代码块|markdown)/,
            /按.*格式.*输出/,
        ],
    },
];
/** 一条用户消息 → 命中的纠正类别（0..n；确定性白名单匹配）。 */
export function classifyCorrectionText(text) {
    const normalized = normalizeCorrectionText(text);
    const hits = [];
    for (const { category, patterns } of CORRECTION_PATTERNS) {
        if (patterns.some((re) => re.test(normalized)))
            hits.push(category);
    }
    return hits;
}
// ─────────────────────────── 内部工具 ───────────────────────────
/** djb2 确定性 hash（stable id 用；不泄密）。 */
function hash8(input) {
    let h = 5381;
    for (let i = 0; i < input.length; i += 1) {
        h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
    }
    return h.toString(16).padStart(8, "0").slice(0, 8);
}
/** 命令归一化（内部聚合键 / 展示用）：去引号段、去路径段、去数字，截断。 */
export function redactCommand(cmd) {
    return cmd
        .slice(0, 120)
        .replace(/["'`][^"'`\n]*["'`]/g, " ")
        .replace(/\/[\w.@-]+/g, " ")
        .replace(/\b[0-9a-f]{8,}\b/g, "x")
        .replace(/\d+/g, "n")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 48);
}
const SEVERITY_WEIGHT = { HIGH: 3, MEDIUM: 2, LOW: 1 };
/** 确定性排序：severity → score → occurrences → category → id。 */
export function rankImprovements(items) {
    return [...items].sort((a, b) => {
        const sw = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
        if (sw !== 0)
            return sw;
        const sa = a.evidence.occurrences * (a.evidence.confidence + 1);
        const sb = b.evidence.occurrences * (b.evidence.confidence + 1);
        if (sb - sa !== 0)
            return sb - sa;
        if (b.evidence.occurrences !== a.evidence.occurrences)
            return b.evidence.occurrences - a.evidence.occurrences;
        if (a.category !== b.category)
            return a.category < b.category ? -1 : 1;
        return a.id < b.id ? -1 : 1;
    });
}
// ─────────────────────────── 规则实现 ───────────────────────────
/** 工具健康门槛（复用 insights 校准值；Improve 再加跨 session 维度）。 */
export const IMPROVE_TOOL_MIN_CALLS = 30;
export const IMPROVE_TOOL_MIN_FAILED = 5;
export const IMPROVE_TOOL_MIN_FAILURE_RATE = 0.08;
export const IMPROVE_TOOL_MIN_SESSIONS = 3;
/** 主错误码占比门槛：单一错误码占失败 ≥40% 且 ≥5 次才算"重复根因"。 */
export const IMPROVE_MAIN_CODE_SHARE = 0.4;
export const IMPROVE_MAIN_CODE_MIN = 5;
/** v0.6（Phase 1.5）：timeout evidence 的 Improve 门槛（与 §29-C 提案门槛一致；与 Tool Health 无关）。 */
export const IMPROVE_TIMEOUT_MIN_EVENTS = 5;
export const IMPROVE_TIMEOUT_MIN_SESSIONS = 3;
/** 按工具名给出具体建议（固定模板；不空泛）。 */
function toolRecommendation(tool) {
    if (tool === "edit") {
        return "在 coding workflow / skill 中加入 edit 前 target existence 与 stale-version 校验，失败后先核对文件状态再重试。";
    }
    if (tool === "bash") {
        return "为 bash 调用增加前置条件检查（路径 / 依赖 / 权限），失败后先诊断原因再重试，避免盲目重复执行。";
    }
    if (tool === "read" || tool === "grep" || tool === "glob") {
        return "确认目标文件存在且路径正确后再读取；先用 glob / ls 定位，避免对不存在路径反复读取。";
    }
    return `为 ${tool} 增加失败前置校验与有限重试策略（同参数失败 ≥2 次即停止并换路径）。`;
}
/** timeout-only 建议文案（预算类；不涉及 Tool Health 语义）。 */
function timeoutRecommendation(tool) {
    if (tool === "bash") {
        return "提高 bash 执行超时预算（或拆分长任务），减少确定性超时导致的执行中断。";
    }
    return `提高 ${tool} 的执行超时预算，或拆分长任务以减少超时。`;
}
function toolImprovement(h, period, now, failedSessions, timeoutEvidence) {
    const timeouts = timeoutEvidence?.count ?? 0;
    const timeoutSessionList = timeoutEvidence?.sessions ?? [];
    const invocations = timeoutEvidence?.invocations ?? h.calls;
    // 硬失败分支（既有语义，原封不动）。
    const hardEligible = h.calls >= IMPROVE_TOOL_MIN_CALLS &&
        h.failed >= IMPROVE_TOOL_MIN_FAILED &&
        h.failureRate >= IMPROVE_TOOL_MIN_FAILURE_RATE;
    let hardMeta = null;
    if (hardEligible) {
        const sessions = failedSessions[h.name] ?? [];
        if (sessions.length >= IMPROVE_TOOL_MIN_SESSIONS) {
            const codes = Object.entries(h.errorCodes).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
            const [mainCode, mainCount] = codes[0] ?? ["", 0];
            if (codes.length > 0 && mainCount >= IMPROVE_MAIN_CODE_MIN && mainCount / h.failed >= IMPROVE_MAIN_CODE_SHARE) {
                hardMeta = { sessions, mainCode, mainCount, sharePct: Math.round((mainCount / h.failed) * 100) };
            }
        }
    }
    // timeout 分支（v0.6 Phase 1.5）：确定性 timeout 证据作为 failure-like operational evidence。
    const timeoutEligible = timeouts >= IMPROVE_TIMEOUT_MIN_EVENTS && timeoutSessionList.length >= IMPROVE_TIMEOUT_MIN_SESSIONS;
    if (hardMeta === null && !timeoutEligible)
        return null;
    const reasonKind = hardMeta !== null && timeoutEligible ? "failure+timeout" : hardMeta !== null ? "failure" : "timeout";
    const id = `improve-tool-${h.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const ratePct = Math.round(h.failureRate * 1000) / 10;
    const timeoutRatePct = Math.round((invocations > 0 ? timeouts / invocations : 0) * 1000) / 10;
    if (reasonKind === "timeout") {
        const severity = timeouts >= 30 && timeoutRatePct >= 15 ? "HIGH" : "MEDIUM";
        const confidence = Math.min(0.9, 0.55 + 0.08 * Math.min(5, timeoutSessionList.length - 2));
        return {
            id,
            period,
            category: "TOOL",
            severity,
            title: `${h.name} 工具重复超时（${timeoutRatePct}%）`,
            summary: `确定性 timeout 跨 ${timeoutSessionList.length} 个会话重复出现（${timeouts} 次），执行预算可能不足。`,
            evidence: {
                metrics: {
                    calls: invocations,
                    timeouts,
                    timeoutRate: timeoutRatePct,
                    hardFailures: h.failed,
                    sessions: timeoutSessionList.length,
                },
                affectedTools: [h.name],
                affectedSessions: timeoutSessionList.slice(0, 12),
                affectedModels: [],
                affectedProviders: [],
                occurrences: timeoutSessionList.length,
                confidence,
            },
            recommendation: timeoutRecommendation(h.name),
            verificationPlan: {
                targetMetric: `${h.name} timeout rate`,
                baseline: timeoutRatePct,
                target: `< ${Math.round(timeoutRatePct * 0.5 * 10) / 10}%`,
                window: "next 7 days",
            },
            status: "DETECTED",
            createdAt: now,
            reasonKind,
        };
    }
    // 硬失败 / 混合分支：既有模板 + 附加 timeout 数字。
    const sessions = hardMeta.sessions;
    const sessionCount = sessions.length;
    const sharePct = hardMeta.sharePct;
    const severity = h.failed >= 30 && h.failureRate >= 0.15 ? "HIGH" : "MEDIUM";
    const confidence = Math.min(0.95, 0.6 + 0.08 * Math.min(5, sessionCount - 2) + (sharePct >= 60 ? 0.05 : 0));
    const title = reasonKind === "failure+timeout"
        ? `${h.name} 工具重复失败与超时（失败 ${ratePct}% / 超时 ${timeoutRatePct}%）`
        : `${h.name} 工具重复失败（${ratePct}%）`;
    const metrics = {
        calls: h.calls,
        failures: h.failed,
        failureRate: ratePct,
        sessions: sessionCount,
        mainCodeCount: hardMeta.mainCount,
        p95Ms: Math.round(h.p95DurationMs),
    };
    if (timeoutEligible) {
        metrics.timeouts = timeouts;
        metrics.timeoutRate = timeoutRatePct;
        metrics.hardFailures = h.failed;
    }
    return {
        id,
        period,
        category: "TOOL",
        severity,
        title,
        summary: reasonKind === "failure+timeout"
            ? `失败跨 ${sessionCount} 个会话重复出现（${hardMeta.mainCode} 占 ${sharePct}%），另有 ${timeouts} 次确定性 timeout。`
            : `失败跨 ${sessionCount} 个会话重复出现，${hardMeta.mainCode} 占失败 ${sharePct}%，且失败后常伴随立即重试。`,
        evidence: {
            metrics,
            affectedTools: [h.name],
            affectedSessions: sessions.slice(0, 12),
            affectedModels: [],
            affectedProviders: [],
            occurrences: sessionCount,
            confidence,
        },
        recommendation: toolRecommendation(h.name),
        verificationPlan: {
            targetMetric: `${h.name} failure rate`,
            baseline: ratePct,
            target: `< ${Math.round(ratePct * 0.8 * 10) / 10}%`,
            window: "next 7 days",
        },
        status: "DETECTED",
        createdAt: now,
        reasonKind,
    };
}
export const IMPROVE_BURST_MIN_SESSIONS = 2;
export const IMPROVE_BURST_MIN_TOTAL = 3;
function workflowImprovement(bursts, period, now) {
    // 按归一化命令聚合（跨 session 重复）。
    const byCmd = new Map();
    for (const b of bursts) {
        const norm = redactCommand(b.cmd);
        if (norm === "")
            continue;
        const tool = norm.split(/\s+/)[0] ?? "bash";
        let agg = byCmd.get(norm);
        if (agg === undefined) {
            agg = { sessions: new Set(), count: 0, tool, hasError: false };
            byCmd.set(norm, agg);
        }
        agg.sessions.add(b.sessionId);
        agg.count += b.count;
        if (b.error !== undefined && b.error !== "")
            agg.hasError = true;
    }
    let best = null;
    for (const [norm, agg] of byCmd) {
        if (agg.sessions.size < IMPROVE_BURST_MIN_SESSIONS)
            continue;
        if (agg.count < IMPROVE_BURST_MIN_TOTAL)
            continue;
        if (!agg.hasError)
            continue;
        if (best === null || agg.count * agg.sessions.size > best.count * best.sessions) {
            best = { norm, sessions: agg.sessions.size, count: agg.count, tool: agg.tool, hasError: true };
        }
    }
    if (best === null)
        return null;
    const severity = best.count >= 6 && best.sessions >= 3 ? "MEDIUM" : "LOW";
    const confidence = Math.min(0.9, 0.55 + 0.07 * Math.min(5, best.sessions - 1));
    const id = `improve-workflow-retry-${hash8(best.norm)}`;
    return {
        id,
        period,
        category: "WORKFLOW",
        severity,
        title: `重复命令重试：${best.tool} × ${best.count} 次 / ${best.sessions} 个会话`,
        summary: "同一命令在多个会话中反复重试且伴随失败，说明前置条件未校验，重试是无效探索。",
        evidence: {
            metrics: { bursts: best.count, sessions: best.sessions },
            affectedTools: [best.tool],
            affectedSessions: [...bursts.filter((b) => redactCommand(b.cmd) === best.norm).map((b) => b.sessionId)].slice(0, 12),
            affectedModels: [],
            affectedProviders: [],
            occurrences: best.sessions,
            confidence,
        },
        recommendation: `为 ${best.tool} 增加前置条件校验（路径 / 依赖 / 权限），失败后先诊断再重试，同一命令连续失败 ≥2 次时停止。`,
        verificationPlan: {
            targetMetric: "repeated retry bursts",
            baseline: best.count,
            target: `< ${best.count}`,
            window: "next 7 days",
        },
        status: "DETECTED",
        createdAt: now,
    };
}
export const IMPROVE_CORRECTION_MIN_SESSIONS = 2;
function correctionImprovement(signals, period, now) {
    let best = null;
    for (const s of signals) {
        if (s.sessions < IMPROVE_CORRECTION_MIN_SESSIONS)
            continue;
        if (best === null || s.sessions > best.sessions || (s.sessions === best.sessions && s.count > best.count)) {
            best = s;
        }
    }
    if (best === null)
        return null;
    const severity = best.sessions >= 5 ? "MEDIUM" : "LOW";
    const label = CORRECTION_LABEL[best.category];
    const id = `improve-instr-${best.category.toLowerCase()}`;
    return {
        id,
        period,
        category: "INSTRUCTION",
        severity,
        title: `重复人工纠正：${label}`,
        summary: `${best.sessions} 个会话中出现同类纠正${best.sessions >= 5 ? "，说明约束未被 Agent 记住" : "，建议沉淀为显式约束"}。`,
        evidence: {
            metrics: { sessions: best.sessions, corrections: best.count },
            affectedTools: [],
            affectedSessions: best.sampleSessionIds.slice(0, 12),
            affectedModels: [],
            affectedProviders: [],
            occurrences: best.sessions,
            confidence: 0.5,
            experimental: true,
        },
        recommendation: `将「${label}」约束写入对应 skill / workflow instruction（如 repo-scope guard），让 Agent 在任务开始时即遵守，而不是事后纠正。`,
        verificationPlan: {
            targetMetric: `correction occurrences (${label})`,
            baseline: best.count,
            target: "< 2",
            window: "next 7 days",
        },
        status: "DETECTED",
        createdAt: now,
    };
}
/** Peak Cost Opportunity：只在有"可延迟负载"证据时提示（夜间活跃 = 非交互批量负载）。 */
export const IMPROVE_PEAK_MIN_SHARE = 3; // ¥
export const IMPROVE_PEAK_MIN_RATIO = 0.5;
export const IMPROVE_PEAK_MIN_NIGHT = 5; // %
function costImprovement(stats, cost, period, now) {
    if (cost === undefined || cost.source !== "peak-offpeak" || typeof cost.peakShare !== "number")
        return null;
    if (cost.peakShare < IMPROVE_PEAK_MIN_SHARE)
        return null;
    const ratio = cost.peakRatio ?? 0;
    if (ratio < IMPROVE_PEAK_MIN_RATIO)
        return null;
    // 可延迟负载证据：存在夜间（0-6 点）事件 → 有非交互批量任务。
    const night = stats.hourHistogram.slice(0, 6).reduce((a, b) => a + b, 0);
    if (stats.totalEvents === 0 || (night / stats.totalEvents) * 100 < IMPROVE_PEAK_MIN_NIGHT)
        return null;
    const avoidable = cost.peakShare * 0.5;
    const ratioPct = Math.round(ratio * 100);
    return {
        id: "improve-cost-peak-shift",
        period,
        category: "COST",
        severity: "MEDIUM",
        title: `高峰成本集中（占 ${ratioPct}%）`,
        summary: `本期高峰时段花费 ¥${cost.peakShare.toFixed(1)}，且存在夜间批量负载，说明部分任务可延迟到谷时。`,
        evidence: {
            metrics: {
                peakCost: Math.round(cost.peakShare * 100) / 100,
                peakRatio: Math.round(ratio * 1000) / 10,
                avoidableCost: Math.round(avoidable * 100) / 100,
                nightPct: Math.round(((night / stats.totalEvents) * 100) * 10) / 10,
            },
            affectedTools: [],
            affectedSessions: [],
            affectedModels: [],
            affectedProviders: [],
            occurrences: Math.max(1, Math.round(ratio * 10)),
            confidence: 0.7,
        },
        recommendation: "将非实时批量任务（渲染 / 批量 / 长分析）排到 12–14、18 点后或周末的谷时段执行，官方峰谷差价 2:1。",
        verificationPlan: {
            targetMetric: "peak cost share",
            baseline: Math.round(ratio * 1000) / 10,
            target: `< ${Math.round(ratio * 1000) / 10}%`,
            window: "next 7 days",
        },
        status: "DETECTED",
        createdAt: now,
    };
}
/** 计算全部 Improve（有界：规则保守，正常 0–5 条），按确定性排序。 */
export function computeImprovements(input) {
    const now = input.now ?? Date.now();
    const items = [];
    const stats = input.stats;
    const failedSessions = input.failedSessions ?? stats.toolFailedSessions ?? {};
    // v0.6（Phase 1.5）：每工具的 timeout evidence（§29-A 检测器产物；Improve eligibility 用）。
    const timeoutByTool = {};
    for (const tool of Object.keys(stats.toolTimeouts ?? {})) {
        timeoutByTool[tool] = {
            count: stats.toolTimeouts[tool] ?? 0,
            sessions: stats.toolTimeoutSessions[tool] ?? [],
            invocations: stats.toolCalls[tool] ?? 0,
        };
    }
    for (const h of stats.toolHealth) {
        const item = toolImprovement(h, input.period, now, failedSessions, timeoutByTool[h.name]);
        if (item !== null)
            items.push(item);
    }
    // timeout-only 工具（无 toolHealth 阈值命中，但 timeout 证据达标）也要进入 Improve 链。
    for (const [tool, ev] of Object.entries(timeoutByTool)) {
        if (items.some((i) => i.id === `improve-tool-${tool.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`))
            continue;
        if (ev.count < IMPROVE_TIMEOUT_MIN_EVENTS || ev.sessions.length < IMPROVE_TIMEOUT_MIN_SESSIONS)
            continue;
        const h = {
            name: tool,
            calls: ev.invocations,
            completed: ev.invocations,
            failed: 0,
            incomplete: 0,
            successRate: 1,
            failureRate: 0,
            avgDurationMs: 0,
            p50DurationMs: 0,
            p95DurationMs: 0,
            errorCodes: {},
        };
        const item = toolImprovement(h, input.period, now, {}, timeoutByTool[tool]);
        if (item !== null)
            items.push(item);
    }
    const workflow = workflowImprovement(stats.burstSamples, input.period, now);
    if (workflow !== null)
        items.push(workflow);
    const correction = correctionImprovement(input.corrections ?? stats.correctionSignals ?? [], input.period, now);
    if (correction !== null)
        items.push(correction);
    const cost = costImprovement(stats, input.cost, input.period, now);
    if (cost !== null)
        items.push(cost);
    return rankImprovements(items);
}
//# sourceMappingURL=improvements.js.map