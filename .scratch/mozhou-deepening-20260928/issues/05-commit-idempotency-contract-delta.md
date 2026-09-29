---
title: 提交幂等：expectedRevision（Contract Delta）
status: ready-for-agent
---

## 为什么单独立票

这是**契约变更**，不是重构。AGENTS.md 规则 10「契约默认冻结」，规则 11 要求显式 Contract Delta，
并同步 schema / mock / 实现 / 测试四处。塞进 04 会让那票同时是重构和契约变更，规则 5 禁止。

## 契约 Delta

| | 现状 | 变更后 |
|---|---|---|
| `POST /api/chapter.commit` 请求 | `{chapterIndex, summary, appends?, ...}` | `+ expectedRevision: number` |
| 失配响应 | —（无此状态） | 409 `PROSE_REVISION_CONFLICT` |

`expectedRevision` 的形状与语义**直接照搬已冻结的** `/api/prose.save` 契约
（`chapter.ts:436-455` 的 `expectedRevision: number | null`、`ProseRevisionConflictError`），
**不发明新形状**。

## 行为

提交时携带作者所见 revision；与盘上 revision 失配 ⇒ 409，正典零写入。
这让**双击提交零消耗**（02 的缺陷 A 从「事后 409」变成「事前 409」）。

## 验收

- 契约文档 `.scratch/mozhou-mvp/contracts/api-contract.md` 同步更新（规则 11）。
- 前端提交路径带上传该字段；`proseRoutes.*.test.ts` 补失配用例。
- 六门禁全绿。

## 依赖

依赖 04。

## 执行记录（2026-09-28 ZCode 工作流）

**判定：done**（契约四处同步完成，目标测试全绿；六门禁中 typecheck/根包全套/web 全套按分工由脚本在执行者之后统一跑，执行者只跑本票目标测试 + web/data-plane typecheck）。

### 契约 Delta 落地形状（照搬 /api/chapter.prose.save 冻结契约，不发明新形状）

- `POST /api/chapter.commit` 请求 `+ expectedRevision: number`（必填整数 ≥ 0；commit 无新建语义故不收 null；缺失/非法 400，动盘之前）。
- 失配 ⇒ 409 `PROSE_REVISION_CONFLICT {expectedRevision, currentRevision, error}`（与 prose.save 同码同形）；**在提取缝（真实模型调用）之前拒绝**：模型调用增量 0，正文/正典/账本零写入。
- 相位守卫仍在 revision 比对之前（照搬 saveProseDraft 检查顺序）：重复提交/成功响应丢失后重试仍 409 `CHAPTER_ALREADY_COMMITTED`，不视为幂等成功。

### 修改文件（四处同步）

1. **schema/类型**：
   - `packages/data-plane/src/chapter.ts:441-446`（CommitChapterRequest `+ expectedRevision?: number`，undefined=模块内部旧调用方不启用守卫）、`chapter.ts:576-581`（commitChapter 写路比对，相位检查后、journal 落盘前——兜住提取 await 期间并发保存的 TOCTOU 窗口）。
   - `packages/pipeline/src/commit-orchestration.ts:161-164`（RunChapterCommitRequest `+ expectedRevision: number` 必填）、`:200-208`（提取缝之前比对 → ProseRevisionConflictError，模型调用增量 0）、`:368-373` 与 `:452-458`（两处 plane.commitChapter 透传）。
2. **契约文档**：
   - `.scratch/mozhou-mvp/contracts/api-contract.md` 新增第 26 节「章节提交幂等：expectedRevision（DELTA-005）」+ 历史列表追加 DELTA-005。
   - `.scratch/mozhou-mvp/contracts/deltas/DELTA-005.md` 新建（显式 Contract Delta：变更原因/前后 Schema/失败语义/同步清单/不做的事）。
   - `.scratch/mozhou-mvp/contracts/openapi.yaml` 新增 `/api/chapter.commit` path（54 paths，JSON 解析验证通过；required: root/chapterIndex/expectedRevision；409 冲突族说明含 PROSE_REVISION_CONFLICT）。
