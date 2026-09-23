# T61-B：LLM 辅助二次分析层（语义评估）

> Phase 5 研究票：GitHub issue #61（LLM 辅助二次分析层）
> Wayfinder 研究员 · 纯文档产出，不改代码、不动 git
> 证据纪律：结论带 `文件:行号`；无法实证标【推断】

## 0. 研究范围与已核实事实基线

### 0.1 本票边界

票 #61 属于 Phase 5（milestone #59）的 wayfinder:research 系列，产出 `docs/research/t61-b-semantic-layer.md`。
四个研究问题（AGENTS 内已核实，不重查）：

1. **语义评估范围**：LLM 二次分析层判什么、不判什么（与既有机械 Gate、learner、接收者面清边界）；
2. **载荷设计**：复用 Context Receipt 还是新载荷；要不要携带 T5 变更摘要；token 上限定在哪；
3. **成本节流**：候选章多时如何排序、批量 vs 单章、LLM 不可用时如何降级；
4. **结论入账**：判定落事件还是派生面、与 ProposalPort 的关系、沿 ADR-0019 保护位。

### 0.2 已核实事实基线（锚点，供实现票直接引用）

| 事实 | 实证 | 对四问的意义 |
|---|---|---|
| Receipt 一证一文件 `.mozhou/receipts/rcpt_<ULID>.json`，entries 含 included/excluded + exclusionReason，replayInputs 为归档最小重放输入面 | docs/specs/context-receipt-physical-format-spec.md:30-38（entries 确定性序）、:38（included=false 原位保留）、:79-97（replayInputs 契约）、:113-127（schema 增补） | ② 载荷复用的裁决依据：Receipt 是可复算审计凭证，**不可承载非确定性 LLM 判定** |
| `ContextCompiled` 事件只持指针摘要，不内联 receipt 体；崩溃一致序 = 先文件后事件 | spec:45-67；ADR-0021:22-23 | ④ 语义判定入账的指针事件先例 |
| ProposalPort 三后端：pipeline｜reconciliation｜style；统一 confirm/reject/editAccept 逐条协议 | packages/pipeline/src/proposal-port.ts:42-45（ProposalPortRef）、:197-219（三动词） | ④ 与 ProposalPort 的关系：语义判定不是默认提案面 |
| Port 决策不新增账本事件（kernel 事件词表唯一真源） | proposal-port.ts:21-23 | ④ 事件词表增补需受控修订，不能随手加 |
| T5 外部修改五态对账 + 确定性 `ChangeSummary`（proseChapter/trackingStream/structuredFile/entityCard/opaque 判别联合） | packages/data-plane/src/reconciliation.ts:120-140（ChangeSummary）、:315/:351/:449/:485（五类 summarize 提取器） | ② 带不带 T5 变更摘要：提取器已存在，可作 payload 输入面 |
| ADR-0019：Protected Author Content 自动化通道不可覆盖；上游重算只能标记 stale，禁止清除/覆写作者文本 | docs/adr/0019-research-driven-amendments-protected-edits-compaction-receipts-knowledgestate.md:14 | ④ 语义判定落账的保护位 |
| ADR-0014：引导式突变协议（HARD_CONFLICT → 作者选择 acknowledge/intentional twist） | docs/adr/0014-canon-conflict-reconciliation-and-intentional-mutation.md:9-17 | ① 硬冲突判定不归 LLM 语义层 |
| ADR-0024：Continuity Gate **纯机械**；LLM 审查降为**旁路建议**；`AutomatedReviewCompleted` 死事件删除 | docs/adr/0024-chapter-pipeline-transactional-orchestration.md:26 | ①③④ 语义层定位 = 旁路分析，不是 Gate，不沿用死事件 |
| Token 预算：服务端精确 tokenizer 为计量权威，估算器严禁进预算路径；`R_out = max(minTokens, ratio×W)` | docs/specs/token-budget-assembly-spec.md:70-72、:42 | ② 语义载荷 token 上限的预算先例 |
| 候选 Desirability 全序（pinned DESC → tierRank ASC → relevanceScore DESC → id ASC） | token-budget-assembly-spec.md:66-67 | ③ 候选多时排序的既有序基础 |
| TaskModelEvaluator = 只读投影器，**只建议不自动改路由/配置** | docs/research/t49-c-task-model-evaluator.md:7-13 | ① 边界先例：辅助分析一律旁路 |

