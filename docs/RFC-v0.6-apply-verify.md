# DeepTrace v0.6 Apply & Verify RFC

> Phase 0 / Scope Design — 纯设计文档,无代码改动。
> 仓库状态:v0.5.4 已发布;本文档为 v0.6 的实现前置设计,不含 commit/tag/publish 计划。

---

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| v0.6 定义 | USER-APPROVED CONTROLLED CHANGE + DETERMINISTIC VERIFICATION |
| 第一版 Apply 类型 | **1 个**:`kind: "settings"` —— 对 DSH settings seam 上 **`shell` 命名空间的数值预算字段**(主:`timeoutMs`)做单路径 set |
| 第二类型 | **无**(宁少勿多;`llm-*` 字段与 `agent-presets.default` 明确延期) |
| 驱动规则 | **复用现有 Repeated Tool Failure 规则**(主错误码 = `TOOL_TIMEOUT` 的变体),**不新增 Improve 规则** |
| 核心机制 | DSH 原生 revision 乐观并发(`SETTINGS_CONFLICT`)、applyId 幂等、PREPARED→MUTATING→APPLIED crash reconciliation |
| Verify | appliedAt 为切点的精确前后窗口,受控 metric registry(**`shell_timeout_rate`**,独立于 tool_failure_rate),minimum evidence 门槛 |
| NEVER | 任何 shell/fs/git/db/credentials/secret/插件装卸/任意代码;自由文本 prompt patch |
| Phase 0.5 | **C1 PASS / C2 PASS(修订后)/ C3 PASS** —— 真实隔离实例实测:settings seam 可达、shell.timeoutMs 可写可回滚、revision 冲突形状与 RFC 一致、live effect 确认、41 例 bash 超时标记 + 3 例 TOOL_TIMEOUT code 实证 |
| 结论 | **GO Phase 1(条件性)** —— 修订见 §29;若 settings seam 在目标 profile 不可达,降级为 VERIFY-only 版本 |

---

## 1. v0.6 产品目标

不是"AI 自动修复 Agent",不是"看到问题后自动改系统"。

第一版定义:

```
DETECTED → RECOMMENDED → PROPOSED → USER APPROVED → APPLIED → OBSERVING
                                                              → VERIFIED / NOT_IMPROVED / INCONCLUSIVE
                                                              → OPTIONAL REVERT(仅用户确认)
```

- 默认只读:DeepTrace 继续只产出建议与证据;只有用户显式点击 APPLY 才发生一次真实 mutation。
- 每次 mutation 必须:(a) 结构化(allowlist schema),(b) 可还原(记录 before),(c) 可验证(预设 VerificationPlan)。
- Apply 不是终点;VERIFY 才是 v0.6 的核心交付。

## 2. 第一版明确不做什么

- 不做自动 Apply / self-healing(任何 mutation 都 user-approved)。
- 不做任意 shell / 任意代码执行;recommendation 永不翻译为可执行命令。
- 不做自由文本 prompt/instruction 改写(无法 deterministic diff / rollback)。
- 不做 workflow builder、不做多步变更编排、不做批量 Apply。
- 不改 Query Engine / ingest / persistence 架构(§21 的提案生成分支除外,不改现有 4 条规则本体)。
- 不新增第二类 Apply target;不做 v0.7 的 multi-target 事务。

## 3. DSH 可修改 surface audit(证据驱动)

以下结论全部来自对 `deepseek-harness-alpha` 工作区与已安装 `@deepseek-ai/*` 包的第一手核查,标注文件位置。

### 3.1 存在的正式变更面

