---
title: 把 254 行内联编排收进一个深 module
status: ready-for-agent
---

## 问题

`proseRoutes.ts:490-743` 是 254 行就地实现的步 6-10 编排，与 `packages/pipeline/src` 里的 module 实现**是同一套规则的第二份**。ADR-0024 说一遍，module 写一遍，route 又写一遍。

web 路径还开着自己的 taskRef 命名空间（`proseRoutes.ts:159-161`），且 `proseRoutes.ts:85-91` 自己写着「本路径**不发射 CanonCommitted**」——注释是诚实的，它承认的是系统里存在两个「什么算提交完成」的形状。

## 关键约束（踩过才知道）

**窗口键 `web_commit_ch<N>_rev<R>` 改不动。** 它被以下位置依赖：

- `packages/pipeline/src/user-edit-step.ts:553,606` —— 风格学习器按 taskRef **精确匹配**
- `packages/pipeline/src/whole-body-edit.test.ts:49,197`

`user-edit-step.ts:553-560` 的注释把脆弱性写得很清楚：「作者改完再原样重存一次会把前一条信号挤出窗口键，本窗口信号整体归零」。
**改键 = 同时打断风格学习器与 T21 编辑 delta。**

所以收口时**保留现有 taskRef 形状**，除非单独开票改学习器的关联键。

## 验收

- 254 行的编排规则在 `route` 侧**只出现一次**（其余调用 module）。
- 现有 `proseRoutes.*.test.ts`（约 2263 行）里重复断言 pipeline 规则的部分**删除**，
  **只保留端点契约断言**——那 6800 行 pipeline 测试已经断言过一次了（规则 21 允许删重复，  但必须在票里逐条列出删哪些、为什么）。
- 六门禁全绿。

## 影响面

- `apps/web/server/routes/proseRoutes.ts`（-254 行或显著减）
- `packages/pipeline/src/`（可能新增一个 module）

## 依赖

依赖 03。

---

## 执行记录（2026-09-28 ZCode 工作流）

### 修改文件

| 文件 | 变化 |
| --- | --- |
| `packages/pipeline/src/commit-orchestration.ts` | **新增**（470 行）：步 6-10 提交编排单一事实源 `runChapterCommit` + 窗口键生成器 `webCommitWindowTaskRef` |
| `packages/pipeline/src/index.ts` | +16：导出上述模块及其类型 |
| `apps/web/server/routes/proseRoutes.ts` | 901 → 621 行（−280）：commit 段编排（原 :518–:898 含 try/finally）替换为 `runChapterCommit` 调用 + 四类结局 → 响应契约映射；本地 `windowTaskRef` 删除（改 import 管线版）；三个响应视图接口改为管线类型别名 |
| `apps/web/server/proposals.ts` | −17：删除 `openProposalForTask` / `openProposalsOfChapter`（随编排迁入管线 module，成为私有实现；`pipelineRoutes.ts` 只用 `canonProposalView`，不受影响） |

路由侧现仅保留：输入解码（chapterIndex/summary/usageFacts 校验，:499–:529）、身份/书权限（`assertSafeBookRoot`，:531）、注入缝（web 提取器 + StyleLearner 钩子，:532–:544）、响应契约映射（四类结局 + catch 错误码映射，:545–:613）。

### 验收对照（工单验收标准）

1. **编排规则在 route 侧只出现一次（其余调用 module）** ✅
   步 6 相位守卫、D06 钉版回读、窗口键、提案续接/stale/待决规则、门禁两道、commitChapter、markConsumed、飞轮记账、会话驱动与作废收口全部只在 `commit-orchestration.ts`（:179–:470）；route 侧零第二实现，只有结局→HTTP 映射（proseRoutes.ts:545–:613）。
2. **保留 `web_commit_ch<N>_rev<R>` 键形状** ✅
   生成器单一事实源迁至 `commit-orchestration.ts:61`（字符串逐字节不变：`'web_commit_ch' + chapterIndex + '_rev' + revision`），提交路径（module 内 :262）与保存路径（proseRoutes.ts:345）同源引用；`user-edit-step.ts:553` 依赖的匹配键、`whole-body-edit.test.ts:49,197` 钉住的形状均未动。
