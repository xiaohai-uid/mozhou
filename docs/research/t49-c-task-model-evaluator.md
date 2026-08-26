# t49-c 研究：TaskModelEvaluator 消费面与能力演化信号

> 票源：#49（wayfinder:research）· 地图：#46（Phase 4 数据飞轮 V1）· 姊妹篇：t47-a / t48-b / t50-d
> 文件名沿 #30 先例「docs/research/t<本票号>-*.md」（#46 Notes 亦同），字母 c 为四研究票组内序。
> 纪律：本票只读不改码。证据链——repo 引用 `文件路径:行号`（相对 repo 根）；规格引用 `文档名 §章节`；无法实证处标注【推断】。

## 0. 结论摘要

1. **四个消费源两两成对**：「运行态」信号（谁被选用、作者接不接受、改多少、花多少）已由账本事件面 + usage.jsonl 承载；「基准态」信号（机械质量地板 + 版本对比）已由 T20 六指标判定器 + M14 版本矩阵承载。TaskModelEvaluator 不需要新造测量面——它是一个**只读投影器**。
2. **真正缺口共四条，全部是字段级/接线级**（§1.6）：G1 recipeSnapshot 未接线进生产 GenerationStarted；G2 usage 行缺 taskType/recipeVersion；G3 全链路无 latency 捕获点；G4 acceptance 分母口径。G1-G3 归 #50 受控增补裁决，G4 由本票给出口径（§1.6 末）。
3. **推荐评价单元 cell = (taskType × route(providerId,model) × recipeVersion)**；输出信号六类（§2.2）；触发阈值五规则（§2.3，数值为建议默认，grilling 拍板）；防过拟合四件套（§2.4）。
4. **Benchmark L1 判定器的角色是资格门**：先机械门禁筛出合格路由，再用偏好/经济信号在合格集内择优——顺序不可倒置（ADR-0008：升级必须数学证明平价或改进）。
5. **边界契约：只建议不自动改路由**（§4）：评估器永不写 settings.yaml；建议物 RoutingSuggestion 为冻结形状纯数据，作者确认后走既有 loadTierConfig 校验+热加载生效。

## 1. 输入面盘点

### 1.1 usage.jsonl（T19 Flywheel Record 步落账面）

- 落点 `.mozhou/usage.jsonl`（packages/pipeline/src/record-step.ts:23），append-only JSONL、运行时区非 canon 不参与对账（record-step.ts:9-12）；读侧 entryId 先到先得去重、撕裂行跳过（record-step.ts:180-203）；异步回灌行必须 derived=true 且带 derivedFrom，宁败不猜（record-step.ts:150-157,171-174）。
- UsageRecord 冻结形状（record-step.ts:36-52）：entryId / taskRef / chapterIndex / commitId / kind(usage|cost) / derived / provider? / model? / inputTokens? / outputTokens? / costMicros? / at?。
- FlywheelRecorded 收尾事件成败都落账，payload = {outcome: succeeded|state_degraded, commitId, recordedCount}（record-step.ts:126-137）；记账失败不阻断正文（chapter-pipeline-spec.md §S12，L94-96）。
- **够用度**：成本/token 维度齐备；缺 taskType、recipeVersion、latencyMs（→G2/G3）。

### 1.2 账本事件面（kernel 单真源词表）

词表 14 事件（packages/kernel/src/domain-events.ts:19-34），成对约束三组（domain-events.ts:47-51）。DomainEvent 本体无时间戳字段（domain-events.ts:38-44）——latency 无法从账本回放推出，只能靠调用方显式捕获（→G3）【形状实证】。

对本票有效的三类行：

- CandidateCreated{candidateId, level, chars}（packages/pipeline/src/multi-candidate.ts:70-80）；呈现即落账，原文不入账只入元数据（multi-candidate.ts:12-15）。
- UserEditRecorded 两形态（packages/pipeline/src/user-edit-step.ts:226-238）：
  - action='candidate_decision'：acceptedOptionIds / rejectedOptionIds 双路同账才构成有效飞轮信号（multi-candidate.ts:101-116，单路信号机械拒绝）；
  - action='edit_blocks'：结构化操作块 insert/delete/replace × 行闭区间（user-edit-step.ts:65-71），payload 带 level/source/blocks/revision。