| # | Surface | 证据(文件) | 写入口 | 生效 | 形态 |
| --- | --- | --- | --- | --- | --- |
| S1 | **Settings seam**(typed, revision-guarded, secret-redacted) | `packages/settings/settings/src/index.ts`;类型 `packages/settings/settings/src/types.ts` | `ctx.settings.register(ns, schema, {base, applies})` → scope;`settings.update(ns, patch, expectedRevision?)`;`settings.describe()` | 每个 namespace 声明 `applies: 'live' \| 'restart'` | schemastery schema;path-addressed `{op:'set'/'unset', path, value}`;**monotonic revision**;**stale write 抛 `SETTINGS_CONFLICT {code, expected, actual}`**;secret 字段声明后 redact(值永不上 wire) |
| S2 | Settings Remote controller | `packages/api/settings-controller/src/index.ts` | `update(ns, 'update', patch, expectedRevision)`(Typert RPC,带 ref 权限) | 同 S1 | 同 S1;`writable` 标志由 provider 决定 |
| S3 | Settings 事件流 | `packages/settings/settings/src/types.ts` | `settings/updated`(ns, next, prev, source:'update'\|'provider')、`settings/document-updated`(ns, revision) | — | 变更可观测性(Apply 后确认 / 外部改动探测) |
| S4 | 已注册 namespace(生产,全部 live 生效):`ui-theme` `locale` `ui-chat` `ui-settings-general` `ui-conversation`、`agent-presets`、`agent-default-model`、`agent-loop`、`permission`、`web-search-deepseek`、**`shell`**、`llm-deepseek`、`llm-pi-ai` | `packages/client/ui-*/src/index.ts`;`packages/preset/agent-presets/src/index.ts:244`;`packages/core/agent-default-model`;`packages/shell/shell/src/index.ts:22`;`packages/llm/llm-deepseek/src/index.ts:86`、`llm-pi-ai:91` | 同上 | 各 NS 声明(实测全 live;session 级消费者在会话创建时采样) | — |
| S5 | **`shell` 用户可写字段(bash 工具预算)** | `packages/shell/bash-local/src/index.ts:41-46`(Config)、`:128`(`installSettingsSection`) | settings 写 | live(每次执行时读取 `clampTimeout`) | `timeoutMs`(默认 120s)、`maxTimeoutMs`(600s 上界)、`maxOutputBytes`、`maxSpillBytes`、`graceMs`、`cwd`、`pwshPath`;schema 为 z.number 且写入端校验 positive-finite |
| S5b | `llm-deepseek` 用户可写字段(含 `retryPolicy`) | `packages/llm/llm-deepseek/src/index.ts:118+`、`:162` | settings 写 | live(route 在变更时重注册,`:476-487`) | `thinking`/`reasoningEffort`/`maxTokens`/`defaultContextWindow`/`models`/`streamIdleTimeoutMs`/`retryPolicy` + secret 字段(apiKeyEnv/baseURL) |
| S5c | `agent-loop`:`{maxParallelToolCalls}`;`permission`:`{defaultPreset}`(session 创建时采样) | `packages/core/agent-loop`、`packages/interaction/permission-presets` | settings 写 | live / 新 session | typed |
| S5d | settings-file provider | `packages/settings/settings-file/src/index.ts` | 文件直改 + chokidar 热发布(外部改动 → `settings/document-updated`) | live | comment-preserving YAML;跨进程写锁;**无跨 namespace 事务**(每 ns 独立 revision fence) |
| S6 | `agent-presets` 用户可写 slice | `packages/preset/agent-presets/src/index.ts:122` | settings 写 | 新 session 挂载时 | 仅 `{ default?: string }`(默认 preset id) |
| S7 | cordis.yml 配置(deployment axis) | `docs/config-catalog.md`(generated,有 verify gate) | 文件编辑 + 重载/重启 | restart | 每个插件 Config 均为文件态;非运行时 live |
| S8 | 工具超时 | `packages/guard/timeout-policy/src/index.ts` | **无远程写口**:`timeoutMs` 来自工具定义 `ctx.tools.get(name).timeoutMs`(代码所有);policy 自身 config 走 cordis.yml | restart | 无 settings namespace |
| S9 | repeat-tool-reminder 阈值 | `packages/guard/repeat-tool-reminder` | cordis.yml(`thresholds/include/exclude`) | load | 无 settings namespace |
| S10 | preset/persona 文件 | `packages/preset/*` | 文件 | 新 session | 自由文本 cordis.yml |
| S11 | credentials seam | `packages/api/settings-controller/src/credentials.ts` | provider-gated `set/unset` | — | **永不可碰** |
| S12 | self-modification(agent 自行装卸插件) | `packages/self-modification/` | agent 能力 | — | 高风险,与 DeepTrace 无关 |

### 3.2 明确不存在的东西

- **不存在** 插件可调的"工具超时/重试次数"运行时 API(S8:值归工具定义代码所有;**bash 工具的默认预算例外**——经 `shell` settings ns 可写,S5)。
- **不存在** 结构化 instruction/prompt patch API(preset/persona 是自由文本文件,S10;systemPrompt registry 是 effect 注册制,非持久 settings)。
- **不存在** `temperature` 设置(仅 per-request `LlmCallConfig.temperature` 走 `agent/request` waterfall,记录在 `request/header`)。
- **不存在** 通用"运行时改任意插件 Config"API(Config 为 load-time;sanctioned 模式 = 插件自注册 settings namespace / storage domain)。
- **不存在** 跨 namespace 事务(单 ns 单路径写,恰好与 v0.6 单 target 设计对齐)。
- DeepTrace 当前安装的 `@deepseek-ai/*` peer 集**不含 `dsh-settings`**:v0.6 需新增该 peer 类型面,或沿用 lazy-inject + 结构兼容适配模式。
- 结论:**第一版 Apply 若不做文件/代码级修改,唯一合格的 SAFE 面是 S1/S2 的 settings path op**。

## 4. Safe / Review / Never 分类

### SAFE(v0.6 可 Apply)
仅 `shell` 命名空间的数值预算字段:`timeoutMs`(主)、`maxTimeoutMs`、`maxOutputBytes`、`maxSpillBytes`、`graceMs`。
(排除 `cwd`/`pwshPath` 字符串路径字段。)
理由:schema 校验(positive-finite 写入端校验)、值 redact 安全、live 生效(每次执行读取)、revision 乐观并发、单路径可逆、无文件副作用、**有真实工具失败证据链直接对应**(§21)。

### SAFE-candidate(已核实可写,但 v0.6 延期 —— 宁少勿多)
- `llm-deepseek`:`maxTokens`/`reasoningEffort`/`thinking`/`streamIdleTimeoutMs`/`retryPolicy`(live、typed;由 v0.6.1 的截断/重试类规则驱动)。
- `agent-loop`:`maxParallelToolCalls`(live、typed)。

### REVIEW REQUIRED(可显示建议 + 手工步骤,不自动 Apply)
- `agent-presets.default`(自由字符串 id、影响新 session、因果链弱)—— 候选 v0.6 第二类型,本期不做。
- `models` catalog 编辑(结构复杂、discovery 可见)。
- 所有 cordis.yml 级配置(timeout-policy / repeat-tool-reminder / 任何 guard 调参)—— 需要文件编辑 + 重载。
- preset/persona/instruction 文件改写 —— 自由文本,无 diff 语义。
- 工具定义 timeoutMs —— 代码所有。

### NEVER AUTO-APPLY(硬禁止清单)
shell 命令执行 · filesystem delete/destructive write · credentials/secrets/API keys(含 `apiKeyEnv`/`baseURL`/credentials seam) · billing/provider 账户 · permission/auth · plugin install/remove · 网络/安全配置 · 任意代码 · git reset/force push · 数据库变更 · 生产部署 · 用户数据删除 · 自由文本 prompt 改写。
原则:任何无法用 allowlist schema path op 表达的修改,第一版只显示建议,不提供 Apply。

