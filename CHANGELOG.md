# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 语义，版本号遵循 SemVer。

## [Unreleased]

### 新增（v0.5 — TRACE → DIAGNOSE → IMPROVE → VERIFY-ready）
- **IMPROVE 引擎**：Finding 回答"发生了什么"，Improve 回答"值不值得改、怎么改"
  - 五类确定性规则：Repeated Tool Failure（跨会话同错误码根因）/ Retry Workflow Waste（跨会话命令重试）/ Repeated User Correction（有限分类，EXPERIMENTAL）/ Peak Cost Opportunity（高峰集中 + 夜间批量证据）/ 全部只读建议，不改任何 skill / workflow / 仓库文件
  - Evidence-first：每条建议带 metrics / affectedSessions / 置信度 / VERIFY 基线 → 目标；stable id 跨周期不变；0 额外 LLM token
  - 人工纠正只存类别与计数，绝不保存用户原句；命令/路径/hash 全部脱敏
  - 全出口可见：markdown Improve 段 + 面板 IMPROVE 区（默认 Top3，展开看证据）+ 独立 HTML 02 / IMPROVE 章节（含 VERIFY 行）
- **Fault isolation（resilience case）**：单个会话日志损坏（如 corrupt Zstandard / torn JSONL）不再拖垮 History / Report / Improve
  - 损坏/不可读会话单独跳过，其余健康会话照常聚合；原因只做粗分类（corrupt-log / read-failed），不存错误原文
  - 报告标记 partial data：markdown 顶部 DATA PARTIAL 行 + 独立 HTML 横幅 + Web 非阻断提示（Dashboard / 完整报告 / 趋势带 ⚠）
  - 缺失数据不按 0 处理：被跳过会话不计入 sessions/subagentSessions、不产生 Improve 证据，只经 partial 披露
  - Improve 不引用被跳过会话（跳过会话从未进入聚合视图，结构性保证 + 测试覆盖）

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
