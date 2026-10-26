---
date: 2026-10-01
description: '墨舟（MoZhou Novel OS）规范术语表：产品领域术语与用词消歧的唯一权威来源'
tags:
  - mozhou
  - glossary
supersedes: CONTEXT.md
---

# 墨舟规范术语表 (MoZhou Glossary)

墨舟全部产物——代码、文档、议题、提交信息、界面文案——的术语唯一权威来源。

> **优先级规则**：本文件与仓库内任何其他文件冲突时，**以本文件为准**。
> 合并前历史文件中的 `CONTEXT.md` 引用，一律视为引用本文件。
> 词条的**结论**若与已接受的 ADR 冲突，以 ADR 为准，并按 `docs/agents/domain.md` 的规则显式提出冲突，不得静默覆盖。

## 0. 使用规则

1. **本表未收录的词，不得携带墨舟特定含义。** 需要新词时先入本表，再使用。
2. 每个词条同时给出**规范中文名**与**英文名**。二者指同一物，**不得互换使用**（例如不得中文写"收据"、英文写 `Context Receipt`）。
3. `_Avoid_` 行是**硬约束**：在墨舟产物中出现即为用词错误，不是风格偏好。
4. **Part 2 收录的是通用工程词**——它们本身不是墨舟专有概念，但它们在本仓曾有多个互相冲突的定义，因此在此登记唯一含义。Part 2 未收录的通用词，**不得携带墨舟特定含义**。
5. **纪事不进本表。** 带日期的决策叙述属于 `docs/adr/`；架构组合关系属于 `docs/architecture.md`。
6. **冻结的历史档案不改写。** `docs/adr/`、`docs/changes/`、`audit-2026-10-03/`、`docs/handoff/`、`docs/audit/`、`handoff-results/`、`.scratch/`、`PROJECT-MAP.md` 是已定稿的决策与变更证据；其中的过时用词只登记（见 Part 3 注记），不追改。生成物（`docs/term-map.md`、`docs/architecture.md`、`apps/web/src/code-graph/codeGraphData.*`）同样不改写，随各自生成器刷新。

---

# Part 1 — 产品领域术语

## 1.1 内核与领域状态

**作品 (Work)**:
作者的一部创作，是书稿树、正典文件与运行时的顶层容器。**UI 与文档一律写"作品"**；"书"只留在既有复合词（书库、建书、切书、书稿）与"书名"字段名内；"小说"只用于题材与他人作品（小说拆解、对标小说）。
_Avoid_: 单用"书""本书""该书""这本书"指当前作品；用"小说"指作者自己的作品

**作者意图 (Author Intent)**:
一部小说不可妥协的宪法性蓝图，封装核心爽点、读者承诺、主角欲望、绝对禁忌与预设高潮。
_Avoid_: Prompt、author note、background setting

**大纲图 (Outline Graph)**:
跨书、卷、弧、章组织叙事推进的分层有向图，带显式依赖边。场景挂在章节之下，自成一等实体，不作为图节点。
_Avoid_: Flat outline、chapter list、story roadmap

**场景 (Scene)**:
规划、写作、对话、评审共用的最小同步单元，挂在章节之下，承载节拍、摘要与 POV；正文本身只存在于章节提交中。
_Avoid_: Beat list、chapter fragment、outline leaf

**实体卡 (Entity Directory Card)**:
`设定/<类型>/` 下的逐实体 Markdown 卡，其 YAML frontmatter 承载机器字段（`ref`、`name`、`aiContext` 四档策略、别名表、排除词、`brief`、`tags`），正文面向人类，绝不整卡拼入提示词。
_Avoid_: Free setting note、lore entry、config object

**对标 Codex (Reference Codex)**:
外部对标产品（Novelcrafter）的设定库功能；本仓只把它作为设计参考来源引用，不实现同名能力。
_Avoid_: 裸写"Codex"指本功能——本仓裸写的"Codex"另指执行与复核用的 OpenAI Codex 智能体

**实体引用 (Entity Ref)**:
书内实体的稳定可读 slug，限定在五个冻结命名空间（`char:`、`item:`、`location:`、`faction:`、`concept:`）内，每书唯一，一旦被跟踪行或卡片引用即冻结。
_Avoid_: Opaque ID、mutable name、numeric key