## 5. 第一版最终支持的 Apply 类型

**唯一类型:`kind: "settings"`**

```
target: { type: "settings", ns: "shell", path: ["timeoutMs"] }
diff:   { op: "set", path: ["timeoutMs"], before: 60000, after: 120000 }
```

- 单 namespace、单路径、标量 JSON 值(allowlist 白名单字段)。
- 读:settings redacted view(值 + revision);写:`settings.update(ns, patch, expectedRevision)`(或 path-op `mutate`)。
- 驱动规则:**现有 Repeated Tool Failure + shell/bash timeout evidence**(§29-A 双路径检测器)。
- **Target 公式(Phase 0.5 校准)**:
  - `before` = **runtime resolved** `shell.timeoutMs`(绝不用源码默认;Phase 0.5 实测部署基值为 **60000**,非 120000)
  - `after = min(before * 2, maxTimeoutMs)`;`maxTimeoutMs` = `min(runtimeResolvedMaxTimeoutMs, DEEPTRACE_SAFETY_CAP)`;**DeepTrace safety cap = 600000ms**,代码注释与本文档均明确:**这是 DeepTrace 自身 safety cap,不是 DSH 官方 hard cap**(DSH 官方仅 positive-finite 校验 + 写入端 `clampTimeout`)
  - `before >= cap` → 不生成 proposal
- 提案生成条件(全部满足):tool family = shell/bash;timeout evidence 属于该 tool;`Repeated Tool Failure` 规则命中;`before` positive finite;`after > before`;reversible = true。

## 6. 为什么选择它(候选评估)

| 候选 | DSH 正式 API | 可读当前值 | deterministic diff | rollback | 作用域 | 重启 | 影响运行中 session | 破坏环境风险 | v0.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A Tool timeout/retry | ✗(通用工具级无写口);**bash 工具预算 = `shell.timeoutMs` settings ✓** | ✓(shell ns) | ✓ | ✓ | 单 NS 单字段 | 否(live) | 新调用生效 | 低 | **✓ 主类型(bash 超时子集)** |
| B Prompt/instruction patch | ✗(无结构化 API,S10) | 文件 | ✗ 自由文本 | 手工 | 全局 | 需要 | — | 高 | **否** |
| C Model configuration | ✓ settings seam(S5b:`maxTokens`/`reasoningEffort`/`thinking`/`retryPolicy`;`agent-default-model`) | ✓ | ✓ | ✓ | 单 NS 单字段 | 否(live) | 新请求生效 | 低 | 延期(0.6.1 候选) |
| D Workflow / agent routing | 部分(agent-presets,`permission.defaultPreset`,S6) | ✓ | ✓(字符串/枚举) | ✓ | 新 session | 半 | 不影响 | 中 | 否(REVIEW) |
| E Plugin configuration | cordis.yml(S7) | 文件 | 部分 | 手工 | 全局 | 需要 | — | 中高 | **否** |

选 A(bash 超时子集)的理由:唯一同时满足"结构化 schema + 值可读 + 单路径 diff + 可逆 + live 无需重启 + revision 并发保护"**且与现有 Improve 证据链直接对应**的面——Repeated Tool Failure(TOOL_TIMEOUT 主错误码)→ 提高 bash 工具预算,verify 指标就是已存在 registry 的 `tool_failure_rate`,不需要新增任何 Improve 规则。

## 7. ApplyProposal schema

```ts
type ApplyRisk = "low" | "medium" | "high";
type ApplyProposalStatus =
  | "proposed" | "approved" | "applied" | "rejected" | "failed"
  | "conflicted"   // 配置在提案后被外部改动 → 需重新生成
  | "superseded";  // 同目标新提案取代旧提案

interface ApplyProposal {
  id: string;                 // `apply-<improvementId>-<hash>` 稳定可寻址
  improvementId: string;      // 现有 stable improve id(如 improve-tool-edit)
  kind: "settings";

  target: { type: "settings"; ns: string; path: string[] };
  expectedBefore: JsonScalar; // 提案时读到的当前值(数值/枚举,绝不存 secret)
  proposedAfter: JsonScalar;
  diff: { op: "set" | "unset"; path: string[]; before: JsonScalar; after: JsonScalar };

  reason: string;             // 规则模板文案,非自由生成
  evidence: {                 // ImprovementEvidence 的子集拷贝(数字 + 受影响会话 id)
    metrics: Record<string, number>;
    affectedSessions: string[];   // 最多 12 个
    occurrences: number;
    confidence: number;
  };

  risk: ApplyRisk;            // v0.6 只生成 "low";其余风险不生成提案
  reversible: true;
  rollbackPlan: { op: "set"; path: string[]; value: JsonScalar /* = expectedBefore */ };

  verificationPlan: VerificationPlan;  // §11,提案时即完整携带

  revisionAtProposal: number; // settings namespace revision(乐观并发锚点)
  createdAt: number;
  status: ApplyProposalStatus;
}
```

约束:不存整个配置 JSON;不存 secret(allowlist 在生成端保证);`evidence` 不含用户原句/错误原文(沿用 v0.5 隐私规则)。

## 8. ApplyRecord schema

```ts
type ApplyExecutionStatus =
  | "prepared"   // 幂等行已落盘,尚未写 settings
  | "mutating"   // settings.update 已发出
  | "applied"
  | "failed"     // 确定未发生写入(revision 未变)
  | "conflicted" // 外部改动竞态,无法判断归属 → 人工复核

interface ApplyRecord {
  applyId: string;            // = proposal.id + 单次 approval nonce(幂等键)
  proposalId: string;
  improvementId: string;
  target: { type: "settings"; ns: string; path: string[] };
  before: JsonScalar;
  after: JsonScalar;
  revisionBefore: number;     // 写入前的 namespace revision
  revisionAfter?: number;     // 写入后的 revision(成功后由 update 返回/describe 回读)
  appliedAt?: number;
  status: ApplyExecutionStatus;
  idempotencyKey: string;     // 与 applyId 同值,独立字段便于查询
  rollback: { available: boolean; status: "none" | "reverted" | "conflicted" };
}
```

