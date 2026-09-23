# Spike：墨舟 ×《长生者皆为薪柴》长篇生产系统交叉审查

**日期**：2026-08-29  
**状态**：REVIEW ONLY / NO IMPLEMENTATION  
**目标读者**：Codex / 墨舟维护者  
**范围**：架构审查、缺口识别、Contract Delta建议；本Spike不改业务代码、不改冻结契约、不迁移数据。

---

## 0. 审查目标

将两个已经真实运行/落地的系统进行双向对照：

1. **墨舟 Novel OS 2.0**：以 Story Kernel、Context Compiler、ChapterProductionSession、Continuity Gate、ProposalPort、ChapterCommit、Flywheel 为核心的工程化长篇小说操作系统。
2. **《长生者皆为薪柴》生产系统**：在真实商业连载过程中逐步建立的 Canon / Knowledge / Relationship / Plot / Chapter Ledger、Scene Card、Expectation→Payoff→Upgrade、Post-Draft Audit、Rule Coverage、Failure Memory、Memory Anchor、revision/SHA绑定、fail-closed交稿机制。

本Spike不是要求把第二套系统的 Markdown 文件照搬进墨舟，而是回答：

> **墨舟目前已经解决了哪些问题？《长生者》实践暴露了哪些墨舟尚未一等建模的问题？这些能力应该落在 Kernel、Planning、Runtime、Review、Flywheel、UI 的哪一层？哪些需要 Contract Delta，哪些只需要新增 Capability/Recipe？**

---

# 1. 权威输入

## 1.1 墨舟仓库

Repo：`xiaohai-uid/mozhou`（master）

必须优先阅读：

- `AGENTS.md`
- `CONTEXT.md`
- `docs/specs/chapter-pipeline-spec.md`
- `docs/specs/capability-recipe-schema-v1.md`
- `docs/specs/migration-and-phasing-plan.md`
- `packages/kernel/src/kernel-schema.ts`
- `packages/context-compiler/src/assemble.ts`
- `packages/pipeline/src/steps.ts`
- `packages/pipeline/src/session.ts`
- `packages/pipeline/src/review-step.ts`
- `packages/pipeline/src/gate-step.ts`
- `packages/data-plane/src/chapter.ts`
- `packages/benchmark/src/metrics.ts`
- `packages/flywheel/src/semantic/types.ts`
- `packages/flywheel/src/semantic/analyze.ts`
- `packages/flywheel/src/evaluator/types.ts`
- `apps/web/package.json`
- `apps/web/server/api.ts`
- `apps/web/src/App.tsx`
- `app/package.json`
- `.scratch/mozhou-mvp/contracts/21-章节级续写契约.md`

## 1.2 《长生者皆为薪柴》生产系统

Repo：`xiaohai-uid/changshengzhe-jiewei-xinchai`（main）

重点阅读：

- `PROJECT_RULES.md`
- `LOAD_ORDER.md`
- `MANIFEST.md`
- `quality/WORKFLOW_STATE_MACHINE.md`
- `quality/RULE_COVERAGE_MATRIX.md`
- `quality/POST_DRAFT_AUDIT.md`
- `quality/PUBLICATION_GATE.md`
- `quality/EXPECTATION_PAYOFF_GATE.md`
- `quality/FINAL_DELIVERY_GATE.md`
- `quality/FAILURE_MEMORY.md`
- `quality/NARRATIVE_PATTERN_LEDGER.md`
- `quality/SCENE_CARD_TEMPLATE.md`
- `quality/MEMORY_ANCHOR_SYSTEM.md`
- `tracking/MEMORY_ANCHOR_LEDGER.md`
- `style/STYLE_GUIDE.md`
- `tools/chapter_gate.py`
- `tools/test_chapter_gate.py`
- `.github/workflows/chapter-quality.yml`

注意：这里的 GitHub Actions / Markdown Gate 是为了在 ChatGPT+GitHub 环境里把行为约束变成可执行门禁。**不要默认它们就是墨舟产品内的正确物理实现。**

---