- GenerationStarted/Finished 配对 + TaskAttemptRegistered：payload.snapshot = {taskType, capability, providerId, providerVersion}（packages/runtime/src/engine.ts:113-127）；降级成功时快照反映实际服务的 provider（engine.ts:152-158）。

### 1.3 T20 六指标 L1 判定器 + M14 版本矩阵钩子

六指标与 ADR-0008 门限（packages/benchmark/src/types.ts:11-39）：CANON_ACCURACY≥0.99 / KNOWLEDGE_LEAK_RATE≤0 / PROMISE_RECALL≥1 / CHANGE_IMPACT_RECALL≥1 / CONTEXT_BUDGET_OVERFLOW≤0 / USER_EDIT_RATIO_REDUCTION>0；全纯函数零时钟零 LLM（packages/benchmark/src/metrics.ts:7）。聚合语义（packages/benchmark/src/run.ts:104-137）：章级五指标按 case 均值；USER_EDIT_RATIO_REDUCTION 是**运行级跨版本指标**，baselineEditCount/currentEditCount 由调用方供给（run.ts:66-68）；空夹具宁败不造数（run.ts:105-107）。BENCHMARK_VERSION='0.1.0'（types.ts:8）。

版本矩阵（packages/benchmark/src/version-matrix.ts:31-54）：matrixRowFor(report, generationStartedPayload) → {recipeVersion|null × benchmarkVersion × metrics} 行；recipeVersion 读自 payload.recipeSnapshot.recipe.recipeVersion 三级收窄路径，任一级缺面返回 null（version-matrix.ts:22-29）。

**关键发现（G1）**：M14 钩子两端就位、中段未接线——toGenerationStartedPayload 产出快照载荷（packages/runtime/src/recipe/loader.ts:209-213），readRecipeVersionFromPayload 消费之，但生产链路 engine.execute 发布 GenerationStarted 时 payload 只有 {snapshot}（engine.ts:123-127）；全仓 recipeSnapshot 引用仅在 loader 工具与测试（grep 实证：version-matrix.test.ts / runtime/src/recipe/recipe.test.ts）。⇒ **当前账本没有任何行携带 recipeVersion**。

### 1.4 Recipe trackingGate 七件套与 loading 语义

七件套整槽缺一即拒（packages/runtime/src/recipe/types.ts:112-132；schema packages/runtime/src/recipe/schema.ts:133-177）：authorityState / casField / transactionModes / derivedViews / budgets(hotContextBytes, perChapterReads) / failureTaxonomy(validationFailed|writeFailed|drift) / hookPoint(preWrite|postWrite|none)。

loading 管线 fail-fast 五步（packages/runtime/src/recipe/loader.ts:65-106）：约定存放位 `<baseDir>/<id>.recipe.yaml`（loader.ts:154-162）→ YAML 解析 → schemaVersion 不认识即拒（compatibilityPolicy='none' 零兼容承诺，loader.ts:73-87）→ JSON Schema 全量校验 → sizeBudget target≤max 语义校验 → retiredPaths 命中即拒载。recipeVersion 独立 semver 自由演进（types.ts:145-146）。

对本票的意义：(a) 能通过加载的配方其 id+recipeVersion 身份可信且唯一，可放心当聚合键；(b) recipe.contextBudget 是 CONTEXT_BUDGET_OVERFLOW 的配额轴（run.ts:41-43 已声明）；(c) trackingGate 是静态自描述义务而非运行信号源——进 evaluator 的方式是随 recipeSnapshot 作为 cell 的静态维度，不单独产指标【推断】。

### 1.5 tier 路由配置（建议物的落点，非消费源）

两级映射 task_type → tier 名 → (providerId, model[, api_key_ref])（packages/runtime/src/tierConfig.ts:13-22）；YAML 单文件 ~/.mozhou/settings.yaml（docs/specs/runtime-capability-spec.md §6 L104-121）；mtime 热加载缓存（tierConfig.ts:59-60,189-221）；明文密钥解析期拦截（tierConfig.ts:86-103）；tier 间接层隔离模型市场漂移（runtime-capability-spec.md §6 L118）。这是 TaskModelEvaluator 建议要改的文件——但评估器自己不写它（§4）。