## 9. Rollback schema

```ts
interface RollbackRecord {
  rollbackId: string;
  applyId: string;
  target: { type: "settings"; ns: string; path: string[] };
  expectedCurrent: JsonScalar; // 必须是 after(current == after 才允许回滚)
  restoreTo: JsonScalar;       // before
  revisionBefore: number;      // 回滚写入前的 revision
  rolledBackAt?: number;
  status: "requested" | "done" | "failed" | "target-changed";
}
```

规则:回滚同样过 `expectedRevision`;只有 `current == after` 才自动回滚到 `before`;否则返回 `TARGET CHANGED AFTER APPLY / MANUAL REVIEW REQUIRED`,不覆盖用户后续修改。

## 10. Audit schema(append-only)

```ts
type AuditAction =
  | "proposal.created" | "proposal.approved" | "proposal.rejected"
  | "proposal.conflicted" | "proposal.superseded"
  | "apply.prepared" | "apply.attempted" | "apply.succeeded" | "apply.failed" | "apply.recovered"
  | "verify.started" | "verify.result"
  | "rollback.attempted" | "rollback.succeeded" | "rollback.failed";

interface AuditEvent {
  id: string;          // 单调(时间 + 序列)
  ts: number;
  applyId?: string;
  improvementId?: string;
  target?: { ns: string; path: string[] };  // 只记路径,不记值
  action: AuditAction;
  result: "ok" | "error";
  code?: string;       // 错误码(如 SETTINGS_CONFLICT),不存错误正文
}
```

不存:secret、完整 prompt、完整 session payload、错误全文、before/after 值(值只存在于 ApplyRecord,且为 allowlist 标量)。

## 11. VerificationPlan schema(Apply 前必须完整)

```ts
interface VerificationPlan {
  metric: MetricKey;            // §12 registry key
  scope: {                     // 受控过滤面(registry 限定 allowedScope)
    tools?: string[];          // 仅 tool_failure_rate / tool_latency_p95 允许
    models?: string[];         // 仅模型级指标允许
  };
  baseline: {                   // 提案时固化展示;verify 时以 canonical index 重算为准
    value: number;
    evidenceWindow: { from: number; to: number };  // [proposalCreatedAt - baselineLookback, appliedAt)
    sampleSize: number;
  };
  target: { operator: "<" | ">" | "<=" | ">="; value: number };
  minimumEvidence: { sessions: number; observations: number };
  cooldownMs: number;           // 默认 10min,Apply 后排除的瞬态窗口
  maxObservationWindowMs: number; // 默认 7d,到期未达 minimumEvidence → INCONCLUSIVE
  baselineLookbackMs: number;   // 默认 7d
}
```

**不能"改完再临时想怎么验证"**:proposal 生成时该对象即完整落盘。

## 12. Verify metric registry(受控,不允许自由 metric string)

```ts
type MetricKey =
  | "shell_timeout_rate"           // v0.6 Apply+Verify 启用(scope: shell/bash)
  | "tool_failure_rate"            // 只读展示(现有 Repeated Tool Failure;与 timeout 统计互不重分类)
  | "tool_latency_p95"             // 只读展示
  | "retry_rate"                   // 只读展示
  | "cost_per_session"             // 只读展示
  | "tokens_per_session"           // 只读展示
  | "peak_usage_ratio"             // 只读展示
  | "user_correction_rate";        // 只读展示,永不 Apply

interface MetricDef {
  key: MetricKey;
  numerator: string;       // 生产实现里的确定聚合路径(代码引用,非自由文本)
  denominator: string;
  allowedScope: "none" | "tool" | "model";
  minimumEvidence: { sessions: number; observations: number };
  direction: "lower-is-better" | "higher-is-better";
  precision: number;       // 展示小数位
  applyEnabled: boolean;   // v0.6 仅 shell_timeout_rate = true
}
```

`shell_timeout_rate` 定义:
- **numerator** = 窗口内 shell/bash tool 的 timeout 数(INDEX_VERSION 17 新增 `toolTimeouts["bash"]`,来源 = §29-A 双路径检测器,ingest 时计数)
- **denominator** = 窗口内 shell/bash 调用数(现有 `toolCalls["bash"]`)
- **scope** = shell/bash;direction = lower-is-better
- **minimumEvidence** = 至少 10 次 post-apply shell 调用,且 ≥3 个会话
- **baseline proposal eligibility** = ≥5 次 timeout 事件且 ≥3 个受影响会话
- **target** = `min(baseline * 0.5, 0.08)` —— 理由:相对基线减半 + 绝对上限 8% 双重约束;不与既有 `tool_failure_rate` 的 <8% 机械混用(那是 failure 口径,timeout 是新统计口径,见 §29-B)

`tool_failure_rate` 定义:分母 = 窗口内目标工具调用总数;分子 = 失败调用数(沿用 `stats.toolHealth` 的 failure 口径,数据来自 v17 index 既有聚合)。**v0.6 不改变其 numerator 语义**(bash timeout 文本结果 `isError=false` 保持不计入 failure,除非另行做 compatibility impact 分析)。

## 13. 状态机

### Proposal
```
proposed ──approve──→ approved ──apply──→ applied
   │                       │
   ├─reject──→ rejected     └─CONFIG_CHANGED──→ conflicted(须重新生成)
   └─同目标新提案──→ superseded
```

