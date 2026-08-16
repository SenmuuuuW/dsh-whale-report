# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 语义，版本号遵循 SemVer。

## [Unreleased]

### 新增
- 多来源模型计价：识别 request/header 中的 provider（upstream/route/baseURL 启发式，支持 opencode-go 订阅）
  - `OPENCODE_GO_PRICES` 订阅价（环境变量 `OPENCODE_GO_CACHE_READ_PRICE_PER_M` / `OPENCODE_GO_INPUT_PRICE_PER_M` / `OPENCODE_GO_OUTPUT_PRICE_PER_M` 可覆盖，默认 DeepSeek 官方价）
  - 模型用量键带 provider 前缀（`opencode-go/deepseek-v4-flash`），报告按来源分列展示与费用分组
  - 识别不到 provider 时回退官方 deepseek 价，行为与之前完全一致
- provider 归一化：modlens 包装 provider（`deepseek-modlens`）归一到实际流量出口 `opencode-go` 统计与计价
  - 可通过环境变量 `WHALE_PROVIDER_ALIASES`（逗号分隔）扩展更多包装 provider 别名

### 修复
- `whale_report` 工具输出 schema 未声明 `cost` / `insights` / `prevCost` 字段，导致严格校验（additionalProperties: false）下工具调用失败

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
