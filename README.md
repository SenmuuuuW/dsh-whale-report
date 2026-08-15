# 深迹 · DeepTrace（dsh-whale-report）

[![CI](https://github.com/SenmuuuuW/dsh-whale-report/actions/workflows/ci.yml/badge.svg)](https://github.com/SenmuuuuW/dsh-whale-report/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 你的 Agent 数据新闻官：从会话事件日志生成日报 / 周报 / 月报 / 年报，
> 用确定性洞察引擎告诉你**钱花哪了、时间去哪了、哪里该改**。
> 只读，绝不改写任何历史。

## 它能干嘛

- **报告**：日报 / 周报 / 月报 / 年报 / 任意区间，一键生成（面板或对话）
- **对比基线**：每周期自动落库，报告自动带上"较上周期 ▲/▼"（费用、会话、命中率）
- **洞察引擎**：7 类确定性规则，把数字变成可行动的卡片：
  - 深夜时段消耗、重试风暴、缓存命中率变化、致命级操作、会话碎片化、费用趋势
- **预算护栏**：自设每周预算，Hero 常驻进度条，80% 提醒 / 超支亮红
- **危险操作分级**：红级（不可逆破坏）黄级（需留意）分开对待，首行匹配防误报
- **模型用量**：按模型分账 token + 费用（实时抓取 DeepSeek 官方定价页，内置价兜底）
- **导出 PDF**：独立排版的可打印 HTML 页
- **活动可视化**：方块式活动图，按周期自适应粒度（日报 30 分钟 / 周报 1 小时 / 月报 1 天 / 年报 1 周）

## 装成插件

```sh
dsh plugin --profile web add "github:SenmuuuuW/dsh-whale-report"
# 重启 dsh web（宿主代码加载后生效；客户端 bundle 自动更新）
```

两个入口：

- **面板（主入口）**：better-sidebar 的 + 菜单里「深迹」Tab；没装 better-sidebar 时右下角悬浮按钮兜底
- **对话**：直接说"给我一份周报"，`whale_report` 工具输出 markdown 报告

数据走官方接缝（`ctx.sessionQuery` + storage domain），零补丁、卸载即净。

## 立即体验（不用装插件）

```sh
pnpm install && pnpm build
pnpm report                # 周报（最近 7 天）
pnpm report -- --daily | --monthly | --yearly | --all
pnpm report -- --from 2026-08-01 --to 2026-08-14   # 自定义区间
```

脚本直接读 `~/.dsh/sessions/*/session.jsonl.zstd`（多帧 zstd 逐帧解压），
与插件共用同一个报告引擎，行为由单测锁定。

## 架构一览

```
宿主 half（node）                         浏览器 half（React）
┌─────────────────────────────┐          ┌──────────────────────────┐
│ /whale/api 路由（同源围栏）  │◄─fetch───│ 深迹 Tab / 悬浮抽屉        │
│  generate → 引擎+费用+洞察   │          │  Hero + 洞察卡 + 图表      │
│  list/get/html/delete       │          │  预算设置 + 历史           │
│  settings（预算）            │          └──────────────────────────┘
│ storage domain:             │
│  reports / session_index /  │
│  period_stats / settings    │
│ whale_report 聊天工具        │
└─────────────────────────────┘
```

性能：会话索引（10 分钟分桶）预聚合 + 启动后台预热，重复生成报告 <0.2s。

## 项目结构

| 文件 | 职责 |
| --- | --- |
| `src/stats.ts` | 报告引擎：聚合、危险分级、分桶索引、重试风暴检测 |
| `src/insights.ts` | 洞察引擎：7 类确定性规则 + 周期 key |
| `src/pricing.ts` | DeepSeek 官方定价抓取 + 费用计算（缓存 6h，内置价兜底） |
| `src/report.ts` | markdown 报告（含洞察与对比段落） |
| `src/html.ts` | 独立可打印 HTML 报告页（导出 PDF） |
| `src/api.ts` | 宿主 API 路由 + 信任围栏 |
| `src/state.ts` | whale 存储域（4 张表） |
| `src/tools.ts` | 共享生成管线 + `whale_report` 聊天工具 |
| `src/client/index.tsx` | 浏览器 half：面板 + 图表 + 洞察卡 |
| `scripts/report-now.mjs` | 免安装 CLI：直接读会话存档 |
| `tests/stats.test.ts` | 21 个单测：引擎/洞察/计费/分级/周期 |

## 开发

```sh
pnpm install
pnpm link-dsh   # 软链本地 harness 闭包（typecheck 需要）
pnpm test       # 21 个单测
pnpm typecheck
pnpm build      # tsc + tsdown（客户端单文件 bundle）
```

## Roadmap

- [x] v0.1 任意区间报告 + CLI
- [x] v0.2 专属面板（client half + API + 历史落库）
- [x] v0.3 可视化升级（方块活动图 / 模型用量 / 导出 PDF）
- [x] v0.4 洞察引擎 + 对比基线 + 预算护栏 + 危险分级
- [ ] v0.5 定时报告（用户自设时间，不自动打扰）
- [x] v0.5 会话钻取 + 插件环境 + 导出（PDF/PNG）+ 修复建议
- [ ] v0.7 敏感信息扫描（API key / 密码，只报有无不展示原文）

## License

MIT