### Apply(执行)
```
approved ──prepared(幂等行落盘)──→ mutating(settings.update 发出)──→ applied
   │                                   │
   └─重复请求→ 返回既有结果            └─SETTINGS_CONFLICT──→ conflicted
```

### Verify(核心)
```
applied ──→ observing(≥ cooldown) ──→ 窗口内达 minimumEvidence?
                                          ├─ 是 → 对照 target
                                          │        ├─ VERIFIED(达标)
                                          │        └─ NOT_IMPROVED(未达标/倒退 → REVERT RECOMMENDED)
                                          └─ 否 → 观察窗耗尽 → INCONCLUSIVE(样本不足)
```

- **NOT_IMPROVED 不自动回滚**;只显示 REVERT RECOMMENDED,由用户确认后 ROLLBACK。
- **VERIFY 失败不自动二次修改**;v0.6 一切 mutation 都是 user-approved。

## 14. Optimistic concurrency

1. Proposal 生成:读 `settings.describe()` → 记录 `expectedBefore`(路径当前值)+ `revisionAtProposal`。
2. 用户点 Apply:先重新读 describe();若 `revision != revisionAtProposal` 或 `value != expectedBefore` → **409 CONFIG_CHANGED**,proposal 置 `conflicted`,要求重新生成。
3. 写入:`settings.update(ns, [{op:'set', path, value: after}], currentRevision)` —— DSH 原生拒绝 stale revision(抛 `SETTINGS_CONFLICT {expected, actual}`),DeepTrace 映射为 409。**双层防护**:自检 + seam 原生守卫。
4. 语义对照:用户手工改过配置 → ABORT,DeepTrace 永不覆盖。

## 15. Idempotency

- `applyId = proposal.id + 单次 approval nonce`;approve 请求必须携带该 applyId(双击/重放同 id)。
- 执行前先写 `prepared` 状态的 ApplyRecord(幂等行):
  - 同 applyId 已有 `applied`/`failed` 记录 → 返回既有结果(200,`already-applied` / `already-failed`);
  - 已有 `prepared`/`mutating` → **409 IN_PROGRESS**(防双写);
- 因此同一个 applyId 的 mutation 至多执行一次。

## 16. Crash consistency(PREPARED → MUTATING → APPLIED)

写序:audit(`apply.prepared`) → ApplyRecord(status=mutating) → `settings.update` → ApplyRecord(status=applied, revisionAfter) → audit(`apply.succeeded`)。

启动时 reconciliation(逐条 `mutating` 记录):
- 读当前 `(ns, path)` 值与 namespace revision:
  - `value == after` 且 `revision == revisionBefore + 1` → 判定本次写入已落:补记 `applied` + audit(`apply.recovered`);
  - `value == before` 且 `revision == revisionBefore` → 写入从未发生:置 `failed`(无副作用);
  - 其他(值变了但不是 after / revision 跳变)→ 置 `conflicted`,audit(`apply.failed`),UI 显示需要人工复核。
- 保证:**绝不让 UI 显示 FAILED 但配置其实已改**。`settings/updated` 事件(source 区分 `update`/`provider`)作为运行时佐证;revision 差值作为权威锚点。

## 17. Threat model

| 威胁 | 缓解 |
| --- | --- |
| 恶意 session 内容 / 日志里的 prompt injection | 提案由确定性规则 + allowlist 生成,无 LLM、无文本→动作映射;session 只是 evidence 数字来源 |
| 伪造 tool error 文本 | 只消费错误码(白名单匹配),错误正文不进提案 |
| 用户内容伪装成指令 | 不存在文本→mutation 通道;mutation 只来自 predefined structured schema |
| stale proposal | §14 双层 revision 校验 |
| 外部改配置 | settings seam 原生 `SETTINGS_CONFLICT`;外部改动同时被 `settings/updated(source='provider')` 记录,可触发提案置 `superseded` |
| 重放 Apply 请求 | 单次 approval nonce + applyId 幂等行 |
| 重复 Apply / 浏览器双击 | `prepared` 幂等行 → 409 IN_PROGRESS |
| Apply 中 crash | §16 reconciliation |
| Apply 成功后写 audit 前 crash | §16 用 revision 锚点恢复 `applied` 并补 audit |
| Verify 数据污染(异常会话刷指标) | 受控 registry 的固定聚合(比率制)、minimumEvidence、精确 [from,to) 窗口;数据全部本机只读 |
| secret 泄漏 | allowlist 排除 secret 字段;settings redact 保证值不上 wire;ApplyRecord 只存数值/枚举标量 |

核心原则:**Session 内容永远只是 evidence;Session 文本不得直接生成 executable mutation。**

## 18. Storage design

在现有 `whale` domain(`src/state.ts`)新增 4 张表(domain 内加表;若 `defineDomain` 对加表要求 version 变更则 version 1→2,属无迁移破坏的新表):

| 表 | 内容 | 保留 | 敏感数据原则 |
| --- | --- | --- | --- |
| `apply_proposals` | ApplyProposal(§7) | superseded/rejected 30 天;applied 90 天 | 无 secret;evidence 只有数字 + 会话 id |
| `apply_records` | ApplyRecord(§8) | 永久(体积小) | before/after 仅 allowlist 标量 |
| `verify_records` | VerifyState(状态 + 前后数值 + 证据量) | 90 天 | 无原文 |
| `audit_log` | AuditEvent(§10) | 180 天 / 上限 1 万条(环形裁剪,保序) | 无值、无正文,只记路径与错误码 |

- **Canonical Query Index 继续只负责 observability data;Apply 状态独立存储,绝不塞回 session_index。**
- audit 只追加:更新通过新增事件实现;裁剪只允许删除最旧条目。

## 19. API design(设计不实现;挂现有 /whale/api + trust fence)