## 1. 票面问题与目标

Phase 5 引入「LLM 辅助二次分析层」：在既有**确定性**管线（编译/召回/预算/对账/机械 Gate）之上，
允许 LLM 对上下文语义质量、正文章节与上下文的适配度做**软性**评估，作为改进 flywheel / learner /
作者可见性的信号源。票面四问即围绕这一旁路层的四个界面：判什么（范围）、喂什么（载荷）、
花多少（成本）、记在哪（入账）。

贯穿四问的三个交叉约束：

- **确定性优先**：预算装配、召回、Gate、T5 提炼全部是确定性纯函数（见 §0.2）；LLM 判定只能
  **叠加**其上，不得改写任何确定性路径的输入或输出。
- **旁路建议**：ADR-0024 已定案「LLM 审查降为旁路建议」（0024:26）——语义层结论默认不阻塞、
  不自动生效，需要作者裁决的少数情况经 ProposalPort style 式旁路（见 §5）。
- **审计一致**：事件词表唯一真源 + 指针事件先例（ADR-0021）；所有判定留痕可复算、可 diff。

## 2. ① 语义评估范围：判什么 / 不判什么

### 2.1 判什么（in scope，全部为只读旁路信号）

**S1. 上下文装配的语义适配度**：给定一次生成的 `ContextReceipt`（entries + replayInputs，
读取 spec:30-38/79-97），判定编译后的上下文对当前写作任务（chapterIndex + taskType）是否语义覆盖——
如关键实体缺失、时效性陈旧、召回空窗（recall_filter 空档）、预算挤出导致的关键条目掉包。
**S2. 正文-上下文一致性提示**：从 CandidateCreated / draft 正文切片出发，判定行文与注入上下文之间
的语义冲突或漂移**提示**（注意：**不裁决**，见 §2.2 MUST-NOT-1）。
**S3. 软性质量标定**（供 learner/flywheel 消费的原始判定）：语义连贯、节奏、风格稳定性等维度打分。
消费边界已由 t49-c 划好：TaskModelEvaluator 是只读投影器，语义层产出原始判定记录即可，
不直接写 settings.yaml / 路由（t49-c.md:7-13 同款边界）。

### 2.2 不判什么（out of scope，MUST-NOT 级）

- **MUST-NOT-1 不裁决硬冲突**：Continuity Gate 纯机械（ADR-0024:26），事实冲突走
  ADR-0014 引导式突变协议（0014:9-17）——LLM 语义层对 HARD_CONFLICT 只可提示，不可自动改文/改事实。
- **MUST-NOT-2 不触碰 Protected Author Content**：任何判定不得清除、覆写、合并作者文本；
  上游重算（含语义重分析）只能把下游产物标记 stale（ADR-0019:14）。
- **MUST-NOT-3 不参与预算核算**：token 计量权威是服务端精确 tokenizer，估算器严禁进预算路径
  （token-budget-assembly-spec.md:70-72）；语义层永远只消费 Receipt，不反向影响装配。
- **MUST-NOT-4 不自动改路由/配置**：同 t49-c 边界契约（t49-c.md:13）。
- **MUST-NOT-5 不裁决事实真伪**：TemporalFact 真伪/时间区间由 kernel 图与对账负责；LLM 无判真权
  （沿 ADR-0019:11 KnowledgeState 的 dual-channel 纪律：图通道权威，embedding 仅覆盖回退）。

### 2.3 推荐（实现票可直写）

> **语义层 = 只读旁路分析器（advisory-only）**：
> 输入 {receiptId / chapterIndex / taskType / draft 切片}，输出 {维度打分 + 证据引用 + 建议动作}；
> 无默认写口，落地仅经事件指针（§5）。作用域 S1-S3，MUST-NOT-1..5 进验收清单。

证据锚点：ADR-0024:26（Gate 纯机械 + LLM 旁路）｜ADR-0019:14（保护位）｜ADR-0014:9-17（冲突协议）｜
t49-c.md:13（边界契约）。

## 3. ② 载荷设计：新载荷，不复用 Receipt（带指针锚点 + 可选 T5 摘要引用）

### 3.1 复用 Receipt 还是新载荷：**新载荷 SemanticAnalysisReport**

Receipt 的三大冻结属性与 LLM 判定天然互斥：

