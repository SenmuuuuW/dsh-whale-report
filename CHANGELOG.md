# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 语义，版本号遵循 SemVer。

## [0.6.1] - 2026-09-03

### Fixed

- Correct historical DeepSeek pricing before the Aug 17, 2026 pricing transition.
- Apply peak/off-peak pricing only from its actual effective date.
- Preserve the Aug 23 weekend off-peak transition historically.
- Fix official pricing-page parsing with whitespace around labels.
- Discover sessions created after DeepTrace startup during periodic reconciliation.
- Preserve full history for resumed sessions instead of treating resume seed events as fork inheritance.
- Keep true fork seed handling unchanged.
- Correct affected historical token and cost reports after upgrade.
- Migration: INDEX_VERSION 17 → 18（旧索引语义失效，自动全量重建）; REPORT_SEM 6 → 7（旧 period_stats 不再作为趋势/基线展示）。

## [0.6.0] - 2026-08-30

### Apply

- First user-approved controlled mutation
- shell.timeoutMs proposal for repeated bash timeouts
- structured before/after diff
- optimistic concurrency
- idempotent execution
- safe rollback
- CONFIG_CHANGED protection

### Verify

- shell_timeout_rate deterministic metric
- exact pre/post windows
- cooldown and minimum evidence
- VERIFIED / NOT_IMPROVED / INCONCLUSIVE
- no automatic rollback

### Safety

- allowlisted settings adapter
- server-side proposal is mutation truth
- cross-origin browser mutation fence
- append-only audit trail
- crash reconciliation
- rejected/stale proposals cannot be reused

### Observability

- timeout-only operational evidence
- TOOL_TIMEOUT + exact bash timed-out marker
- exact timeout edge accounting
- INDEX_VERSION 17

### Validation

- 393 tests
- real isolated DSH settings roundtrip
- exact timeout oracle
- security acceptance
- restart reconciliation
- tarball-only acceptance
- npm package includes nested Apply/Verify runtime modules

## [0.5.4] - 2026-08-29

### Pricing

- Sync DeepSeek weekend off-peak pricing effective 2026-08-23 00:00 CST
- Weekdays retain 09:00–12:00 and 14:00–18:00 peak windows
- Saturdays and Sundays are all-day off-peak
- Historical reports remain date-aware across the effective boundary
- Live price badge, peak ratio/share and cost opportunity use the same pricing schedule

## [0.5.3] - 2026-08-28

Query Engine Rewrite：INGEST ONCE → QUERY MANY。

### Correctness

- 修复 period switch 跨周期串数据：24h 标签不再可能显示 weekly report（渲染层 + 响应层双不变量）
- rolling 24h 改为精确 [now-24h, now)（不再使用自然日 identity）
- PeriodSpec 成为唯一时间窗口真相源（API / cache / period_stats / report / client 统一消费）
- 修复 10min boundary bucket 整桶丢失（最近 0–10 分钟数据此前被静默丢弃）
- edge bucket 改为 exact [from,to) filtering（compact rows，无比例近似）
- 修复峰谷小时 CST 错位造成成本低估（14–17 点 peak 用量被按 offpeak 计价）
- daily / weekly / monthly / yearly / Activity 时间口径统一 Asia/Shanghai（TZ matrix ×3 全过）
- Raw Oracle equivalence gate（整数完全一致、cost <¥0.01，真实数据 costDiff=0.0000）

### Query Engine

Refresh 不再 readSession / decompress / aggregate 原始事件：INGEST ONCE（fingerprint / salvage / firehose）→ CANONICAL INDEX（INDEX_VERSION 16）→ QUERY MANY（零 session IO）。

### Live incremental

- 使用 DSH session/event firehose（baseline + buffered events + seq dedupe）
- session/created / disposed / flush 生命周期 + fingerprint reconcile fallback
- live-session 不再每 30s full readSession

### Performance（真实生产数据）

- Refresh：~31s → ~7ms median（×100：p95 8.3ms / max 11.3ms）
- Live endpoint：6.5s → <1ms steady state
- Period switch：毫秒级

