# 深迹 DeepTrace · 架构文档

> Agent 数据报告产品。只读、确定性、可复算。
> 本文档描述宿主/浏览器两侧的模块职责、数据流、存储结构、兼容性策略与扩展点。
> 与当前实现（v0.5-dev）保持同步。

## 1. 总览

```
宿主 half（Node / cordis 插件）              浏览器 half（React / 单文件 bundle）
┌────────────────────────────────┐          ┌──────────────────────────────┐
│ src/index.ts（插件入口）        │          │ src/client/index.tsx          │
│  ├─ 四接缝：tools /            │◄─fetch───│  三视图：概览 / 报告 / 历史     │
│  │  sessionQuery /             │  /whale/ │  概览：品牌区→余额→Hero→洞察→   │
│  │  storageDomain / web 路由   │   api/*  │  活跃→模型→会话钻取→鲸评短卡    │
│  ├─ /whale/api 路由（7 方法）   │          │  报告：报告头→鲸评→Findings→  │
│  ├─ /whale/assets 素材路由      │          │  活跃/Token→模型/工具→风险→    │
│  └─ whale 存储域（3 张表）      │          │  会话钻取→会话索引→导出         │
└────────────────────────────────┘          │  导出：PDF(HTML页)/PNG(canvas) │
                                            └──────────────────────────────┘
```

## 2. 数据流（生成一次报告）

```
请求 (preset | custom)
  → presetRange()：日报=今天 0:00 / 24h=滚动 / 周=本周一 0:00 / 月=1日 / 年=1月1日
                   custom 需显式 from/to（非法区间直接拒绝）
  → collectEvents()：
       listSessions → 会话头（id / createdAt / cwd / delegationDepth）
       持久化会话：session_index 命中（INDEX_VERSION 匹配 + 10 分钟 TTL）→ 复用分桶
                   未命中 → readSession + bucketizeOwnEvents（seedLength 去重，
                   排除 whale/* 自事件，10 分钟分桶；user/message 逐条做协作信号
                   检测：方向修正 / 迟到约束，确定性词表）→ 写回索引
       live 会话：每次直读（不落索引）
       并发 12 读取 → 单会话损坏/读取失败：跳过并记入 stats.partial
       （skippedSessionIds 上限 20 + 粗分类原因 corrupt-log/read-failed，
       不含错误原文；被跳过会话不进入聚合、不计 sessions）
       → aggregateBuckets(views, period, headers, partial)
  → computeCost()：官方定价页实时价（6h 缓存，内置价兜底）→ 每模型费用；
       provider-aware：request/header 识别 provider（upstream/route/baseURL 启发式，
       归一化 trim/lowercase），opencode-go 流量走订阅价（OPENCODE_GO_PRICES，env 可覆盖），
       模型键带 provider 前缀（opencode-go/deepseek-v4-flash），无前缀历史键回退官方价
  → 会话钻取：sessionsDetail 按"会话 × 模型 token × 单价"折算费用 → 排序 → Top 20
  → 插件环境清单：loader 枚举已加载第三方插件名（排除 @deepseek-ai/* 与 cordis）
  → periodKey(preset, to) + previousPeriodKey → period_stats 上一周期基线
  → computeInsights()：8 条确定性规则（阈值、归因、估算口径固定）
  → computeCollaborationInsights()：协作复盘 ≤3 条（需求漂移 / 迟到约束 / 上下文碎片化，
      样本不足不触发；确定性，无 LLM）
  → computeImprovements()：IMPROVE 引擎 ≤5 条（Repeated Tool Failure / Retry Workflow Waste /
      Repeated User Correction(EXPERIMENTAL) / Peak Cost Opportunity；证据 + VERIFY 计划，
      stable id，0 额外 LLM token；evidence 只含健康会话）
  → reportGeneration：本地确定性生成 → 0 token（mode=local）
  → 落库：reports（REPORT_SEM=6）+ period_stats（原地更新，含 skippedCount）
```

**DATA PARTIAL（fault isolation）**：`stats.partial` 有界（id ≤20 + 粗分类原因），缺失数据不按 0 处理 —— markdown 顶部 DATA PARTIAL 行、HTML 报告横幅、Web 非阻断提示（概览 / 完整报告 / 趋势 ⚠）三处披露；Improve 证据不引用被跳过会话（跳过会话从未进入聚合视图）。

**summary 复用（概览路径）**：同 preset + `sem === REPORT_SEM` + 同周期 key + 含 cost + 5 分钟新鲜度窗口内 → 直接返回已存报告；过期则原地重算（沿用原 id，不删历史）。custom 区间每次重新生成，不复用。

**后台预热**：启动 3s 后对全部持久化会话预建索引（`warmIndex`），首次生成报告的成本移到后台，之后的重复生成命中索引（实测 0.1–0.3s）。

## 3. 模块职责