### 1.6 缺口清单与口径补丁

| # | 缺口 | 实证 | 影响 | 归属 |
|---|---|---|---|---|
| G1 | 生产 GenerationStarted 不携带 recipeSnapshot | engine.ts:123-127 vs loader.ts:209-213 | per-recipe 聚合无主键 | 实现小票接线 + #50 登记 |
| G2 | UsageRecord 缺 taskType/recipeVersion | record-step.ts:36-52 | cell 归因需跨表 join 且仍缺 recipe 轴 | #50 受控增补 |
| G3 | 无 latency/tokens-out 捕获点 | domain-events.ts:38-44 无时钟域；usage.at 可选 | 效率信号缺半边 | #50（建议 Record 步传入实测耗时） |
| G4 | acceptance 分母：无候选决策的章无偏好行 | 词表无对应事件 | acceptance_rate 口径悬空 | 本票口径见下 |

**口径拍板建议（G4）**【推断】：

- acceptance_rate 仅在有多候选择优的窗口上定义（分母 = 该 cell 内 candidate_decision 数），不做「无决策 = 隐式接受」的全章摊派——V1 多候选是显式触发动作（multi-candidate.ts:55-57 要求 ≥2 选项），未触发章摊入分母会稀释信号并混入 UI 曝光噪声；
- edit_ratio 在所有走完 user_edit 步的章上定义：Σblocks 覆盖行数 ÷ 章正文总行数（blocks 结构化可精确折算，user-edit-step.ts:65-71）；无 UserEditRecorded 的 committed 章记 0 而非缺数据——「一字未改」本身就是正信号；
- 按 cell 聚合时以 taskRef 对齐同窗（十步共享一个 taskRef，packages/pipeline/src/steps.ts:11 起 PIPELINE_STEPS 单窗推进；FlywheelRecorded 与 CanonCommitted 同事务序顺排不变量有测试钉死，packages/pipeline/src/nine-boundaries.test.ts:436-440）。

## 2. 输出信号：集合、阈值与防过拟合

### 2.1 评价单元

cell := (taskType, providerId, model, recipeVersion)。taskType/route 取自 GenerationStarted.snapshot（engine.ts:117-122），recipeVersion 取自 G1 接线后的 recipeSnapshot；usage/edit/decision 行经 taskRef join 进 cell（§1.6 口径）。

### 2.2 信号集合（六类）

| 信号 | 来源 | 方向语义 |
|---|---|---|
| S1 acceptance_rate | candidate_decision（§1.6 口径） | 作者偏好，越高越好 |
| S2 edit_ratio | UserEditRecorded blocks 折算（§1.6 口径） | 改写负担，越低越好 |
| S3 六指标 gate 通过率 | T20 判定器 METRIC_GATES（types.ts:32-39） | 机械质量地板 |
| S4 USER_EDIT_RATIO_REDUCTION | benchmark 运行级（run.ts:128） | recipe 迭代净收益 |
| S5 经济性 | usage.costMicros/outputTokens/inputTokens | 千字成本、token 效率 |
| S6 可靠性 | TaskAttemptRegistered 密度、GenerationFinished 失败态、FlywheelRecorded outcome=state_degraded 计数 | 降级/失败频率 |

### 2.3 触发阈值（建议默认值，grilling 拍板；本节规则数值均为【推断】）

- R1 资格门前置：候选路由最近一次基准运行六指标 gate 全过，否则一票否决——无论偏好信号多好（ADR-0008 Consequences：升级必须数学证明平价或改进）。
- R2 最小样本：acceptance 样本 ≥30 个 decision 且 ≥5 个独立章窗口方产生 suggest；不足则输出 insufficient_sample 观察条目。
- R3 区间优势：challenger 的 Wilson 95% 下界 > incumbent 的 Wilson 95% 上界（对 S1），**且** S2 相对降幅 ≥10%——双条件同时满足，防单指标误判。
- R4 滞后确认：优势须连续两个观测窗口保持（建议各 ≥14 天或 ≥20 新样本）；首窗口只产 watch 条目。
- R5 单变量：一次建议只动一个 cell 的一个 tier 叶子，providerId+model 成对整体替换（尊重 TierRoute 复合键，tierConfig.ts:13-19）。多 cell 同时恶化 incumbent 时按（优势宽度×样本量）排序逐个出建议。

