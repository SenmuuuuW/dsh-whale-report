<p align="center">
  <img src="assets/whale/whale-happy.svg" alt="" width="56">
</p>

<h1 align="center">深迹 · DeepTrace</h1>

<p align="center"><b>Your Agent, in numbers.</b></p>

<p align="center">把 DSH 的 session、token、cost、tool call、风险与异常，<br/>转成可以真正读懂的 Agent 报告。</p>

<p align="center">
  <a href="https://github.com/SenmuuuuW/dsh-whale-report/releases"><img src="https://img.shields.io/github/v/release/SenmuuuuW/dsh-whale-report?label=version&color=4d6bfe" alt="version"></a>
  <a href="https://github.com/SenmuuuuW/dsh-whale-report/actions/workflows/ci.yml"><img src="https://github.com/SenmuuuuW/dsh-whale-report/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4d6bfe.svg" alt="license"></a>
</p>

<table align="center">
  <tr>
    <td align="center" style="background:#0b1733;border-radius:12px;padding:10px 30px">
      <span style="color:#4d6bfe;font-weight:700;font-family:ui-monospace,Menlo,monospace">6 PERIODS</span>
      <span style="color:#33445f"> · </span>
      <span style="color:#cbd5e1;font-family:ui-monospace,Menlo,monospace">8 RULES</span>
      <span style="color:#33445f"> · </span>
      <span style="color:#cbd5e1;font-family:ui-monospace,Menlo,monospace">4 EXPORTS</span>
      <span style="color:#33445f"> · </span>
      <span style="color:#cbd5e1;font-family:ui-monospace,Menlo,monospace">READ-ONLY</span>
      <span style="color:#33445f"> · </span>
      <span style="color:#cbd5e1;font-family:ui-monospace,Menlo,monospace">DETERMINISTIC</span>
    </td>
  </tr>
</table>

<br/>

<img src="docs/images/overview.png" alt="DeepTrace Overview" width="100%" style="border:1px solid #d9e3e8;border-radius:14px">

---

## Why DeepTrace

Agent 跑完之后，真正难回答的问题不是"它做了什么"，而是：

- 哪些 session 最贵？
- 为什么突然开始 retry？
- 哪些操作值得注意？
- 夜里到底跑了多少？
- 是哪次任务把成本拉高的？

DeepTrace 不是 log viewer，也不是普通 dashboard——它把会话事件日志聚合成报告，让这些问题有答案。

## The loop

<table align="center">
  <tr>
    <td align="center" width="30%" style="background:#f5f8f9;border:1px solid #d9e3e8;border-radius:12px;padding:16px 14px">
      <b style="color:#4d6bfe">SEE</b><br/>
      <span style="color:#33445f;font-size:13px">总览成本、调用、模型与异常</span>
    </td>
    <td align="center" width="5%" style="color:#94a2b3">→</td>
    <td align="center" width="30%" style="background:#f5f8f9;border:1px solid #d9e3e8;border-radius:12px;padding:16px 14px">
      <b style="color:#4d6bfe">NOTICE</b><br/>
      <span style="color:#33445f;font-size:13px">Findings + Whale Note 指出值得看的问题</span>
    </td>
    <td align="center" width="5%" style="color:#94a2b3">→</td>
    <td align="center" width="30%" style="background:#f5f8f9;border:1px solid #d9e3e8;border-radius:12px;padding:16px 14px">
      <b style="color:#4d6bfe">TRACE</b><br/>
      <span style="color:#33445f;font-size:13px">Session Drilldown 追到具体会话复盘</span>
    </td>
  </tr>
</table>

一次报告，走完整个闭环。

## Product

<img src="docs/images/overview-detail.png" alt="DeepTrace overview" width="100%" style="border:1px solid #d9e3e8;border-radius:14px">

<sub>The sidebar overview — cost, top findings and the whale's take at a glance.</sub>

<img src="docs/images/whale-note.png" alt="Whale Note" width="100%" style="border:1px solid #d9e3e8;border-radius:14px">

<sub>The whale note — a deterministic review of the period, light or spicy.</sub>

<img src="docs/images/activity.png" alt="Activity scan" width="100%" style="border:1px solid #d9e3e8;border-radius:14px">

<sub>Activity scan — sonar view of when your agent was actually working.</sub>

<img src="docs/images/report.png" alt="Full report" width="100%" style="border:1px solid #d9e3e8;border-radius:14px">