**时序事实 (Temporal Fact)**:
绑定主语、谓词、值的规范原子断言，受有效章节区间（`valid_from` 至 `valid_until`）与显式确认状态（`planned`、`candidate`、`confirmed`、`rejected`）约束。秘密是保留谓词命名空间 `secret` 下的时序事实，其揭露即关闭有效区间。
_Avoid_: Memory item、context note、setting entry

**候选事实 (Candidate Fact)**:
从 AI 生成草稿正文中提取、尚未验证的事实断言，等待用户验证或章节提交。
_Avoid_: Canon、true fact、memory。**中文一律写"候选事实"，不得只写"候选"**

**候选事实账本 (Candidate Fact Ledger)**:
书内运行时区中存放候选事实及其决断状态的追加式存储；每条候选绑定来源章节与正文版本，作者确认/拒绝/编辑决断后状态单向演进，拒绝与作废记录永久保留，同章重新提取作废旧现场。
_Avoid_: 事实账本（省略"候选"）、事件账本（那是管线账本事件）、knowledge base、fact table

**候选 (Candidate)**:
**必须带限定词。** 本仓有三个候选：**候选草稿**（未经采纳的生成产物）、**候选事实**（见上条）、**候选条目**（上下文装配的召回候选）。裸用"候选"即为错误。
_Avoid_: 全部（裸用）

**正典事实 (Canon Fact)**:
正典中永久、已验证的真相，仅在章节提交并经作者确认后成立。
_Avoid_: Candidate fact、hallucination、brainstorm

**知情状态 (Knowledge State)**:
在任一章节上，明确记录特定角色、读者与叙述者知道或不知道什么，用于阻止全知泄漏。
_Avoid_: Character memory、shared knowledge、global state

**叙事承诺 (Narrative Promise)**:
被跟踪的叙事义务——伏笔、悬念、倒计时、角色债务、未揭秘密——受严格生命周期约束（`introduced`、`reinforced`、`due`、`paid_off`、`abandoned`、`overdue`）。
_Avoid_: Foreshadowing ledger、plot point、hook

**关系状态 (Relationship State)**:
实体间关系动态的时序记录（如 生疏 →  tentative 盟友 → 互信 → 背叛），按章节时间线索引。
_Avoid_: Character relationship table、social graph

**时间线事件 (Timeline Event)**:
故事宇宙中不可变的编年事件，推进世界时间或改变时序事实。
_Avoid_: Chapter log、story history

**场景风格画像 (Scenario Style Profile)**:
按场景类型（`action`、`dialogue`、`romance_emotion`、`exposition_worldbuilding`）参数化的作者文体节奏与用词量化表示。
_Avoid_: Prompt prefix、system prompt、global tone

**状态压缩 (State Compaction)**:
在卷边界把过期时序事实折叠为压缩滚动摘要的自动归档过程，用于维持恒定的检索开销。
_Avoid_: Fact deletion、garbage collection、memory purge

## 1.2 事务与连续性

**数据面 (Data Plane)**:
承载正典文件与其可丢弃投影的持久化层。正典文件是唯一真值，投影可随时重建；书内全部持久化写入经它收口。
_Avoid_: 数据平面、storage layer、database、后端存储

**章节提交 (Chapter Commit)**:
已定稿叙事输出的原子事务单元，含最终正文、抽取增量（事实、关系、知情、承诺、时间线、物品）、章节摘要与依赖清单。
_Avoid_: Saved file、chapter markdown、draft accept

**在写草稿 (Active Draft)**:
书稿树中尚未提交、或提交后正在被重新编辑的章节文件；可在任意编辑器自由编辑，不触发对账。
_Avoid_: Dirty file、temp draft、WIP copy

**双平面同步 (Sync Layering)**:
规划层实体（作者意图、大纲节点、场景、手工创建的承诺、风格画像）保存即落盘到正典文件，而叙事状态增量（事实、知情、关系、时间线）只在章节提交时落地。
_Avoid_: Autosave everything、deferred write-back、batch flush

**哈希基线 (Hash Baseline)**:
墨舟自身维护的指纹记录，记录它上次写入每个正典文件时的内容，存放在可丢弃投影之外，用于把外部修改与应用自身写入区分开。
_Avoid_: Cache key、checksum log、git index