3. **实现**：
   - 路由 `apps/web/server/routes/proseRoutes.ts:518-529`（解码 + 400）、`:549-556`（传编排）、`:631-642`（409 PROSE_REVISION_CONFLICT 映射，与 prose.save :388-396 同形）、`:15-24`（文件头契约注释）。
   - 前端 `apps/web/src/quality/QualityPanel.tsx:114-116`（proseRevision 状态，refresh 读 /api/chapter.prose 时捕获）、`:160-171`（缺失时补读一次，仍拿不到显式拒绝不盲发）、`:174`（提交携带 expectedRevision）、`:199-207`（409 → 刷新对账 + 显式报错，绝不静默改带新 revision 重发；注意 refresh 会重置 error，故报错在 refresh 之后——组件测试钉住）。
   - 非主调用方同步（调用方清单内的一致性维护）：`scripts/verify-real-model-journey.mjs:262-268、:286-292` 与 `scripts/verify-real-novel-journey.mjs:245-247` 提交载荷补 expectedRevision（取 draft.accept 响应回带的 revision）。**这两个脚本调用真实模型，执行者按硬约束未运行，改动仅为静态契约一致性。**
4. **契约测试**：
   - 新增 `apps/web/server/routes/proseRoutes.commitRevision.test.ts`（5 用例覆盖工单验收清单：首次请求 200；重复请求=成功响应丢失后重试 → 409 CHAPTER_ALREADY_COMMITTED 非 200；过期 revision → 409 PROSE_REVISION_CONFLICT + 0 提取 + 正文/正典/账本零写入；双窗口 → 旧 revision 409（0 提取）+ 重读对账后新 revision 合法提交成功（新输入≠幂等回放）；缺失/非法（缺省/null/字符串/小数/负数）→ 400 + 盘面零变更）。提取缝为计数夹具（真实归一 normalizeDelta 产出），只证明控制流，不冒充真实模型质量/费用验证。
   - `packages/data-plane/src/chapter.test.ts:459-479` 新增 TOCTOU 守卫用例（失配抛 ProseRevisionConflictError 且事件账本零追加；匹配照常提交）。
   - 前端 `apps/web/src/quality/QualityPanel.test.tsx`：既有提交用例追加请求体断言（expectedRevision: 2，来自 mock prose 快照）；新增 409 冲突处置用例（报错可见/相位保持草稿期/自动刷新 ≥2 次读 prose）。
   - 既有测试的 commit 请求体按新契约补字段（AGENTS 规则 20b：已批准 Contract Delta 变更客户端义务）：proseRoutes.repeatCommit/commitExternalChange/authorEditSignal/dependencyManifest/gate/proposal/flywheelRecord/sessionComplete/resubmit/resubmitAbandon/.test.ts 共 11 文件；值一律取自各用例夹具的保存响应或 /api/chapter.prose 快照（证据驱动，非硬编码猜测）。

### 影响面分析（改码前执行）

- GitNexus MCP `impact(commitChapter)`（repo=绝对路径）：`LocalDataPlane.commitChapter` upstream 2 个直接调用方 = web proseRoutes + `packages/context-compiler/src/l1-lifecycle-bench.ts:1143`（bench，非 HTTP 路径；expectedRevision 为可选字段，bench 不受影响），风险 LOW。索引落后 17 提交（runChapterCommit 为工单04 新增未入库符号，CLI 查不到），直接调用方清单经 grep 全仓复核：runChapterCommit 仅 proseRoutes.ts:549 一个生产调用方。
- `/api/chapter.commit` HTTP 客户端全仓清单：QualityPanel.tsx（主）+ 11 个 proseRoutes 测试文件 + QualityPanel.test.tsx + 2 个 journey 验收脚本——全部已按新契约更新。

### 测试命令与退出码（本票目标测试）

- `npx vitest run <12 个 proseRoutes*.test.ts> src/quality/QualityPanel.test.tsx`（apps/web）→ **98 passed (13 files)，EXIT=0**
- `npx vitest run packages/data-plane/src/chapter.test.ts`（repo 根）→ **19 passed，EXIT=0**
- `npx tsc -b && npx tsc -p tsconfig.server.json --noEmit`（apps/web）→ **EXIT=0**（一次预检；正式 typecheck 门禁归脚本）
- `pnpm --filter @mozhou/data-plane --filter @mozhou/pipeline build`（tsc -p .）→ Done×2（web 测试经包 main 解析 dist，改包后必须重建——首轮新契约测试曾因陈旧 dist 出现失配 200 假阴性，重建后转绿）

### 补丁与证据

- 基线/结果补丁：`.dsh-audit/implementation-20260928/patches/05-before.patch`（tracked 文件；commit-orchestration.ts 为工单04 未跟踪文件，其基线即工单04 交付态）、`05-after.patch`（20 个 diff，含 3 个新文件全文）。
- 未验证范围：六门禁的根包全套/web 全套测试与正式 typecheck（按分工由脚本统一跑）；两个 journey 脚本的实际运行（涉真实模型费用，禁止）；GitNexus 索引未重建（索引落后 17 提交，按 P0 约定不由执行端重建）。