3. **风格学习器 / T21 编辑 delta / proposal/ledger 关联不回归** ✅（由既有测试实证，见下）
   - 学习器窗口锚：`proseRoutes.sessionComplete.test.ts:274-280`（FlywheelRecorded taskRef 正则 `^web_commit_ch1_rev\d+$`）通过；
   - 保存→学习器端到端：`proseRoutes.authorEditSignal.test.ts`（7 用例，含「StyleLearner 真的读到本窗口编辑并更新文风.md」）通过；
   - proposal/ledger 关联：`proseRoutes.proposal.test.ts`（10 用例：PENDING/STALE/续接/队列确认）+ `flywheelRecord.test.ts`（14 用例，含 `toEqual` 精确匹配 4 字段视图与 afterRecordError）通过；工单03 会话驱动（步锚/配对头/markCommitted/finish）由 `sessionComplete.test.ts` 5 用例钉住，通过。

### 测试命令与退出码（本票实际执行）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @mozhou/pipeline build` | exit 0 |
| `pnpm exec tsc -p tsconfig.server.json --noEmit`（apps/web） | exit 0（两次：重构后 + 注释修正后复查） |
| `pnpm exec vitest run server/routes/proseRoutes.{test,gate,proposal,flywheelRecord,dependencyManifest,repeatCommit,commitExternalChange,sessionComplete,resubmit,resubmitAbandon,authorEditSignal}.test.ts`（apps/web） | **11 files / 80 tests 全过**，exit 0 |
| `pnpm exec vitest run server/routes/fullJourney.test.ts`（apps/web） | 1 test 过，exit 0 |
| GitNexus `check`（repo=C:\zcode\novel-ai） | `status: clean, cycleCount: 0`（注：索引落后 HEAD 17 个提交，结果基于既有索引；新模块为纯新增无环，import 方向 pipeline→data-plane/kernel/runtime 既有依赖） |

按测试分工未跑：web 全套 vitest、根包全套、全仓 typecheck/lint——由脚本在本票之后统一执行。

### 测试保留声明（删除清单为空）

未删除、未弱化任何既有断言。工单原文设想的「删除 proseRoutes 测试里重复断言 pipeline 规则的部分」经核查不适用：这些测试全部是**黑盒真实 HTTP 端点契约测试**（起真实 server、临时书目录，断言响应码/响应体/盘面事件），断言的是端点可观察行为而非 pipeline 内部规则，工单要求的「只保留端点契约断言」正是它们的现状。新增编排 module 未另写单测：其全部行为面（相位守卫零消耗、三类挂起、驱动收口、键形状、注入缝）均被上述 HTTP 套件钉住，pipeline 级单测只会复制同一断言（规则 21 反重复精神）。

### 证据（文件:行号）

- 编排单一事实源：`packages/pipeline/src/commit-orchestration.ts:61`（窗口键）、`:188-191`（相位守卫先于提取，工单02A 顺序不变）、`:218`（afterRecord 钩子留痕再抛）、`:325`（提取缝注入调用）、`:179`（编排入口）。
- 注入缝：`apps/web/server/routes/proseRoutes.ts:532-544`（extractDelta 带 principal 的 resolveEndpoint；afterRecord 调 StyleLearner）。
- 响应契约映射：`proseRoutes.ts:545-558`（STALE）、`:559-570`（GATE_CONFLICT，proposalId 条件携带）、`:571-586`（PENDING）、`:587-598`（200 committed，canonProposal 视图重载后映射）；catch 错误码映射原样保留（PROSE_EXTERNAL_CHANGE/CHAPTER_ALREADY_COMMITTED/CHAPTER_MISSING/500）。
- 补丁存档：`.dsh-audit/implementation-20260928/patches/04-before.patch`（基线，含工单01-03既有改动）、`04-after.patch`（3 个 tracked 文件 diff，544 行）、`04-new-commit-orchestration.NOTE.md`（新文件获取方式：安全 hook 禁止 shell cp .ts，改 `git diff --no-index /dev/null packages/pipeline/src/commit-orchestration.ts` 查看）。

### 判定

**done（本票范围内）**。行为等价由 80+1 个既有测试全绿实证，未以行数变少代替等价性。遗留边界：全量门禁（typecheck/web 全套/根包全套）与图谱索引重建按计划分工由后续脚本执行，本记录未声称已完成。