**写前校验 (Write Verification)**:
强制的写前哈希检查：当磁盘文件与基线不符时挂起应用侧保存，把冲突转入对账，而不是静默覆盖。
_Avoid_: Last-writer-wins、force save、merge-on-save

**全量重建 (Full-Absorption Rebuild)**:
以正典文件为真值确定性重扫并重建投影、重新建立基线；全程不需要模型参与。
_Avoid_: Ledger replay、backup restore、resync wizard

**运行时区 (Runtime Zone)**:
书内非正典区域（`.mozhou/`），存放可丢弃投影、审计账本、凭证与快照；不参与对账，永不作为真值。
_Avoid_: Hidden state、system folder、cache directory

**快照 (Snapshot)**:
每次章节提交后及按需对整个书目录做的时点副本，作为回滚数据源。
_Avoid_: Autosave、version history、undo stack

**外部修改提案 (External Modified Proposal)**:
通过 SHA-256 不匹配检测到正典 Markdown/JSONL 被外部修改时生成的未验证状态增量，暂存待作者对账。
_Avoid_: Overwrite prompt、dirty state、sync error

**受保护作者内容 (Protected Author Content)**:
带保护标记的人工撰写正文或正典编辑；自动化流程永不可覆盖，上游重算只可将受影响的下游产物标记为过期（见 ADR-0019 §4）。
_Avoid_: Lock file、read-only mode

**过期标记 (Stale Marker)**:
放在下游产物上的非破坏性标志，标记其上游输入已变，提示需重新验证，不删除也不重生成作者内容。
_Avoid_: Deletion、cache purge、rewrite

**依赖清单 (Dependency Manifest)**:
为特定章节编译与生成期间所读取的全部正典实体、事实、大纲节点、承诺、世界规则与风格版本的精确确定性记录。
_Avoid_: Context dump、read log、prompt history

**变更影响引擎 (Change Impact Engine)**:
双层分析系统，结合确定性依赖图遍历与语义 LLM 评估，在上游正典变更时定位失效或断裂的下游章节。
_Avoid_: LLM rewrites、manual check、batch regeneration

**上下文编译器 (Context Compiler)**:
确定性的预算与筛选管线，查询故事圣经，按邻近度、POV、激活规则与 token 上限筛选相关实体，为模型编译精确载荷。
_Avoid_: Prompt builder、context injector、system prompt generator

**上下文数据包 (Context Packet)**:
传给模型的提示词载荷，由带严格优先级与裁剪策略的预算化分节组成。
_Avoid_: Full context、prompt text、context window

**上下文凭证 (Context Receipt)**:
用户可检视的透明拆解，逐项交代编译出的上下文数据包中每个 token、每个纳入实体与每条排除规则，说明为何纳入或排除。
_Avoid_: 收据、上下文收据、Context viewer、prompt log、debug trace。**规范短式：上下文凭证；带限定词的短式同样合法（装配凭证 / 编译凭证 / 不可变凭证）**

**预留分配 (Reserved Allocation)**:
两阶段预算算法，先严格按可取序为候选条目预留最终形态 token 成本，再放置预留前缀；因此"被纳入"等价于"占据该顺序的一个前缀"。
_Avoid_: Best-effort fill、skip-ahead packing、greedy insertion

**可取序 (Desirability Order)**:
候选条目上的确定性全序——人工置顶、档位序、相关度分、标识符平局裁决——预留沿其进行，驱逐据其定义。
_Avoid_: Insertion Order (hand-tuned scalar)、priority number、sort index

**原子条目 (Atomic Entry)**:
受免裁剪语义约束的条目：要么整体进入数据包，要么整体被驱逐，绝不中途截断；原子性禁止截断，但不禁止驱逐。
_Avoid_: Protected entry、undeletable entry、eviction-immune entry

**正文配额 (Story Text Quota)**:
在任何设定类条目竞争之前预扣的正文 token 底线；设定类条目永远不能支取它，正文本身可吸收超过底线的池内余量。
_Avoid_: Prose budget cap、quota refund、story text limit

