---
title: commit 端点外部改盘返回 500 而非 409
status: ready-for-agent
---

## 问题

同一个物理条件（章节文件被外部改过，哈希基线失配），两个端点给出**两种**错误契约：

| 端点 | catch 位置 | 响应 |
|---|---|---|
| `/api/prose.save` | `proseRoutes.ts:381-384` | 409 `PROSE_EXTERNAL_CHANGE` + 可操作提示 |
| `/api/chapter.commit` | `proseRoutes.ts:731-741` | **500** `{ok:false, error: <原始消息>}`，无 `code` |

抛出方 `commitChapter` 在 `chapter.ts:582` 调 `assertPreWriteHash`，抛 `PreWriteHashMismatchError`。
该类**已有测试证明**：`chapter.test.ts:422-432`。route 侧 catch 链只处理 `ChapterPhaseError`(409) 与 ENOENT(404)，
其余一律落到 `:740` 的 `json(500, ...)`。

违反 **AGENTS.md 规则 15**（生产失败必须显式暴露为可行动的错误状态）与**规则 12**（契约不得返回未文档化字段形状）。
对作者的实际后果：窗口点提交，界面报「服务器错误」，而真实原因是「你的章节在别处被改过，请先刷新」——**无法据此行动**。

## 修复

在 `proseRoutes.ts:731` 的 catch 链里，`ChapterPhaseError` 之前插入 `PreWriteHashMismatchError` 分支，
复用 `:382` 的同一条 409 响应。错误码沿用 `PROSE_EXTERNAL_CHANGE`（条件完全相同），**不新增契约字段**。

## 验收

- 新增测试：外部改盘后 POST `/api/chapter.commit` ⇒ 409 + `code === 'PROSE_EXTERNAL_CHANGE'`（RED 先行）。
- 现有 500 分支测试（若有）改断言为 409，**理由记录在案**：条件判断已证明（chapter.test.ts:422），契约变更经批准。
- 六门禁全绿。

## 影响面

- `apps/web/server/routes/proseRoutes.ts`（catch 链 + import 已有）
- 新增/修改 1 个 route 测试
**本票不碰 commit 编排逻辑**，与 02/03/04 无冲突。

## 依赖

无。可立即开工。

## 执行记录（2026-09-28 ZCode 工作流）

**性质**：验收票。不重写现有修复（`ba08c3b`），只验证 + 补齐缺口。

### 判定：done

### 验收对照

| 工单验收项 | 结果 | 证据 |
|---|---|---|
| 新增测试：外部改盘后 POST `/api/chapter.commit` ⇒ 409 + `code === 'PROSE_EXTERNAL_CHANGE'` | ✅ 修复提交自带 `proseRoutes.proposal.test.ts:369-399`（带 appends 续接路径 `proseRoutes.ts:708`）；本次新增 `proseRoutes.commitExternalChange.test.ts`（无 provider 快速路径 `proseRoutes.ts:621`） | 本节测试命令 |
| 正文不被覆盖 | ✅ 两用例均断言外部字节保留、`phase: draft`、无 `commitId`、revision 未动 | `proposal.test.ts:398`；`commitExternalChange.test.ts:97-101` |
| 正典不被覆盖 | ✅ `assertCanonUntouched`（五族 0 行 + 无 ChapterCommitted/CanonCommitted）+ 新用例同款断言 | `proposal.test.ts:137-147`；`commitExternalChange.test.ts:104-112` |
| 现有 500 分支测试改断言 409 | ✅ 无既有 500 分支测试需要改（commit catch 链此前无测试钉 500）；RED 实证记录在 `ba08c3b` 提交信息 | `git show ba08c3b` |
| RED 先行 | ✅ 本次独立复验：临时移除 `proseRoutes.ts:737-740` 分支 → 测试精确复现缺陷（500 + 裸英文消息无 code，与 `ba08c3b` 记录的 RED 响应逐字一致）→ 原样恢复（`git diff` 零残留已验证） | 本节命令 3-4 |

### 修改文件

- 新增 `apps/web/server/routes/proseRoutes.commitExternalChange.test.ts`（验收补充：无 provider 快速提交路径的外部改盘 409 + 正文/正典零覆盖；纯黑盒真实 HTTP + `mkdtempSync` 隔离临时书 + 清空 provider 环境变量走确定性 'none' 提取器，零模型调用、零 mock）
- `apps/web/server/routes/proseRoutes.ts` 仅 RED 复验临时改动，已恢复至与 HEAD 零差异
- 未触碰：`storyBrainRoutes.ts` 等用户既有未提交改动

