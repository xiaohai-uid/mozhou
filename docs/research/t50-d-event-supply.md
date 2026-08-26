# t50-d · EventLedger 供给面完备性研究（三个 learner 的事件需求）

> 票：#50（Phase 4 数据飞轮 · Wayfinder 研究 d 号）· 地图 #46 · 2026-08-24
> 方法：独立推演三 learner 信号需求（不等 R1-R3 结果），逐条对照 kernel/domain-events.ts 单真源与各发射点代码。
> 证据纪律：repo 引用 = 文件路径:行号；规格引用 = 文档:章节；无法实证处标注【推断】。

---

## 0. 结论速览

1. **词表本体喂得动**：DOMAIN_EVENT_TYPES 14 词条（domain-events.ts:19-34）覆盖三 learner 的 V1 信号类型面；缺口**全部在 payload 携带面与命名空间桥接**，不需要增删词条、不需要动 EVENT_PAIRS（domain-events.ts:47-51）。
2. **结构性发现：账本里有两个互不相连的 taskRef 命名空间**。会话窗事件（UserEditRecorded/FlywheelRecorded 等）用 session taskRef；引擎执行事件（GenerationStarted/Finished/TaskAttemptRegistered）用 engine.execute 内部另铸的 taskRef（engine.ts:114），且不带 chapterIndex。**今天没有任何账本内字段把两者连起来**——per-model/per-recipe 的接受率与改写率在账面上不可计算。
3. 受控增补提案 **3 个**（P1 执行事件桥接 / P2 编辑 delta 规模与删除侧文本 / P3 生成时长），全部 payload 层或既有可选字段层，零词表变更；另 4 项缓议/不做（§6）。

---

## 1. 现状盘点：事件供给全景

### 1.1 任务事件行（PublishBus 单口，{seq, event} 格式）

| 事件 | 发射点 | payload 关键字段 | 证据 |
| --- | --- | --- | --- |
| CandidateCreated | presentCandidates | candidateId, level(cursor\|selection), chars | pipeline/src/multi-candidate.ts:70-80 |
| UserEditRecorded{candidate_decision} | recordCandidateDecision | acceptedOptionIds[], rejectedOptionIds[], level | multi-candidate.ts:138-148 |
| UserEditRecorded{edit_blocks} | recordUserEdit | blocks[{op,paragraphStart,paragraphEnd,replacementText}], source(author\|assistant), level, revision | pipeline/src/user-edit-step.ts:226-237, 65-71 |
| FlywheelRecorded | runFlywheelRecord | outcome(succeeded\|state_degraded), commitId, recordedCount, errorDetail? | pipeline/src/record-step.ts:126-137 |
| CanonCommitted | session.markCommitted | commitId, ...自由 payload | pipeline/src/session.ts:292-297 |
| TaskFinished | session.finish | outcome:'succeeded'（仅完成态可达） | session.ts:308-313 |
| CandidateDeltaExtracted | runFinalExtract | outcome, counts(四族), revision, errorDetail? | pipeline/src/extract-step.ts:126-136 |
| GenerationStarted | engine.execute | {snapshot: ResolutionSnapshot}——**仅此一项** | runtime/src/engine.ts:123-127 |
| GenerationFinished | engine.execute | 成功 {outcome,providerId}；terminal +reason；recoverable +triedProviders | engine.ts:154-158, 165-169, 176-184 |
| TaskAttemptRegistered | engine.execute（fallback 每次） | {providerId, reason} | engine.ts:137-141 |

ResolutionSnapshot = {taskType, capability, providerId, providerVersion, tier?, provider?, model?}（kernel-schema.ts:559-568）。M14 缝 toGenerationStartedPayload 可把配方快照并进同槽（runtime/src/recipe/loader.ts:203-213；共存形态仅测试构造，runtime/src/recipe/recipe.test.ts:267-272——**生产链路未接线**）。

### 1.2 平铺领域行（先于 runtime 存在的写入方，原样保留）