**可复算性 (Recomputability)**:
上下文凭证的审计属性：它归档最小重放输入面，使任意时刻重跑预算装配都能复现同一重算哈希；被篡改或已退役的输入会显式失败并把漂移定位到具体条目，绝不静默分叉。
_Avoid_: Digest-only anchoring、determinism claim without verification、best-effort replay

**激活证据 (Activation Evidence)**:
候选条目经由哪条召回通道进入的类型化记录——命中关键词、图跳来源与深度、向量分、人工置顶——按凭证条目可选携带；结构性注入没有激活证据。
_Avoid_: Compressed evidence string、activation key dump、search log、relevance explanation prose

**重放输入 (Replay Inputs)**:
上下文凭证内归档的最小输入快照——配置/分词器/模型版本，加上带分数与内容摘要的可取序候选列表、结构分节摘要、正文切片摘要——足以确定性重跑预算装配阶段；实体正文本身从不复制。召回过滤的透传位于重放契约之外。
_Avoid_: Raw prompt archive、full input snapshot、digest-only anchor

**图触发源 (Graph Trigger Source)**:
关键词快通道经别名表从草稿提及解析出的实体引用；它为 k 跳图召回生根，其实体卡无条件进入候选集，其一跳事实绕过相关度阈值但绝不绕过预算与门控。
_Avoid_: Mention hit、activation key、anchor entity

**K 跳召回 (K-Hop Recall)**:
在 POV 可见的时序正典子图上，从触发源沿关系、引用、事件边做确定性宽度受限遍历，在硬分支上限下把邻域事实浮为候选。
_Avoid_: Graph search、recursive scanning、memory walk

**连续性门 (Continuity Gate)**:
章节提交前执行的一系列确定性与 LLM 辅助核查，用于检出逻辑错误、知情泄漏、时间线悖论与死承诺。
_Avoid_: Linter、fact checker、review agent。**引用时不得简写为"门"或"gate"**

## 1.3 运行时与能力

**上下文档位 (AI Context Tier)**:
实体级装配策略的四档——`always`、`detected`（默认）、`detectedOff`、`never`——只决定激活与否；密级授权与 POV 切片门控由中心强制执行，任何档位都不能绕过。
_Avoid_: Include flag、prompt toggle、permission level

**小说运行时 (Novel Runtime)**:
有状态执行引擎，跨小说生命周期协调工作流、事件总线、调度器、检查点与事务。
_Avoid_: Agent loop、script runner、orchestrator

**事件总线 (Event Bus)**:
异步领域事件骨干，发布并记录每一个生成步骤、评审发现与用户决策。
_Avoid_: Message queue、callback listener

**会话重放 (Session Replay)**:
从已记录领域事件对历史生成运行做确定性重建与根因审计。
_Avoid_: Chat history、debug log

**任务投影 (Task Projection)**:
任务生命周期状态（jobs/steps/attempts）的可重建 SQLite 投影，行与账本序号对齐；乐观并发（CAS）只作用于投影，绝不作用于只追加账本本身。
_Avoid_: Source-of-truth state table、dual ledger

**档位路由 (Tier Routing)**:
从 task_type 到档位名再到 (provider, model) 对的两级间接映射；模型 id 永不直接绑定任务类型，使供应商侧重命名被隔离在配置内。
_Avoid_: Direct model binding、hardcoded per-task models

**章节生产会话 (Chapter Production Session)**:
驱动单章穿过十步管线（Prepare→…→Flywheel Record）的单一内存状态机；每次步进转换都是一个账本任务事件，一个会话恰好产出一个提交，恢复时从步边界检查点重放。
_Avoid_: Batch job、background worker。**本词与 Part 2 的"任务 (Task)"无关，勿混用**

**提案端口 (Proposal Port)**:
统一确认 API，对账流程与管线的正典提案都经它等待逐项作者裁决（confirm/reject/editAccept）后才晋升。
_Avoid_: Ad-hoc dialog state、silent auto-promotion

**能力 (Capability)**:
抽象的任务级契约（如 `PROSE_DEAI`、`MARKET_SCAN`、`STATE_EXTRACTOR`、`LONGFORM_PLANNING`），与底层实现提供者解耦。
_Avoid_: tool、agent、技能（当所指是该契约本身时）

**技能 (Skill)**:
作者可见、可启用的方法论单元，由**能力配方**实例化后的运行时形态（如「技能广场」里的项）。与**能力 (Capability)** 分工不同，不是同义词。
_Avoid_: 用"技能"指任务级抽象契约（那是能力）

