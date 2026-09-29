---
title: 书级请求解码被就地重写了 16 次
status: ready-for-agent
---

## 问题

- `typeof body['chapterIndex'] === 'number' ? … : null` **16 次**（pipelineRoutes 9 / proseRoutes 5 / storyboardRoutes 2）
- `assertSafeBookRoot` **47 次**跨 10 个文件
- `ChapterProductionSession.resume(...) === null → 409 'no open production session'` 在 `pipelineRoutes.ts` **重复 3 次**（:326/:631/:701），文字完全一样
- `routeCodes.ts` 只有 **2 个**错误码，route module 里有 **84 处内联 `code: '…'`** 字面量

`chapterIndex` 必须是 ≥ 1 的整数这条冻结规则，在 `pipelineRoutes:443` / `proseRoutes:268,401,440,497`
有**五种写法**。

`2cc9be7` 已经把 `PROVIDER_UNAVAILABLE` 从 4 个文件收成一处——**方法是对的，只是停在 65 个里的 2 个**。

## 目标 interface

```
decodeBookRequest(body, bookRoot)
  → Result<{ root, chapterIndex, principal }, ContractError>
```
**浅在哪很明确**：今天 5 行 interface 换 5 行 implementation，不变式留在每个调用方脑子里。

## 验收

- 16 个内联解析器消失；`routeCodes.ts` 不再是 2 条的清单。
- 表驱动断言：每个端点都用了它。
- **但 84 处内联错误码一次不必收完**——先收 `proseRoutes` + `pipelineRoutes` 两个文件，
  其余留作后续。本票不追求全量。

## 依赖

**必须排在 04 之后**——两者同改 `proseRoutes.ts`，顺序反了会在同一个 diff 里打架。

---

## 执行记录（2026-09-28 ZCode 工作流）

### 修改文件

| 文件 | 性质 |
|---|---|
| `apps/web/server/bookRequest.ts` | **新增**：`decodeBookRequest(body, bookRoot, opts) → Result<{root, chapterIndex, principal}, ContractError>` + `noOpenProductionSessionError(chapterIndex)` |
| `apps/web/server/bookRequest.test.ts` | **新增**：解码器单元测试（30 例，8 组表驱动） |
| `apps/web/server/routes/bookRequestDecoder.test.ts` | **新增**：16 端点表驱动 + 主体闸分层事实 + 合法路径不误伤（24 例） |
| `apps/web/server/routeCodes.ts` | 扩充：2 → **20** 个契约错误码（新增 18） |
| `apps/web/server/routes/proseRoutes.ts` | 5 处内联解析 → 解码器；内联 `code:` 字面量 → 常量 |
| `apps/web/server/routes/pipelineRoutes.ts` | 9 处内联解析 → 解码器；3 处「无开放会话」重复 → 单一构造函数 |
| `apps/web/server/routes/storyboardRoutes.ts` | 2 处内联解析 → 解码器（工单「核对」项） |

`grep -c "typeof body\['chapterIndex'\]"` 在三个路由文件均为 **0**。

### 关键设计决策

1. **返回 `Result` 而非抛异常**（`bookRequest.ts:93-149`）：路由要在**动盘之前**用 `json()` 回 4xx；抛出会把「普通形状错误」和「内部故障」混进同一条 try。
2. **重载把「章号必选/可选」映射到不同静态类型**（`bookRequest.ts:88-91` 签名 + `:53-54` 结果类型）：`'required'` ⇒ `number`，`'optional'` ⇒ `number | null`。旧代码 9 个调用点各自把 `number | null` 传进要求 `number` 的函数、靠同一行的 `Number.isInteger` 守卫窄化；重载让编译器替它们做。
3. **章号校验必须在守卫之前**（`bookRequest.ts:108` 的顺序，主体→root→章号）：`chapterIndex: 0` 现在报「章号非法」而不是先去 stat 一个不存在的目录。
4. **本模块不重新解释「什么算一本书」**：`assertSafeBookRoot`（`bookRequest.ts:124`）的 status/code/message 原样透出（`:125-129`），边界判据的唯一真源仍是 `security.ts:23`。

### 行为变化（显式记录，不隐瞒）

- **收紧**：`session.open` / `session.advance` / `session.abandon`(原本已收紧) / `chapter.review` / `chapter.rework` / `chapter.corrections` / `chapter.quality` 此前**只判 `typeof`**，故 `chapterIndex: 0` 与 `1.5` 能穿过并进入管线（`proseRoutes` 的 5 处与 `storyboard` 的 2 处原本已判 `< 1`）。现按冻结规则统一 400。
- **文案收口**：400 的 error 从三种端点自选文案（`'root and chapterIndex required'` / `'valid root and chapterIndex required'` / `'root and integer chapterIndex >= 1 required'`）收为按字段给出。**客户端无任何按该文案分支的代码**（已 grep 核对 `apps/web/src`、packages、docs、.scratch、openapi.yaml）；`productionRoutes.test.ts:90,101` 断言的是 `'no open production session'`，该文案**逐字保留**。
- **新增 code 字段**：上述端点的 400 此前连 `code` 都没有，现在带 `INVALID_BOOK_REQUEST`。OpenAPI 只描述「形状非法 400」，不断言字面量。
- **`/api/draft.accept` 章号改为可选**（`pipelineRoutes.ts:575-582`）：此前 `typeof body['chapterIndex'] === 'number' ? … : undefined` 已容忍缺失；`draft-accept.ts:206` 在双方都带时核对身份。本票把这条隐式语义写成显式契约——**带了就必须合法，不做「猜一个」的兜底**。

