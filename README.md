<p align="center">
  <img src="assets/whale/whale-happy.svg" alt="" width="56">
</p>

<h1 align="center">深迹 · DeepTrace</h1>

<p align="center"><b>Your Agent, in numbers.</b></p>

<p align="center">把 DSH 的 session、token、cost、tool call、风险与异常，<br/>转成可以真正读懂的 Agent 报告。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-whale-report"><img src="https://img.shields.io/npm/v/dsh-whale-report?label=npm&color=4d6bfe" alt="npm version"></a>
  <a href="https://github.com/SenmuuuuW/dsh-whale-report/releases"><img src="https://img.shields.io/github/v/release/SenmuuuuW/dsh-whale-report?label=version&color=4d6bfe" alt="version"></a>
  <a href="https://github.com/SenmuuuuW/dsh-whale-report/actions/workflows/ci.yml"><img src="https://github.com/SenmuuuuW/dsh-whale-report/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/Anil-matcha/awesome-dsh-plugin"><img src="https://img.shields.io/badge/awesome--dsh--plugin-listed-4d6bfe" alt="awesome dsh plugin"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4d6bfe.svg" alt="license"></a>
</p>

<table align="center">
  <tr>
    <td align="center" style="background:#0b1733;border-radius:12px;padding:10px 30px">
      <span style="color:#4d6bfe;font-weight:700;font-family:ui-monospace,Menlo,monospace">6 PERIODS</span>
      <span style="color:#33445f"> · </span>
      <span style="color:#cbd5e1;font-family:ui-monospace,Menlo,monospace">10 FINDINGS</span>
      <span style="color:#33445f"> · </span>
      <span style="color:#cbd5e1;font-family:ui-monospace,Menlo,monospace">4 IMPROVE RULES</span>
      <span style="color:#33445f"> · </span>
      <span style="color:#cbd5e1;font-family:ui-monospace,Menlo,monospace">VERIFY-READY</span>
      <span style="color:#33445f"> · </span>
      <span style="color:#cbd5e1;font-family:ui-monospace,Menlo,monospace">PEAK / OFF-PEAK</span>
      <span style="color:#33445f"> · </span>
      <span style="color:#cbd5e1;font-family:ui-monospace,Menlo,monospace">FAULT ISOLATION</span>
      <span style="color:#33445f"> · </span>
      <span style="color:#cbd5e1;font-family:ui-monospace,Menlo,monospace">READ-ONLY</span>
      <span style="color:#33445f"> · </span>
      <span style="color:#cbd5e1;font-family:ui-monospace,Menlo,monospace">DETERMINISTIC</span>
    </td>
  </tr>
</table>

<br/>

<img src="docs/images/deeptrace-overview.png" alt="DeepTrace inside DSH" width="100%" style="border:1px solid #d9e3e8;border-radius:14px">

---

## Why DeepTrace

Agent 跑完之后，真正难回答的问题不是"它做了什么"，而是：

- 哪些 session 最贵？
- 为什么突然开始 retry？
- 哪些操作值得注意？
- 夜里到底跑了多少？
- 是哪次任务把成本拉高的？
- **这周有什么值得改的？**

DeepTrace 不是 log viewer，也不是普通 dashboard——它把会话事件日志聚合成报告，让这些问题有答案。

## The loop

<table align="center">
  <tr>
    <td align="center" width="22%" style="background:#f5f8f9;border:1px solid #d9e3e8;border-radius:12px;padding:16px 10px">
      <b style="color:#4d6bfe">SEE</b><br/>
      <span style="color:#33445f;font-size:13px">总览成本、调用、模型与异常</span>
    </td>
    <td align="center" width="4%" style="color:#94a2b3">→</td>
    <td align="center" width="22%" style="background:#f5f8f9;border:1px solid #d9e3e8;border-radius:12px;padding:16px 10px">
      <b style="color:#4d6bfe">NOTICE</b><br/>
      <span style="color:#33445f;font-size:13px">Findings + Whale Note 指出值得看的问题</span>
    </td>
    <td align="center" width="4%" style="color:#94a2b3">→</td>
    <td align="center" width="22%" style="background:#f5f8f9;border:1px solid #d9e3e8;border-radius:12px;padding:16px 10px">
      <b style="color:#4d6bfe">TRACE</b><br/>
      <span style="color:#33445f;font-size:13px">Session Drilldown 追到具体会话复盘</span>
    </td>
    <td align="center" width="4%" style="color:#94a2b3">→</td>
    <td align="center" width="22%" style="background:#f5f8f9;border:1px solid #d9e3e8;border-radius:12px;padding:16px 10px">
      <b style="color:#4d6bfe">IMPROVE</b><br/>
      <span style="color:#33445f;font-size:13px">只读建议 + 证据 + VERIFY 计划（v0.5）</span>
    </td>
  </tr>