ContextCompiled 指针行：{type, seq, at, receiptId, taskType, chapterIndex?, recomputationHash, totalTokens, storyTextQuota, entryCount}（context-compiler/src/receipt-file.ts:99-131；ADR-0021 指针纪律）。ChapterCommitted 同为平铺行（pipeline/src/ledger.ts:7-8）。

### 1.3 伴生投影：usage.jsonl（T19）

UsageRecord = {entryId, taskRef(会话侧), chapterIndex, commitId, kind(usage\|cost), derived, derivedFrom?, provider?, model?, inputTokens?, outputTokens?, costMicros?, at?}（record-step.ts:23, 36-52）。注意：usage 行挂**会话** taskRef，与账本任务行可直接 join；provider/model 由调用方经 UsageFact 供给。

### 1.4 两个读面（兼容性关键地形）

- runtime readStoredLines：只取任务行，撕裂行跳过，平铺行显式跳过防干扰配对/投影（runtime/src/eventBus.ts:30-65，注释 54-56）。
- pipeline readPipelineLedger：双格式都读，kind:'task'\|'domain' 判别；**position 为唯一权威时序**（平铺行 seq 0 起 vs 任务行 1 起，跨格式禁 seq 算术）（pipeline/src/ledger.ts:13-14, 21-24）；DomainEvent 逐字段重建、payload 整体透传（ledger.ts:56-63）。

---

## 2. 三个 learner 的信号需求推演（对照账面）

### 2.1 AuthorPreferenceLearner（R1 · #47）

需要：① 显式偏好对（选 B 弃 A/C，双路同账）；② 编辑隐式信号（改了什么/删了多少/删了什么）；③ 噪声治理所需的呈现上下文（候选顺序、来源通道）。

账面对照：
- ① 已满足且质量高：accepted/rejected 双路强制同账、id 必须可回溯到 CandidateCreated（宁败不猜），机械校验挡单路假信号（multi-candidate.ts:110-136；ADR-0013:13-16 的主偏好信号设计）。
- ③ 半满足：呈现顺序可由**同 taskRef 的 CandidateCreated 行序**推导（presentCandidates 按入参序串行 publish，multi-candidate.ts:69-83；PublishBus 单实例串行 append，eventBus.ts:73-76 注释 + 107-111），无需新字段；level 两级动作位在账。
- ② **有洞**：编辑块的插入侧文本（replacementText）入账，但**被删除/被替换的原文本不入账**——applyEditBlocks 后旧正文被 atomicReplace 覆盖、无任何快照留存（user-edit-step.ts:211-219；草稿 phase 内 revision 只在 frontmatter 步进）。作者"删了什么"是 Tier-1/Tier-2 最强的负向风格信号（ADR-0005:25「abstracting edits into style delta rules」；data-flywheel-spec.md:53 明列 prose deletions 为数据源；ADR-0007(novel):20 对 UserEditRecorded 的原始设想就是「diffs between candidate and user final text」——两侧都要）。现状只有半边 diff。

### 2.2 StyleLearner（R2 · #48）

需要：按场景型（action/dialogue/romance_emotion/exposition_worldbuilding，kernel-schema.ts:322-326）分面的编辑 delta 流；EMA 更新的量化输入（句长/对话比等，StyleProfile 字段 kernel-schema.ts:337-345；α=0.05 ADR-0012:22）。

账面对照：
- 编辑块携带行区间+操作语义+新文本，终稿侧特征（句长分布/对话比）可在 learner 侧从 blocks+replacementText 提取——够用，不该由账本预计算（避免把学习算法焊进发射端）。
- 场景型标签：**任何事件都不带 scenarioType**。归属裁决属 #48 研究范围（分类器在发射端还是学习端未定），本票只在 §6 给出预留槽位建议供 grilling 一并拍板。
- 删除侧文本缺失同 2.1-②（学「作者删掉抽象心理独白」这类内容级信号必须见原文，纯计数不够）。

### 2.3 TaskModelEvaluator（R3 · #49）

