---
date: 2026-08-27
description: 'Phase 6（双角色 UI）折叠规格——Novice Wizard 五步 + Pro Studio 三面板；来源：t73-t75 研究 + t76 grilling 终裁'
tags:
  - project-note
  - mozhou
---

# 双角色 UI 折叠规格（Phase 6）

> Wayfinder 地图 [#72](https://github.com/xiaohai-uid/mozhou/issues/72) · 研究：docs/research/t73-a / t74-b / t75-c · 裁决：docs/research/t76-grill-dual-ui
> 折叠纪律：只折叠不发明；冲突以 grilling 终裁为准

## 0. 一句话

**同一本书的两种视角**：Novice Wizard（五步引导）与 Pro Studio（三面板深控室）
共享 bookRoot 与 taskRef 会话——UI 是纯消费层，零新增后端能力，一切写路径经
既有 Session/对账守卫。

## 1. 全局裁定（t76）

- UI 消费层：显式类型化包契约直引，零 any/裸 map（UVSD §9-12）
- 底座：Vite + React + TS，apps/web 直引 workspace，无 HTTP BFF、无 TUI
- V1 切片：建书→世界观→大纲→首章→影响可见 五步全通；V2+ backlog

## 2. 旅程定义（t73）

| 步 | 用户动作 | 系统 | 失败 |
|---|---|---|---|
| 1 建书 | 书名/作者 | createBook | 目录非空→提示换路径 |
| 2 世界观 | 1 实体卡 | 写盘+投影 | CanonStructureError→就地纠错 |
| 3 大纲 | 卷/章节点 | 大纲树 | 同上 |
| 4 首章 | AuthorIntent | 十步流 | StepGuardError 显示步序 |
| 5 连写 | 下一章 | session 续接 | 不可续→回大纲 |

验收：每步台架确定性可复现；第 5 步产 ChapterCommitted 事件行。

## 3. 三面板（t75）

### Story Brain
- 读面：readCanonState（canon-read.ts:408）/scanEntityCards（:327）/queryActiveFacts
  （narrative-state.ts:129）/queryInvalidatedKnowledgeStates（:135）
- 交互：实体网格+大纲树+事实列表；全只读

### Context Viewer
- 读面：loadReceipt（receipt-file.ts）/loadReceiptForResume（compile-step.ts:138）
- 交互：Receipt 列表+详情（entries/replayInputs）+『从未决继续』（唯一写动作）

### Change Matrix（T34 含装配）
- 读面：listImpactRecords（impact.ts）/StaleMarker（stale.ts）/selectSemanticAnalysisRows
  （flywheel projection.ts:25）
- 新增只读投影：assembleChangeMatrix(root)（data-plane，T34 内联）
- 交互：矩阵表（行=Traversal/列=受影响章）+『重跑遍历』（写动作受幂等/预算）

## 4. 实现票切分（t76 D6）

- **T31** apps/web 底座 + 垂直切片（建书→首章→账本可见；Vite+React+TS 脚手架+
  根 workspace 挂载）
- **T32** Story Brain 面板（实体网格+大纲树+事实列表，只读渲染+契约快照测试）
- **T33** Context Viewer + Wizard 完善（Receipt 列表/详情/续跑按钮 + 五步表单壳
  与 Pro 切换路由）
- **T34** Change Matrix + assembleChangeMatrix（矩阵装配函数+矩阵表+重跑按钮）

依赖：T31 → T32/T33/T34（面板基于底座）。V1 完成 = 四票全绿 + 五步端到端台架 +
契约快照在册 + app 构建产物可静态打开。

## 5. 验收基线（t76 §4）

1. T31-T34 各自四绿；产物可静态打开
2. 五步旅程端到端（台架确定性）产 ChapterCommitted 可查
3. 三面板渲染走包类型契约零 any，快照测试在册
4. 上游 canon 改动→对账 applied→Change Matrix 新红行（端到端）