# 2. 已由代码确认的墨舟优势

以下不是建议，是当前实现已经具备的能力。

## 2.1 正典与事务层远强于 Markdown 方案

墨舟已经拥有：

- TemporalFact / KnowledgeState / NarrativePromise / RelationshipState / TimelineEvent；
- Scene 一等实体；
- AuthorIntent 宪法层；
- ChapterCommit 不可变事务；
- contentHash / dependencyManifest / receiptId；
- draft / committed 相位；
- pending-commit 双向恢复；
- Canon Proposal + riskClass；
- ProposalPort 逐条 confirm / reject / editAccept；
- stale / change impact；
- Event Ledger 与 session replay。

**结论**：不要把《长生者》的 JSONL patch / GitHub branch / CI 机制原样搬进墨舟。墨舟应该用自己的事务域模型吸收同一语义。

## 2.2 Context Compiler 已经解决“LOAD是否真实发生”

墨舟的 ContextReceipt 比《长生者》的人工 Context Receipt 更工程化：

- 精确 tokenizer；
- 结构段、召回候选、story text quota；
- inclusion / exclusion 原因；
- activation evidence；
- replayInputs；
- inputsDigest；
- recomputationHash；
- 可重放预算装配。

**结论**：《长生者》的 HOT/WARM/LOAD_ORDER 应被翻译成墨舟的召回/结构注入策略，而不是继续维护一份平行的“必读文件清单”。

## 2.3 ChapterProductionSession 已有真正状态机

现有十步：

`prepare → compile → draft → review → user_edit → final_extract → continuity_gate → canon_proposal → commit → flywheel_record`

已有：

- 全局 single-flight；
- step transition guard；
- hard conflict forward exit关闭；
- crash resume；
- re-submit 新 session；
- 一 session ↔ 一 commit。

**结论**：《长生者》的 workflow markdown 不应成为第二套状态机。

---

# 3. 已确认的核心缺口 / 架构矛盾

## P0-A：当前存在两条产品血脉，长期权威需要明确

### 事实

- 根 `README.md` 仍把 `app/` 描述为主要 Web 应用，技术栈是 Next.js + Postgres/pgvector + Drizzle + one-api。
- `app/package.json` 不依赖任何 `@mozhou/*` workspace 包。
- `pnpm-workspace.yaml` 只包含 `packages/*` 与 `apps/*`，**不包含 `app/`**。
- 新 `apps/web` 明确依赖 `@mozhou/data-plane / pipeline / runtime / kernel`，但目前 UI/API 只覆盖建书、读 Canon State、读 Ledger 等较薄能力。
- 老 `.scratch/mozhou-mvp/contracts/21-章节级续写契约.md` 的续写路径仍是“末尾3000字 + RAG + 风格 + 技能 → SSE → 插入正文”，与 Novel OS 十步事务管线不是同一抽象。
- `docs/specs/migration-and-phasing-plan.md` 又明确把 2.0 的 Phase 6 定义为 Persona UI Integration。

### 风险

如果不先裁权威线，后续“把长篇质量系统接进墨舟”可能会：

- 接进 legacy `app/`，而 Novel OS 2.0 不消费；
- 接进 `packages/*`，但用户实际仍从旧 `app/` 写作；
- 两边各有一套章节状态/上下文/保存语义；
- 测试通过的是一条线，真实使用走另一条线。

### Codex 必答

1. `app/` 当前是 legacy、仍运营产品、还是最终需要迁移的 V1？
2. `apps/web` 是否确定为 2.0 长期 UI？
3. 两者的迁移/退役边界在哪里？
4. 章节级续写 Contract 21 哪些行为应保留为 UI interaction，哪些必须改为调用 ChapterProductionSession？
5. README / workspace / release gate 是否存在权威漂移？

**这项应先于文学质量新功能实施。**

---

## P0-B：Review 目前不是“文学质量门”，与真实写作需求不一致

### 当前实现