需要：按 (model/provider × recipe 版本 × 任务型) 聚合的结局指标——接受率、edit_distance_ratio、token/latency、六指标门（benchmark/src/types.ts:11-18, 32-39；版本矩阵钩子 benchmark/src/index.ts:45-46；规格锚 data-flywheel-spec.md:82-104、ADR-0005:20 P2 清单）。

账面对照：
- 结局面（接受/拒绝/edit_blocks 有无）：会话行，✓。
- token/cost：usage.jsonl 按 commitId/taskRef join 会话行，✓（record-step.ts:88-92 盖章即会话侧）。
- provider/model 身份：GenerationStarted.snapshot.providerId ✓——**但在另一个 taskRef 命名空间**：engine.execute 自铸 taskRef（engine.ts:114）、发布时不带 chapterIndex（engine.ts:123-127），runDraftStep 传进的 recipeId/recipeVersion 只进 provider 业务 payload、**不落账**（draft-step.ts:324-330 进 execute；engine 丢弃，只发 {snapshot}）。t17 测试明证两族事件「同账并存」（pipeline/src/t17-pipeline.test.ts:109）。
- 现有代码已在用「取最近一条 GenerationFinished」这种邻接启发式兜底（draft-step.ts:241-251，靠 S11 全局单飞才成立）——分析型离线消费不可依赖此耦合【推断：重提交全量重走（T19）下一窗多对生成时，「最近一对=被提交那对」只是大概率而非不变式】。
- latency_ms：**全仓零记录**（grep 'latency' 于 packages 零命中）；规格 P2 明列 token latency（data-flywheel-spec.md:99、ADR-0005:20）。
- context policy 维度：经 ChapterCommit.receiptId（kernel-schema.ts:500）→ ContextReceipt.replayInputs.configVersion/tokenizerVersion/modelProfileId（kernel-schema.ts:432-445）可得，账本侧 ContextCompiled 平铺行也带 receiptId——join 链存在 ✓。

---

## 3. 票面三问直答

**Q1 候选决策是否需带选项排序/分数？——排序不需新增字段；分数不做。**
排序：同 taskRef 行序即可靠推导（§2.1-③ 证据链），加 presentedOrder 属冗余投影（工程原则 2：最简实现）。分数：当前不存在任何打分产生源（CandidateOption 只有 id/text，multi-candidate.ts:23-26；候选生成走 Draft 缝、账面只存元数据，multi-candidate.ts:13-15），先加字段是无源之水；待真有打分器再走受控增补。

**Q2 UserEditRecorded 是否需 editDelta 规模/类型字段？——类型不用加；规模加聚合统计；删除侧文本建议一并加（P2）。**
操作类型分布（insert/delete/replace 各几笔）从 blocks 直接可数；插入规模 = Σ replacementText 长度可算。**不可推导的只有删除侧**：removedChars 与 removedText（§2.1-②）。建议发射端机械盖章 deltaStats 并可选携带 removedText（见 P2），不在 blocks 形状上动刀（blocks 是调用方输入，validateBlock 白名单校验后原样入账，user-edit-step.ts:73-100）。

**Q3 FlywheelRecorded 是否需 recipeId 引用？——不加裸 recipeId；根因是命名空间断裂，修桥不复制（P1）。**
FlywheelRecorded 加 recipeId 只是症状贴膏药：evaluator 还需要 provider/model/attempt 轨迹与结局 join，那些都在引擎命名空间。单一事实源原则下配方身份已随 GenerationStarted 可达（snapshot + M14 缝），缺的只是**桥**。给执行事件补 parentTaskRef/chapterIndex/recipeId·Version 三个槽位（P1），FlywheelRecorded 保持 {outcome, commitId, ...} 不动。

---

## 4. 受控增补提案（每个：位置 / 含义 / 兼容策略）

### P1 执行事件桥接补丁（最高优先级——没有它 R3 无法算 per-model 接受率）