```
POST /whale/api/apply/proposals        body {improvementId}
                                       → 200 {proposal} | 422 {code: NO_APPLYABLE_TARGET}
GET  /whale/api/apply/proposals/:id    → 200 {proposal}
POST /whale/api/apply/:id/approve      body {applyId, expectedRevision, expectedBefore}
                                       → 200 {applyRecord}
                                       | 409 CONFIG_CHANGED | 409 IN_PROGRESS | 409 ALREADY_APPLIED
                                       | 422 FORBIDDEN_FIELD | 503 SETTINGS_UNAVAILABLE
POST /whale/api/apply/:id/reject       → 200 {status: rejected}
POST /whale/api/apply/:id/revert       body {rollbackId, expectedRevision}
                                       → 200 {rollbackRecord}
                                       | 409 TARGET_CHANGED | 409 NOT_APPLIED | 409 ALREADY_REVERTED
GET  /whale/api/verify/:applyId        → 200 {status, before, after, delta, evidenceCount, windows}
GET  /whale/api/audit?applyId=&limit=  → 200 {events}
```

统一错误包:`{ ok:false, error:{ code, message } }`(沿用现有 api.ts 风格)。幂等语义见 §15,并发语义见 §14。

## 20. UI flow(最小)

Improve card(**仅 Repeated Tool Failure 且主错误码 ∈ 超时白名单** 的条目)增加 `[Review change]` →
proposal detail(Evidence / Change(Before→After)/ Expected impact / Verification / Rollback)+ `[Apply]` `[Cancel]` →
成功后 chip:`OBSERVING`(含观察窗与 minimum evidence 进度)→
终态 chip:`VERIFIED` / `NOT_IMPROVED`(+ `[Revert]`,标签 REVERT RECOMMENDED)/ `INCONCLUSIVE`。

不做 workflow builder;高风险项根本不渲染 Apply 按钮。

## 21. 当前 4 条 Improve 如何进入 v0.6

| 规则 | A 能否生成提案 | B target | C 结构化 | D 可 rollback | E verify metric | F v0.6 |
| --- | --- | --- | --- | --- | --- | --- |
| **Repeated Tool Failure(shell/bash + timeout evidence)** | **是** | `shell.timeoutMs`(bash 工具预算) | 是(allowlist 数值) | 是(set 回 before) | **shell_timeout_rate**(新统计) | **v0.6 唯一 Apply 规则** |
| Repeated Tool Failure(其他错误码) | 否(无对应 settings 面) | — | — | — | tool_failure_rate(只读展示) | **read-only**;显示手工步骤文案 |
| Retry / Workflow Waste | 否(命令重试无 settings 面;llm retryPolicy 属另一证据链,延期) | — | — | — | retry_rate(只读展示) | **read-only** |
| Repeated User Correction(EXP) | 否(且 EXPERIMENTAL) | — | — | — | user_correction_rate(只读) | **read-only**,长期如此 |
| Peak Cost Opportunity | 否(时间调度无安全 mutation 面) | — | — | — | peak_usage_ratio(只读) | **read-only**;保留 scheduling suggestion 文案 |

结论:不为"4 条全支持 Apply"硬做。**零新增 Improve 规则**;Repeated Tool Failure 上挂一个"tool=shell/bash 且 timeout evidence 达标"的提案生成分支(§29-A 检测器 + §29-C 阈值)。报告语义未变,REPORT_SEM 保持 6;INDEX_VERSION 16→17(§29-B)。

## 22. 仍保持 read-only 的清单

- 3 条现有规则(Retry / Workflow Waste、Repeated User Correction、Peak Cost Opportunity)的全部输出(建议文案 + VERIFY 计划)。
- Repeated Tool Failure 的非超时错误码变体(无对应 SAFE settings 面,只显示建议 + 手工步骤)。
- Peak Cost Opportunity 的调度建议(不自动改 `agent-presets.default`、不改 schedule)。
- 所有 REVIEW/NEVER 面(§4)。
- secrets/credentials 的任何路径。

## 23. 测试计划

- `tests/apply-proposal.test.ts`:规则→提案生成确定性(同输入同 id 同 diff)、allowlist 拒绝 secret 字段、风险过滤(非 low 不生成)。
- `tests/apply-executor.test.ts`:冲突矩阵(值变/revision 变/都不变)、SETTINGS_CONFLICT 映射、幂等(双击/重放/崩溃注入)、prepared→mutating→applied 全路径。
- `tests/apply-rollback.test.ts`:current==after 才回滚;current!=after → TARGET_CHANGED;二次回滚 → ALREADY_REVERTED。
- `tests/verify-windows.test.ts`:appliedAt 切点精确 [from,to)、cooldown 排除、maxObservationWindow 到期 INCONCLUSIVE、minimumEvidence 门槛。
- `tests/verify-metrics.test.ts`:metric registry 完整性;`shell_timeout_rate` 的 raw-rows Oracle == bucketized 等价(costDiff 式对账)。
- `tests/audit.test.ts`:append-only、事件序、错误码不存正文。
- TZ 矩阵扩展:verify 窗口在 3 个 TZ 下边界一致。
- 集成(内存 domain):api 路由 + 状态机全链路,无真实 settings 依赖(mock adapter 注入)。

## 24. Real DSH acceptance plan