### Index

- INDEX_VERSION 16：exact rows 存储优化（纯计数事件 → ts delta 数组）
- v15 whale.json 377MB → v16 ~74–81MB（exact accounting 不变，无比例近似）

### Persistence

- DIRTY IN MEMORY → 5min coalesced checkpoint → force on dispose/shutdown
- revision-safe persistence；写失败保持 dirty 重试
- 写放大：187MB/min（46 rewrites/20min）→ 17.5MB/min（~4 rewrites/20min）

### Resilience

- salvage heavy decode 移入 worker_threads（22MB 执行中 Query 不阻塞：Refresh p50 7.8ms / max 14.6ms）
- restart / pre-checkpoint recovery：无漏计、无双计

### Validation

- 314 tests；typecheck / build；真实 3080 production acceptance
- Raw Oracle costDiff = 0.0000；24h 与 weekly 真实窗口独立

Compatibility：官方基线 DSH 0.1.1-rc.2；另经 DSH 0.1.2-alpha.1 运行时验证（0.1.2-alpha.1 is runtime-tested only and is not included in the current npm peer semver range）。

## [0.5.2] - 2026-08-25

LESS, FASTER：Overview 打开即见，不再等待完整报告生成。

### 新增
- **Snapshot-first Overview Fast Path**：`GET /whale/api/overview` 只读最近已完成快照（不触发 collect / readSession / aggregate），Overview 打开即显示；实测 endpoint <1ms、冷挂载首屏约 10ms
- **快照年龄刷新策略**：<5min 不触发完整 summary；5–15min 先显示快照、后台静默更新；>15min 显示旧数据并标注 stale、后台更新；手动「刷新」才强制重新生成
- **数据口径 UI**：LAST COMPLETED SNAPSHOT（数字截至快照时刻）与 LAST UPDATED（完整统计，含进行中会话）明确区分；Live Session 标注「快照后仍在发生的实时活动」
- 活跃扫描 / 模型分配 / 会话轨迹下沉到「更多详情」折叠区（数据同源，不额外请求）

### 优化
- Live Session（30s）与 Provider Balance（60s）保持独立轻量刷新，永不触发完整 summary；60s Overview polling 仅只读快照，不触发计算
- 巨大 live session / 冷 summary 不再阻塞 Overview 首屏

### 验证
- 288 tests 全绿；typecheck / build 通过；DSH 0.1.1-rc.2 verified（daily / weekly / monthly / yearly / custom 全预设 200）

## [0.5.1] - 2026-08-25

Refresh / 性能修复热修。

### 修复
- **Web Refresh 卡死**：请求超时预算 + `finally` 兜底 + 竞态门 + 旧请求 abort；stale-while-refresh（失败保留上次数据 + REFRESH FAILED + 重试），不再永久停在「更新中…」
- **session index 改为 source fingerprint 失效**（mtime + size），不再每 10 分钟全量重放历史会话；旧条目按「最后写入 ≤ 最后索引事件」回填指纹，无破坏性迁移
- **torn/corrupt session salvage 结果可缓存**（带指纹 + salvage 来源标记）：同一未变化的损坏文件不再重复解压（22MB 会话 14.5s → 0），来源披露跨生成保留
- **same-period summary single-flight**：并发 / 重试请求共享同一份生成，避免重复 99-session 重放
- **monthly / yearly / custom 热索引下 `object is not iterable`**：分桶 `toolHealth.failedSessions` 的 Set 被 JSON 序列化为 `{}`（窗口相关崩溃），改为数组形态 + 聚合端兼容三种形态
- **custom period 污染 weekly History Trend**：custom 独立周期 key（`custom-<from>-<to>`），读取侧过滤旧污染记录（preset=custom 且 key=wk-…），无破坏性迁移

### 验证
- 277 tests 全绿；DSH 0.1.1-rc.2 verified；warm refresh 从约 15s 降至通常 <200ms