- **确定性契约**：装配是 `(inputs, modelProfile, configVersion, tokenizerVersion)` 上的纯函数，
  同输入必逐字节复现（token-budget-assembly-spec.md:62-63）；非确定性 LLM 判定写入会摧毁
  `recomputationHash` 可复算承诺（spec:37, 93-94）。
- **不可变凭证（I5）**：永不改写，修正 = 新 ULID 新证（spec:39）——语义判定是可丢弃可重算的
  旁路产物，不用并入审计凭证本体。
- **热路径 vs 旁路**：receipt 走装配热路径且全保留（spec:140）；语义评估低频、可跳过、可重建，
  混在一起会让"为什么 AI 看到这个"与"它质量如何"失去边界。

**推荐（实现票可直写）**：新载荷 `SemanticAnalysisReport`，一报一文件
`.mozhou/semantic-analysis/report_<ULID>.json`（对齐 receipts 一证一文件先例 spec:30-36），
**必带锚点** `{receiptId, recomputationHash, chapterIndex, taskType}`——判定必须可追溯到
它评估的具体那次编译；事件只持指针摘要（§5）。拒绝把判定折进 receipt 或复用死事件
`AutomatedReviewCompleted`（domain-events.ts:9-10 已删）。

### 3.2 带不带 T5 变更摘要：**带引用，不内嵌全文**

- T5 `ChangeSummary` 提取器已存在且确定性（reconciliation.ts:120-140 判别联合；
  :315/:351/:449/:485 五类 summarize）——判「正文-上下文漂移」时，正文是否存在未决/已决外部
  修改是关键语境：同一上下文配五态文本 vs 已应用文本，S2 结论可完全不同。
- **推荐**：payload 带可选 `reconciliationRef { proposalId, changeSummaryDigest }`；全文不内嵌
  （真源唯一，沿 `replayInputs` "内容本体一律不内嵌" 纪律 spec:86）。摘要引用自证"评估的是哪版
  对账状态"，不复制正文、不引入第二真源。

### 3.3 token 上限：锚定装配包 + 服务端 tokenizer

- **计量纪律**：一律服务端精确 tokenizer（token-budget-assembly-spec.md:70-72），估算器严禁进
  核算路径——语义层同样遵守。
- **输入面 = 装配包 + 正文切片**：上下文条目已受 budget 约束（总包 ≤ `W − R_out − margin`，
  spec:76-79），正文切片受 storyTextQuota 约束（spec:53）；语义层输入不应超出原装配包规模。
- **推荐（数值为默认，实现票/grilling 可调）**：
  `semanticInputTokensCap` 默认 = `min(装配包 totalTokens × 1.0, 16384)`【推断：量级对齐
  常见长上下文二次分析，数值未实证】；**输出判定**为固定小 JSON（默认 ≤ 512 tokens 的
  findings），报告本体不走预算装配路径、不参与 `recomputationHash`。

### 3.4 载荷形状草案（纯增量，随票入 schema 判定为「受控增补」）

```ts
/** LLM 辅助二次分析报告（旁路产物：不阻塞、不自动生效、非审计凭证） */
export interface SemanticAnalysisReport {
  readonly reportId: string;        // report_<ULID>
  readonly version: 1;
  readonly createdAt: string;
  readonly anchor: {                // 必填：判定针对哪次编译
    readonly receiptId: string;
    readonly recomputationHash: string;
    readonly chapterIndex: number;
    readonly taskType: string;      // CompileTaskType
  };
  readonly reconciliationRef?: { readonly proposalId: string; readonly changeSummaryDigest: string };
  readonly provider: { readonly providerId: string; readonly model: string; readonly promptVersion: string };
  readonly inputStats: { readonly inputTokens: number; readonly outputTokens: number;
    readonly entriesIncluded: number; readonly entriesExcluded: number };
  readonly findings: readonly SemanticFinding[];
  readonly verdict: 'pass' | 'flag' | 'review';
  readonly refusal?: 'no_llm' | 'timeout' | 'invalid_input';  // L0 降级时置
}
export interface SemanticFinding {
  readonly dimension: string;       // 'recall_coverage' | 'prose_context_alignment' | 'coherence' …
  readonly level: 'info' | 'warning' | 'critical';
  readonly score: number;           // 0..1
  readonly evidence: readonly string[];  // 条目 identifier / 正文切片引用——绝不含全文
  readonly suggestion?: string;     // 建议动作，不自动执行
}
```


## 4. ③ 成本节流：章级排序 → 批量优先 → 三级降级

