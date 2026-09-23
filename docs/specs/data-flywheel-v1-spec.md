---
date: 2026-08-26
description: 'Phase 4（Data Flywheel V1）折叠规格——三学习者（AuthorPreferenceLearner/StyleLearner/TaskModelEvaluator）+事件供给面受控增补。来源：t47/t48/t49/t50 四份研究 + t51/t52/t53 三份 grilling 终裁（25 项决议，2 项 DEFER）'
tags:
  - project-note
  - mozhou
---

# 数据飞轮 V1 折叠规格（Phase 4）

> 相关笔记：[[data-flywheel-spec]] · [[runtime-capability-spec]] · [[capability-recipe-schema-v1]] · [[chapter-pipeline-spec]]
> Wayfinder 地图 [#46](https://github.com/xiaohai-uid/mozhou/issues/46) · 研究：docs/research/t47-a / t48-b / t49-c / t50-d · 裁决：docs/research/t51-grill-learner-protocols / t52-grill-event-supply / t53-grill-task-model-evaluator
> 折叠纪律：只折叠不发明；冲突以 grilling 终裁为准；未决项入 §7 待澄清

## 0. 一句话

**Phase 4 把 Phase 3 已落账的事件源（candidate_decision/UserEditRecorded/FlywheelRecorded/usage.jsonl/Benchmark 六指标）接上三个只读学习者（偏好/风格/任务模型），全部派生数据 P1 本地优先，只产建议不自动改路由。**

## 1. 三学习者总览表

| Learner | 输入信号 | 输出产物 | 存储 | 触发点 | 包位 |
|---|---|---|---|---|---|
| AuthorPreferenceLearner | candidate_decision 双路（强）+ UserEditRecorded edit_blocks（source==='author' 过滤）+ FlywheelRecorded（窗口锚点） | PreferenceProfile（七维特征均值+置信 κ） | .mozhou/preference/{observations.jsonl, profile.json} | user_edit 后增量 | packages/flywheel（首只学习者建包） |
| StyleLearner | UserEditRecorded 结构化块（replace/insert=正、delete→tabooWords 负） | StyleProfile vN ×4 场景型分面 | 文风.md fenced-YAML profiles map | Flywheel Record 步后，失败降级不阻断正文 | packages/flywheel |
| TaskModelEvaluator | 账本+usage.jsonl+矩阵行存档（三件）→ cell(taskType×route×recipeVersion) | RoutingSuggestion（纯数据建议）+ watch 条目 | .mozhou/suggestions.jsonl（派生面不入账本） | 按需重算（投影器） | packages/flywheel |

## 2. 决策正文（25 项终裁）

### 2.1 学习器协议（t51，10 项）

- **[A1]** κ₀=8；权重表 w = [1.0, 0.3, 0.15, 0, 0]（对应当前决策/近/中/远/最远档）；退火 = 1/(κ₀+W_d) 隐式衰减，**无日程表**；漂移检测单独用 α=0.15 短窗，**主均值不是 EMA**；σ 用加权增量方差，样本 <5 条跳过判定。出处 t51:A1。
- **[A2]** 否决延迟启动；七维 m₀ 全量定案：sent_len_mean=42 / sent_len_p90=65 / dlg_char_ratio=0.30 / para_line_span=2.0 / ttr_win500=0.55 / cand_len_diff=0 / level_ratio=0.5（后四项为 grilling 新钉）；profile.json 快照延迟到**首批观测后**物化。出处 t51:A2。
- **[A3]** 否决 displayOrder payload 增补——账本发布序即呈现序（multi-candidate.ts:69-83 保序发布 + ledger.ts:12-14 行序权威），payload 开洞属投机契约变更。出处 t51:A3。
- **[A4]** 特征最小面 f1-f7 逐字冻结（sent_len_mean/sent_len_p90/dlg_char_ratio/para_line_span/ttr_win500/cand_len_diff/level_ratio）；词表依赖型特征显式出界；R1 标量红线（只持久化标量、拒绝 P0 片段）作伴生验收断言。出处 t51:A4。
- **[B1]** 批准受控豁免案（否决去保护位）：种子自身同时要求 protected:true 与「EMA 算完即落盘」（create-book.ts:91,142）——I1 本意是挡生成管线非禁飞轮；解法=StyleProfileStore 唯一写者 + writeStyleProfiles 单口收口 + 强制 StyleProfileUpdated 审计事件，走 Contract Delta。出处 t51:B1。
- **[B2]** 批准复用 ProposalPort 第三后端 {port:'style'}；永挂待决、无超时自动生效、无静默批量接受。出处 t51:B2。
- **[B3]** 政策定案：跳过不落默认桶、冻结常量、台架回填两票节奏批准；**分类器置信阈值+触发词表初值 DEFER**（阻塞面：分类器未实现、无标注语料）。出处 t51:B3。
- **[B4]** 批准四场景型（action/dialogue/romance_emotion/exposition_worldbuilding）×4 section **全注入**、否决 top-2（选择器是误分类源且伤 Receipt 可复算性）；≤800 token 断言、超限抛错。出处 t51:B4。
- **[B5]** 批准 StyleProfileUpdated 入词表（非成对、EVENT_PAIRS 不动）；修正一处——**taskRef/chapterIndex 从 payload 剥到 DomainEvent 顶层**（domain-events.ts:38-44）。出处 t51:B5。
- **[B6]** 批准 α=0.05 / Δmax=0.1 / Nmin=10 / taboo（≥2 章 ≥3 次转正，容量 50）；澄清 Δmax 在常规 α 下恒不激活，真实作用域是 regimeChange α_boost=0.2 期的过冲保险丝。出处 t51:B6。

### 2.2 事件供给面（t52，8 项）

- **[B1]** 修改后批准：RuntimeEngine.execute 增第三可选参 meta（生产调用方仅 draft-step.ts:324 一处）；**eventPayload 弃平铺 recipeId/recipeVersion，改铸 M14 形状 toGenerationStartedPayload**（recipeSnapshot 三级嵌套，loader.ts:209-213；唯一消费者 version-matrix.ts:18-29 只走嵌套路径）；DraftStepRequest 增可选 recipeDoc；业务 payload 删 recipeId/recipeVersion 两键；**G1 接线并入同票**。出处 t52:B1。
- **[B2]** 批准+精度修正：deltaStats 五字段（opsInsert/opsDelete/opsReplace/insertedChars/removedChars）口径钉死；**removedText 全文无截断上限**（与无上限的 replacementText 对称，单侧截断废 diff 对称性）；仅发布侧克隆块携带、validateBlock 镜像守卫拒调用方传入。出处 t52:B2。
- **[B3]** 批准：nowMs? 缺省 Date.now（与 newTaskRef 先例同构，engine.ts:97）；「测量可缺省、时刻戳必显式」判例成立，注释级锚定**不开新 ADR**。出处 t52:B3。
- **[B4]** 批准：修桥不复制，FlywheelRecorded 形状零改动（record-step.ts:126-137 核实）。出处 t52:B4。
- **[B5]** 批准+硬约束：读侧 ?? null 缺省（record-step.ts:95-100 先例）；**DomainEvent 禁止新增顶层字段**——pipeline 读面逐字段白名单重建会静默丢弃未知顶层键（ledger.ts:57-63）；一切新字段进 payload 层。出处 t52:B5。
- **[B6]** 批准+勘误：learner 读面走 readPipelineLedger（双格式+position 权威序，pipeline/src/ledger.ts:13-24）；runtime readStoredLines 双格式容读不扩展是特性（runtime/src/eventBus.ts:54-56）；账本行序即权威时序。出处 t52:B6。
- **[Q-D]** 不做：scenarioType 等 #48 分类权属结论，不留投机槽位。出处 t52。
- **[Q-E]** 批准并具体化：TaskResult 增只读 taskRef（否则调用方拿不到本次 taskRef）；邻接启发式 lastGenerationFinishedReason 改精确折叠。出处 t52。

### 2.3 评估器信号（t53，7 项）

- **[C1]** 批准：只读投影器；Benchmark L1 判定器=**资格门**（机械六指标 gate 前置筛，偏好/经济信号只在合格集内择优），消费 evaluateMetricGate 禁复制门限表。出处 t53:C1。
- **[C2]** 批准+硬前置：cell 主键 = (taskType × route(providerId,model) × recipeVersion)；taskRef 同窗 join 前提**今天为假**（两个 taskRef 命名空间互不相连）——**#50-P1 桥接必须先行**；桥接合入前 evaluator 只许产 watch 条目。出处 t53:C2。
- **[C3]** 批准附记零边界条款：「走完 user_edit 步无编辑行」记 0 ≠「未走完」不入分母，两种空语义分开。出处 t53:C3。
- **[C4]** 批准两处修订：R1 锐化（资格门证据必须是覆盖**当前 CASE 全集的复跑报告**，堵「最近一次运行」陈旧漏洞）；R3 加地板效应条款（incumbent edit_ratio<0.05 时 S2 改**绝对不劣化**判据）。R2=最小样本 ≥30 决策且 ≥5 章；R4=切窗机制（14 天或 20 决策先到切窗）；R5=单变量单 cell 变更，原样定案。出处 t53:C4。
- **[C5]** 批准防过拟合四件套（最少样本/置信区间/影子期双轨对比/基准回归守卫 CASE-NNNN）；V1 影子期=时间切窗；可比性钉死在「同 taskType×同 recipeVersion」内。出处 t53:C5。
- **[C6]** 批准：只建议不自动改路由；RoutingSuggestion 纯数据走既有 loadTierConfig 机械校验 + mtime 热加载生效，**不新建写入通道**；suggestions.jsonl 派生面不入真源账本；重算输入面=账本+usage+矩阵行存档三件。出处 t53:C6。
- **[C7]** 批准 packages/flywheel 包位；**建包时机随首只 learner 实现票**；禁预铺 LearnerBase 抽象（工程守则 1/2：不做投机抽象）。出处 t53:C7。

## 3. 事件供给面受控增补清单（全部 payload 层/可选参数层）

| 补丁 | 位置 | 形状 | 兼容策略 |
|---|---|---|---|
| P1 执行桥接 | packages/runtime/src/engine.ts execute 第三参 | meta{parentTaskRef?, chapterIndex?, eventPayload?{recipeSnapshot}} | 可选参数，缺省行为不变 |
| P1a 请求面 | packages/pipeline/src/draft-step.ts DraftStepRequest | 增可选 recipeDoc | 可选字段，缺省不填 |
| P2 编辑 delta | user-edit-step recordUserEdit payload | deltaStats{opsInsert,opsDelete,opsReplace,insertedChars,removedChars} + delete/replace 块可选 removedText（全文无截断） | payload 层增补；读侧 ?? null |
| P3 生成时长 | RuntimeEngineDeps nowMs?（缺省 Date.now） | GenerationFinished 统一盖 durationMs | 可选注入；「测量可缺省、时刻戳必显式」 |
| Q-E taskRef | TaskResult | 增只读 taskRef 字段 | payload 层增补 |
| B5 顶层纪律 | DomainEvent | **禁止新增顶层字段**（如有意，须先过 contract delta 并同步 ledger.ts 白名单） | 强制执行 |
| StyleProfileUpdated | kernel/domain-events.ts 词表 | 非成对收尾事件；taskRef/chapterIndex 在 DomainEvent 顶层 | EVENT_PAIRS 不动 |

## 4. 数值常量总表（实现票单一事实源）

- 偏好：κ₀=8；w=[1.0,0.3,0.15,0,0]；退火 1/(κ₀+W_d)；漂移 α=0.15 短窗；σ 加权增量方差；<5 条跳过
- m₀ 七维：42 / 65 / 0.30 / 2.0 / 0.55 / 0 / 0.5（sent_len_mean/sent_len_p90/dlg_char_ratio/para_line_span/ttr_win500/cand_len_diff/level_ratio）
- 风格：α=0.05；Δmax=0.1（仅 regime α_boost=0.2 期生效）；Nmin=10；taboo 转正 ≥2 章 ≥3 次（容量 50）；四场景型全注入 ≤800 token
- 评估：R2 = 30 决策且 5 章；R3 地板 <0.05 改绝对判据；R4 切窗 14 天或 20 决策先到；R5 单变量
- 事件：deltaStats 五字段；removedText 全文无截断

## 5. 隐私与隔离铁律

- **R1 标量红线**：学习者只许持久化标量特征，任何 P0 正文片段（含 removedText/replacementText）禁止进入派生数据——写成测试断言（扫描 .mozhou/preference/ 与 style 产物无 P0 原文）
- **R2 导出二分**：P2 匿名导出只走白名单投影（规格 §4 telemetry JSON 是未来 P2 投影形状，非账本物理格式）
- **R3 删除即重置**：删 .mozhou/preference（及 style/suggestions 派生目录）= 完整重置，不触发对账破裂（.mozhou 不入 canon 基线）
- 关键事实 K1：replacementText（P0）已随事件 payload 进 events.jsonl（T17 既有合法行为）——隐私边界执行责任在消费者侧

## 6. 实现票验收对照（依赖序）

| 待拆实现 | 覆盖裁决 | 前置 |
|---|---|---|
| P1-P3 事件增补票 | t52 全量 + t51:B5 + t53:C2 前置 | T11/T17/T19 已给底座 |
| AuthorPreferenceLearner | t51:A1-A4 + t47 | 无需 P1（candidate_decision 已完备） |
| StyleLearner | t51:B1-B6 + t48 | StyleProfileUpdated 词表（t51:B5）；可与 P1 并行 |
| TaskModelEvaluator | t53:C1-C7 + t49 | **硬前置 P1 桥接**（C2）；此前只产 watch 条目 |

DEFER 回填：台架校准票（分类器置信阈值/触发词表/R_high/K）——不阻塞上述四票。

## 7. 待澄清

- 无实现阻塞级未决；其余留 DEFER 台架票。