### 测试命令与退出码

```
1. pnpm vitest run server/routes/proseRoutes.commitExternalChange.test.ts server/routes/proseRoutes.proposal.test.ts
   （cwd=apps/web）→ exit 0：Test Files 2 passed (2) / Tests 11 passed (11)
2. RED 复验：临时移除 proseRoutes.ts:737-740 后同命令 → exit 1（预期失败）：
   AssertionError: {"ok":false,"error":"pre-write hash check failed for 正文/第一卷/第0001章.md: disk content differs from baseline (external edit?)"}: expected 500 to be 409
3. 恢复验证：git diff -- apps/web/server/routes/proseRoutes.ts → 空（与 HEAD 零差异）；重跑命令 1 → exit 0（11 passed）
```

补丁存档：`.dsh-audit/implementation-20260928/patches/01-before.patch`（基线为空 diff，既有文件无改动）、`01-after.patch`（新测试文件全文）。

### 关键机制证据（文件:行号）

- 修复现场：`apps/web/server/routes/proseRoutes.ts:737-740`（PreWriteHashMismatchError → 409 PROSE_EXTERNAL_CHANGE，文案与 `/api/prose.save` 的 `:385` 同一条）
- 守卫抛出点：`packages/data-plane/src/chapter.ts:582`（`assertPreWriteHash`），先于一切写入（journal `:656`、流追加 `:661`、事件 `:666`、正文翻转 `:669` 后）——冲突零盘上副作用的机制依据
- 守卫有效性前提：`LocalDataPlane.openOrRebuild`（`local-data-plane.ts:132-145`）正常路径走 `open()`，manifest 基线从盘上读入不刷新 → 外部改盘必然失配
- 隔离验证方式：真实 HTTP（`apiMiddleware`）+ `mkdtempSync` 临时书目录，未触碰 `.mozhou_data` 真实书稿与 43000/43001 端口（测试随机端口 listen(0)）

### 影响面分析

GitNexus `impact(PreWriteHashMismatchError, upstream)`：CRITICAL（7 直接调用方：assertPreWriteHash/acceptDraft/commitChapter/reopenChapter/saveProseDraft/propagateStaleMarkers 等，8 流程）。本票未修改任何共享符号（仅新增独立测试文件），该风险面不适用；它同时印证"不重写现有修复"约束。注：索引落后 HEAD 17 commits（P0 图谱重建受限，未在本票范围）。

### 未验证范围

- typecheck / lint / 根包全套 / web 全套：按分工由脚本在本票之后统一跑，本次未跑
- 六门禁中的 graph:check / build：同上未跑
- 真实模型调用的行为（费用路径）：按票约束一律确定性适配器/夹具，未验证
- 带 appends 场景的模型调用由 `vi.mock` 提取缝夹具替代（`proposal.test.ts:30-37`）；真实 streamOpenAiChat 传输层由 deltaExtractor/openaiStream 自身测试覆盖，本次未重跑

### 门禁复核（2026-09-28，脚本统一门禁 exit=1 后）

脚本门禁结果：typecheck exit=0、web 测试 exit=0、根包测试 exit=1（末尾指向 `packages/flywheel/src/semantic/analyze.test.ts:48` 超时）。复核结论：**非本票引入，为间歇性超时**——

1. 本票在 `packages/` 下零改动（`git status --porcelain -- packages/` 为空）；新增测试文件位于 apps/web，根包 vitest include（`packages/*/src/**/*.test.ts`）不加载它；web 套件（含新测试）exit=0。
2. 单跑失败文件通过：`pnpm vitest run packages/flywheel/src/semantic/analyze.test.ts` → 5 passed（278ms）。
3. 重跑根包全套：`pnpm vitest run`（根目录）→ 输出 `Test Files 101 passed (101) / Tests 868 passed (868)`，与 `ba08c3b` 六门禁记录数字一致，全绿。
4. 未修改任何 packages/ 文件凑绿；StoryboardView 的 act() 提示为 stderr 警告（web 套件 exit=0，非失败）。