**能力注册表 (Capability Registry)**:
把抽象能力解析到具体提供者（原生例程、外部技能或远程服务）的中心注册表，不让调用方耦合实现名。
_Avoid_: Skill manager、tool list、plugin loader

**能力配方 (Capability Recipe)**:
机器可校验的冻结方法论单元（类型化字段 + JSON Schema：触发器、静态加载条件、失败矩阵、跟踪门控、上下文预算、锁定的 MIT 来源），可实例化为一次或多次运行时技能运行。
_Avoid_: Free-form prompt template、skill definition

**任务流 (Task Stream)**:
服务端任务进度的只读事件流：快照 + 带 schemaVersion/epoch/sequence 的增量事件，断线重连后以快照补发对齐；客户端不持有任务真实性，后端才是任务状态的家。
_Avoid_: WebSocket 推送（实现细节）、日志流、轮询接口（不加限定）

**候选生成标识 (Generation Id)**:
一次草稿候选生成（draft.generate / draft.continue）的不可复用标识：续写严禁复用被续写候选的候选 id 或 generationId，每次操作必须分配全新 operationId 与全新 attemptId（契约见 ADR-0035 与 draft-continue）。
_Avoid_: attemptId（每次尝试独立分配）、任务 (Task)（账本单位，见 Part 2 §2.3）、请求 id（不加限定）

## 1.4 评估与验证

**评估引擎 (Evaluation Engine)**:
一等自动化验证子系统，针对标准化基准衡量正典准确性、知情泄漏、承诺召回与提示词回归。
_Avoid_: Unit test suite、prompt grader

**长篇基准 (Long Novel Benchmark)**:
50 章合成参考小说，用于机械压测时序事实、知情不对称、延迟承诺与追溯性世界变更。
_Avoid_: Test sample、demo book

**文学审查报告 (QualityReviewReport)**:
版本绑定的文学审查报告**值**，随报告 JSON 落 `.mozhou/quality-reviews/`，非正典；正文变化即失效（fail closed）。
_Avoid_: Canon fact、把它当正典写入

**文学质量策略 (QualityPolicy)**:
平台默认 + 项目覆盖的规则集，`maxAutomaticReworks` 恒为 2。
_Avoid_: Per-project ad-hoc rule set

**失败模式 (FailurePattern)**:
从作者结构化纠错中投影出的项目级失败记忆，是**质量先验**，不是正典事实。
_Avoid_: Canon fact、Temporal fact

**读者体验差值 (ReaderExperienceDelta)**:
压力/期待/实得/兑付/解法模式的章级诊断，位于内核之外。
_Avoid_: Quality score、评估引擎总分

## 1.5 数据飞轮与隐私

**策略飞轮 (Policy Flywheel)**:
闭环学习机制，在不上传、不微调原始私有书稿正文的前提下，精修提示词配方、上下文策略、模型路由决策、质量门控与作者个性化画像。
_Avoid_: Model training pipeline、data scraper、LLM fine-tuner

**作者模型 (Author Model)**:
从用户的选择、编辑与删除中持续推断出的作者文体与结构习惯个性化画像。
_Avoid_: Custom prompt、user persona

**能力演进 (Capability Evolution)**:
基于采纳率与编辑比，随时间对能力与配方版本做经验性追踪与基准对比。
_Avoid_: Version list、release changelog

**事件账本 (Event Ledger)**:
只追加日志，记录用户决策、候选采纳/拒绝、生成后编辑、评审结论与执行延迟。
_Avoid_: User tracker、telemetry dump、audit log

**隐私档位 (Privacy Tier)**:
四级分类体系，严格区分严格本地的书稿正文（P0）与派生的私有画像（P1）、选择加入的匿名执行指标（P2）、显式贡献的开放数据集（P3）。
_Avoid_: Security level、data flag

**市场简报 (Market Brief)**:
从公开市场榜单与基准中抽取的、结构化且持续更新的类型趋势、钩子位置、章节长度分布、节奏模式与反模式画像。
_Avoid_: Market report、scan markdown、crawler output

