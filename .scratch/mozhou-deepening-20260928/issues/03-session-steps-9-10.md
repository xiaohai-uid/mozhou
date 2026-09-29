---
title: 让 session 走完第 9/10 步，而不是 abandon 掉
status: ready-for-agent
---

## 问题

ADR-0024 决策 4：「恢复 = 按步边界检查点重跑该步」。**这条今天不在生产路径上。**

实测生产调用方：

| 规则 | 生产调用方 |
|---|---|
| `runContinuityGate` | 1（`proseRoutes.ts:637,690`） |
| `createCanonProposal` | 1 |
| `runFlywheelRecord` | 1 |
| `runFinalExtract` | **0**（route 走 `deltaExtractor.extractChapterDelta`） |
| `watcher-checkpoint.ts` 整条 83 行 | **0** |

机制是通的：`advance(to, result?)` 有 result 参数，门禁判定走
`TaskStepTransitioned{to:'continuity_gate', payload.verdict}`（`projection.ts:110-112`），
`t19-rework.test.ts:161-163` 钉住了通过路径。**缺的只是有人去驱动它。**

## 为什么不能直接改

`/api/session.open`（`pipelineRoutes.ts:303-317`）开出的窗口**永远走不到第 9/10 步**
（没人传 gate verdict ⇒ `GateNotPassedError`，`session.ts:335-343`），
于是**永久占住全局单飞、锁死全书**。

这正是提交 `9b3b5f7` 引入 `abandonOpenWindow` 的根因（提交正文：「requestResubmit 开出的窗口永久占住单飞，全书锁死」）。
**天真地「让 web 走 session」就是重新引入一个已修的 bug。**

## 任务

让窗口能走完第 9/10 步，从而**不再需要 abandon**。具体形状由实现时定，但必须满足：

- 窗口从第 1 步开到第 10 步走完，`TaskStarted` 在**第 1 步**落账（不是第 9 步）——否则 `findOpenSessionWindow`（`projection.ts:201-226`）看不到它，
  `assertSessionStartable`（`session.ts:223-233`）的跨章单飞判据失效。
- 书级单飞**保留不变**（`GlobalSingleFlightError`，`session.ts:229-232`）。

## ADR

**补一条说明，不改决策。** 决策 4「按步边界检查点重跑」已隐含「窗口必须能走到第 9/10 步」；
决策 1（章=会话）与决策 4 自洽。缺的是执行，不是规格。
在 `docs/adr/0024-*.md` 追加：单飞判据是**书级**（全账本任一悬挂窗口），非章级。

## 验收

- 走完第 1→10 步的窗口**不占用** abandon 路径，且第 10 步后可正常推进下一章。
- 崩溃后 `resume` 能从步边界重跑（这是 ADR-0024 决策 4 唯一的可观察证据）。
- `abandon` 的调用方归零后，**才**允许删它。
- 六门禁全绿。

## 影响面

- `packages/pipeline/src/session.ts`、`proseRoutes.ts`、`pipelineRoutes.ts`
- `docs/adr/0024-chapter-pipeline-transactional-orchestration.md`（追加，不改决策）

## 依赖

依赖 02。


---

## 执行记录（2026-09-28 ZCode 工作流）

### 实现形状（工单授权「具体形状由实现时定」）

提交路径驱动器（`apps/web/server/routes/proseRoutes.ts`，/api/chapter.commit）：本章存在活动会话窗口
（TaskStarted 已在第 1 步落账，`session.ts:266-277`）且作者已把会话走到 user_edit 及之后
（步 2-5 由既有生产端点驱动：/api/session.advance 纯光标步进 `pipelineRoutes.ts:319-344`、
/api/chapter.review 真审查+recordQualityReview `pipelineRoutes.ts:624-692`）时，本次提交沿十步收口该窗口：

- 步 6：复用既有 `runFinalExtract`（`packages/pipeline/src/extract-step.ts:98`，此前 0 生产调用），
  web 提取器 `extractChapterDelta` 作为显式注入缝，CandidateDeltaExtracted 以会话 taskRef 落账（proseRoutes.ts:694-706）。
- 步 7：`runContinuityGate`（既有生产调用保留），verdict/hardConflicts 随 `advance('continuity_gate', result)`
  的 TaskStepTransitioned Result 字段进账（proseRoutes.ts:745-751）——pass 与 hard_conflict 都落账。
- 步 8：窗口内 `recordProposal` 配对头（payload 携带 web 提案 proposalId 作关联），幂等守卫防
  PAIRING_HEAD_UNCLOSED（proseRoutes.ts:662-669）；`web_commit_ch<N>_rev<R>` 键形状不变（工单 04 前置约束）。
- 步 9/10：`markCommitted` → `advance('flywheel_record')` → `finish()`（proseRoutes.ts:636-657），
  TaskFinished{outcome:'succeeded'} 闭合窗口，不占 abandon 路径。
- 恢复语义：驱动请求先 `adoptOpenHeads`（跨请求悬挂头认领，防 PAIRING_TAIL_WITHOUT_HEAD，proseRoutes.ts:618-626）；
  门禁 hard_conflict 悬置窗口由作者改文再提交显式驱动 `requestRework` 回炉重走（S7，proseRoutes.ts:711-718）；
  光标在 final_extract/continuity_gate/canon_proposal/commit 的崩溃续跑各自有幂等步进守卫。