</table>

一次报告，走完整个闭环；IMPROVE 的输出带 VERIFY 基线 → 目标，为后续自动回验（Apply / self-healing）预留。

## Product

<img src="docs/images/overview.png" alt="DeepTrace overview" width="100%" style="border:1px solid #d9e3e8;border-radius:14px">

<sub>DeepTrace overview — hero, provider balance, cost, findings and the whale note.</sub>

<img src="docs/images/report.png" alt="Full report" width="100%" style="border:1px solid #d9e3e8;border-radius:14px">

<sub>The full DeepTrace report — findings, collaboration review, activity, resources, risks and session trace.</sub>

## What it measures

| | |
| --- | --- |
| **Cost** | 官方峰谷价分段计算（2026-08-17 起：高峰 9–12 / 14–18 为谷时 2 倍，定价页实时抓取、6h 缓存、内置价兜底），按模型与会话分账，报告带峰谷占比（peakShare / peakRatio）与「挪到谷时约省 ¥X」估算 |
| **Live session** | 进行中会话实时计费（30s 刷新）：token 与费用按当前时段价折算，右上角常驻峰/谷徽标 + 双模型价目表 |
| **Tokens** | input / output / cache read / reasoning，按模型拆分 |
| **Sessions** | 会话数、回合数、事件数、活跃天数、最忙日 |
| **Activity** | 小时级活跃热力图（GitHub contribution 风格，基于 Tokens 的固定 log 阈值分级）；hover 显示每小时 Tokens / 会话 / 回合 / 工具 / 成本；峰值时段、活跃小时、夜猫指数 |
| **Tool calls** | 工具调用总量与明细，按工具族归类 |
| **Tool health** | 高频工具（≥30 次）失败率健康分级，标出最不稳定的工具 |
| **Retry bursts** | 同一命令连续重复 ≥3 次，附错误摘要样本 |
| **Dangerous operations** | 红级（不可逆破坏）/ 黄级（需留意）分级，只对命令首行匹配 |
| **Secret scan** | 6 类常见密钥模式的存在性检测，**只报有无，不存原文** |
| **Session drilldown** | 按费用排序的会话轨迹：成本、重试、危险信号、模型 token 归因 |
| **Baseline** | 每周期自动落库，报告带"较上周期 ▲/▼"（费用、会话、缓存命中率等） |
| **Trends** | 多周期趋势曲线（成本 / 会话 / 缓存命中 / 夜间活跃），hover 显示每周期明细与日期范围，进行中周期标记 LIVE（不与完整周期混比） |
| **Provider balance** | 模型平台实时余额（DeepSeek 已支持，可扩展）；key 只在本机服务端使用 |
| **Improve（v0.5）** | 值得改的行为建议：Repeated Tool Failure / Retry Workflow Waste / Repeated User Correction（EXPERIMENTAL）/ Peak Cost Opportunity；每条带 metrics、受影响会话、置信度与 VERIFY 基线 → 目标；stable id 跨周期不变，只读、不自动修改任何配置 |
| **Data partial** | 单个会话日志损坏/不可读 → 跳过并披露（只存会话 id + 粗分类原因，不含错误原文）；其余健康会话照常聚合，缺失数据不按 0 计；markdown / HTML / Web 三处非阻断提示 |

## Deterministic insights

DeepTrace 的统计与洞察**不是让另一个 AI 随机点评你的数据**。它基于：