**路由建议确认 (RoutingSuggestion 确认)**:
作者显式把一条 promote/demote 建议落到档位配置的动作；watch 条目不可确认。
_Avoid_: 自动应用建议改路由、把 `api_key_ref` 写进确认后的叶子、把 watch 条目当作路由变更

**路由变更 (RouteChange)**:
一次确认所描述的单叶子 providerId+model 变更记录。
_Avoid_: Tier config rewrite、批量变更

---

# Part 2 — 用词消歧登记

本节收录的词是**通用工程词汇**，本身不是墨舟专有概念。它们在此登记，是因为它们在本仓曾有多个互相冲突的定义。
**引用时必须带限定词。裸用一个词而依赖读者猜含义，在墨舟产物中即为错误。**

## 2.1 议题与执行跟踪

**议题 (Issue)**:
GitHub 上的执行跟踪单元，编号写作 `#31`，一律用 `gh` CLI 操作。**执行状态的唯一权威**。
_Avoid_: 工单、ticket、本地文件

**工单 (Ticket)**:
**已废弃中文俗称，即"议题 (Issue)"。** 出现即为用词错误，一律改写为"议题"。存量集中在冻结的历史档案（Part 3 注记 3）。
_Avoid_: 全部

**本地规格文档 (Local Spec Doc)**:
`.scratch/<feature-slug>/` 下的本地 markdown，承载**规格、决策与历史归档**，**不是执行状态**。
_Avoid_: 工单、ticket、issue、"当前要做的活"

**地图 (Map)**:
单个标注 `wayfinder:map` 的议题，其所有子议题都挂在它下面。
_Avoid_: 任务列表、backlog、总览页

**状态标签 (Triage Label)**:
`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix` 五个角色，**存放于 GitHub 议题标签**。
_Avoid_: 在本地 markdown 的 frontmatter 里声明状态（存量违规见 Part 3 注记）

## 2.2 门控与验证

**门 (Gate)**:
一次性的、阻塞式的通过条件。本仓有**四种互不相同的门**，引用时**必须带限定词**：

| 限定词 | 含义 | 定义所在 |
|---|---|---|
| 需求保真门 (Requirement Fidelity Gate) | 议题完成前验证是否实现了被批准的需求 | ADR-0018 |
| 连续性门 (Continuity Gate) | 章节提交前的逻辑/知情/时间线/承诺核查 | Part 1 §1.2 |
| 文学质量门 (Quality Gate) | pre-Canon 文学质量边界 | ADR-0025 |
| 自动化门 (Automated Gate) | 由 CI 或脚本执行的 Gate | `AGENTS.md` §5 |

_Avoid_: 门禁、闸门、gate（裸用）、`.specify` 的 review gate（属降级层）

**门禁**: 门的**已废弃中文俗称**。出现即为错误，请改用"门 + 限定词"。
_Avoid_: 全部

**闸门**:
**本仓不使用此词。** 存量的 11 处全部在冻结的历史档案与生成物内（清单见 Part 3 注记 2），本仓不再新用。规范替代：确定性阻断用**门 (Gate)**，人工介入点用**检查点 (Checkpoint)**。
_Avoid_: 全部

**检查 (Check)**:
不阻塞的验证动作。
_Avoid_: gate、门

**配额 (Quota)**:
账户维度的用量上限。与**限流 (Rate Limit)** 是两件事。
_Avoid_: gate、门禁

## 2.3 交付单元

**纵切 (Vertical Slice)**:
UVSD 协议下的**交付单元**：一个端到端、可上线、可观察的行为。
_Avoid_: 切片（单用）、task、job

**切片 (Slice)**:
文本、状态或统计上的局部片段（正文切片、质量切片、时间切片），**必须带限定词**。UVSD 的**交付单元**一律写全"纵切 (Vertical Slice)"。单用"切片"在本仓曾有三个冲突含义：纵切、遗留未做项、superpowers 计划章节。
_Avoid_: 单用（指 UVSD 交付单元或某个具体切片时）

**挂账项 (Deferred Item)**:
已识别、已裁决**不在当前范围内**的条目。`AGENTS.md` 曾称之为"遗留切片"，该说法已废止。
_Avoid_: 遗留切片、切片、V1.1 未做项