- `review-step.ts` 目前只把 phase=draft 正文读取为 `MechanicalReviewInput`。
- `chapter-pipeline-spec.md` 明确冻结：Review 无硬失败；Continuity Gate = 纯机械。
- `gate-step.ts` 只硬判：
  1. schema 行校验；
  2. dependency 引用完整性；
  3. 时间线单调；
  4. POV secret 零泄漏。
- LLM reviewer 明确是 advisory-only，不进入 Gate 判定。
- `SemanticAnalysisReport` 同样明确 MUST-NOT：不裁硬冲突、不改正文、不改 canon、不走 ProposalPort。

### 《长生者》真实生产中暴露的问题

最耗人工的错误往往不是 Canon schema 错误，而是：

- 规则写了但生成时没执行；
- Rolling Outline 被逐项扩写成正文；
- 配角为了剧情临时长技能；
- 主角为了推进突然全知/降智；
- 场景已经表达完，叙述又解释一遍；
- 短句瀑布、报告腔、AI句式；
- 章节任务过载；
- 连续重复同一种破局算法；
- 成长刚兑现就被代价清零；
- 读者一直受压却没有正向期待；
- 记忆点只偶然出现，没有经营；
- 审的是 A 稿，后来改成 B 稿却沿用旧 PASS。

这些错误如果 Review 永远只是 advisory，最终仍需要作者作为第一道检测器。

### Codex 必答

是否需要一次明确 **Contract Delta**，引入“交用户前的 Blocking Literary Quality Review”？

推荐审查以下三种方案，不先假定哪种正确：

#### 方案 1：扩展 Review step，允许受控回环

`draft → review → quality_pass → user_edit`

若 blocking literary finding：

`review → draft_rework → review`

要求：
- 自动/Agent rework 与作者编辑严格区分；
- 有最大自动重试次数；
- 每次重写产生新 draft revision/hash；
- 不覆盖 protected author content；
- 超限后停在 `needs_author`，不无限自修。

#### 方案 2：Review只产结构化质量报告，但 step transition 由 policy guard 阻断

不增加十一步，只给 `review → user_edit` 增加“blocking findings 必须清零/waive”守卫。

问题：谁负责修文？如果只能作者修，仍无法实现“尽量不让作者抓低级错误”。

#### 方案 3：增加独立 Quality Gate

把“文学质量门”与“Continuity Gate”分开。

优点：边界清楚。  
缺点：改变十步冻结契约，成本最大。

**Codex应从现有 ADR/Contract纪律出发选最小正确 Delta，而不是偷塞 Prompt。**

---

## P0-C：需要项目级 Quality Rule Registry，而不是一份超长Prompt

《长生者》的 Rule Coverage Matrix 经真实使用证明了一个问题：

> “规则存在”与“规则被检查”是两件事。

建议墨舟增加一个非 Canon 的项目级质量策略层（名称由Codex定，不要求沿用）：

```ts
QualityRuleDefinition {
  ruleId
  scope            // book | volume | arc | chapter | scene | character | platform
  sourceRef         // author rule / style profile / market brief / failure memory
  version
  applicability
  evaluatorKind     // deterministic | semantic | hybrid
  severity          // advisory | blocking
  evidenceContract
  failAction        // rewrite | replan | block | author_decision
  enabled
}
```

并产生：

```ts
QualityRuleEvaluation {
  ruleId
  ruleVersion
  draftRevision
  draftContentHash
  receiptId
  status            // pass | fail | na | unknown
  evidenceRefs[]
  findingCodes[]
}
```

### 设计原则

- 不能把所有书的规则硬编码进 Kernel。
- 番茄节奏规则、修仙力量成本规则、某个主角的禁忌，都应是 **book-specific policy**。
- deterministic 能机械判的规则才硬算；文学判断可由模型做，但必须留结构化证据。
- `UNKNOWN` 对 blocking rule 必须 fail closed。
- 每条 blocking rule 必须知道“谁负责判断”。

### 与 CapabilityRecipe 的关系

Codex应优先评估：

> 是否可把 Quality Rule Registry 建成 `quality_gate` Capability/Recipe 的项目态输入，而非新增 Kernel 柱？