| 文件 | 职责 | 关键约束 |
| --- | --- | --- |
| `src/stats.ts` | 聚合引擎：事件聚合、危险分级、密钥检测、重试风暴、分桶索引、会话级明细 | 纯函数；直算/分桶两条路径等价（有不变式测试） |
| `src/insights.ts` | 洞察规则 + 周期 key + 工具族归类 | 确定性，无 LLM |
| `src/improvements.ts` | IMPROVE 引擎：跨会话重复失败 / 命令重试 / 人工纠正（EXPERIMENTAL）/ 高峰成本 | 只读建议 + 证据 + VERIFY；0 LLM；纠正不存原文 |
| `src/whale-notes.ts` | 鲸鱼娘统一规则：鲸评触发 + 表情（同一套阈值） | 客户端与 HTML 导出共用，单一阈值源 |
| `src/collaboration.ts` | 协作复盘：确定性规则（≤3 条，样本不足不触发） | 无 LLM；不改既有口径 |
| `src/balance.ts` | Provider 余额：adapter 架构 + DeepSeek 实现 + 60s 缓存 | key 只在本机服务端使用 |
| `src/pricing.ts` | 官方计价页抓取 + 费用计算（flash/pro 档位） | 失败回退内置价 |
| `src/tools.ts` | 会话索引（10 分钟分桶/TTL/预热）+ 共享生成管线 + `whale_report` 聊天工具 | 面板与对话同源 |
| `src/api.ts` | HTTP 路由（7 方法 + 素材白名单） | 本机同源围栏（trust-fence） |
| `src/report.ts` / `src/html.ts` | markdown / PDF HTML 报告 | 同一数据两种呈现 |
| `src/state.ts` | 存储域 schema（3 张表） | zod 边界校验 |
| `src/client/index.tsx` | 浏览器 UI：三视图 + 导出（PDF/PNG） | 零依赖，模块表装配 |

## 4. 存储结构（whale 域，domain version 1）

| 表 | 键 | 值要点 |
| --- | --- | --- |
| `reports` | `whale-<ts36>-<rand6>` | sem(REPORT_SEM) + preset/from/to + stats(含 partial) + cost + insights + improvements + prev + markdown |
| `session_index` | `<sessionId>` | v(INDEX_VERSION) + builtAt + lastSeq + lastMs + 10 分钟分桶 + titles |
| `period_stats` | `day-…` / `24h-…` / `wk-…` / `mo-…` / `yr-…` | 周期基线（对比用）+ skippedCount；前缀隔离互不冲突 |

**版本策略**：
- `REPORT_SEM = 6`：报告语义变更（周期定义、字段含义）时 +1，旧记录作废重建
- `INDEX_VERSION = 14`：分桶结构变更时 +1，旧索引自然失效

## 5. API（`/whale/api/*`，全部经本机同源围栏）

| 方法 | 说明 |
| --- | --- |
| POST `generate` | 生成并保存报告（新 id；更新 period_stats 基线） |
| POST `summary` | 概览数据：同周期 5 分钟内复用，过期原地重算（不删历史）；custom 不复用 |
| GET `list` | 历史摘要列表（新到旧） |
| GET `get?id=` | 单份完整报告 |
| DELETE 由 POST `delete` 承载 | 删除指定 id |
| GET `html?id=` | 独立可打印 HTML（备用分享页；面板 PDF 改走打印） |
| GET `balance?provider=&refresh=` | Provider 余额（服务端只读探针；key 永不出宿主；60s 缓存） |
| GET `/whale/assets/*` | 素材白名单路由（assets/whale/，仅允许清单内文件名） |

## 6. 洞察规则（8 条）

| 规则 | 触发条件 | 级别 |
| --- | --- | --- |
| 深夜消耗 | 0–6 点事件占比 ≥15% 且费用 ≥¥3 | tip / warning(≥30%) |
| 重试风暴 | 同一命令连续重复 ≥3 次 | tip / warning(≥10 次) |
| 缓存命中率下降 | 命中率 <75% 且较上周期跌 ≥5pt | warning |
| 致命级操作 | 存在红级危险命令 | critical |
| 需留意操作 | 存在黄级危险命令（无红级） | tip |
| 会话碎片化 | ≥5 会话且平均回合 <2 | tip |
| 疑似密钥 | 命中 6 类密钥模式之一（只报存在性） | critical |
| 费用趋势 | 较上周期费用涨跌 ≥20% | tip / warning |

（另有 info 级"缓存命中率良好"记录，概览不展示，仅入档。）

**协作复盘（`collaboration.ts`，≤3 条）**：REQUIREMENT-DRIFT（修正 ≥5 次且 ≥3 会话）/ LATE-CONSTRAINT（迟到约束 ≥3 条）/ CONTEXT-FRAGMENTATION（短会话 ≥5 且占比 ≥40%）；会话 <5 或用户消息 <30 时不展示。