**任务 (Task)**:
**Part 1 §1.3 任务投影 (Task Projection) 的语义**，即 jobs/steps/attempts 账本单位。**不得**用来指"一件要做的事"。
_Avoid_: job、任务项、要做的事

**任务简报 (Task Brief)**:
superpowers 工作流的单位，属**已降级的历史层**，新工作不再使用。
_Avoid_: ticket、工单

## 2.4 决策、契约与文档分层

**决策记录 (ADR)**:
`docs/adr/` 下的一条不可变决策记录。编号规则与系列前缀见 `docs/adr/INDEX.md`。
_Avoid_: 纪事、变更日志、会议纪要

**纪事 (Chronicle)**:
带日期的决策叙述。**家 = `docs/adr/`**。本表与 `docs/architecture.md` 均不承载纪事。
_Avoid_: 写进术语表或架构地图

**架构地图 (Architecture Map)**:
`docs/architecture.md`——组合、核心包、依赖环、接缝、扩展点的**有序**地图，是生成物，禁止手改。
_Avoid_: CONTEXT.md、README

**契约 (Contract)**:
本仓有两个不同含义，**必须带限定词**：

| 限定词 | 含义 | 定义所在 |
|---|---|---|
| BFF 契约 | UI 消费的类型化接口契约，默认冻结 | `AGENTS.md` §3 |
| 领域契约 | 领域层的结构约束 | `docs/specs/` |

_Avoid_: 裸用"契约"

**接缝 (Seam)**:
可替换能力，必须同时具备**服务定义 (Service Definition)**、**服务提供者 (Service Provider)**、**消费者 (Consumer)** 三个角色。只有定义与提供者、零消费者的东西**不是接缝，是死代码**。
_Avoid_: 抽象、接口（不加限定）

**消费者 (Consumer)** / **提供者 (Provider)** / **定义 (Definition)**:
接缝的三角色。引用时必须说清是哪个接缝的哪个角色。
_Avoid_: 笼统说"那边"

**工作台 (Workbench)**:
**只指产品 UI**——作者的创作工作台（如 A 版双栏写作台）。
_Avoid_: agent harness 语境。该语境一律译作**智能体 Harness (Agent Harness)**

**智能体 Harness (Agent Harness)**:
可嵌入的 AI 代理运行时（如 DeepSeek Harness / DSH）。
_Avoid_: 工作台、workbench

**版本 (Version)**:
对外版本标识：发布版本号（以 `package.json` 为准）与画像版本（`StyleProfile vN`）。章一级的版次一律写 **revision**，不写"版本"。
_Avoid_: 用"版本"指章 revision；用"版本号"笼统指三者

**会话 (Session)**:
**必须带限定词。** 裸用"会话"只指**章节生产会话**（Part 1 §1.3）；登录态写**登录会话**，LLM 对话写**写作对话**。
_Avoid_: 全部（裸用指登录态或写作对话）

## 2.5 流程线（2026-10-01 裁决）

本仓同时存在六条历史工作流线。裁决后**只有一条有流程权威**：

| 线 | 裁决 | 家 |
|---|---|---|
| **mattpocock/skills（术语与流程权威）** | **保留，唯一流程权威** | `docs/agents/` + `AGENTS.md` |
| 应用线 UVSD | **并入 matt 线**，受其优先级规则裁决 | `AGENTS.md` §1–§8 |
| 内核线 Wayfinder | **并入 matt 线**，受其优先级规则裁决 | `AGENTS.md` §9 |
| spec-kit / speckit | **降级为产物目录**，模板不再产生新约束 | `.specify/`、`specs/` |
| superpowers | **降级为历史层**，brief/report 不再是新工作单位 | `docs/superpowers/`、`.superpowers/` |
| DSH `.dwf.ts` | **降级为任务级脚本**，不是流程 | `.zcode/workflow-drafts/` |

**优先级规则**：`AGENTS.md` 一次只描述一套流程。UVSD 的工程纪律条款与 Wayfinder 的追踪操作**互补而非竞争**，前者管"能不能做"，后者管"记在哪"。两者冲突时，**UVSD 的范围纪律优先**——宁可停下报告，不得自行扩大范围。

---

# Part 3 — 禁用近义词总索引