`CapabilityRecipe` 已有 prechecks、severityPolicy、trackingGate、failure matrix、versioning，这可能是很好的执行载体；但它目前更像“方法论配方”，不等于“每本书动态增长的规则数据库”。

---

## P0-D：Review结果需要绑定“精确稿件版本”，不能只绑定上下文

《长生者》实践中出现过真实失败：

> 审 A 稿 → 改了几段 → 把 B 稿交用户，但旧审查仍被当成有效。

墨舟已有优秀基础：

- draft `revision`；
- immutable ChapterCommit；
- commit `contentHash`；
- ContextReceipt `receiptId/recomputationHash`。

但当前 `SemanticAnalysisReport` 的 anchor 重点绑定 `receiptId/recomputationHash/changeSummaryDigest`，并没有把“被审正文 exact bytes”作为一等锚点。

### 建议 Codex 检查

所有文学 Review / RuleEvaluation 是否应绑定：

- chapterIndex
- prose draft revision
- `draftContentHash`
- receiptId / recomputationHash
- reviewer recipeVersion/model route

然后建立失效规则：

- 只改标点：机械/风格局部检查失效；
- 改对白/段落：相关Style/Voice/Publication规则失效；
- 改事件/动机/知识/能力/关系/章尾：全量文学 Review + Final Extract + Continuity 失效。

不要求照抄《长生者》的粒度，但必须保证：**没有旧报告给新稿发毕业证。**

---

# 4. Kernel 层候选改进（需谨慎，可能需要 Schema Major/Delta）

## P1-A：KnowledgeState 目前不足以表达“怀疑”和“相信但未确认”

当前：

```ts
KnowledgeState {
  factId
  holder
  knownSinceChapter
  knownSinceSceneId?
  distortion?
}
```

它很好地表达：

- KNOWS；
- false belief（通过 distortion）。

但不自然表达：

- SUSPECTS：角色有证据怀疑，但不当事实使用；
- BELIEVES：角色相信某说法，但并未确认；
- UNKNOWN：可由“无行”表达。

《长生者》里这一区别是防角色越权的核心。例如：

> 陈缺确认白骨山用血虫养新人 ≠ 陈缺确认整个修仙世界都是养殖场。

建议Codex评估最小扩展，例如：

```ts
epistemicMode: 'knows' | 'suspects' | 'believes'
```

- absence = UNKNOWN
- `believes + distortion` = FALSE_BELIEF
- `knows` 才允许硬事实驱动

必须评估对 queryActiveFacts、POV slicing、secret gate、旧JSONL迁移的影响。

---

## P1-B：RelationshipState 只有 type + affinity，难以承载长篇真实关系结构

真实长篇常同时存在：

- 信任；
- 恐惧；
- 利益绑定；
- 欠债；
- 控制/把柄；
- 信息差；
- 依赖；
- 隐藏目的。

“关系=盟友/敌人 + affinityScore”会把韩鸦这种“低信任、高利用价值、高控制、高警惕”的关系压扁。

Codex需评估：

1. 是否扩 RelationshipState 多维度；
2. 是否将关系维度建模为专门 temporal assertions；
3. 是否应该留在 character/relationship planning profile 而非 Canon Kernel。

**不要直接加 `metadata:any`。** 服从 AGENTS typed-contract discipline。

---

# 5. 不建议进入 Canon Kernel、但应成为一等质量对象的能力

## P1-C：Memory Anchor / 记忆锚

《长生者》新增后验证的设计：

类型：

- SCENE
- LINE
- BEHAVIOR
- OBJECT
- RELATIONSHIP
- THEME

生命周期：

- PLANTED
- ESTABLISHED
- ECHOED
- RECONTEXTUALIZED
- PAID_OFF
- RETIRED

关键原则：

- 普通章节允许 `NO NEW ANCHOR`；
- 禁止“每章一个金句”；
- 旧锚只有增加新情绪/关系/信息/含义才算 echo；
- 每 Arc 结束前检查：可复述场面、人物强性格瞬间、可回响锚、阶段变化。