- 未行走窗口（光标停在 prepare..review）驱动面空转（`driveEngaged=false`），保持既有作废收口——
  步 2-5 的编译/审查工作属其他端点，路由不伪造会话步。
- 响应新增 `sessionWindow` 呈现面 {driven, taskRef, completed, errorDetail}（proseRoutes.ts:280-293）；
  驱动收口是派生面，失败不回退已落定的提交（S12 同款纪律）。

### abandonOpenWindow 处置（按工单条件，未删除）

生产调用方现状：仍为 2——`proseRoutes.ts:608`（未行走窗口的提交出口作废收口）与
`pipelineRoutes.ts:373`（POST /api/session.abandon 取消端点）。两者在「窗口已被行走→提交完成收口」
之外仍是必要出路（作者重提交后不驱动会话 / 作者中途放弃），调用方未归零 ⇒ 按工单「调用方归零后才允许删」
**保留不删**。底层 `session.abandon`（`session.ts:520-541`）是完整实现且被测试钉住（取消路径），本票未削弱它。
替代链路（完成收口）已验收（下测试 1/2/3）。

### ADR-0024（追加，不改决策）

`docs/adr/0024-chapter-pipeline-transactional-orchestration.md` 新增「补充说明（2026-09-28）」一节：
单飞判据是**书级**（findOpenSessionWindow 扫全账本任一悬挂窗口），非章级；决策 4 隐含窗口必须能走到
第 9/10 步，本票补的是执行链路，决策 1-5 内容不变。

### 修改文件

- `apps/web/server/routes/proseRoutes.ts`（驱动器 + 响应呈现面 + 头注释更新）
- `apps/web/server/routes/proseRoutes.sessionComplete.test.ts`（新增，5 用例）
- `docs/adr/0024-chapter-pipeline-transactional-orchestration.md`（追加一节）
- 基线/补丁：`.dsh-audit/implementation-20260928/patches/03-before.patch`（20 行，含工单 01 既有 dirty）/
  `03-after.patch`（706 行，含新增测试文件）

### 测试命令与退出码（本机实跑）

| 命令 | 结果 |
|---|---|
| `pnpm exec tsc -p tsconfig.server.json --noEmit`（apps/web） | exit 0 |
| `pnpm --filter @mozhou/web exec vitest run <12 个目标/相邻测试文件>`（本票新增 + proseRoutes 全系 + api.test） | **136 passed（12 files），exit 0** |
| 其中新增 `proseRoutes.sessionComplete.test.ts` | 5 passed：正常完成 / 拒绝门禁 / 崩溃恢复（requestRework 回炉续跑）/ 取消 / 未行走窗口保持作废收口 |

覆盖对照工单验收：✅ 走完 1→10 步的窗口不占 abandon 路径且第 10 步后别章 session.open 200、同章可再 resubmit；
✅ 崩溃后 resume 从步边界重跑（HTTP 层证据=悬置窗口经 requestRework 从 continuity_gate 边界续跑至完成；
管线层「任意步 resume」由既有 `session.test.ts:123` 钉住，本票未改管线）；✅ 取消路径（abandon）保持可用；
✅ 书级单飞保留不变（未改 session.ts；悬置窗口期间别章开卷 409 有断言）。同书竞争：窗口悬置期单飞 409 +
同章重复提交 409 已覆盖（后者由工单 02A 的 proseRoutes.repeatCommit.test.ts 钉住）；并行 HTTP 竞态未单独压测
（V1 全局单飞 + 单实例串行发布为既有裁定，t19-single-flight.test.ts 已钉）。

### 影响面（GitNexus impact，repo="C:\zcode\novel-ai"）

`impact(ChapterProductionSession, upstream)` → **HIGH**：直接调用方 6（pipeline index、resubmit.ts、review-step.ts、
start/resume/abandonOpenWindow ← pipelineRoutes 与 proseRoutes）。本票**未改** packages/pipeline 任何签名，仅在
proseRoutes 新增驱动调用；HIGH 波及面（requestResupmit / session 端点 / 作废收口）全部由上述回归测试覆盖。
注意：GitNexus 索引落后 HEAD 17 个提交（P0 索引重建仍被权限阻塞），影响面结论以此为限。

### 未验证 / 未覆盖

- 六门禁中 typecheck（web server 侧）/ 目标测试已实跑；根包全套、web 全套、lint、构建、图谱门禁（gitnexus check）
  由编排脚本统一执行，本工单未重复跑。
- GitNexus `detect_changes` 未跑：索引落后 17 提交且本票不产生 commit；以补丁 + 测试为变更证据。
- runFinalExtract 的 failed_recoverable 路径在生产缝（extractChapterDelta 不抛错、失败返回空批+原因）下不可达，
  其语义由管线既有测试覆盖，本票未新增 HTTP 层用例。
- 未调用任何收费 API：提取缝打夹具、审查用确定性规则策略、编译走 runCompileStep，全程零模型调用。

### 判定

工单验收 4 条全部满足（完成收口链路 / resume 步边界重跑 / abandonOpenWindow 按条件处置并记录 / 本票目标测试全绿）。
**status: done**（以本票范围计；跨票的索引重建与全套门禁归编排脚本）。