- **位置**：RuntimeEngine.execute 增第三参 `meta?: { parentTaskRef?: string; chapterIndex?: number; eventPayload?: Readonly<Record<string, unknown>> }`；publish GenerationStarted/Finished/TaskAttemptRegistered 时 chapterIndex 上 DomainEvent 既有可选字段（domain-events.ts:42），parentTaskRef 与 eventPayload 合入 payload（snapshot 之后）。DraftStepRequest 增可选 sessionTaskRef，由编排方传入（步函数不持会话的先例不变，draft-step.ts:318-320）；runDraftStep 经 meta 传 {parentTaskRef: sessionTaskRef, chapterIndex, eventPayload: {recipeId, recipeVersion}}（标量平铺，符合 ADR-0021 指针纪律——不嵌整个配方文档）。
- **含义**：一行执行事件从此可 join 回会话窗（同章、同窗、同配方身份）；resubmission 多对生成按 parentTaskRef 分组天然成 attempt 序列。
- **兼容策略**：纯增量可选字段。旧读者不受影响（payload 开放 Record，eventBus.ts:43、ledger.ts:62 均整体透传）；旧账本行缺字段 = 学习器侧缺省处理。词表/EVENT_PAIRS/写侧校验零改动。

### P2 编辑 delta 统计与删除侧文本补丁

- **位置**：user-edit-step.recordUserEdit 发布 payload 增 `deltaStats: { opsInsert; opsDelete; opsReplace; insertedChars; removedChars }`（步内在应用前机械计数，仿 UsageFact 盖章先例 record-step.ts:86-102）；delete/replace 块增可选 `removedText?: string`（应用前从行数组截取，零时钟零成本）。
- **含义**：规模量（edit_distance_ratio 的分子原料）无需重放正文即可得；removedText 补齐 diff 另半边，激活「作者删什么」的内容级负向信号（ADR-0007(novel):20 原始意图、ADR-0005:25、flywheel-spec:53 三重规格背书）。
- **兼容策略**：deltaStats 新行恒有；removedText 可选。历史行两字段皆缺——读取侧 `?? null` 缺省，特征提取容忍缺省是 R1 冷启动设计的一部分（归 #47）。隐私面：events.jsonl 本就在本地运行时区且已携带 replacementText（user-edit-step.ts:4「payload 原样落账」），removedText 未开辟任何新出口通道；体量增长交 grilling 确认。

### P3 生成时长补丁

- **位置**：RuntimeEngineDeps 增 `nowMs?: () => number`（缺省 Date.now；测试注入常数）；execute 在 GenerationStarted 前取样、三种 GenerationFinished 出口（engine.ts:154-158, 165-169, 176-184）统一盖 `durationMs`（含 fallback 链全程）。
- **含义**：P2 隐私档 latency_ms 的账面落点；路由评估「哪个模型又快又好」的必要维度。
- **兼容策略**：可选字段，旧行缺省。零时钟纪律裁决点：record-step 先例是「时间戳显式注入、缺省不落」（record-step.ts:14），而 duration 是测量值不是时刻戳、生产必须有值——建议判例边界为「测量可缺省时钟、时刻戳必显式」，交 grilling 追认（§7 Q-C）。taskRef ULID 自带毫秒时戳（kernel-schema.ts:36-37），起始锚已有，durationMs 是唯一缺角。

---

## 5. 向后兼容面：readStoredLines 双格式容读是否需扩展？——**不需要**