- Phase 0 探测:web profile 下 DeepTrace 插件能否 `ctx.inject(["settings"])` 并 `describe()` 到 `shell`(缺失 → 特性优雅降级为 read-only)。
- 自测 namespace:先用 DeepTrace 自己注册的测试 namespace 验证 write/revision/`SETTINGS_CONFLICT`/redact 行为(不动真实配置)。
- 真实字段:`shell.timeoutMs` 一次手工批准往返(before→after→revert),确认 live 生效(`settings/updated` 事件)与 file provider 重启后持久。
- 外部改动竞态:手工编辑 settings.yaml → 确认 watcher 触发、在途提案置 `superseded`/approve 返回 CONFIG_CHANGED。
- 验收数据:真实 session 数据上跑 TOOL_TIMEOUT 白名单与 verify 窗口,确认 minimumEvidence 与 target 校准。
- 全绿判定:§25 gates 全部通过 + 手工 Apply 一次 + Revert 一次 + 崩溃恢复注入一次。

## 25. Release gates(v0.6 发布必须全过)

- **Safety**:100% Apply 需用户批准(代码级不可绕过);arbitrary mutation 不可能(allowlist + schema);stale config 覆盖不可能(revision);duplicate Apply 幂等;rollback 并发安全。
- **Correctness**:Verify 使用 exact before/after 窗口(appliedAt 切点);`shell_timeout_rate` 指标 raw Oracle == query engine;pre/post 无污染(cooldown 与窗口切分);TZ 矩阵一致。
- **Resilience**:crash reconciliation(§16 三态恢复)测试通过;持久化失败不丢幂等行(prepared 先落盘);mutation 失败状态可解释;无 partial-Apply 假象。
- **Testing**:确定性单测 + 集成测试 + 真实 DSH sandbox acceptance(§24)全绿。
- **Regression**:现有 323 tests 保持全绿;README/CHANGELOG 随版本更新;**INDEX_VERSION 16 → 17**(新增 timeout contribution 字段,旧 v16 索引自动失效重建,见 §29-B)。
- **降级**:settings seam 不可用 → 全 UI 显示 read-only(不得出现 Apply 按钮但点击报 500)。

## 26. 预计新增/修改文件

```
src/apply/settings-adapter.ts   # settings seam 封装(describe/read/update/冲突映射/可用性探测)
src/apply/allowlist.ts          # SAFE 字段白名单 + secret 排除
src/apply/proposal.ts           # 提案生成(规则 → ApplyProposal)
src/apply/executor.ts           # prepared→mutating→applied + 幂等 + reconciliation
src/apply/rollback.ts
src/apply/audit.ts
src/verify/metrics.ts           # metric registry + shell_timeout_rate 聚合
src/verify/verifier.ts          # 窗口计算 + 状态机
src/verify/state.ts
src/state.ts                    # +4 张表(domain 版本评估)
src/api.ts                      # +7 条路由
src/improvements.ts             # Repeated Tool Failure 加 TOOL_TIMEOUT 提案生成分支(4 条规则本体不动)
src/client/index.tsx            # Review change / proposal detail / 状态 chip
tests/{apply-proposal,apply-executor,apply-rollback,verify-windows,verify-metrics,audit}.test.ts
README.md / CHANGELOG.md
```

## 27. 最大风险

1. **DSH pre-release 波动**:AGENTS.md 明示"rename or repackage freely until first tagged release"——settings seam 的 API 名/事件名/`applies` 语义在快照间可能变化。缓解:`settings-adapter.ts` 单点封装 + DeepTrace 已有的双惰性注入模式 + 不可用即降级 read-only。
2. **peer 类型缺口**:DeepTrace 当前安装集不含 `@deepseek-ai/dsh-settings`;adapter 需新增该 peer(types)或惰性注入 + 结构化类型兼容(沿用 sessionQuery 双惰性注入先例)。host profile 与 npm peer 范围要同步评估。
3. **live 生效范围**:`shell.timeoutMs` 对后续 bash 调用生效(live),但进行中调用不受影响 —— UI 必须明示"对新调用生效",避免用户误以为"立即修复"。
4. **因果链是建议性的**:提高 shell 超时预算 ≠ 一定降低失败率;VERIFY 是唯一裁判,NOT_IMPROVED 必须提示回滚。
5. **错误码确认前置**:DeepTrace 现有 toolHealth.errorCodes 里 bash 超时对应的精确 code 字符串(`TOOL_TIMEOUT` 或 bash-local 家族码)必须在 Phase 0.5 用真实日志确认,提案生成分支依赖它。
6. **settings provider 缺失**(部分 profile 无 file provider → `writable=false`):功能优雅降级为 verify-only。
7. **REPORT_SEM**:预期保持 6(仅新增提案状态展示,统计语义未变);实现时若报告结构变化则评估 bump。

## 28. 推荐的 Phase 1 implementation scope

只做"能被完整测试的最小闭环",不做 UI 之外的一切:

1. `settings-adapter`(探测/read/update/冲突映射);
2. `allowlist` + `proposal`(Repeated Tool Failure/TOOL_TIMEOUT 变体 → `shell.timeoutMs` 提案);
3. `state.ts` 4 表 + `audit`;
4. `executor`(幂等 + 并发 + PREPARED→MUTATING→APPLIED + 启动 reconciliation);
5. `rollback`(current==after 校验);
6. `verify/metrics` + `verifier`(exact 窗口 + minimumEvidence);
7. 单测 + 集成测试 + 一次真实 sandbox 手工往返。

---

## GO / NO-GO

**GO(条件性)**。

条件(在 Phase 1 前 2 天内关闭):
- C1:web profile 下 DeepTrace 可注入 `settings` 且 `shell` namespace 可 describe 且 `writable=true`(不可达 → NO-GO,降级为 VERIFY-only v0.6);
- C2:timeout 检测器与阈值在真实数据上确认(Phase 0.5 已确认:41 例 bash 标记超时 + 3 例 TOOL_TIMEOUT code,双路径可确定检测),提案率合理;
- C3:`SETTINGS_CONFLICT` 与 revision 语义在真实 seam 上按 §14/§16 行为一致。

