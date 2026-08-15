# 深迹 DeepTrace · 架构文档

> Agent 数据报告产品。只读、确定性、可复算。
> 本文档描述宿主/浏览器两侧的模块职责、数据流、存储结构、兼容性策略与扩展点。

## 1. 总览

```
宿主 half（Node / cordis 插件）              浏览器 half（React / 单文件 bundle）
┌────────────────────────────────┐          ┌──────────────────────────────┐
│ src/index.ts（插件入口）        │          │ src/client/index.tsx          │
│  ├─ 双服务名兼容注入            │◄─fetch───│  概览 / 报告 / 历史 三视图      │
│  │  (webServer/httpServer)     │  /whale/ │  品牌头 → Hero → 洞察Feed      │
│  ├─ /whale/api 路由（7 方法）   │   api/*  │  → 活动图 → 模型 → 会话钻取    │
│  ├─ 共享生成管线                │          │  导出：PDF(HTML页)/PNG(canvas) │
│  └─ whale 存储域（4 张表）      │          └──────────────────────────────┘
└────────────────────────────────┘
```

## 2. 数据流（生成一次报告）

```
请求 (preset) 
  → presetRange()：自然周期区间（日报=今天 / 24h=滚动 / 周=本周一 / 月=1日 / 年=1月1日）
  → summary 复用检查：同周期 key + REPORT_SEM + 5 分钟新鲜度 → 命中直接返回
  → collectEvents()：
       live 会话 → readSession（内存快照）
       持久化会话 → session_index 缓存（10 分钟 TTL）→ 未命中才 zstd 全量重建
       每会话：bucketizeOwnEvents（10 分钟分桶，seedLength 去重，排除 whale/* 自事件）
  → aggregateBuckets()：全局统计 + 会话级明细（按模型 token）
  → computeCost()：官方定价页（6h 缓存，内置价兜底）→ 每模型费用 + 每会话费用
  → 基线对比：period_stats[上一周期 key] → 涨跌
  → computeInsights()：8 类确定性规则
  → 落库（reports / period_stats）→ 返回
```

## 3. 模块职责

| 文件 | 职责 | 关键约束 |
| --- | --- | --- |
| `src/stats.ts` | 聚合引擎 | 纯函数；直算/分桶两条路径等价（有不变式测试） |
| `src/insights.ts` | 洞察规则 + 周期 key + 工具族 | 确定性，无 LLM |
| `src/pricing.ts` | 官方计价抓取 + 费用 | 失败回退内置价 |
| `src/tools.ts` | 共享生成管线 + 聊天工具 | 面板与对话同源 |
| `src/api.ts` | HTTP 路由 | 本机同源围栏 |
| `src/report.ts` / `src/html.ts` | markdown / PDF HTML | 同一数据两种呈现 |
| `src/state.ts` | 存储域 schema | zod 边界校验 |
| `src/client/index.tsx` | 浏览器 UI | 零依赖，模块表装配 |

## 4. 存储结构（whale 域，version 1）

| 表 | 键 | 值要点 |
| --- | --- | --- |
| `reports` | `whale-<ts>-<rand>` | sem(语义版本) + stats + insights + cost + prev + budget |
| `session_index` | `<sessionId>` | v(版本) + builtAt + 10 分钟分桶 + titles；INDEX_VERSION=10 |
| `period_stats` | `wk-2026-W33` 等 | 周期基线（对比用）；前缀 day-/24h-/wk-/mo-/yr- 互不冲突 |
| `settings` | `user` | budgetWeeklyCny |

**版本策略**：
- `REPORT_SEM`：报告语义变更（周期定义等）时 +1，旧记录作废重建
- `INDEX_VERSION`：分桶结构变更（新增字段）时 +1，旧索引自然失效

## 5. API（/whale/api/*，全部经本机同源围栏）

| 方法 | 说明 |
| --- | --- |
| POST `generate` | 生成并保存报告（含基线更新） |
| POST `summary` | 概览数据：同周期 5 分钟内复用，过期原地重算（不删历史） |
| GET `list` / `get` / `delete` | 历史管理 |
| GET `html?id=` | 独立可打印 HTML（导出 PDF） |

## 6. 洞察规则（8 类）

见 README「洞察引擎」表。规则全部确定性：阈值、归因、估算口径固定，可复算可对质。

## 7. 兼容性策略（DSH preview 期生存术）

| 漂移点 | 策略 |
| --- | --- |
| 路由服务名 webServer→httpServer | 顶层 inject 只声明稳定服务；路由服务用惰性双注入 `ctx.inject(["webServer"])` + `ctx.inject(["httpServer"])`，`in` 探测避免 Proxy 抛异常 |
| 客户端声明 dsh.client→dshClient | package.json 双写（嵌套 + 顶层） |
| 会话查询类名 SessionQueryEngine→SessionQueryService | 结构化类型（只依赖行为面） |

## 8. 隐私与安全边界

- 只读：绝不改写会话历史；统计排除 `whale/*` 自生事件
- 密钥扫描：只存模式标签 + 时间 + sessionId，**不存原文**
- 危险命令：只存命令首行（引号段剥离防 grep 误报）
- API 围栏：仅本机 loopback + 同源标记
- 执行联动：只输出方案与命令模板，**永不自动执行**

## 9. Roadmap

- [x] 报告引擎 / 面板 / 洞察 / 治理 / 会话钻取 / 插件环境（已加载第三方插件）/ 导出（PDF+PNG）/ 修复建议
- [ ] 原生"打开会话"机制（待官方 client API 明确）
- [ ] 长会话内存优化（LRU 化 session_index）
- [ ] 多周期预算（日报/月报预算）