反向信号（demote 建议）：incumbent 连续两窗口跌破资格门（R1 失败），或 S6 失败率 ≥2× 既有基线且 n≥10 → 出回退建议，同样只建议不改。

### 2.4 防过拟合四件套

1. 最少样本量（R2）：低于阈值一律不出建议。
2. 置信区间判据（R3）：Wilson 区间代替裸均值比较，小样本高方差天然被压住。
3. 双轨对比（影子期）：建议基于历史自然流量生成；实施后新旧 route 至少并行观测一个窗口再复评。V1 单机单作者的现实形态 = 时间切窗先后对比 + CASE 回归守护【推断：书内层 routing.yaml 覆盖机制在 V1.5 后可按书真双轨，runtime-capability-spec.md §6 L119】。
4. 基准回归守护：任何 promote 建议附 CASE-NNNN 回归要求（ADR-0008 §3）：落地前在基准夹具复跑六指标并留矩阵行（matrixRowFor，version-matrix.ts:47-54），证明不低于基线。

## 3. 与 Tier 2 Capability Evolution 的关系

规格锚：data-flywheel-spec.md §3.2（Tier 2 三机制：T2A Recipe Benchmarking / T2B Context Policy Debugging / T2C Task-Model Router）；CONTEXT.md:255-257（Capability Evolution = 按 acceptance rates 与 edit ratios 对 capability/recipe 版本的实证追踪）。TaskModelEvaluator 即 T2C 的本地实现，同时给 T2A 供给矩阵行。

### 3.1 双维度四象限（acceptance_rate × edit_ratio）

| | 低 edit_ratio | 高 edit_ratio |
|---|---|---|
| 高 acceptance | 强 cell：维持现状 | 口味对但费手：修 recipe 层（提示词/上下文策略），不是换模型 |
| 低 acceptance | 候选平庸但省事：优先评估换 route/model | 弱 cell：route 与 recipe 双查 |

判读规则【推断】：S1 主导「要不要换模型」（偏好对模型差异最敏感），S2 主导「要不要改 recipe」（改写负担多来自生成风格错位，归 t48-b/t47-a 的学习面）；两者背离时以 R1 资格门与 CASE 回归兜底。

### 3.2 Benchmark L1 判定器的三重角色

- **资格门**（R1）：机械六指标是硬地板，偏好信号只在地板之上分辨优劣；KNOWLEDGE_LEAK_RATE=0 这类恒 0 目标无商量余地（types.ts:34-37）。
- **收敛孪生**：USER_EDIT_RATIO_REDUCTION 是 S2 的基准态孪生——线上 edit_ratio 改善必须能在基准夹具上复现，否则视为噪声（防止把作者状态波动学成路由结论）。
- **回归网**：T2B 把真实连续性事故固化为永久 CASE（data-flywheel-spec.md §3.2 *Context Policy Debugging*；ADR-0008 §3）；evaluator 的每条建议必须声明不打破现有 CASE 集。

## 4. 边界契约：只产出建议，不自动改路由

### 4.1 建议物冻结形状（实现票直写）

```ts
interface RoutingSuggestion {
  suggestionId: string;                 // 'sug_' + ULID（铸法同 record-step.ts:87）
  createdAtUtc: string;                 // 注入时钟 nowUtc（同 run.ts:69 先例，禁 Date.now）
  cell: { taskType: string; providerId: string; model: string; recipeVersion: string | null };
  kind: 'promote' | 'demote' | 'watch';
  proposedRoute: { providerId: string; model: string };  // api_key_ref 归作者配置侧补
  basis: {
    sampleSize: { decisions: number; chapterWindows: number };
    challengerAcceptanceWilson: [number, number];
    incumbentAcceptanceWilson: [number, number];
    editRatioDeltaPct: number;
    benchmarkGatePassed: boolean;
    matrixRowRef: string | null;        // 关联 VersionMatrixRow（version-matrix.ts:32-38）
  };
  status: 'sufficient_sample' | 'insufficient_sample';
}
```