建议它落在 **Quality/Planning/Flywheel plane**，链接 Canon source refs，但本身不是世界真相。

需要支持：

- source chapter/scene/span
- owner entity
- anchor type
- lifecycle status
- current meaning
- last echo
- next echo condition
- overuse risk

Context Compiler可把“当前Arc active memory anchors / echo conditions”作为结构或召回候选，而不是全表塞Prompt。

---

## P1-D：Expectation → Payoff → Upgrade / Commercial Rhythm

NarrativePromise 已经能追踪 reader_expectation，但仍缺少对“商业阅读体验”的周期审计：

- 当前读者具体在等什么正向结果？
- 本章是推进、部分兑现还是兑现？
- 主角实际得到什么？
- 收益是否在章末仍存在？
- 代价是否把收益立刻归零？
- 最近奖励是否长期只有“信息”？
- 主角 agency 是否净增长？
- 下一冲突是否从已有收益自然长出？

建议做成 **Derived Quality Projection**，不要写进 Canon Truth。

候选字段：

```ts
ChapterRhythmRecord {
  chapterIndex
  expectationRefs[]
  payoffMode
  rewardTypes[]       // ability/resource/status/access/leverage/impact/info/relationship...
  durableAssets[]
  costTypes[]
  agencyDelta
  rewardZeroed
  driverType
  endingType
}
```

Arc层滚动看最近3—5章，而不是机械“三章一爆”。

---

## P1-E：Narrative Pattern / 破局算法重复

只比较道具/场景不够。

以下换了道具仍属于同一种算法：

- 看别人踩坑 → 得完整答案 → 主角精准通过；
- 隐藏/装弱 → 对方误判 → 无代价脱身；
- 偷听内幕 → 获得答案 → 规避危险。

建议 Semantic Review 输出 `solutionPatternCode` / embedding-like structural label，Flywheel在5章窗口内做重复警报。

这应是 advisory 或 project-policy blocking，不是 Canon 硬事实。

---

## P1-F：Failure Memory / 用户纠错变成回归测试

《长生者》最有价值的生产经验之一：

> 用户指出一次“本来应该被系统拦截的问题”，不能只修当前正文；必须把它变成以后章节的回归项。

墨舟 Flywheel 已有：

- acceptance rate；
- edit ratio；
- model routing evaluation；
- usage/cost/reliability。

但“作者为什么改/为什么拒绝”若只留成字符编辑量，会损失最高价值的语义反馈。

建议新增结构化 correction/rejection reason：

```ts
FailurePattern {
  patternId
  projectId/bookId
  code
  description
  sourceDecisionRef
  mappedRuleIds[]
  detectionStrategy
  active
}
```

例如：

- outline_expansion
- character_toolization
- knowledge_overreach
- short_paragraph_waterfall
- payoff_zeroed
- stale_review_pass
- forced_golden_line

新章Review必须加载 ACTIVE FailurePattern 做回归。

Flywheel可统计“同一FailurePattern再次被作者指出”的复发率。

---

# 6. Semantic Review 报告需要更强证据，而不是只有 message

当前：

```ts
SemanticFinding {
  severity: 'info' | 'warning'
  code
  message
}
```

如果未来它承担真正文学 QA，建议至少评估增加：

- ruleId / ruleVersion
- evidence spans（chapter/scene/paragraph/char range）
- source refs（Canon / Scene / Outline / MemoryAnchor / prior chapter）
- confidence（仅供排序，不替代blocking policy）
- suggestedAction（rewrite / replan / inspect / authorDecision）
- affected dimensions（character/causal/style/payoff/memory/etc.）

这样才能做到：

> PASS/FAIL有证据，而不是“模型觉得人物不够立体”。

---

# 7. Benchmark 建议扩展：从“不断线”到“成书质量”

现有 L1 六指标非常适合机械正确性：Canon Accuracy、Knowledge Leak、Promise Recall、Change Impact Recall、Budget Overflow、Edit Reduction 等。