## [0.5.0] - 2026-08-23

正式发布：TRACE → DIAGNOSE → **IMPROVE** → **VERIFY-ready**。
产品状态：**LOCAL · READ-ONLY · DETERMINISTIC · 0 EXTRA LLM TOKENS**。
未实现（后续版本）：Apply / self-healing / 自动 Verify 闭环 —— 本版本只产出只读建议与验证计划。
兼容：DSH **0.1.1-rc.2**（peer 范围 `>=0.1.1-rc.2 <0.2.0`）；226 tests 全绿。

### 新增（v0.5 — TRACE → DIAGNOSE → IMPROVE → VERIFY-ready）
- **IMPROVE 引擎**：Finding 回答"发生了什么"，Improve 回答"值不值得改、怎么改"
  - 四类确定性规则：Repeated Tool Failure（跨会话同错误码根因）/ Retry Workflow Waste（跨会话命令重试）/ Repeated User Correction（有限分类，EXPERIMENTAL）/ Peak Cost Opportunity（高峰集中 + 夜间批量证据）/ 全部只读建议，不改任何 skill / workflow / 仓库文件
  - Evidence-first：每条建议带 metrics / affectedSessions / 置信度 / VERIFY 基线 → 目标；stable id 跨周期不变；0 额外 LLM token
  - 人工纠正只存类别与计数，绝不保存用户原句；命令/路径/hash 全部脱敏
  - 全出口可见：markdown Improve 段 + 面板 IMPROVE 区（默认 Top3，展开看证据）+ 独立 HTML 02 / IMPROVE 章节（含 VERIFY 行）
- **Fault isolation（resilience case）**：单个会话日志损坏（如 corrupt Zstandard / torn JSONL）不再拖垮 History / Report / Improve
  - 损坏/不可读会话单独跳过，其余健康会话照常聚合；原因只做粗分类（corrupt-log / read-failed），不存错误原文
  - 报告标记 partial data：markdown 顶部 DATA PARTIAL 行 + 独立 HTML 横幅 + Web 非阻断提示（Dashboard / 完整报告 / 趋势带 ⚠）
  - 缺失数据不按 0 处理：被跳过会话不计入 sessions/subagentSessions、不产生 Improve 证据，只经 partial 披露
  - Improve 不引用被跳过会话（跳过会话从未进入聚合视图，结构性保证 + 测试覆盖）

### 修复（usage reconciliation — P0/P1 统计准确性）
- **P0 salvage：损坏会话不再整段丢弃**。官方读取器因尾部 `agent/inbox/spliced`
  seq 校验失败而整体拒读的会话，DeepTrace 改为只读 salvage：逐帧解压（fzstd）→
  newline 解析 JSONL → 完整 record 全部进入聚合，仅残缺尾部丢弃（droppedRecords=1，
  不猜测/不补全）；zstd 无法解压 / 中间 corruption / 无 header 时才整 session skip。
  不修改 ~/.dsh 原文件（hash 不变测试）。partial 新增 `salvage` 元数据
  （recoveredSessions/recoveredRecords/droppedRecords），markdown / HTML / Web 三处
  文案改为「已恢复 N 条完整记录，M 条残缺记录未计入」
- **P0 totalTokens 双计修复**：DSH 语义确认 output 已含 reasoning → 全仓合计统一
  `usageTotalTokens(input + cacheRead + output)`（src/usage.ts canonical helper），
  reasoning 只作 output breakdown 展示；report.ts / client Hero / StatGrid /
  html.ts / PNG 导出 / Activity / Trend / 模型行全部收敛
- **P0 cost double-subtract 修复**：modelCost 不再 `max(0, input - cacheRead)`
  （DSH adapter 已保证 input=miss 独占）→ miss×inputRate + hit×cacheRate +
  output×outputRate；cache≫input 的真实样例不再清零 input 计费
- **P1 provider comparison scope**：API 响应新增 `providerBreakdown`
  （按 provider 聚合 tokens/requests）；与 DeepSeek Platform 对账只取
  deepseek-official