### 4.1 候选章多时如何排序：**章级"成本-价值"序，复用既有 receipts 投影**

- 底部数据已存在：.`mozhou/receipts/` 全保留 + SQLite 投影
  `receipts(receipt_id, chapter_index, created_at, …)`（spec:68-73）——章级排序不需要新表。
- **推荐排序键（权重为默认，可调）**【推断：数值粒度非实证】：
  ① 作者/系统显式 pin 优先（沿候选 pinned DESC 先例 token-budget-assembly-spec.md:66）；
  ② 存在未决/新落定 T5 对账的章优先（`reconciliationRef` 命中 → 内容变了最值得重判）；
  ③ 距上次评估最久（stale 优先，沿 ADR-0019:14 上游重算标记 stale 语义）；
  ④ 主线章（chapterIndex 邻近当前进度）优先于支线。
- 每轮按评估预算（`maxReportsPerRun`）截断，超出的标 `deferred` 不静默丢。

### 4.2 批量 vs 单章：**批量传输 + 单报产出；上下文不够时回退单章**

- **推荐**：同 taskType、章节相邻（如 3-5 章）合成一次 LLM 调用（共享 rubric 指令、共享上下文
  条目），省调用数与固定开销；**但每章仍产独立 report 文件**——批量只是传输层优化，不合并结论
  （一报一文件纪律不放松）【推断：批量大小默认值 = 3-5，实现票定】。
- **回退单章**：模型上下文窗口装不下批量输入、或作者手动触发单章评估时。
- 判定本身永远逐章落账，批量不改变 §5 的入账形状。

### 4.3 LLM 不可用降级：**三级，永不静默 mock**

- **L0 跳过（生产能力缺失）**：LLM/provider 不可用时本次不评估；可选产 `refusal` 报告
  （`verdict` 缺省、记原因码）或干脆不产——**推荐 V1 不产文件、只发指针事件带 `refusal` 码**，
  沿「失败装配不产 receipt，走错误事件」（spec:134-136）先例。**绝不**静默退回 mock/本地小模型
  冒充（AGENTS 规则 14/15：生产永不静默回退 mock，失败必须显式）。
- **L1 确定性兜底【推断：实现票验证价值，缺省不做】**：用既有确定性信号（relevanceScore 分布、
  exclusionReason/trimType 计数、entryCount 波动）产机械版 finding 并标注
  `deterministic_fallback`。信号面齐全（receipt 全量归档）所以可实现，但价值需验证；若不做则
  瞬时失败直接 L2 重试后转 L0。
- **L2 重试**：瞬时错误（超时/限流/网络）指数退避重试 N 次（推荐默认 3 次，退避 1s/2s/4s
  【推断】），超限转 L0；与调度解耦——评估队列可稍后重跑（凭 `deferred` 标记幂等续做）。


## 5. ④ 结论入账：指针事件 + SQLite 派生面；ProposalPort 默认不参与；ADR-0019 保护位

### 5.1 事件还是派生面：**两者都要——事件只持指针、报告文件为真源**

严格对齐 ADR-0021 的「先文件后事件」崩溃一致序与指针语义（spec:60-67, ADR-0021:22-23）：

1. 先写 `.mozhou/semantic-analysis/report_<ULID>.json`；
2. 后追加指针事件 **`SemanticAnalyzed`**（受控增补新词条，见 5.4）；
3. SQLite 派生面投影 `semantic_analysis(report_id PK, receipt_id, chapter_index, task_type,
   created_at, verdict, finding_count, provider, model, input_tokens, output_tokens)`
   （对齐 receipts 投影先例 spec:68-73），可丢弃重建 = 扫目录。

事件词表纪律：kernel 类型库唯一真源、禁止各模块散写（domain-events.ts:4-6）；增词条必须受控
增补。**不可复用已删死事件 `AutomatedReviewCompleted`**（domain-events.ts:9-10 明确删除，
ADR-0024:26 Gate 纯机械）——语义层是新旁路，不是回填审查事件。

### 5.2 与 ProposalPort 的关系：**默认不参与；critical 建议以 style 式旁路为上限**

- ProposalPort 是**需作者逐条确认的变更面**（pipeline/reconciliation/style 三后端，
  confirm/reject/editAccept，proposal-port.ts:42-45, 197-219）；语义判定是旁路建议、不阻塞
  （ADR-0024:26），所以**默认不进 ProposalPort、不落提案仓**。
