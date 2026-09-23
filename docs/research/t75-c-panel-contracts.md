# T75 三面板数据契约（Phase 6 · issue #75）

> 状态：定稿 ｜ 研究者：主会话（Wayfinder）｜ 日期：2026-08-27
> 证据纪律：结论带 文件:行号；无代码证据处标【推断】。

## 1. 结论摘要

三面板全部可基于**既有读面**渲染，零新增后端能力（除 Change Matrix 的行组装
可选补齐一个只读投影）。契约原则：UI 消费显式类型化包类型，零 any/裸 map
（UVSD §9-12）；面板只读，写路径全经既有 Session/对账守卫。

## 2. Story Brain 契约

| 面板分区 | 数据源读函数 | 输出形状 | 字段清单 | 只读 |
|---|---|---|---|---|
| 全书概览 | readCanonState(root)（canon-read.ts:408） | CanonState | book/chapters/entities/summary 计数 | ✓ |
| 实体网格 | scanEntityCards(root)（canon-read.ts:327） | EntityCardScan[] | id/kind/name/summary（按 kind 分栏） | ✓ |
| 章大纲树 | OutlineNodeScan（canon-read.ts:31） | 大纲节点 | chapterIndex/title/status/stale 三字段 | ✓ |
| 事实列表 | queryActiveFacts(root,{...})（narrative-state.ts:129） | TemporalFact[] | 事实字段全集 | ✓ |
| 失效知识 | queryInvalidatedKnowledgeStates(root)（narrative-state.ts:135） | KnowledgeState[] | 知识态字段 | ✓ |

缺口：实体间关系边（relationshipState/timelineEvent 的图查询）现读面以表格返回
——V1 网格呈现足够；图可视化进 V2 backlog【推断：sprint 长度不足不扩读面】。

## 3. Context Viewer 契约

| 分区 | 数据源 | 形状 | 字段 | 只读 |
|---|---|---|---|---|
| Receipt 列表 | 扫 .mozhou/receipts/ 目录（receipt-file.ts 读面） | ContextReceipt[] | receiptId/createdAtIso/taskRef/chapterIndex | ✓ |
| 单份详情 | loadReceipt(root,id)（receipt-file.ts） | ContextReceipt | recomputationHash/entries（含 included 与排除理由）/replayInputs/structural | ✓ |
| 续跑凭据 | loadReceiptForResume(root,id)（compile-step.ts:138） | ContextReceipt | INV-R1/R2 凭据（存在性） | ✓ |
| 从未决继续 | compile-step（写路径） | 续跑开始 | 传 receiptId | 动作（受 Session 守卫） |

## 4. Change Matrix 契约

| 行来源 | 数据源 | 形状 | 字段 | 只读 |
|---|---|---|---|---|
| 上游变更 | TraversalFinished 事件 / impact 投影（impact.ts listImpactRecords） | ImpactRecord[] | traversalId/upstreamChanges/affectedChapters/affectedFingerprint/recordedAt | ✓ |
| 矩阵章状态 | 章大纲 frontmatter StaleMarker（stale.ts 三字段） | StaleMarker | reason/markedAt/upstreamRefs | ✓ |
| 语义 verdi ct | selectSemanticAnalysisRows(root)（flywheel projection.ts:25） | SemanticAnalysisRow[] | report_id/receipt_id/chapter_index/verdict/finding_count | ✓ |
| 重跑遍历 | runTraversal（impact.ts） | TraversalOutcome | 动作（受预算/幂等约束） | 动作 |

条目级应对：单元格 red=StaleMarker 命中 + 语义 verdict 徽标；行=单次 Traversal。

## 5. 缺口清单

1. 【建议补齐】矩阵行组装只读投影：单函数 assembleChangeMatrix(root) 把 impact
   记录 + StaleMarker + 语义行合成矩阵（一行=Traversal，列=受影响章）——放
   packages/data-plane（或 flywheel）一票内完成，UI 只消费这一形状
2. 【backlog】关系图可视化查询（Story Brain V2）；WebSocket/轮询实时刷新（本地
   单机每次动作后重读即可，无需推送）
3. 【不扩】HTTP API 层（T74 否决）；UI 中间层缓存（单机重读便宜）

## 6. 契约纪律落点

- 全部消费走包类型 import（readCanonState 等签名直引），UI 层不手写形状
- 面板组件只读渲染；唯一写动作（续跑/重跑遍历）必须显示进行态与结果（UVSD §14
  失败显式）
- 测试：台架级 UI 走组件测试（vitest）+ 契约快照（面板输入形状与后端类型同步）