- **P1 TODAY timezone**：daily 自然日固定 Asia/Shanghai（UTC+8），不再依赖机器
  时区（`shanghaiDayStart` 纯算术）；`periodKey('daily')` 改用上海日期
- 新测试：salvage（torn tail / 中间 corruption / 无效 zstd / hash 不变 / collectEvents
  集成）+ usage（total/pricing/breakdown/UTC+8 边界/双路径）；226 tests 全绿

### 新增（Dark Mode — System / Light / Dark 三档主题）
- **主题解析优先级**：用户显式选择 > 宿主 theme（复用 DSH web 在 `<html>` 上的
  `color-scheme` 信号，不侵入本体）> prefers-color-scheme > light 兜底；
  默认 System，选择持久化到 localStorage（`whale.theme`），不上传任何设置
- **统一 token 体系**：`--dt-*` 全量收敛（paper/surface/ink/muted/faint/line/border/
  blue/cyan/danger/warning/secret/tooltip/heat/abyss/export…），CSS 零散硬编码色清零；
  dark 调色板为深蓝黑 graphite（DeepSeek × Linear × Vercel 方向：克制、低眩光、非纯黑）
- **切换入口**：面板顶部右侧小型 segmented toggle（系统/浅色/深色），抽屉头 / 概览品牌区 /
  完整报告 actions 三处放置，不抢主界面；抽屉模式不重复出现
- **专项校准**：Activity Scan 深色为「深灰蓝 → 更亮 DeepTrace blue」，空 cell 保持可见但
  不亮成网格墙；Trend 轴线/网格/LIVE 虚线/空心点/tooltip 全 token 化；severity 徽标
  （HIGH/MEDIUM/LOW、DATA PARTIAL、risk、Tool Health）深色下前景/背景重校准；
  scrollbar / color-scheme 随主题；鲸鱼 SVG 素材用 filter 压亮度（不复制资产）
- **内联色主题化**：活跃图/图例/Token 构成/模型条等 JSX 内联色改为主题感知
  （THEME_COLORS），accent 类改 CSS var
- 测试：20 个 theme 单测（默认 system / prefers dark→dark / prefers light→light /
  显式覆盖 / 持久化恢复 / matchMedia 不可用兜底 / 存储异常 / 不影响 report data /
  订阅摘除）；203 tests 全绿
- 未动：Improve rules / thresholds / REPORT_SEM / INDEX_VERSION / stats / pricing / session index

### 修复（真实数据验收发现）
- **summary 常规路径漏存 `improvements`**：markdown 里有 Improve 段，但 API record 没有
  `improvements` 字段 → 面板拿不到数组、IMPROVE 区不渲染（custom 路径与 generate 路径已有）
- **分桶路径窗口外会话误计入 sessions / sessionsDetail**：aggregateBuckets 在窗口裁剪前
  `seenSessions.add` 并累加会话级明细 —— 真实数据上自然周报告把全部历史会话算成
  "本周 97 会话"（实际 3）；修复为只有窗口内至少一个桶的会话才计入，钻取明细同步过滤
- **纠正信号首条消息误报**：首条用户消息里的"用中文输出"式指令被当成纠正 —— 真实数据上
  OUTPUT_FORMAT 20/28 命中来自首条消息（初始需求 ≠ 纠正）；修复为只在会话第 2+ 条
  用户消息里统计（与 collab lateConstraints 同语义），直算/分桶双路径同口径
- 新增回归测试：窗口外会话不计入（`tests/stats.test.ts`）、首条消息不计纠正
  （`tests/improvements.test.ts`）；183 tests 全绿