- session event logs
- deterministic aggregation
- explicit rules
- reproducible report generation

10 条确定性 Finding 规则：深夜消耗、峰谷时段成本、重试风暴、缓存命中率变化、致命级操作、需留意操作、会话碎片化、疑似密钥、费用趋势、工具健康。每条都带阈值、归因与估算口径。

**IMPROVE 引擎（v0.5）**：Finding 回答"发生了什么"，Improve 回答"值不值得改、怎么改"。4 条确定性规则：

| 规则 | 触发证据（跨 session 重复性） | 输出 |
| --- | --- | --- |
| Repeated Tool Failure | 工具失败跨 ≥3 会话、失败率 ≥8%、单一错误码占失败 ≥40% | 建议 + 主错误码 + P95 |
| Retry / Workflow Waste | 同一归一化命令在 ≥2 会话重复重试且伴随失败 | 建议 + 重试次数 |
| Repeated User Correction（EXPERIMENTAL） | 同类纠正跨 ≥2 会话（只在第 2+ 条用户消息统计，首条消息是初始需求不算） | 建议 + 类别 + 计数 |
| Peak Cost Opportunity | 高峰占 ≥50% 且 ≥¥3，且有夜间批量负载证据 | 建议 + 可省金额 |

每条建议都带 **evidence**（metrics / affectedSessions / 置信度）与 **verificationPlan**（目标指标、基线 → 目标、窗口），排序 severity → score → occurrences → category；同一目标跨周期 id 稳定。全部本地确定性规则，**0 额外 LLM token**；Apply / self-healing 为后续版本预留（v0.5 只落 DETECTED / DISMISSED）。

**协作复盘（COLLABORATION REVIEW）**：观察人机协作模式——需求漂移 / 迟到约束 / 上下文碎片化，最多 3 条，样本不足不展示；语气是"找摩擦、给可尝试的优化"，不评价人格、不把技术 retry 归因为沟通问题。

鲸鱼娘的 Whale Note 也建立在同一套确定性触发规则上（`src/whale-notes.ts`，表情与文案同源）。

**同一份数据 → 同一份结论。**

报告本身由本地确定性代码生成——**REPORT GENERATION · 0 TOKENS · LOCAL DETERMINISTIC**，生成报告不消耗模型调用。

## Privacy / read-only

- **只读**：绝不改写任何 session 历史；统计排除 DeepTrace 自身的 `whale/*` 事件
- **不自动执行**：修复建议只输出方案与命令模板，需要你亲自确认
- **Secret Scan 不重印**：只记录模式标签、时间与来源，报告与导出里都不出现 secret 原文
- **危险命令只存首行**：引号段剥离，防止 grep 模式被误报
- **纠正信号只存类别与计数**：Repeated User Correction 的匹配基于归一化白名单（去引号、数字、路径），**绝不保存用户原句**
- **损坏日志不泄错误**：fault isolation 只披露会话 id 与粗分类原因（corrupt-log / read-failed），错误消息 / 堆栈从不进报告
- **本机围栏**：API 只服务本机 loopback + 同源标记

## Reports

| Preset | 区间 | 口径 |
| --- | --- | --- |
| 日报 | 今天 0:00 → 现在 | 自然日 |
| 24h | 过去滚动 24 小时 | 唯一滚动周期 |
| 周报 | 本周一 0:00 → 现在 | 自然周 |
| 月报 | 本月 1 日 0:00 → 现在 | 自然月 |
| 年报 | 本年 1 月 1 日 0:00 → 现在 | 自然年 |
| 自定义 | 任意 from / to | 显式区间 |

自然周期与滚动 24h 的区别：周/月/年按日历对齐（周一、1 号、1 月 1 日），"24h" 则是任意时刻起算的滚动窗口。周期 key 前缀隔离（`day-` / `24h-` / `wk-` / `mo-` / `yr-`），对比基线互不串扰。

## Export