但长篇质量层还应有**作者标注的golden fixtures**，不要求全部变成绝对数值阈值。

建议新增benchmark场景：

1. Outline Leakage：四个outline任务被逐项翻译为正文；应抓出。
2. Toolized NPC：配角突然拥有刚好解决本章的技能；应抓出。
3. Epistemic Overreach：SUSPECTS被写成KNOWS；应抓出。
4. Payoff Zeroing：重大成长同章被完全抹掉；应抓出。
5. Repeated Solution Pattern：连续三章换皮但同算法；应告警。
6. Memory Anchor Overuse：同一句标志台词机械复读；应告警。
7. Forced Golden Line：场景结束后硬加哲理总结；应抓出。
8. Revision Binding：Review A通过后修改正文B，旧报告必须失效。
9. User Correction Regression：作者标注过的FailurePattern在下一章复发，必须被review抓住。
10. Arc Memory Residue：Arc结束没有任何可复述场面/人物瞬间时给结构警报，但不得强造名台词。

文学benchmark可以是：

- 模型 finding + author labeled expected finding；
- precision/recall；
- blocker false-positive rate；
- user-edit reduction；
- repeat-correction rate。

不要把“爽感=0.82”这类伪精确分数当成硬真相。

---

# 8. 《长生者》里哪些机制不要照搬

1. **不要每章跑GitHub Actions作为产品正文门禁。** 这是ChatGPT环境的外部执行器替代品；墨舟已有 ChapterProductionSession/Commit/ledger，应在应用域内fail-closed。
2. **不要复制Markdown Rule Coverage Matrix为运行时真源。** 应有 typed registry / recipe / report。
3. **不要复制Canon JSONL patch迁移策略。** 墨舟已有不可变commit+event replay+state compaction。
4. **不要把“番茄/200万/修仙”规则写成平台全局规则。** 它们属于Book/MarketBrief policy。
5. **不要要求每章产生记忆点。** `NO NEW ANCHOR`必须合法。
6. **不要让LLM文学审查直接改Canon。** 它只能驱动草稿rework/作者决策；Canon仍走Proposal/Commit。
7. **不要把Author Intent、MarketBrief、Quality Rules混成一个system prompt。** 保持来源、版本、优先级与证据链可追踪。

---

# 9. 推荐的分层目标形态（供Codex挑战，不是已拍板设计）

```text
AUTHOR / PROJECT POLICY
  AuthorIntent
  QualityPolicyProfile
  Platform/MarketBrief
  FailurePatterns
  MemoryAnchors
        ↓
PLANNING
  OutlineGraph / Scene
  Expectation-Payoff state
        ↓
CONTEXT COMPILER
  deterministic recall + budget + Receipt
        ↓
DRAFT
  candidate revision/hash
        ↓
LITERARY QUALITY REVIEW
  applicable rules
  deterministic prechecks
  semantic evidence findings
  failure regression
  memory/payoff/pattern audit
        ↓
  [blocking fail] controlled draft rework
        ↓
USER EDIT / AUTHOR DECISION
        ↓
FINAL EXTRACT
        ↓
CONTINUITY GATE (继续保持确定性硬真相门)
        ↓
CANON PROPOSAL / COMMIT
        ↓
FLYWHEEL
  acceptance/edit ratio
  correction reasons
  recurrence
  model/recipe evaluation
```

核心思想：

> **“文学质量门”与“Canon真相门”分层。前者可以使用语义模型并驱动草稿重写；后者继续保持确定性/作者确认，不让模型把主观判断写成世界真相。**

---

# 10. Codex 审查任务

请在**不修改业务代码**的前提下完成以下工作。

## A. 代码事实核验

逐条核验本Spike §2—§7 的判断：

- `CONFIRMED`
- `PARTIALLY_CONFIRMED`
- `INCORRECT`
- `ALREADY_IMPLEMENTED_ELSEWHERE`

每条必须给**具体文件/符号/测试**证据。

## B. 找到遗漏的已有能力

特别检查：

