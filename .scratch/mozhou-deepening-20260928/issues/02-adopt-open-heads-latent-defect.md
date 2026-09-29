---
title: 重复提交会白烧一次 LLM，并埋下 PAIRING_HEAD_UNCLOSED
status: ready-for-agent
---

## 问题

**两个缺陷，同一根因：提交端点没有幂等性。**

### 缺陷 A：重复提交先烧钱后报错

`/api/chapter.commit` 的 490-743 段 grep `idempot|expectedRevision|expectedSha256|CAS` **零命中**。
`CommitChapterRequest`（`chapter.ts:436-455`）本身也没有这两个字段。唯一守卫是相位机：
`commitChapter` 抛 `ChapterPhaseError` → 409（`proseRoutes.ts:732-734`）。

第二次提交的实际执行顺序：

1. `openProposalForTask` 因首投已 `markConsumed`（`proseRoutes.ts:714`）返回 null
2. **重跑 `extractChapterDelta`（`:605`）—— 一次真实 LLM 调用**
3. 再落一份 `prp_*.json` 与**第二个同名 head**
4. 最后才撞相位 409

**作者双击提交，Key 就烧掉一次。**

### 缺陷 B：head 键复用会砸掉提交

`PublishBus.adoptOpenHeads`（`eventBus.ts:125-138`）对全账本**无窗口、无 position 门控**地折叠所有任务行。
配对键 = `${pair[0]}#${event.taskRef}`（`eventBus.ts:88`），而 `windowTaskRef`（`proseRoutes.ts:159-161`）是**确定性**的
`web_commit_ch<N>_rev<R>`。同一章同一 revision 重复提交 ⇒ **同一 head 键** ⇒ `recordProposal` 撞 `PAIRING_HEAD_UNCLOSED`（`eventBus.ts:90-95`）。

今天侥幸没炸：每处都 `new PublishBus()`（`proseRoutes.ts:538/549/572/652`），内存 head 表 `#openHeads`（`eventBus.ts:78`）是空的。
`adoptOpenHeads` 目前只有 `abandon` 走（`session.ts:534`）。

**注意**：缺陷 B 的实际行为是静态推断，walker 标为 UNKNOWN，**本票必须先实跑复现再改**。

## 修复顺序

1. **先复现缺陷 B**：构造旧 web 形状的悬挂 head + 新开 PublishBus 走 `adoptOpenHeads`，断言是否抛 `PAIRING_HEAD_UNCLOSED`。
   复现不出来 ⇒ **停下来报告**，不要按推断改。
2. 缺陷 A：把相位/提案检查**前移到 LLM 调用之前**。重复提交应在 0 消耗处拒绝。
3. 缺陷 B（仅在复现成立时）：head 键纳入运行实例唯一性，或 `adoptOpenHeads` 补 position 门控。
   **具体方案由复现结果决定，本票不预设。**

## 验收

- 缺陷 A：同一 revision 连发两次 commit ⇒ 第二次 **0 次 LLM 调用** 且 409。用夹具计数断言。
- 缺陷 B：RED→GREEN，且补一条**留在仓库里**的回归测试。
- 六门禁全绿。

## 影响面

- `apps/web/server/routes/proseRoutes.ts:490-743`
- `packages/runtime/src/eventBus.ts`（仅缺陷 B 复现成立时）

## 依赖

无。可与 01 并行。

## 执行记录（2026-09-28 ZCode 工作流）

### 缺陷 A：同 revision 重复提交（已修复）

- **RED 复现**：`apps/web/server/routes/proseRoutes.repeatCommit.test.ts`（计数抽取夹具，真实 normalizeDelta 产行）。修复前实跑失败：`第二次提交不得重跑提取: expected 2 to be 1`——第二次提交确实重跑了提取（工单推断的执行顺序 1→4 成立；409 状态码本就正确，缺的是 0 消耗）。
- **修复**：`apps/web/server/routes/proseRoutes.ts:524-530`——commit 段在读入正文后、`extractChapterDelta`（:617）之前前置相位检查：`proseFile.phase !== 'draft'` 即抛 `ChapterPhaseError`（detail 与 `packages/data-plane/src/chapter.ts:565-566` commitChapter 同文案），由既有 catch（:750-752）渲染同一 409 `CHAPTER_ALREADY_COMMITTED` 形状，响应契约不变。提案续接/stale 检查原本就在提取之前（:593-612），未动。
- **GREEN**：同文件测试通过；断言第二次提交 409 + `fixture.calls===1`（0 次提取调用）+ 提案文件数 1（无第二份 prp_*.json）+ events.jsonl 字节级零追加（无第二个同键 CanonProposalCreated 头）+ 正文文件字节级不变。
- **夹具边界**：计数抽取器只证明控制流（0 消耗拒绝），不冒充真实模型质量或费用验证（无任何收费 API 调用）。