- **Web report**：面板内完整报告视图（含 IMPROVE 区与 DATA PARTIAL 提示）
- **PNG 图片**：canvas 按面板同款视觉绘制主报告（报告头 / 鲸评 / Findings / 活跃 / 模型工具 / 风险），不含会话轨迹、索引与 IMPROVE 区
- **会话轨迹**：单独导出的 PNG，仅含会话轨迹 + 会话索引（追查专用）
- **HTML**：独立可打印 HTML 页，含 02 / IMPROVE 章节（severity 色标 + 证据 + VERIFY 行）与 DATA PARTIAL 横幅
- **PDF**：直接打印面板报告（A4 排版），浏览器打印对话框另存为 PDF——与面板逐像素一致

鲸鱼娘与页面形象在导出中使用真实素材（与面板显示一致）。

## Installation

需要 DSH（DeepSeek Harness，web 端）环境。两种安装方式，注意区分：

**① DSH 插件安装（推荐，完整功能）** —— 注册进 dsh web：

```sh
dsh plugin --profile web add "github:SenmuuuuW/dsh-whale-report"
# 重启 dsh web 使宿主代码生效；客户端 bundle 随插件自动更新
```

**② npm 包安装（仅依赖）** —— 把包装进你的项目：

```sh
npm install dsh-whale-report
```

> 注意：`npm install` 只是安装包本身，**不会自动注册为 DSH 插件**。Web UI、`whale_report` 工具与实时计费都需要通过方式 ① 注册；方式 ② 适合直接 import 报告引擎 / 用 CLI 生成报告的场景。

两个入口：

- **面板（主入口）**：装了 better-sidebar 时在 "+" 菜单里打开「深迹」Tab；未装时右下角悬浮按钮兜底
- **对话**：直接说"给我一份周报"——`whale_report` 工具输出 markdown 报告

数据走官方接缝（`ctx.sessionQuery` + storage domain），卸载即净。

### 立即体验（不用装插件）

```sh
pnpm install && pnpm build
pnpm report                  # 周报（最近 7 天）
pnpm report -- --daily       # 或 --monthly / --yearly / --all
pnpm report -- --from 2026-08-01 --to 2026-08-14   # 自定义区间
```

CLI 直接读本机会话存档（`~/.dsh/sessions/*/session.jsonl.zstd`），与插件共用同一个报告引擎。

## Architecture

```
DSH session events
        ↓
aggregation / pricing / safety
（损坏会话跳过 → partial，缺失 ≠ 0）
        ↓
deterministic findings + improve rules
        ↓
DeepTrace report（DATA PARTIAL 披露 + VERIFY-ready 建议）
        ↓
Web / HTML / PDF / PNG
```

细节（数据流、存储结构、兼容性策略）见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## Development

```sh
pnpm install
pnpm link-dsh   # 软链本地 harness 闭包（typecheck 需要）
pnpm typecheck
pnpm test       # 183 个单测：引擎 / 洞察 / Improve 规则 / fault isolation / 峰谷计价 / 导出
pnpm build      # tsc + tsdown（客户端单文件 bundle）
```

## Status & limitations

当前边界，如实说明：

- **会话跳转**：报告提供 Session ID 复制，尚未实现"一键跳回原会话"（待官方 client API 明确）
- **费用为估算**：按官方峰谷价分段估算，以平台账单为准
- **IMPROVE 为只读建议**：v0.5 只落 DETECTED / DISMISSED 与 VERIFY 计划，Apply / self-healing 未实现（路线图下一步）；Repeated User Correction 标记 EXPERIMENTAL（保守阈值 + 首条消息过滤）
- **PNG 主报告导出暂不含 IMPROVE 区**（HTML / PDF / markdown / 面板已含）

## License

MIT

---

## Friends

- [dsh-tianshu-tui](https://github.com/huiliyi37/dsh-tianshu-tui) — 超好看的 DSH 终端界面（TUI）
- [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) — 很实用的 DSH 侧边栏工作台

---

<p align="center"><em>DeepTrace is built to make Agent behavior inspectable, measurable, and easier to improve.</em></p>

<p align="center"><img src="assets/whale/whale-happy.svg" alt="" width="28"><br/>
<sub>…and yes, the whale is watching. She reads every report first.</sub></p>