<sub>The complete web report view, from opening to appendix.</sub>

<img src="docs/images/export.png" alt="Export" width="100%" style="border:1px solid #d9e3e8;border-radius:14px">

<sub>Exported long image — same report, anywhere.</sub>

## What it measures

| | |
| --- | --- |
| **Cost** | 按官方定价页实时价计算（6h 缓存，内置价兜底），按模型与按会话分账 |
| **Tokens** | input / output / cache read / reasoning，按模型拆分 |
| **Sessions** | 会话数、回合数、事件数、活跃天数、最忙日 |
| **Activity** | 24h 小时分布 + 半小时分布 + 按天序列；夜猫指数（0–6 点占比） |
| **Tool calls** | 工具调用总量与明细，按工具族归类 |
| **Retry bursts** | 同一命令连续重复 ≥3 次，附错误摘要样本 |
| **Dangerous operations** | 红级（不可逆破坏）/ 黄级（需留意）分级，只对命令首行匹配 |
| **Secret scan** | 6 类常见密钥模式的存在性检测，**只报有无，不存原文** |
| **Session drilldown** | 按费用排序的会话轨迹：成本、重试、危险信号、模型 token 归因 |
| **Baseline** | 每周期自动落库，报告带"较上周期 ▲/▼"（费用、会话、缓存命中率等） |

## Deterministic insights

DeepTrace 的统计与洞察**不是让另一个 AI 随机点评你的数据**。它基于：

- session event logs
- deterministic aggregation
- explicit rules
- reproducible report generation

8 条确定性规则：深夜消耗、重试风暴、缓存命中率变化、致命级操作、需留意操作、会话碎片化、疑似密钥、费用趋势。每条都带阈值、归因与估算口径。

鲸鱼娘的 Whale Note 也建立在同一套确定性触发规则上（`src/whale-notes.ts`，表情与文案同源）。

**同一份数据 → 同一份结论。**

## Privacy / read-only

- **只读**：绝不改写任何 session 历史；统计排除 DeepTrace 自身的 `whale/*` 事件
- **不自动执行**：修复建议只输出方案与命令模板，需要你亲自确认
- **Secret Scan 不重印**：只记录模式标签、时间与来源，报告与导出里都不出现 secret 原文
- **危险命令只存首行**：引号段剥离，防止 grep 模式被误报
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

- **Web report**：面板内完整报告视图
- **PNG 图片**：canvas 按面板同款视觉绘制主报告（报告头 / 鲸评 / Findings / 活跃 / 模型工具 / 风险），不含会话轨迹与索引
- **会话轨迹**：单独导出的 PNG，仅含会话轨迹 + 会话索引（追查专用）
- **HTML**：独立可打印 HTML 页
- **PDF**：直接打印面板报告（A4 排版），浏览器打印对话框另存为 PDF——与面板逐像素一致

鲸鱼娘与页面形象在导出中使用真实素材（与面板显示一致）。

## Installation

需要 DSH（DeepSeek Harness，web 端）环境。

```sh
dsh plugin --profile web add "github:SenmuuuuW/dsh-whale-report"
# 重启 dsh web 使宿主代码生效；客户端 bundle 随插件自动更新
```

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
        ↓
deterministic insights
        ↓
DeepTrace report
        ↓
Web / PDF / PNG
```

细节（数据流、存储结构、兼容性策略）见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## Development

```sh
pnpm install
pnpm link-dsh   # 软链本地 harness 闭包（typecheck 需要）
pnpm typecheck
pnpm test       # 48 个单测：引擎 / 洞察 / 规则 / 导出
pnpm build      # tsc + tsdown（客户端单文件 bundle）
```

## Status & limitations

当前边界，如实说明：

- **会话跳转**：报告提供 Session ID 复制，尚未实现"一键跳回原会话"（待官方 client API 明确）
- **历史趋势**：当前支持"较上一周期"对比，尚无跨多周期的趋势曲线
- **费用为估算**：按官方定价页实时价计算，以平台账单为准

## License

MIT

---

## Friends

- [dsh-tianshu-tui](https://github.com/huiliyi37/dsh-tianshu-tui)
- [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)

---

<p align="center"><em>DeepTrace is built to make Agent behavior inspectable, measurable, and easier to improve.</em></p>

<p align="center"><img src="assets/whale/whale-happy.svg" alt="" width="28"><br/>
<sub>…and yes, the whale is watching. She reads every report first.</sub></p>