- **上限（若 V1 做）**：findings 中 `level=critical` 且 `suggestion` 需要作者裁决时，合成
  **style 式旁路建议**——沿 t51:B2 先例：派生建议不落提案仓、内存持留、永挂待决、无超时自动生效、
  confirm 显式生效（proposal-port.ts:39-45, 160-174, 405-431）【推断：V1 是否做 critical→style
  桥接预留，实现票定；缺省 = 只记录 suggestion 不产生任何 Port 引用】。
- **底线**：语义层永不代作者调用 confirm/reject/editAccept；永不写 canon / 提案文件 / 配置。

### 5.3 ADR-0019 保护位（必守）

- **零正文泄露**：evidence 只引 identifier / 切片引用，绝不内嵌正文（沿 replayInputs「内容本体
  一律不内嵌」spec:86 与事件指针先例）。
- **动作域仅限 { 标记 stale, 产出建议 }**：重算只能标 stale、绝不清除/覆写作者文本
  （ADR-0019:14）；合并/覆写/清除一律禁止，改事实走 ADR-0014 引导式突变（0014:15-17），
  语义层只提示。
- **KnowledgeState 只读引用**：可引用作证据，无权变更（ADR-0019:11 图通道权威纪律）。

### 5.4 受控增补清单（实现票草案）

1. kernel 词表新增 `SemanticAnalyzed`（不成对，EVENT_PAIRS 不动——沿 `StyleProfileUpdated`
   先例 domain-events.ts:14-16）；payload = 指针摘要
   `{reportId, receiptId, chapterIndex?, taskType, verdict, findingCount, refusal?}`，
   taskRef/chapterIndex 走 DomainEvent 既有顶层槽位（禁塞 payload，t52:B5）。
2. 报告文件目录 `.mozhou/semantic-analysis/` 入目录树（运行时区非正典、不参与对账；
   对齐 receipt 归属理由 spec:27-35）。
3. SQLite 投影表 `semantic_analysis`（可丢弃，重建 = 扫目录）。


## 6. 结论汇总表与开放问题

### 6.1 四问 → 推荐 → 证据一览

| 票面问题 | 推荐（实现票可直写） | 关键证据 |
|---|---|---|
| ① 语义评估范围 | 只读旁路分析器（S1 上下文适配 / S2 正文-上下文提示 / S3 软性标定）；MUST-NOT：不裁决硬冲突、不碰受保护作者内容、不进预算路径、不改路由、不判事实真伪 | ADR-0024:26；ADR-0019:14；ADR-0014:9-17；t49-c.md:13 |
| ② 载荷设计 | 新载荷 `SemanticAnalysisReport` 一报一文件 + receipt 锚点；T5 摘要只引 `changeSummaryDigest` 不内嵌；输入上限锚定装配包、输出 ≤512 tokens；服务端 tokenizer 计量 | spec:62-63/39/86；reconciliation.ts:120-140 |
| ③ 成本节流 | 章级排序（pinned→对账命中→stale→主线）；批量传输+单报产出，窗口不足回退单章；L0 跳过 / L1 确定性兜底（默认不做，验证后定）/ L2 退避重试；永不静默 mock | spec:68-73；token-budget-assembly-spec.md:66；ADR-0019:14 |
| ④ 结论入账 | 报告文件先、`SemanticAnalyzed` 指针事件后、SQLite 派生面投影；ProposalPort 默认不参与（critical 至多 style 式旁路）；经事件/报告零正文泄露，动作仅限标 stale + 建议 | spec:60-67；domain-events.ts:4-16；proposal-port.ts:160-174；ADR-0019:11/14 |

### 6.2 开放问题（留给实现票 / grilling）

1. **L1 确定性兜底**是否值得做——推荐先不做，跑一段 L0/L2 再评估；
2. **critical → style 旁路桥接**——推荐 V1 只记录 `suggestion`，桥接留 V2；
3. 数值默认：批量大小（3-5 章）、`semanticInputTokensCap`（装配包 ×1.0 且 ≤16K）、重试 3 次
   退避 1s/2s/4s、章级排序权重——均【推断】，实现票/grilling 定案；
4. 报告保留：V1 全保留（对齐 spec:140）还是按 `deferred`/旧章裁剪；
5. 目录名 `semantic-analysis/` 与 schema 是否进 `kernel-schema-draft.ts` 受控增补（Q 编号走
   kernel-schema-decisions 先例）。