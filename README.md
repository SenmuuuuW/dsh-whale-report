# 🐋 鲸鱼记事本（dsh-whale-report）

[![CI](https://github.com/SenmuuuuW/dsh-whale-report/actions/workflows/ci.yml/badge.svg)](https://github.com/SenmuuuuW/dsh-whale-report/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 你的 Agent 年度报告：从会话事件日志里长出来的数据新闻官。
> 日报 / 周报 / 月报 / 年报 / 任意区间，一份就能发朋友圈。

## 它能干嘛

对 DSH 说一句，立刻得到一份报告：

> 给我一份周报 ｜ 这个月我干了啥 ｜ 去年我和鲸鱼的故事

报告内容全部来自你自己的会话事件日志（**只读，绝不改写历史**）：

- **⚙️ 干了多少活**：会话数、回合数、子代理次数、工具使用排行
- **🔥 烧了多少 token**：输入/输出/缓存命中/思考，四个口袋分开记账
- **🌙 作息画像**：24 小时活跃热力条 + 熬夜指数 + 人设评语（守夜鲸/模范鲸）
- **⚠️ 惊魂时刻**：危险命令清单（rm -rf、force push、删库……）原样列出，逐条带时间
- **🧵 会话标题**：这段日子你在忙什么的记忆切片

## 立即体验（不用装插件，一条命令）

```sh
pnpm install && pnpm build
pnpm report                # 周报（最近 7 天）
pnpm report -- --daily     # 日报
pnpm report -- --monthly   # 月报
pnpm report -- --yearly    # 年报
pnpm report -- --all       # 从有史以来到现在
pnpm report -- --from 2026-08-01 --to 2026-08-14   # 自定义区间
```

脚本直接读 `~/.dsh/sessions/*/session.jsonl.zstd`（多帧 zstd 逐帧解压），
与插件共用同一个报告引擎（`src/stats.ts`），引擎行为由 12 个单测锁定。

## 装成插件

```sh
dsh plugin --profile web add "github:SenmuuuuW/dsh-whale-report"
# 重启 dsh web
```

装好后有**两个入口**：

### 🐋 专属面板（v0.2，主入口 —— 不是聊天里的 skill）

重启后 Web GUI 右下角会出现鲸鱼按钮 → 点开是「鲸鱼记事本」抽屉面板：

- 日报/周报/月报/年报/自定义区间，一键生成
- 报告渲染成统计卡片 + 24 小时作息热力条 + 惊魂清单（DSH 主题配色）
- **导出 PDF**（浏览器打印）→ 直接发群发朋友圈
- 「历史」页：所有报告落库保存，随时回看、删除

面板不经过聊天：走插件自己的 `/whale/api` 路由（本机同源围栏），
由官方 client-modules 接缝装载的浏览器 half 渲染。

### 💬 聊天路径（保留）

也可以直接说"给我一份周报"——`whale_report` 工具会把 markdown 报告发到对话里。

插件走官方接缝：`ctx.sessionQuery`（listSessions + readSession），
零补丁、零核心改动，卸载即净。报告生成时还会把 `whale/report` 事件
写回会话日志——**记事本会记下它自己写的账**。

## 项目结构 = 你的教材

| 文件 | 你学到什么 |
| --- | --- |
| `src/stats.ts` | 报告引擎：纯函数聚合、事件宽容解析、可单测的数据层 |
| `src/report.ts` | 文案层：数字 + 人设评语 + 热力条，markdown 报告 |
| `src/api.ts` | 宿主 API：`/whale/api` 路由 + 信任围栏 + 历史存储 |
| `src/state.ts` | whale 存储域：报告历史跨会话落库 |
| `src/tools.ts` | `whale_report` 聊天工具 + 会话事件声明合并 |
| `src/client/index.tsx` | 浏览器 half：鲸鱼抽屉面板（React + 模块表装配） |
| `src/trust-fence.ts` | 本机同源围栏：DNS rebinding / 跨站防御 |
| `scripts/report-now.mjs` | 多帧 zstd 解压、脱离 harness 独立读存档 |
| `tsdown.config.ts` | 客户端单文件 bundle：`__ModuleLoader__.load` 注册 |
| `tests/stats.test.ts` | 12 个单测：计数/危险命令/作息/文案 |

## Roadmap

- [x] v0.1：任意区间报告 + 独立 CLI（跑通真实数据）
- [x] v0.2：专属鲸鱼面板（客户端 half + /whale/api + 历史落库）—— 不再是聊天里的 skill
- [ ] v0.3：定时生成——"每早 9 点日报 / 每周五下班周报"（接 dsh-schedule）
- [ ] v0.4：危险命令风险分级（/tmp 清理 = 正常开发，rm -rf / 才是红色警报）
- [ ] v1.0：报告轨道开放——其他插件往报告里贡献板块（"你装了 30 个插件，7 个在吃灰"）

## License

MIT