### 缺陷 B：adoptOpenHeads 潜伏缺陷（已实跑复现 → 已修复）

- **RED 复现（工单要求先复现再改）**：`packages/runtime/src/eventBus.test.ts`「工单 02B position 门控」组，第一用例以 createCanonProposal 的真实发布载荷形状（`packages/pipeline/src/proposal-step.ts:289-297`）在账本落一条旧 web 形状悬挂头 `CanonProposalCreated#web_commit_ch1_rev1`，新实例 `adoptOpenHeads` 后再发同键新头——修复前实跑抛 `PairingError: PAIRING_HEAD_UNCLOSED: CanonProposalCreated#web_commit_ch1_rev1 尚未闭合，禁止再次开启`（eventBus.ts:90-95 机制，walker 的 UNKNOWN 判定证实为真）。**复现成立，故按工单授权修改 eventBus。**
- **修复**：`packages/runtime/src/eventBus.ts:139-167`——`adoptOpenHeads` 补 position 门控（工单两授权方案之一）：只认领「当前开卷窗口」（最后一个未闭合 TaskStarted 及其后）内的 head；TaskFinished 闭合窗口后到下个 TaskStarted 之间的 head 不认领；新 TaskStarted 取代旧窗口时清零（与 `packages/pipeline/src/projection.ts` projectSession.openHeads 的窗口闸同源）。未改 head 键形状（`web_commit_ch<N>_rev<R>` 保留，plan P3 要求）；未改任何 events.jsonl 存量数据。
- **留仓回归**：4 条新用例钉住——窗口外 web 悬挂头不认领且同键新头可开；当前窗口内 head 仍认领（abandon/跨请求闭合能力不回退，TaskFinished 不误伤窗口内提案头）；被取代旧窗口不认领；窗口闭合后的窗口间悬挂头不认领。

### 验证（实际执行的命令与退出码）

| 命令 | 结果 |
| --- | --- |
| `npx vitest run packages/runtime/src/eventBus.test.ts`（修复前） | 退出码 1：4 failed（缺陷 B 复现）/ 10 passed |
| `npx vitest run packages/runtime/src/eventBus.test.ts`（修复后） | 退出码 0：14/14 passed |
| `npx vitest run server/routes/proseRoutes.repeatCommit.test.ts`（apps/web，修复前） | 退出码 1：`expected 2 to be 1`（缺陷 A 复现） |
| 同上（修复后） | 退出码 0：1/1 passed |
| `npx vitest run` 9 个 `server/routes/proseRoutes.*.test.ts`（apps/web） | 退出码 0：9 文件 / 74 tests passed（含 resubmitAbandon 真实走 abandon→adoptOpenHeads 链、proposal 续接/重提案不变量） |
| `npx vitest run packages/runtime/src packages/pipeline/src/{resubmit,session,nine-boundaries,t19-single-flight}.test.ts` | 退出码 0：13 文件 / 178 tests passed（runtime 全包 + adoptOpenHeads 全部消费方） |
| `npx vitest run server/routes/fullJourney.test.ts`（apps/web） | 退出码 0：1/1 passed |
| `pnpm --filter @mozhou/runtime exec tsc -p .` | 退出码 0 |
| `pnpm typecheck`（apps/web） | 退出码 0 |

### 影响面分析（GitNexus MCP，repo=绝对路径）

- `adoptOpenHeads` upstream：risk=LOW，epistemic=exact；d=1 唯一直接调用方 `ChapterProductionSession.abandon`（session.ts:534），d=2 `abandonOpenWindow`，d=3 `pipelineRoutes` + `proseRoutes.cleanupStaleResubmitWindow`，2 条受影响流程——与手工 grep 一致，门控后全部保留认领当前窗口 TaskStarted 的能力。索引落后 17 个提交（拓扑仍与现场吻合，已在结果中标注）。
- `proseRoutes` upstream：impactedCount=0（叶子路由），risk=LOW。

### 判定

**done**。两缺陷均 RED→GREEN；验收三条全部满足（缺陷 A：同 revision 二次提交 0 次提取调用 + 409 + 无第二次提案写入；缺陷 B：复现成立 + 留仓回归测试；夹具只证控制流）。补丁存档 `.dsh-audit/implementation-20260928/patches/02-before.patch`（空基线，3 个 tracked 目标文件在 HEAD 0f23e55 干净）与 `02-after.patch`（158 行）。未验证范围：typecheck/根包全套/web 全套由编排脚本统一跑（本票未重复跑）；真实 LLM 付费路径不在本票范围（夹具边界）。用户既有未提交改动（storyBrainRoutes.ts 等）原样保留，未触碰。

