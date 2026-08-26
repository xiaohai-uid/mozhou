---
date: 2026-08-24
description: '工单 #48 产出（Wayfinder Phase 4）：StyleLearner 增量演化协议研究——StyleProfile vN 版本化、编辑 delta→分面 EMA 更新规则、漂移检测与回滚契约、compile() 消费接缝与 USER_EDIT_RATIO_REDUCTION 收敛判据'
tags:
  - project-note
  - mozhou
---

# t48-b StyleLearner 增量演化协议（StyleProfile vN）研究

> 工单 [#48](https://github.com/xiaohai-uid/mozhou/issues/48) · 地图 [#46](https://github.com/xiaohai-uid/mozhou/issues/46)（Phase 4 数据飞轮）
> 相邻票：#47（a AuthorPreferenceLearner）· #49（c EventLedger 供给面）· #50（d TaskModelEvaluator）。三票共享 UserEditRecorded 读侧；本票只裁**风格画像本体的维护协议**，偏好推断归 #47。
> 证据纪律：repo 引用为 路径:行号；规格引用为 文档:章节；无法实证处标【推断】/【提案】。

## 0. 一句话结论

四场景型独立分面（非统一向量）+ EMA(α=0.05) 已被 ADR-0012 裁定且内核注释预留了归属（kernel-schema.ts:335「EMA 平滑簿记归 flywheel 层」）；真正的设计空白在四处——①文风.md 单文件与四实体 schema 的映射、②protected:true 与「EMA 结果自动落盘」的 I1 矛盾、③领域事件词表无任何风格事件、④compile() 对 StyleProfile **零消费点**（注入缝 structural.sections 已预留但无人填充）。本票给出可直写的补全设计。

## 1. 现状取证

### 1.1 类型面（kernel）

- `ScenarioType` 四值封闭枚举：action / dialogue / romance_emotion / exposition_worldbuilding（packages/kernel/src/kernel-schema.ts:322-326）。
- `SentenceLengthBucket {maxLengthChars, share}`，share 合计 ≈1，句长按字符计（中文网文）（kernel-schema.ts:328-333）。
- `StyleProfile` 五个量化分面：dialogueRatio / sentenceLengthDistribution / tabooWords / sensoryDensity / actionPacing（kernel-schema.ts:337-345）。行 335 注释明示两点：**EMA 平滑簿记归 flywheel 层，kernel 只存平滑结果**；规格 §2.8 的 `version` 字段由 `KernelEntityHead.revision` 承担（改名裁决见 docs/specs/kernel-schema-decisions.md:85,123）。
- revision 语义（Q14）：事务性原地变更 +1；不可变实体恒 0（kernel-schema.ts:96-104；kernel-schema-decisions.md:94）⇒ StyleProfile 是**可变实体**，vN 即 revision 序。
- ID 品牌 `style_` + ULID（kernel-schema.ts:54；ulid.ts:98-99）。
- 领域词条锚：Scenario Style Profile = quantified / archetype-specific，avoid prompt prefix / global tone（CONTEXT.md:67-69）。

### 1.2 存储面（data-plane）与保护位矛盾

- 路径冻结：`STYLE_PROFILE_PATH = '文风.md'`（packages/data-plane/src/layout.ts:66）。
- 建书种子即宣告单文件多场景意图：「StyleProfile × scenarioType（…）；EMA 平滑结果算完即落盘，初始为空表」（create-book.ts:140-143）。
- 但扫描器只取文件身份+全文哈希：`PlanningArtifactScan {id, kind, revision, contentSha256}`，不解析任何分面（canon-read.ts:389-402,413-416）；SQLite 投影 `planning_artifacts` 同样只有版本锚列（projection.ts:42-47）。**⇒ 分面数据今天无处结构化落地，是纯 gap。**
- 外部手改文风.md → EXTERNAL_MODIFIED → 进 reconcileSurface（local-data-plane.test.ts:131-144）：作者手动改画像走对账确认，是既有权威通道。
- **矛盾点（实现票必须拍板）**：种子 frontmatter 发射 `protected: true`（create-book.ts:82-93，注释称「宪法层整体受保护 I1」），而 I1 = 保护位禁自动化通道写入（kernel-schema.ts:76-82；prose 侧执法见 user-edit-step.ts:203-209）——但同文件正文却声明「EMA 平滑结果算完即落盘」。飞轮 learner 正是自动化写入方。【推断】I1 的立法本意是防生成管线改写作者宪法文件，不是禁飞轮自维护（ADR-0005 Tier 2 与 data-flywheel-spec §3.1 都要求持续自动精修）；推荐解法见 §6-D。

### 1.3 信号面（EventLedger 现状）

- 词表 14 型中可用的输入：`UserEditRecorded`(edit_blocks)、`UserEditRecorded`(candidate_decision)、`FlywheelRecorded`（domain-events.ts:19-34）。**无任何 StyleProfile* 事件**——画像更新在账面上不可审计，是 #49 受控增补清单的头号缺口（移交 §7）。
- 编辑 delta 形态 = 结构化操作块（非字符 diff）：`{op: insert|delete|replace, paragraphStart, paragraphEnd, replacementText?}` 行闭区间（user-edit-step.ts:59-71）；payload 原样落账 {action:'edit_blocks', level, source:'author'|'assistant', blocks, revision}（user-edit-step.ts:226-238）。
- candidate_decision 要求 accepted/rejected 双路同账方为有效信号（multi-candidate.ts:110-136,138-148）。
- 账本物理：`.mozhou/events.jsonl` 单一 append 真源、publishEvent 单口（runtime-capability-spec.md:61-66；pipeline/src/ledger.ts:1-15 双格式行）。

### 1.4 消费缝（context-compiler）——核心结论：缝已预留，无人填充

全仓 grep `StyleProfile` 仅命中 kernel/data-plane 类型与存储侧（15 处）；**context-compiler 包内零匹配** ⇒ compile() 今天不消费 StyleProfile。但注入缝早已点名预留：

- `CompileInput.structural.sections` 注释：「基础结构层注入段（Author Intent / 任务框架 / **风格画像**）」（compile.ts:116-117），直通装配器（compile.ts:249）。
- `StructuralSection` 注释直接点名三个合法段：Author Intent / 任务框架 / **Scenario Style Profile**（assemble.ts:84-89）。
- 管线侧入口：`RunCompileRequest.structuralSections?` → 并入 compile 入参（compile-step.ts:48,118）；现有调用全部传空数组或仅 author_intent（compile-step.test.ts:111 等）。
- Receipt 语义：structural 条目 assemblySource='structural'（kernel-schema.ts:362-368）、activation evidence 恒 undefined（context-receipt-physical-format-spec.md:122）、按 identifier 参与条目级 diff（同 §3.2）、replayInputs 记结构层各 section digest（§3.1）——风格段进证后天然获得复算与 diff 能力。
- 预算约束：structuralCapTokens 默认 4096（assemble.ts:117,128）。

### 1.5 收敛指标候选现状（benchmark）

- `judgeUserEditRatioReduction`：下降率 = (基线−当前)/基线，门限严格 >0，零基线退化有专门定义（metrics.ts:159-174；types.ts:30,38）。
- 定位是**运行级跨版本对比**指标，不入章级五指标（run.ts:49,66-67,128）；输入只是标量对 {baselineEditCount, currentEditCount}。ADR-0008 将其定义为 recipe/prompt 迭代验证指标（adr/0008 §2 第 6 条）；data-flywheel-spec §3.2 同用途（story-deslop v1.4 vs v1.3 的 edit distance 对比）。

## 2. RQ1：版本化形态——每场景型独立分面，版本按更新批次递增

**裁决依据（实证）**：ADR-0012 Decision 明文「Each category maintains an independent StyleProfile」+ EMA α=0.05（docs/adr/0012 Decision 2/3）；scenarioType 判别键正是 Q13 为「US23 EMA 按场景隔离的前提」而补（kernel-schema-decisions.md:85）；CONTEXT.md:69 把「global tone」列入 avoid 词。统一向量方案被三重证据封死。

**版本尺度（提案）**：
- vN = `KernelEntityHead.revision`；learner 每应用一个更新批次 ⇒ 整文件原子替换 + revision +1（沿 user-edit-step.ts:213-219 的 atomicReplace+revision 步进先例）。更新批次挂章粒度：十步第 10 步 Flywheel Record 之后批处理本章全部 edit_blocks（chapter-pipeline-spec.md §1 表第 10 行；失败降级不阻断正文的 state_degraded 先例 record-step.ts:104-124）。
- 时间常数：EMA(α=0.05) 半衰期 ≈ ln0.5/ln0.95 ≈ **13.5 个更新批次**，有效记忆 ≈ 1/α = 20 批【数学推导，非引用】⇒ 统计上显著的画像移动以 ~15 章为单位；这解释了为何每章都可 +1 revision 而「漂移感知窗口」应设 ≥20 批（§4）。
- 历史保留：不在 canon 文件里存历史（I5 不适用——它是可变实体）；历史 = ledger 里逐批落的 StyleProfileUpdated 事件快照（§4-C），回滚即重放。

**物理形态裁决（提案）**：维持文风.md 单文件（目录树 v2 冻结纪律、create-book 种子意图、Sync Layering 把 style profiles 归 planning 层立即落盘——CONTEXT.md:87-89）。body 冻结为一个 fenced YAML 块：`profiles:` map × 四 ScenarioType，每分面携带建书时一次性铸好的独立 `style_<ULID>` id 与五分面值。canon-read 升级 readStyleProfiles() 结构化解析、宁败不脏（canon-read.ts:404-407 纪律先例）；projection 不动（contentSha256 已覆盖任何分面变化，projection.ts:42-47）。

## 3. RQ2：编辑 delta → 分面更新规则

**信号价值分层（按 op 类型，全部机械可提取，零 LLM）**：

| 信号 | 学什么 | 备注 |
|---|---|---|
| replace 新文本 | 最强正观测：句长分布 / dialogueRatio 直接从 replacementText 统计 | 作者亲笔改写 |
| insert 新文本 | 强正观测：同上 | 作者主动添加 |
| delete 被删文本 | 负观测：高频被删词 → tabooWords 候选；整段删除该批不计正观测 | tabooWords 是 schema 既有槽位（kernel-schema.ts:342） |
| 保留不动 | **不计入 EMA 观测**；仅作收敛评估的正向证据 | 【提案】AI 本就按画像生成，保留是「画像没被推翻」而非新方向；计入会自证循环 |

**EMA 规则（ADR-0012 α=0.05 已裁，此处给操作语义【提案】）**：
- 标量分面：new = clamp01((1−α)·old + α·observed)。observed 从该章归入本场景型的编辑块新文本统计。
- 分布分面：逐桶 EMA 后重归一化使 Σshare ≈ 1（schema 契约 kernel-schema.ts:331）。桶边界沿用种子表，不因学习改动（否则分布不可比）。
- tabooWords：集合语义不走 EMA——被删/被换词按 (词, 章) 去重计数，跨 ≥2 章、≥3 次命中才转正；表长上限 50 防 structural 段膨胀【提案阈值，台架校准项】。
- **sensoryDensity / actionPacing 两分面的诚实降级**：这两个语义量没有可靠的纯文本机械算法。【推断】V1 只让 dialogueRatio + sentenceLengthDistribution + tabooWords 三项参与自动 EMA（它们有确定性统计定义）；sensoryDensity/actionPacing 保持种子空值，更新仅走 LLM 旁路建议 + 作者确认（S5「LLM 审查只做旁路建议不入 Gate」的同款边界，chapter-pipeline-spec.md §2 S5）。宁缺毋滥，不做伪精确。
- 场景归类的分类器：编辑块 → scenarioType 需要 V1 启发式（引号密度→dialogue；战斗动词词表→action 等）+ 低置信度整批跳过。ADR-0012 Context 段警告的交叉污染正是误分类后果。【推断】升级路径：本地 bge-small-zh 向量资产已在库（packages/context-compiler/assets/models/bge-small-zh-v1.5/），可作二阶段分类器，V1 不依赖。
- candidate_decision 不进本 learner 的 V1 观测：候选文本是 AI 产物，用它学风格有自证风险【提案】；该信号的全部价值归 #47。

## 4. RQ3：漂移检测、突变区分与回滚契约

**A. 无输入即无漂移（结构性论证）**：learner 只吃 UserEditRecorded(edit_blocks) 驱动——没有编辑活动，画像按构造冻结。因此 ADR-0012 要防的漂移只剩三个源：场景误分类交叉污染（§3 分类置信门限挡）、观测统计 bug（纯函数测试挡）、极端单章污染（α=0.05 + 下述钳制挡）。

**B. 护栏三件套【提案值，台架校准项】**：① 单批位移钳制 Δmax：任一分面单批变化 ≤±0.1；② 最小样本门 Nmin：本场景型有效编辑块 <10 则本批不更新；③ 二档学习率：滑动窗（近 5 章）edit_blocks 总量超阈值 R_high 且同分面连续 ≥K 批同向 ⇒ 判定「作者风格迁移」，本批起切 α_boost=0.2 快速跟随并在事件 payload 打 regimeChange 标记。突变 vs 漂移的区分判据由此机械化：**真实突变必然伴随密集编辑活动（有信号），算法漂移不伴随（无信号）**。

**C. 回滚契约（提案，沿既有不变量精神）**：
- 每次更新批次落一条 `StyleProfileUpdated` 事件：payload 含 {分面 after 全量, beforeDigest, sampleCount, alphaUsed, regimeChange?, taskRef, chapterIndex}。before 不内联（账本瘦身；回滚靠重放历史重建）——INV-R5「轻量可 diff」精神的 P1 侧移植（receipt-spec §7 表）。
- 回滚到第 k 批 = 重放 ledger 前 k−1 条事件的 after 值覆写文风.md + revision 继续 **+1**（revision 是变更计数不是分支号，Q14 语义）+ 落一条带 rolledBackTo 锚的事件。回滚执行器 V1 为确定性函数/CLI，UI 归 Phase 6（receipt-spec §3.2 出界先例）。
- 作者手动改文风.md 永远赢：EXTERNAL_MODIFIED 对账流已是权威通道（local-data-plane.test.ts:131-144）；learner 读侧每次批量前重扫盘上现值作 old 基线，不做内存长持。

## 5. RQ4：compile() 消费接缝 + 收敛指标

**消费方式（可直写）**：新增纯函数 renderStyleSections(profiles): StructuralSection[] ——section 标识符 `style_profile:<scenarioType>`（沿 'entity:<ref>'/'author_intent' 命名先例，compile.ts:169、compile-step.test.ts:111），content = 量化分面的人读指令渲染（如「对话占比约 45%；句长峰值 12–25 字桶占 60%；禁用词：……」）。编排方在 Prepare 后读取文风.md → 渲染 → 填入 RunCompileRequest.structuralSections（compile-step.ts:48,118）。CHAPTER_DRAFTING 任务 V1 **四分面全注入**：确定性、零分类依赖，估算总量 ≤800 token << structuralCapTokens 4096【token 数为估计】，且分 section 使 Receipt diff 可定位单一场景型的画像变更（receipt-spec §3.2）。CONTEXT.md:69 的 avoid「prompt prefix」指的是把 StyleProfile 概念降格为固定提示词前缀，不妨碍其量化结果经 structural 通道注入——该通道定义原文即含「风格等结构性注入」（kernel-schema.ts:362-364）。

**USER_EDIT_RATIO_REDUCTION 能否作收敛指标——能作验收级，不能作过程级**：
- 可用性：它度量的恰是 StyleLearner 的最终目的（人工改写量下降），且判定器/gate 现成（metrics.ts:171-174；types.ts:38）。
- 局限一（运行级标量对）：混淆因子不可忽略——改写量受剧情难度、作者状态、recipe 其他变化影响。归因到 StyleLearner 必须控制变量：同 recipe/模型，仅开关风格注入段做 A/B 窗口配对（基线 K 章关、处理 K 章开），再喂 {baselineEditCount, currentEditCount}。
- 局限二（口径缺口）：「editCount」无系统内约定。建议口径 = 窗口内 Σ|blocks|（结构化块数，user-edit-step.ts:65-71 有原生粒度），比事件数细、比字符数稳【提案】；聚合器归 #49 的供给面清单。
- 过程级补充指标（L1 纯函数可判，提案）：分面稳定度 = 相邻 N 批更新的向量 L∞ 位移 < ε（EMA 几何收敛，理论收敛率已知）；负反馈率 = 编辑块落在 AI 生成段的比例随批次下降。两者无需 A/B、可每窗计算，作实现票的自检门；USER_EDIT_RATIO_REDUCTION 作对外验收门（ADR-0008「必须数学证明不劣于基线」的精神）。

## 6. 推荐设计汇总（实现票可直写）

- **A 存储**：文风.md body 冻结 fenced-YAML profiles map（4×{id, dialogueRatio, sentenceLengthDistribution[], tabooWords[], sensoryDensity, actionPacing}）；canon-read 增 readStyleProfiles()（宁败不脏）；投影不动。
- **B 学习器**：新模块（归 packages/pipeline 或新 flywheel 包，实现票定）纯函数核 updateStyleProfiles(old, batch: EditBlockObservation[]) → {next, report}；EMA α=0.05、Δmax=0.1、Nmin=10、taboo 转正 3 次/2 章、表长 ≤50；V1 机械分面仅三项（§3）。
- **C 触发点**：第 10 步 Flywheel Record 之后批处理本章 edit_blocks；写盘失败降级 state_degraded 不阻断正文（record-step.ts:104-124 先例）；写后 refreshManifestEntries + atomicReplace + revision+1（user-edit-step.ts:213-224 先例）。
- **D 保护位矛盾解法（Contract Delta）**：保留 protected:true 不削弱 I1，增补受控豁免——定义唯一合法写者 StyleProfileStore（flywheel 维护通道），强制每次写盘伴随 StyleProfileUpdated 事件（审计替代禁令）；作者手改仍走对账且永远赢。备选（更简但弱保证）：种子改 protected:false。倾向前者【提案，grilling 拍板项】。
- **E 消费**：renderStyleSections() + 编排方填充 structuralSections（§5）；Receipt 天然收录（assemblySource='structural' + replayInputs digest）。
- **F 事件增补（交 #49 汇总入受控增补）**：`StyleProfileUpdated`（非成对收尾事件，FlywheelRecorded 先例 record-step.ts:5）；regimeChange 作 payload 位不加新词条。
- **G 收敛门**：过程级 = 分面稳定度 ε 门 + 负反馈率下降；验收级 = USER_EDIT_RATIO_REDUCTION A/B 配对 >0。

## 7. 移交与分工边界

- → #49：上述 F 事件形状 + editCount 聚合口径（Σ|blocks|/窗）纳入 EventLedger 供给完备性定案。
- → #47：edit_blocks 读侧共享；偏好特征提取（其 Q2）与本票分面统计共用同一个 Observation 提取器，避免两套解析。
- → #50：无直接耦合；version-matrix 的 recipe 轴是 USER_EDIT_RATIO_REDUCTION 的现有宿主（run.ts:66），A/B 开关位建议挂 recipe 引用而非新轴。
- 明确不做（越界）：偏好推断、候选选择学习（#47）；usage/token 记账（T19 已交付）；云同步加密形态（data-flywheel-spec §2 P1 仅要求 local by default）。

## 8. 未决问题（建议 grilling 拍板）

1. §6-D 保护位矛盾取「受控豁免+审计」还是「去保护位」？（影响 Contract Delta 走法）
2. sensoryDensity/actionPacing 的 LLM 旁路确认面放哪（ProposalPort 复用 vs 独立 review 面）？
3. 分类器 V1 阈值与词表初值：接受「台架校准后回填」的两票节奏吗？
4. 四分面全注入 vs 草稿分类 top-2 注入：预算宽裕时是否值得省那几百 token？