### 测得的既有门禁顺序（读码结论，未改）

- `router.ts:101-114`：hosted 下会话解析失败即 401 `UNAUTHORIZED`，请求**根本不进路由处理器**。故 `bookRequest` 的 401 `UNAUTHORIZED_PRINCIPAL` 是**双层防护的内层**，端到端不可触发；`bookRequestDecoder.test.ts` B 组如实断言外层不变，**不为可观察性放宽任何一闸**。内层的单元级证据在 `bookRequest.test.ts` 第 5 组。
- `bookAccess.ts:359`：缺 root 时网关的书授权层先报 400 `BOOK_REQUIRED`（既有语义，本票未改）。
- `bookAccess.ts:372` `assertResourceOwnership`：对 `candidateId` 做盘上存在性预检，**在路由处理器之前**。端到端测 `/api/draft.accept` 必须先造候选工件文件（`bookRequestDecoder.test.ts:89-92`），否则 404 会盖住解码器。
- `router.ts:147`：`bookRoot = authorizedBook?.root ?? body.root`，故「未传 root」在 `book` 策略端点通常已被网关拦下；解码器的 root 分支是可直达路径的兜底。

### 测试命令与退出码

| 命令 | 结果 |
|---|---|
| `pnpm --filter @mozhou/web exec vitest run server/bookRequest.test.ts` | **0**（30 passed） |
| `pnpm --filter @mozhou/web exec vitest run server/routes/bookRequestDecoder.test.ts` | **0**（24 passed） |
| `pnpm --filter @mozhou/web exec vitest run server/routes/ server/bookRequest.test.ts` | **0**（31 files / 255 passed）——覆盖全部既有路由回归 |
| `pnpm --filter @mozhou/web exec vitest run src/api.test.ts src/workbench` | **0**（9 files / 99 passed）——前端消费端 |
| `cd apps/web && npx tsc -p tsconfig.server.json --noEmit` | **0**（无输出） |
| `node .gitnexus/run.cjs check --cycles -r "C:\zcode\novel-ai"` | **0**（`No circular imports found.`） |

未跑（按分工交脚本统一执行）：根包全套 typecheck / 全量 lint / web 全套测试 / build / 索引重建。

### 证据（文件:行号）

- 解码实现：`apps/web/server/bookRequest.ts:93-149`（主函数，含重载 88-91）、`:38-40`（ContractError）、`:45-51`（DecodedBookRequest）、`:53-54`（DecodeBookRequestResult）、`:152-160`（`noOpenProductionSessionError`）
- 替换点（`decodeBookRequest(body, …)` 调用行）：`proseRoutes.ts:295 / 328 / 430 / 468 / 520`（5）；`pipelineRoutes.ts:290 / 306 / 347 / 408 / 577 / 625 / 696 / 722 / 767`（9）；`storyboardRoutes.ts:42 / 64`（2）
- 错误码收口：`routeCodes.ts:14-88`（20 个）；三个路由文件内 `code: '…'` 字面量已归零（`grep` 见上）
- 影响面分析：`impact(proseRoutes/pipelineRoutes, upstream)` 均 `risk: LOW` / `impactedCount: 0`（GitNexus MCP，repo 传绝对路径）；`detect_changes(scope=unstaged)` 返回 69 changed / 83 affected / 35 files，**其中大部分是 01–06 票的既有未提交改动，非本票引入**（本票改动文件：routeCodes.ts + 3 个 route 文件 + 2 个新文件）
- 用户既有改动未受影响：`git diff --stat apps/web/server/routes/storyBrainRoutes.ts` 仍为 `2 insertions(+), 1 deletion(-)`，`WizardOverlay.test.tsx` / `export-code-graph.mjs` / code-graph 两文件均未被本票触碰
- 补丁存档：`.dsh-audit/implementation-20260928/patches/07-before.patch`（793 行）、`07-after.patch`（1424 行）

### 判定

**done**。工单两条验收均达成：16 个内联解析器消失（grep 计数 0）、`routeCodes.ts` 不再是 2 条清单（20 条）；表驱动断言覆盖全部 16 个端点。错误码按工单要求只收 `proseRoutes` + `pipelineRoutes`（外加 storyboard 的 3 处 options 400 顺带带上 `INVALID_BOOK_REQUEST`，因同一端点已改不带上会自相矛盾），未追求全量 84 处。

**未覆盖范围**：真实模型/生成端到端路径（按硬约束不调用收费 API）；`systemRoutes.ts:273` 另有一处 `body['chapterIndex']` 解析但语义不同（requestedChapterIndex，非必填整数规则），本票未动；`worksRoutes` / `storyBrainRoutes` / `reconciliationRoutes` / `systemRoutes` 的 `assertSafeBookRoot` 调用点按工单「本票不追求全量」保留原状。