**如果现在开始写 v0.6,第一周只实现**:§28 的 1–7,且 Apply 仅暴露在「单字段、low 风险、`shell.timeoutMs`(bash 工具预算)」一个提案上;UI 只有一张 proposal detail 卡;一周结束时交付物 = 一次真实 settings 写→verify→revert 往返 + 全绿测试,而不是任何新 UI 框架。

---

## 29. Phase 0.5 probe findings — amendments written back (C1/C2/C3 closed)

> 依据:隔离 DSH 实例(DSH_HOME=/tmp/dsh-probe-home,port 3399,装载真实 dsh-whale-report + 临时探针插件)实测;真实数据只读调查(100 sessions)。

### A. Timeout detector(统一 evidence 检测器)

```
Path A: error.code === 'TOOL_TIMEOUT'               (host wrapper 路径;真实样本 3 例,工具=web_search)
Path B: tool/result content 精确匹配 /\[timed out after \d+ms\]/  (executor 预算路径;真实样本 41 例,全部 tool=bash)
禁止:   substring "timeout"、模糊 message matching、AI semantic classification
```

**GLOBAL timeout detection 与 SHELL APPLY eligibility 必须分离**:
- 任意 tool 的 timeout 都可计入全局 observability timeout stats(`toolTimeouts[tool]`);
- `shell.timeoutMs` Proposal **仅当** tool family = shell/bash **且** 该事件被检测器确认为 timeout 时生成;
- web_search 的 TOOL_TIMEOUT 计入 observability,但**绝不能**生成 shell.timeoutMs Proposal(防止"浏览器超时→改 bash timeout"的错误归因)。

### B. INDEX_VERSION 16 → 17(正式修订)

canonical bucket schema 新增 timeout contribution。推荐字段(Phase 1 采用):

```ts
/** 该分桶内按工具的 timeout 计数(仅 normalized tool identity + count)。 */
toolTimeouts?: Record<string, number>
```

只保存 tool identity + count;**不保存** command、timeout message、原始 content(隐私同现有 rows 原则)。旧 v16 索引 v 不匹配 → 自动失效重建(现有 `entry.v !== INDEX_VERSION` 路径)。
`REPORT_SEM` 保持 6:这是**新增统计 contribution**,不是重解释现有 usage/cost semantics;实现中发现必须变化时先报告,不自行 bump。

### C. Proposal eligibility threshold(真实数据校准)

bash/shell timeout proposal 必须同时满足:

- `shell_timeout_rate` 证据:timeout events **≥ 5**,affected sessions **≥ 3**(真实数据:41 例/6 会话,高于阈值,提案率合理)
- 当前 Improve = Repeated Tool Failure(工具名属于 shell/bash 家族)
- timeout evidence 属于该 tool(不是 web_search 等)
- `shell.timeoutMs` 当前值可读,`before` positive finite
- `before < safety cap` 且 `after > before`
- reversible = true

**普通 bash failure(非 timeout)绝不生成 timeout proposal。**

### D. Timeout target(已并入 §5)

`after = min(before * 2, maxTimeoutMs)`;`before` = runtime resolved value(实测部署基值 60000,绝不用源码默认 120000);`maxTimeoutMs = min(runtimeResolvedMaxTimeoutMs, 600000)`;DeepTrace safety cap **600000ms** 是 DeepTrace 自身 cap,不是 DSH 官方 hard cap(DSH 仅 positive-finite 校验 + clampTimeout);`before >= cap` 不生成。

### E. External modification acceptance

proposal 创建后,用户/外部程序直接修改 settings.yaml → revision 改变 → Apply 必须返回 `CONFIG_CHANGED`、proposal 置 `superseded`;不得覆盖用户新配置。(Phase 0.5 实测:直接文件编辑 → watcher 热发布 → revision 0→1→2;stale write 抛 `SettingsConflictError{code:'SETTINGS_CONFLICT', expected, actual}`。)

### F. Probe safety lesson(开发安全约束,非产品功能)

Phase 0.5 环境事故:探针 profile 的 node_modules 符号链接被 `healProfilesModuleFallback` 的清理逻辑沿 symlink 遍历,删除了真实 web profile 的 `@deepseek-ai` 包链接(已当场恢复:pnpm install + 手动 heal,194/194/228 链接就位;live 实例全程 200)。

**后续 v0.6 开发测试规则(硬性)**:
1. sandbox cleanup 不得 follow symlink(清理前 lstat/realpath containment check);
2. 不得对真实 `~/.dsh` profile 做 recursive cleanup;
3. probe profile 必须拥有**独立** node_modules/fallback tree(不得指向真实 profile 的目录);
4. destructive cleanup 前必须 realpath containment check(目标位于 `/tmp/...` 才允许);
5. real DSH acceptance 默认只读,除明确测试的 allowlisted setting(`shell.timeoutMs`)。

### Phase 0.5 实测数字(写入 RFC 作校准基线)

- settings seam:14 namespaces;`shell` `{applies:'live', secrets:[]}`;revision 序列 `0→1→2→2(同值写不增)→3→4→5`;同值 update = no-op(幂等友好)
- live effect:timeoutMs=1000 → `sleep 3` 1012ms `timedOut:true`;timeoutMs=8000 → `sleep 2` 2025ms exitCode 0
- stale write:抛 `SettingsConflictError`,shape 与 RFC §14 逐字一致
- 真实数据:TOOL_TIMEOUT code 3 例/1 会话(web_search);bash 标记超时 41 例/6 会话,预算分布 60s×33 / 600s×3 / 70-120s×5;事件 payload 无 `timedOut` 字段(仅 content 文本标记);外部预算值 7 种(用户真实改过 → 乐观并发必要)
- redaction:llm-deepseek describe 无 key 材料(apiKeyEnv 仅为 env 变量名引用;真 key 在 credentials seam)
