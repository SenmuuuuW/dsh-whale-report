# UI 集成说明：provider/model 前缀键（v0.4 前置）

PR #1（opencode-go provider/pricing）之后，`stats.models` 与 `cost.perModel` 的键
可能带 provider 前缀，例如：

```
"opencode-go/deepseek-v4-flash"   （opencode-go 订阅流量）
"deepseek/deepseek-v4-pro"        （官方 DeepSeek 流量，归一化后也带前缀）
"deepseek-v4-flash"               （无 provider 的历史报告键，向后兼容）
```

## UI v3 需要适配的 3 个位置

| 位置 | 现状 | 推荐显示 |
| --- | --- | --- |
| 1. Dashboard「03 模型分配」（`src/client/index.tsx` modelRows） | `{model}` 直接显示完整键 | 拆两列/两行：Provider `opencode-go` · Model `deepseek-v4-flash` |
| 2. 完整报告「05 模型与工具」（`src/client/index.tsx` ModelTable） | 同上 | 同左：来源 + 模型名，费用占比条不变 |
| 3. PNG 导出模型区（`src/client/index.tsx` exportReportImage） | `paint(model...)` 显示完整键 | 同上拆分；宽度紧张时只显示 model，provider 并入「来源」列或省略（≤2 来源时） |

## 推荐做法

直接使用新增纯函数（独立文件 `src/client/model-key.ts`，不会与 UI 改动冲突）：

```ts
import { splitModelKey } from "./model-key.js";

const { provider, model } = splitModelKey("opencode-go/deepseek-v4-flash");
// provider === "opencode-go" | null（null = 无前缀历史键，显示旧样式即可）
// model    === "deepseek-v4-flash"
```

- provider 为 `null` 时按旧样式显示（历史报告兼容，无需特判前缀）。
- 费用按来源分组已在 `report.ts`（markdown 报告）实现；面板与导出图建议与之一致
  （`费用按来源：` 小标题或来源列）。
- 导出 PDF（`src/html.ts` modelTableHtml）同样直接显示键——建议同步拆分。

## 不需要改的

- 计价/统计/insights：全部在服务端/纯函数层处理完毕（computeCost 按 provider 选价）。
- periodStats 基线对比：不存模型键，无影响。