### 兼容性
- 依赖升级到 DSH **0.1.0-rc.7**：peerDependencies 全部 @deepseek-ai/* ^0.1.0-rc.7，
  devDependencies 锁定 rc.7 类型（与 DSH Desktop Community Market 的 rc.7 兼容边界对齐）
- rc.7 下实测：typecheck / 128 tests / build 全绿；全部功能（余额 / 协作复盘 /
  工具健康 / 历史趋势 / 活跃扫描）在 rc.7 运行时环境验证通过
- 既有 webServer/httpServer 双惰性注入与 SessionQuery 结构化类型兼容策略保持有效

## [0.4.0] - 2026-08-16

### 新增
- **UI v3**：DeepTrace 研究终端精修（报告头 / 鲸评 / Findings / 协作复盘 / 活跃 / 资源 / 风险 / 轨迹 / 索引）
- **多来源模型计价**：识别 request/header 中的 provider（upstream/route/baseURL 启发式，支持 opencode-go 订阅）
  - `OPENCODE_GO_PRICES` 订阅价（`OPENCODE_GO_*_PRICE_PER_M` 环境变量可覆盖，默认 DeepSeek 官方价；非法值回退默认）
  - 模型用量键带 provider 前缀（`opencode-go/deepseek-v4-flash`），报告按来源分列展示与费用分组
  - provider 归一化（trim + lowercase）；别名仅由 `WHALE_PROVIDER_ALIASES` 显式配置，默认不做任何本机假设
  - 识别不到 provider 时回退官方 deepseek 价，行为与之前完全一致
- **provider/model 展示**：Overview / Full Report / PNG 导出三处拆分显示
  （主模型名 + 小号 provider meta，`src/client/model-key.ts` splitModelKey；无前缀历史键完全兼容）

### 修复
- **SessionFormatUnsupportedError**（Issue #2）：`whale_report` 不再向会话日志写入 `whale/report` 自定义事件
  （DSH 核心不认插件事件且 append 无 ignorable；报告数据已由 periodStats 持久化，删除无功能损失）
- `whale_report` 输出 schema 补全 `cost` / `insights` / `prevCost`；`cost.perModel` 改
  `additionalProperties: true`（DSH 校验器仅支持 boolean 形式，动态 provider/model 键可通过真实校验）
- INDEX_VERSION 11 → 12（provider-aware 模型键语义变化，旧索引自动失效重建）

### 测试
- 新增 22 个回归测试（schema 真实校验 / providerOf / 计价与 env 校验 / 双路径等价 / whale_report 不再写会话日志 / model-key），101 tests 全绿

### 致谢
- PR #1 贡献者 mathhyphen：opencode-go 订阅计价与 provider 归属、`whale/report` 会话污染修复与 Issue #2 的完整定位分析

## [0.3.0] - 2026-08-16

### 新增
- Provider Balance：模型平台实时余额（DeepSeek 已实现，adapter 架构可扩展 GLM 等）
  - key 只在本机服务端读取（`~/.dsh/.credentials.yaml` 优先）+ 60s 缓存 + 手动刷新
  - 余额查询失败/超时不影响报告加载；瞬时错误自动重试、不缓存过期状态
- 协作复盘 COLLABORATION REVIEW：人机协作模式确定性观察（需求漂移 / 迟到约束 / 上下文碎片化）
  - 用户消息逐条词表信号检测（方向修正 / 迟到约束），直算与分桶双路径等价
  - 最多 3 条、样本不足不展示、不评价人格、不把技术 retry 归因为沟通问题
- REPORT GENERATION：报告生成消耗元数据（当前全本地确定性 → 0 TOKENS · LOCAL DETERMINISTIC）
- 编辑式研究终端 UI：报告头 / 鲸评 / Findings / 协作复盘 / 活跃 / 资源 / 风险 / 轨迹 / 索引
- 导出四出口：图片（主报告，不含轨迹/索引）/ 会话轨迹（单独导出）/ HTML / PDF（直接打印面板，与面板逐像素一致）
- 导出使用真实鲸鱼娘素材（png → svg 回退，缺图才手绘）

### 变更
- 会话索引 INDEX_VERSION 10 → 11（协作信号字段）
- 导出 PNG 高度随内容预算 + 实际高度裁剪，任何周期不裁切
- README 升级为发布级主页（截图 + 深海指标条 + The loop 卡片化）

### 修复
- balance key 读取优先级：`~/.dsh/.credentials.yaml` 优先（`.env` 可能存在无效残留）
- 多币种余额选择：CNY 优先（官方可能同时返回 USD/CNY）
- 余额超时 8s → 12s；瞬时错误不缓存；前端自动重试一次
- PNG 导出底部裁切（weekly/monthly/custom 高度按实际行数计算）
- 测试：48 → 78（balance 13 / collaboration 13 / 导出 6 / 引擎 29 / 鲸评 13）

## [0.2.0] - 2026-08-15

### 新增
- 会话钻取：会话级费用归因（按模型 token × 官方价），概览 Top5 / 完整报告全部，复制 Session ID
- 插件环境：loader 枚举已加载第三方插件清单（排除官方包）
- 导出升级：PDF（独立 HTML）+ PNG 长图（canvas 零依赖，长标题自动截断）
- 洞察修复建议：确定性方案 + 可复制命令（只输出，不自动执行）
- 鲸鱼娘层：本期鲸评（规则触发 + 轻/毒舌双模式，完整独白）；表情状态（生气/困/无语/呆萌）
- 素材接入通道：/whale/assets 白名单路由 + 客户端 SVG 回退（assets/whale/ 规格书）

### 变更
- 周期语义定死：日报=今天 / 24h=滚动 / 周/月/年=自然周期（key 前缀 day-/24h-/wk-/mo-/yr- 隔离）
- summary 5 分钟新鲜度，过期原地重算（概览不永久变旧）
- 统计排除 whale/* 自生事件（不自污染）
- **移除预算功能**（洞察规则 / UI / 设置接口 / 存储表全链路）

### 修复
- review×6：自然周期 / key 冲突 / 预算越权 / 客户端竞态 / 自污染 / summary 新鲜度
- 活跃图三连修：flex+aspect-ratio / 低值幂放大 / 24h 粒度
- 报告语义版本号 REPORT_SEM=3 防旧记录误用

## [0.1.0] - 2026-08-14

### 新增
- 报告生成：日报 / 周报 / 月报 / 年报 / 自定义区间（面板 + 聊天工具双入口）
- 专属面板：better-sidebar Tab 优先、悬浮抽屉兜底；历史列表 / 查看 / 删除
- 导出 PDF：独立排版的可打印 HTML 页（`/whale/api/html`）
- 会话索引：10 分钟分桶预聚合 + 启动后台预热（重复生成 <0.2s）
- 模型用量：按模型分账 token，DeepSeek 官方定价页实时价 + 内置价兜底
- 洞察引擎（确定性规则）：
  - 深夜时段消耗 / 重试风暴（连续相同命令 ≥3） / 缓存命中率变化
  - 致命级操作 / 预算护栏（80% 提醒、超支亮红）/ 会话碎片化 / 费用趋势
- 对比基线：周期自动落库（ISO 周 / 月 / 年 / 日），报告带"较上周期 ▲/▼"
- 危险操作分级：红级（不可逆）黄级（需留意）；只对命令首行匹配，防 heredoc 误报
- 预算设置：面板内每周预算输入，Hero 常驻进度条
- 活动可视化：方块式，按周期自适应粒度（日报 30 分钟 / 周报 1 小时 / 月报 1 天 / 年报 1 周），绿色强度
- 独立 CLI（`pnpm report`）：直接读会话存档，无需安装插件

### 修复
- cordis Proxy 服务属性访问异常导致路由注册静默失败（`in` 探测替代 `??` 连读）
- `webServer`/`httpServer` 服务名快照漂移 → 双惰性注入兼容
- `dsh.client`/`dshClient` 声明字段快照漂移 → 双声明兼容
- 会话事件重复计数（种子事件）→ seedLength 边界过滤
- 危险命令误报：heredoc 正文、`~` 子路径、源码文件名含关键字

### 兼容性
- 官方 harness 0.1.0-rc.5+ 与 npm rc.6 快照均可运行