- 是否已有项目级 quality rule registry；
- 是否已有文学blocking review，只是本Spike没读到；
- 是否已有 review↔draft 自动/受控回环；
- 是否已有 Memory Anchor 等价物；
- 是否已有 Failure Memory/作者纠错原因结构化存储；
- 是否已有 Expectation/Payoff/Agency projection；
- 是否已有 richer epistemic state；
- 是否已有 Relationship 多维模型；
- `app/` 与 `apps/web` 的实际迁移状态。

## C. 输出 Gap Matrix

至少列：

| Capability | 墨舟当前 | 《长生者》实践 | 是否需要 | 最佳落层 | 是否Contract Delta | 优先级 |
|---|---|---|---|---|---|---|

## D. 给出三档方案

### Minimal

尽量只用现有 CapabilityRecipe / Semantic Analysis / Flywheel 增补，不改 Kernel major、不改十步顺序。

### Balanced

允许受控 Contract Delta，把文学QA真正变成交用户前的fail-closed层；尽量保持Continuity Gate纯机械。

### Full

允许 Kernel/Review/UI/Benchmark系统性升级，但必须说明迁移成本和为什么值得。

每档写：

- 用户收益；
- 代码改动面；
- 数据迁移；
- 契约/ADR变更；
- 回归风险；
- 测试策略。

## E. 明确推荐

只选一个作为推荐方案，并说明：

1. 为什么它最适合“百万字商业长篇生产”；
2. 为什么不会把墨舟过度设计成一个巨大规则引擎；
3. 怎样让用户只负责“好不好看/要不要这样写”，而不是人工抓系统漏规则。

## F. 如需实施，先输出票据拆分，不直接实现

按 UVSD：

- 一个ticket一个可观察能力；
- 先 Contract Delta / ADR，再实现；
- 列依赖；
- 每票给验收测试；
- 不跨票重构。

---

# 11. 初步优先级（待Codex挑战）

### P0

1. 裁清 `app/` vs `apps/web` / Novel OS 2.0 权威与迁移路径。
2. 解决“Review advisory-only，无法在交用户前强制文学QA”的产品缺口。
3. 建项目级 Quality Rule Registry / Evaluation evidence，不把规则塞成大Prompt。
4. 所有文学Review绑定 exact draft revision + content hash，并在编辑后正确失效。

### P1

5. richer Knowledge epistemic mode（KNOWS/SUSPECTS/BELIEVES；absence=UNKNOWN）。
6. Relationship richer state 的最小正确建模。
7. Memory Anchor lifecycle。
8. Expectation/Payoff/Upgrade + durable asset/agency projection。
9. Failure Memory / structured correction reason / regression。
10. Narrative Pattern重复检测。
11. SemanticFinding 证据span与rule映射。

### P2

12. 文学质量benchmark与author-labeled fixture。
13. MarketBrief把平台经验变成book-specific policy建议，而非全局硬规则。
14. Pro Studio展示：Quality Findings / Memory Anchors / Current Expectation / Failure Regression / Canon Gate分层可见。

---

# 12. 成功标准

最终墨舟应该能做到：

- **Canon错**：确定性Gate拦。
- **角色知道了不该知道的事实**：Knowledge/Continuity拦。
- **规则存在但本章没执行**：Rule Coverage/Review orchestration拦。
- **审A稿交B稿**：revision/hash binding拦。
- **作者曾纠正过的同类错误再次出现**：Failure Regression优先抓。
- **连续信息奖励、爽点归零、破局算法重复**：短周期Quality Projection告警/按项目策略阻断。
- **名场面/人物记忆点**：被追踪和增值，但不逼每章造金句。
- **用户**主要判断“这章我喜不喜欢、这个人物我喜不喜欢、下一步想看什么”，而不是替系统做低级规则验收。

同时保持：

- Author Intent受保护；
- 语义审查不能直接写Canon；
- Continuity truth gate不被主观分数污染；
- 所有重要决定有证据、版本和可回放记录；
- 不为文学QA破坏墨舟已经建立的事务与恢复正确性。