**鲸鱼娘规则（`whale-notes.ts`，单一阈值源）**：danger（仅红级 → angry）> retry ≥3（→ dazed）> night ≥15%（→ sleepy）> fragment；表情与鲸评文案由同一函数推导，客户端与导出端一致。

**IMPROVE 规则（`improvements.ts`，≤5 条）**：Repeated Tool Failure（calls ≥30 / failed ≥5 / 失败率 ≥8% / 跨会话 ≥3 / 单一错误码占失败 ≥40%）/ Retry Workflow Waste（同一归一化命令跨会话重试且伴随失败） / Repeated User Correction（EXPERIMENTAL：有限分类白名单，跨会话 ≥2，只存类别与计数）/ Peak Cost Opportunity（高峰占比 ≥50% 且 ¥≥3 且存在夜间批量负载）。每条含 metrics / affectedSessions / 置信度 / VERIFY 基线→目标；排序 severity → score → occurrences → category → id；`period` 只做标记不影响判定。

## 7. 导出

- **PDF**：把面板报告克隆到 body 顶层后 `window.print()`（`@media print` 只显示报告、A4 分页），与面板逐像素一致、数据同源。`/whale/api/html` 独立页路由保留（备用分享页）。
- **PNG 主报告**（`exportReportImage(report, "main")`）：canvas 按面板同款视觉绘制报告头 / 鲸评 / Findings / 活跃+Token / 模型与工具 / 风险扫描（危险+重试诊断+密钥扫描）/ 页脚，**不含会话轨迹与会话索引**；数据口径与面板同源（cacheRate/night/delta/鲸评规则同一函数）；高度由 `budgetExportHeight` 随内容预算 + 绘制后按实际高度裁剪，任何周期不裁切；活跃区最多最近 7 天，超限标注 LAST 7 DAYS。
- **PNG 会话轨迹**（`exportReportImage(report, "trace")`）：独立导出，仅含会话轨迹（06）+ 会话索引（07），追查专用。
- **素材**：鲸鱼娘表情与页面形象在导出中加载真实 `/whale/assets` 素材（png 优先、svg 回退、缺图才手绘兜底），与面板显示一致。
- **重试诊断**：仅存在于导出（PDF 与 PNG 均含错误摘要样本），面板不展示。

## 8. 兼容性策略（DSH preview 期生存术）

| 漂移点 | 策略 |
| --- | --- |
| 路由服务名 webServer→httpServer | 顶层 inject 只声明稳定服务；路由服务用惰性双注入 `ctx.inject(["webServer"])` + `ctx.inject(["httpServer"])`，`in` 探测避免 Proxy 抛异常，只注册一遍 |
| 客户端声明 dsh.client→dshClient | package.json 双写（嵌套 + 顶层） |
| 会话查询类名 SessionQueryEngine→SessionQueryService | 结构化类型（只依赖行为面） |

## 9. 隐私与安全边界

- 只读：绝不改写会话历史；统计排除 `whale/*` 自生事件
- Fault isolation：单个会话日志损坏/不可读 → 跳过并披露 partial（只存 id + 粗分类原因，**不含错误原文**）；缺失数据不按 0 处理
- 人工纠正信号：只存类别 + 计数 + sessionId 样本，**绝不保存用户原句**（归一化匹配后即丢弃）
- 密钥扫描：6 类常见模式（OpenAI sk- / AWS AKIA / 私钥块 / GitHub PAT / Slack Token / 配置型），只存模式标签 + 时间 + sessionId，**不存原文**；报告与导出均不重印
- 危险命令：只存命令首行（引号段剥离防 grep 误报），红/黄两级分级
- API 围栏：仅本机 loopback + 同源标记（`trust-fence.ts`）
- 修复建议：只输出方案与命令模板（`FIX_SUGGESTIONS`），**永不自动执行**
- Provider 余额：key 只在宿主进程内读取（`~/.dsh/.env` 的 `DEEPSEEK_API_KEY`）与请求，绝不下发浏览器 / 不入 report / 不入导出 / 不写日志；错误信息一律固定文案
- 插件环境清单：只列插件名，非工具级归因（精确归属尚未实现）

## 10. Roadmap

- [x] 报告引擎 / 面板（三视图）/ 洞察 / 会话钻取 / 插件环境清单 / 导出（PDF+PNG）/ 修复建议 / 鲸鱼娘规则统一
- [x] v0.5 IMPROVE 引擎（TRACE → DIAGNOSE → IMPROVE → VERIFY-ready）
- [x] v0.5 Fault isolation（损坏会话跳过 + partial 披露，resilience case）
- [ ] VERIFY 落地：improvement 状态机（DETECTED → APPLIED → VERIFIED），对照 verificationPlan 自动回验
- [ ] 原生"打开会话"机制（待官方 client API 明确；当前仅复制 Session ID）
- [ ] 长会话内存优化（LRU 化 session_index）
- [ ] 工具调用 → 插件的精确归属（当前仅为环境清单）