| 禁用词 | 规范词 | 依据 |
|---|---|---|
| 收据 / 上下文收据 | 上下文凭证 Context Receipt | Part 1 §1.2 |
| 候选（裸用） | 候选草稿 / 候选事实 / 候选条目 | Part 1 §1.1 |
| 书 / 本书 / 该书（指当前作品时） | 作品 Work | Part 1 §1.1 |
| 小说（指作者自己的作品时） | 作品 Work | Part 1 §1.1 |
| 会话（裸用） | 章节生产会话 / 登录会话 / 写作对话 | Part 2 §2.4 |
| 熔核 | 内核 Kernel（中文一律写"内核"） | Part 1 §1.1 |
| 数据平面 | 数据面 Data Plane（英文一律写 Data Plane） | Part 1 §1.2 |
| 门禁 / 闸门 / 裸 gate | 门 Gate + 限定词 | Part 2 §2.2 |
| 切片（指 UVSD 交付单元时） | 纵切 Vertical Slice | Part 2 §2.3 |
| 遗留切片 | 挂账项 Deferred Item | Part 2 §2.3 |
| 任务（指"要做的事"） | 议题 Issue / 挂账项 Deferred Item | Part 2 §2.3 |
| 任务简报 | 议题 Issue | Part 2 §2.3 |
| 工单 | 议题 Issue | Part 2 §2.1 |
| workbench（agent 语境） | 智能体 Harness | Part 2 §2.4 |
| 契约（裸用） | BFF 契约 / 领域契约 | Part 2 §2.4 |
| "Default" vs "Canonical" 二选一 | **canonical（规范）** | `AGENTS.md` 历史冲突 |

## 已知存量违规（冻结层不追改，不阻塞使用）

1. **9 个 `.scratch/mozhou-deepening-20260928/issues/*.md` 带 `status` frontmatter**（8 个 `ready-for-agent` + 1 个 `wontfix`），其余 65 个本地规格文档**没有**该字段，74 个中仅 32 个进 git。按 Part 2 §2.1，状态只应存在于 GitHub 议题，故这 9 个字段无权威。该批次已冻结（见 ADR-0034）。
2. **11 处"闸门"**。除本表、`docs/term-map.md` 与 `scripts/verify-glossary.mjs`（三处都是登记/检测该词本身）外，其余全部在冻结的历史档案内：`docs/adr/CODE-DUPLICATION-INVENTORY.md` ×3、`docs/archive/2026-10/audit-2026-10-03/01-baseline-and-graph-gate.md` ×3、`docs/research/t51-grill-learner-protocols.md`、`docs/archive/2026-08/novel-four-project-acceptance-matrix-2026-08-16.md`、`docs/archive/2026-10/w3-operations-implementation-report-2026-10-05.md`（引述禁令本身）、`docs/archive/2026-10/audit-2026-10-03/logs/014-AGENTS-md-diff.txt`、`PROJECT-MAP.md`。`packages/context-compiler/src/compile.ts` 的"硬隔离闸"已于 2026-10-05 改为"硬隔离门"。
3. **三套执行跟踪 ID 方案并存**：本地 `NN-<slug>`、speckit `[ID] [P?]`、GitHub `#31`。规范只剩 GitHub `#31`（议题）。
4. **两套"造什么"权威**：`AGENTS.md` §1（User journeys define product scope）与 `specs/*/spec.md`（User Scenarios）互不引用。规范权威是 `AGENTS.md` §1。
5. **冻结层的「门禁」「工单」「数据平面」存量。** 2026-10-07 完成活跃层清扫：代码注释与测试标题、`README.md`、包 README、`scripts/`、`.github/workflows/`、`docs/gates.md`、`eslint.config.js`；同时把 Part 3 禁用词接进 `pnpm run check:glossary`（只扫活跃层，范围见 `scripts/verify-glossary.mjs` §7）。剩余存量全部在冻结的历史档案（`docs/adr/`、`docs/changes/`、`docs/specs/`、`docs/handoff/`、`docs/audit/`、`docs/research/`、`docs/spikes/`、`docs/archive/2026-10/audit-2026-10-03/`、`handoff-results/`、`.scratch/`、`PROJECT-MAP.md`、根级历史审计报告）与生成物（`apps/web/src/code-graph/codeGraphData.*`、`docs/term-map.md`）中，按 §0 规则 6 不追改。