1. 职责边界清晰：readStoredLines 服务 runtime 配对/回放，跳过平铺行是**特性不是缺陷**（eventBus.ts:54-56）；learner 的正确读面是 readPipelineLedger（双格式 + position 权威序，ledger.ts:13-24）。扩展 readStoredLines 反而会把平铺行灌进配对语义，破坏其不变式。
2. 本票全部补丁落在 payload/既有可选字段层：runtime 侧读者取整个 row.event 透传（eventBus.ts:57-61），pipeline 侧 payload 整体透传（ledger.ts:62）——新字段对两个读者都透明。
3. 写侧词表校验只拒未知 type（eventBus.ts:81-83）；零词表变更 ⇒ 零写侧风险、EVENT_PAIRS 状态机零触碰。
4. 若未来真要加事件类型：沿 T16 判例走「词表修订 = kernel 类型库受控增补 + domain-events.test.ts 机械断言 + kernel-schema 入册」（domain-events.ts:4-13 头注；kernel-schema.ts §11 头注 544-547；chapter-pipeline-spec.md:116-120 三处清单先例）。本票不需要走到这一步。
5. 缺省值纪律：exactOptionalPropertyTypes 下新可选字段一律条件展开（record-step.ts:95-100 先例）；历史行缺新字段是常态，learner 不得假设字段存在。

---

## 6. 缓议与不做

| 项 | 裁决 | 理由 |
| --- | --- | --- |
| UserEditRecorded/CandidateCreated 预留 scenarioType 槽位 | **缓议**（归 #48+grilling） | 分类权属未定：发射端盖章（UI/编排方知道语境）vs 学习端推断（Scene beats/正文分类）。现在预留 = 投机字段；若 grilling 判发射端，则为一行 payload 可选字段，随时可补 |
| survival_verified 事件 | **不做**（V1） | 长程存活可由「现行文 hash vs ChapterCommit.contentHash（kernel-schema.ts:502）比对」派生投影，无需新事件流；flywheel-spec:102 该字段本就允许 null |
| privacy_tier 逐行盖章 | **不做** | tier 是事件语义的函数（ADR-0005 分级表），逐行冗余；导出/同步通道尚不存在，届时在通道侧过滤更稳 |
| FlywheelRecorded 冗余 recipeId/providerId | **不做** | 与 P1 桥接方案二选一，选桥（单一事实源；复制面迟早漂移） |

---

## 7. 给 grilling 票的决策题

- **Q-A**：P1 三槽位（parentTaskRef / chapterIndex / eventPayload{recipeId,recipeVersion}）整批一批，还是拆「桥接」与「配方身份」两票？——推荐整批：同一接缝（execute 签名 + DraftStepRequest），拆票反而两次动同一签名。
- **Q-B**：P2 删除侧带 removedText 全文，还是只带 removedChars 计数？——推荐全文（半边 diff 学不了内容级偏好；本地账本无新增隐私出口），代价是行体量，可设单块上限作为折中。
- **Q-C**：P3 缺省时钟 Date.now 是否违零时钟判例？——推荐采纳「测量可缺省、时刻戳必显式」边界并记入 ADR 或 record-step 注释修订。
- **Q-D**：scenarioType 发射端预留槽位现在定还是等 #48 结论？（本票倾向：等。）
- **Q-E**：「最近一条 GenerationFinished」邻接启发式（draft-step.ts:241-251）在 P1 落地后是否改为显式桥接查询？（实现票顺路重构，非本票范围。）

## 附：关键证据索引（快速复核路径）

词表与形状 domain-events.ts:19-51 · 候选双路 multi-candidate.ts:69-149 · 编辑块与覆盖丢失 user-edit-step.ts:65-100, 211-238 · 收尾与 usage record-step.ts:23-52, 86-140 · 引擎命名空间断裂 engine.ts:113-141 + draft-step.ts:324-330 + t17-pipeline.test.ts:109 · M14 缝未接线 loader.ts:203-213（生产未用；recipe.test.ts:267-272 仅测试形态） · 双读面 eventBus.ts:30-65 vs ledger.ts:13-63 · 指针行 receipt-file.ts:99-131 · 规格 data-flywheel-spec.md:53, 82-104 · ADR-0005:20-30 · ADR-0007(novel):14-22 · ADR-0012:11-22 · ADR-0013:13-16 · 六指标 benchmark/src/types.ts:11-39 · 入册判例 kernel-schema.ts:544-568 + chapter-pipeline-spec.md:116-120 + domain-events.test.ts:11-54