### 4.2 生效路径（人工确认闭环）

1. 评估器产出 report（纯数据，可渲染确认面——ProposalPort 统一确认面先例，chapter-pipeline-spec.md §3 Q6.1/Q6.2 行 L108）。
2. 作者确认 ⇒ 人为编辑 ~/.mozhou/settings.yaml（或确认命令代写）：既有 loadTierConfig 机械校验 + mtime 热加载使其即时生效（tierConfig.ts:189-221；runtime-capability-spec.md §6 L120）。**不需要新建写入通道——校验器本身就是安全栏**。
3. 变更后首窗口强制 watch 态复评（R4 滞后）；劣化即出 demote 建议。

### 4.3 纪律对齐

- UVSD §1.2：未经批准旅程不实现能力——自动改路由无旅程背书，「作者审阅后生效」有。
- 工程原则 3（分层生长）：最小端到端版本 = 只读投影器 + 报告，学习闭环后置。
- L1 纪律：评估器本体纯函数、零时钟（nowUtc 注入）、零外部服务，与 T20 判定器同界（types.ts:4）。
- 隐私边界：全程本地 P1/P2 面；若未来匿名上报仅聚合值出域（data-flywheel-spec.md §2 P2 行 L15；ADR-0005 Privacy Tiering）。

## 5. 开放问题（移交 grilling）

1. G1 接线归属：随 Phase 4 实现票一并做，还是先行独立小票？（依赖 #50 对事件面的总体裁决）
2. 建议是否入账：新增 RouteSuggestionIssued 事件（词表受控增补，#50 一并裁决）vs 纯文件 .mozhou/suggestions.jsonl 不入真源账本。【本票倾向后者：建议是派生面，随时可由账本重算】
3. R2-R5 数值默认值的拍板（本文给出的是有依据的首版建议值）。
4. 双轨影子期在 V1 全局单飞 + 单作者下的执行形态（时间切窗 vs V1.5 书内覆盖层真双轨）。
5. 包位：建议新建 packages/flywheel 容纳三个 learner（t47-a / t48-b 同址）——pipeline 是十步编排域、learner 是离线投影域，混居破坏模块边界【推断】。

## 附 A：关键证据索引

- usage 落账：packages/pipeline/src/record-step.ts（全文件已引）
- 事件词表：packages/kernel/src/domain-events.ts:19-51
- 编辑/候选信号：packages/pipeline/src/user-edit-step.ts:65-71,226-238；packages/pipeline/src/multi-candidate.ts:50-116
- 引擎事件：packages/runtime/src/engine.ts:113-159
- 六指标：packages/benchmark/src/metrics.ts（六 judge 函数）；types.ts:8-48；run.ts:64-137
- 版本矩阵：packages/benchmark/src/version-matrix.ts:15-54
- Recipe 七件套与装载：packages/runtime/src/recipe/types.ts:112-146；schema.ts:133-177；loader.ts:65-106,154-213
- tier 路由：packages/runtime/src/tierConfig.ts:13-63,189-221；docs/specs/runtime-capability-spec.md §6
- 规格：docs/specs/data-flywheel-spec.md §2/§3.2/§3.3/§4；docs/specs/chapter-pipeline-spec.md §S12(L94-96)、§3(L108)；docs/adr/0005-policy-flywheel-and-privacy-tiering.md（7-Tier Engine Tier 4=Task-Model Router）；docs/adr/0008-evaluation-engine-as-first-class-system.md §2/§3；CONTEXT.md:245-265

## 附 B：与姊妹票的分工边界

- t47-a（AuthorPreferenceLearner）：S1/S2 的**学习侧**（EMA/Bayes 更新、特征提取）——本票只定义**评价侧**口径与阈值。
- t48-b（StyleLearner）：StyleProfile 演化协议；其问题 4 引用的 USER_EDIT_RATIO_REDUCTION 收敛指标即本票 S4/S2 孪生关系。
- t50-d（EventLedger 供给面）：G1/G2/G3 受控增补的唯一裁决场，本票 §1.6 缺口表是其直接输入。

— 完 —
