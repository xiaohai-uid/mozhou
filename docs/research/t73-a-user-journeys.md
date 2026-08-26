# T73 用户旅程与 UX 流（Phase 6 · issue #73）

> 状态：定稿 ｜ 研究者：主会话（Wayfinder）｜ 日期：2026-08-27
> 证据纪律：结论带 文件:行号；无代码证据处标【推断-设计建议】。

## 1. 结论摘要

- Novice Wizard 与 Pro Studio 是【同一本书的两种视角】，非两套产品——共享同一
  taskRef 会话与 canon 数据面，切换零状态丢失。
- V1 垂直切片 = 建书 → 世界观（1 实体卡）→ 大纲（1 章）→ 首章（AuthorIntent
  提示词 → 十步流）→ 影响可见（改上游 → Change Matrix 出红）——五步各完成即验收。
- 全部用户动作收敛到三个后端入口：createBook（建书）、ChapterProductionSession
  （十步流）、readCanonState/queryActiveFacts 等读面（面板渲染）——UI 层零新后端
  能力，只做编排与呈现。

## 2. Novice Wizard 五步旅程

| 步 | 用户动作 | 系统回应 | 数据面（文件:行号） | 失败处理 |
|---|---|---|---|---|
| 1 建书 | 输入书名/作者 | 建书目录+种子 | createBook（create-book.ts:96） | 目录非空抛 BookDirectoryNotEmptyError（:37）→ UI 提示换路径 |
| 2 世界观 | 填写 1 张实体卡（角色/设定） | 实体卡写盘+投影刷新 | readCanonState/scanEntityCards（canon-read.ts:327,408） | 格式错→CanonStructureError（:23）→ 就地纠错 |
| 3 大纲 | 输入卷/章大纲节点 | 大纲树写盘 | OutlineNodeScan（canon-read.ts:31） | 同上 |
| 4 首章 | 写 AuthorIntent 提示词 | 十步流跑通（compile→draft→review→edit→gate→commit） | ChapterProductionSession（session.ts:125）+ compile-step 续跑凭据（compile-step.ts:138 loadReceiptForResume） | StepGuardError 族（session.ts:37-117）→ 显示当前步与期望步 |
| 5 连写 | 下一章 | 新 session 续接 | session 按章 new | SessionNotResumableError（:48）→ 引导回大纲 |

验收判据：每步完成后台架可复现（确定性注入），五步按序可走通且第 5 步产出
ChapterCommitted 事件行；任一步失败给出可操作错误。

## 3. Pro Studio 三面板

### 3.1 Story Brain（全书图景）
- 数据源：readCanonState（canon-read.ts:408）→ CanonState；queryActiveFacts
  （narrative-state.ts:129）、queryInvalidatedKnowledgeStates（:135）
- 交互面：实体卡片网格（kind 分栏）+ 章大纲树（左侧）+ 事实列表（右侧）；点击
  实体过滤关联事实
- 读写边界：只读视图（读面全为 pure 查询）；编辑走编辑抽屉→canon 写路径
  （T5 对账守护）

### 3.2 Context Viewer（装配看板）
- 数据源：Receipt 物理文件读面——loadReceipt（context-compiler receipt-file）、
  loadReceiptForResume（compile-step.ts:138）；显示 recomputationHash/entries/replayInputs 摘要
- 交互面：最近 Receipt 列表 + 单份详情（entries 分键折叠、replayInputs 展开）+
  「从未决继续」按钮（receiptId 续跑）
- 读写边界：只读呈现 Receipt；续跑动作调 compile-step（写路径受 Session 守卫）

### 3.3 Change Matrix（影响矩阵）
- 数据源：StaleMarker（stale.ts frontmatter 三字段）、impact 投影（impact.ts
  listImpactRecords）、语义报告（flywheel semantic/projection.ts selectSemanticAnalysisRows）
- 交互面：矩阵表（行=上游实体变更，列=受影响章），单元格=Stale 状态+语义 verdict
  徽标；点击行→Traversal 详情
- 读写边界：只读；「重跑遍历」按钮调 runTraversal（受预算与幂等约束）

## 4. 双角色切换与状态共享

- 同一 bookRoot 即状态：Wizard 完成步 3 后同一本书可切 Pro 三面板（读面全通）；
  Pro 内编辑抽屉=Wizard 编辑的 Pro 形态（同一 canon 写路径）
- taskRef 会话按章隔离（session.ts:39 activeTaskRef），两角色共享 canon+投影，
  切换零迁移

## 5. V1 垂直切片验收判据

1. 建书→世界观→大纲→首章→连写 五步按序可走通（台架确定性）
2. 首章产出 ChapterCommitted 事件行（账本可查）
3. 改上游事实（对账 applied）→ Change Matrix 出现新红行（impact 投影更新）
4. 三面板全为只读渲染，写路径全部经既有 Session/对账守卫
5. 契约型：全部 UI 消费走显式类型化读函数，零 any/裸 map（UVSD §9-12）

## 6. 证据清单

| 结论 | 证据 |
|---|---|
| 建书入口 createBook | create-book.ts:96 |
| 十步流 Session | session.ts:125 |
| Receipt 续跑 | compile-step.ts:138 |
| Story Brain 读面 | canon-read.ts:408；narrative-state.ts:129,135 |
| Change Matrix 读面 | stale.ts；impact.ts；flywheel projection.ts:25 |
| 错误族 | session.ts:37-117 |
