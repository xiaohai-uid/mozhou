---
title: 245 行正则守卫，在守一个 32 行的 adapter
status: ready-for-agent
---

## 问题（这是一条自我指控）

这条针对的是**我上一轮的产出**。

- `withPlane`（`packages/data-plane/src/with-plane.ts`）**32 行**，6 个生产调用点
- 守卫（`apps/web/server/planeHandles.test.ts`）**245 行**，含 7 条自检（:138-229）
- 裸 `LocalDataPlane.open/openOrRebuild` 还有 **22 处**
- **同一文件内部就不一致**：storyBrainRoutes.ts:31 裸开 / :144 走 adapter；worksRoutes.ts:275,300 裸开 / :103,132,147 走 adapter

那个守卫文件**自己写下了问题的形状**：「忘记 close 不报错、不崩、测试照样全绿」，
头注释里还**记着两版失败的守卫**（:14-20）。

## 删除测试结论（反直觉）

- 删掉 `withPlane` ⇒ 复杂度不会重新出现（6 处内联也就几行）。**它今天是浅的，只是形状对。**
- 删掉那 245 行守卫 ⇒ 什么都不会坏，**直到某次静默泄漏**。

**真正承重的是守卫，不是 adapter。而承重的恰好是最脆的（正则 + 行号语义）。**

## 修复

让泄漏**不可表达**：不导出带名字的句柄，只导出 `withBook(root, fn)`。
守卫退化成一条 eslint 规则：`with-plane.ts` 之外禁止裸 `LocalDataPlane.open`。

**进 `eslint.config.js` 常规门禁**，不进测试。理由：这条规则零容忍，且它比 245 行正则**更**能抓住目标。

## 验收

- `findLeakLines` + 7 条自检**全部删除**（净减约 200 行）。
- 22 处裸开改走 `withBook`。
- 故意写一处裸 open ⇒ eslint 报红（**实测 RED 证明**，不是推断）。
- 六门禁全绿。

## 依赖

与 01-06 无冲突。可当调剂票。

---

## 执行记录（2026-09-28 ZCode 工作流）

### 修改文件

**seam 本体**
- `packages/data-plane/src/with-plane.ts` — 改为 `withBook`（恢复打开）/ `withStrictBook`（严格打开）
  两个词法借用 + `retainBook`/`retainStrictBook`/`releaseBook` 三个显式所有权转移出口
  + `isPlaneOpen` 判据导出。**修了旧 `try/finally` 形态的一个真实缺陷**：fn 返回
  Promise 时 finally 会在第一个 await 之前就关句柄（见「与工单描述的偏离」第 3 条）。
- `packages/data-plane/src/with-plane.test.ts`（新增，262 行）— 18 个用例，判句柄真实生死。
- `packages/data-plane/src/book-backup.ts:21,231-232` — 恢复重建投影改走 `withBook`。

**生产调用点迁移（22 处裸开 → 0）**
- `apps/web/server/routes/storyBrainRoutes.ts` — 6 处（absorbAuthorIntentWrite、
  book.state、entities、entity.save、facts、contract）。**作者意图修复原样保留**，
  仅把 `open+try/finally` 换成 `withBook`/`withStrictBook` 词法借用。
- `apps/web/server/routes/worksRoutes.ts` — 5 处（3 处原 withPlane 改名，:275、:300 裸开迁移）。
- `apps/web/server/routes/proseRoutes.ts` — 4 处（:302、:350、:391、:437）。409 分支
  重构为「先取 commitId 再 json」，语义等价（`?? null` 保持 `string | null`）。
- `apps/web/server/routes/reconciliationRoutes.ts` — 2 处，均为**真长活句柄**，
  走 `retainBook`/`releaseBook` 显式转移。
- `apps/web/server/routes/exportRoutes.ts` — 1 处。
- `apps/web/server/draftContext.ts` — 1 处，**async 调用点**，句柄缩到只覆盖盘面读取段。
- `apps/web/server/storyboard/store.ts` — 2 处。
- `packages/pipeline/src/draft-accept.ts` — 1 处（整段包进 `withBook` 回调）。
- `packages/pipeline/src/resubmit.ts` — 1 处。
- `packages/pipeline/src/watcher-checkpoint.ts` — withPlane → withStrictBook。
- `packages/pipeline/src/commit-orchestration.ts` — 1 处，**跨 await 句柄**，
  走 `retainBook`/`releaseBook`。
- `packages/context-compiler/src/l1-lifecycle-bench.ts` — 2 处（:1139、:1304），
  走 `retainStrictBook`/`releaseBook`。**旧守卫第二版的误报点，本次实测全绿**。

**门禁与守卫退场**
- `eslint.config.js` — 新增 `no-restricted-syntax` 块禁裸 `LocalDataPlane.open/openOrRebuild`；
  `maximumDefaultProjectFileMatchCount` 64 → 70（新增 server 测试文件占用 defaultProject）。
- `apps/web/server/planeHandles.test.ts` — **已删除**（245 行，findLeakLines + 7 条自检全删）。
- `apps/web/server/routes/planeSeamMigration.test.ts`（新增，293 行）— 14 个路由级迁移回归。

### 测试命令与退出码

| 命令 | 结果 |
|---|---|
| `npx vitest run packages/data-plane/src/with-plane.test.ts` | 18/18 通过，exit 0 |
| `pnpm --filter @mozhou/web test -- server/routes/planeSeamMigration.test.ts` | 14/14 通过，exit 0 |
| `pnpm --filter @mozhou/web test -- server/routes/proseRoutes` | 85/85 通过（12 文件），exit 0 |
| `pnpm --filter @mozhou/web test -- server/routes/storyBrainRoutes.contract.test.ts server/storyboard` | 14 通过 / 1 skipped，exit 0 |
| `npx vitest run packages/data-plane packages/pipeline` | 382/382 通过（47 文件），exit 0 |
| `npx vitest run packages/context-compiler` | 106/106 通过（10 文件），exit 0 |
| `pnpm test`（根全套） | **891/891 通过**（102 文件），exit 0 |
| `pnpm --filter @mozhou/web test`（web 全套） | **802 通过 / 1 skipped**（106 文件），exit 0 |
| `pnpm build` | exit 0 |
| `pnpm --filter @mozhou/web typecheck` | exit 0 |
| `npx tsc -p apps/web/tsconfig.server.json --noEmit` | exit 0 |
| `npx eslint apps/web/src/ticket08-eslint-red-probe.ts`（**RED 证明 ×2**） | **exit 1**，2 errors 命中两种裸开形态 |
| `gitnexus check`（repo=`C:\zcode\novel-ai`） | `status: clean, cycleCount: 0` |
| `pnpm lint`（全套） | exit 1，**剩余 5 个 error 全为既有**：proseRoutes.ts 三个 unused 别名（工单 04 遗留）、bookRequest.test.ts、generationTarget.ts |

### 证据（文件:行号）

- seam 的异步修复：`packages/data-plane/src/with-plane.ts:66-84`（`isPromiseLike` 命中则
  走 `result.then(close, close)`，不再用 finally 即关）；`with-plane.test.ts:135-141`
  「fn 返回 Promise 时句柄在 settle 之前不得关闭」实测 await 后 `isPlaneOpen === true`。
- eslint 规则本体：`eslint.config.js:50-90`（selector 精确匹配
  `CallExpression > MemberExpression[object.name=LocalDataPlane][property.name=/^(open|openOrRebuild)$/]`）。
- RED 日志：`.dsh-audit/implementation-20260928/logs/08-eslint-red.log`（迁移前）
  与 `08-eslint-red-after-guard-removal.log`（**旧守卫删除之后**复验，仍 exit 1）。
  两次都命中两处，形态分别是「开了不关」与「开完就丢」。
- 裸开清零：`grep -rn "LocalDataPlane\.\(open\|openOrRebuild\)(" --include=*.ts apps packages`
  排除 test/dist/with-plane/local-data-plane 后 **exit 1（零命中）**。
- 旧守卫已删：`ls apps/web/server/planeHandles.test.ts` → No such file or directory。
- 净行数：删 245 行守卫；新增 seam 125 行 + seam 测试 262 行 + 迁移回归 293 行。
- 作者意图修复原样：`storyBrainRoutes.ts:107-126`（409 冲突分支、逐字等价判幂等、
  `AUTHOR_INTENT_ALREADY_INITIALIZED` 文案）逐字未改，并由
  `planeSeamMigration.test.ts:245-268` 三个断言（200 / idempotent / 409）实跑钉住。

### 与工单描述的偏离（需要记录，三处）

1. **没有合成一个 `withBook`**：工单写「只导出 withBook(root, fn)」。但 `open` 与
   `openOrRebuild` 失败语义不同（前者缺投影照抛、后者先重建），合成一个会逼调用点写
   「开两次去 catch」。故为 `withBook`（恢复）+ `withStrictBook`（严格）两个名字。
   seam 的实质是「借出的句柄没有名字」，不是「函数只有一个」。
2. **额外导出 `retainBook`/`releaseBook`**：工单假设所有句柄都是词法借用，但有三处
   **真的长活**：常驻对账宿主（`ensureReconciliationRuntime` / `resolveService`，
   句柄要活过请求边界）、提交编排（工单 04 的事务窗口，句柄必须活过提取缝的
   `await`）、生命周期台架（句柄跨两次删库重建）。词法借用表达不了它们，硬套会得到
   「await 期间句柄已关」的新故障。显式 retain/release 保留了原有行为，且成对出现
   在同一函数内——比原先「裸 open + 远端 close」更可 review。
3. **修了一个工单没提的真实缺陷**：`draftContext.ts` 与 `commit-orchestration.ts`
   都是 async fn + `try/finally { plane.close() }`，finally 会在第一个 `await` 之前
   执行。改后 `draftContext` 把句柄缩到只覆盖同步的盘面读取段（await 之后不再需要句柄），
   `commit-orchestration` 走 retain/release。旧写法在生产里是「句柄在模型调用期间已被关」。

### 判定

**通过（done）**。工单四条验收逐条兑现：findLeakLines + 7 条自检全删（守卫文件已移除）；
22 处裸开清零；故意写裸 open ⇒ eslint 实测 exit 1（迁移前、旧守卫删除后各一次）；
门禁：build / typecheck / 根套 891 / web 套 802 / gitnexus cycleCount 0 全绿，
`pnpm lint` 剩余 5 个 error 均为本票之前既有（工单 04/06/07 的未提交改动，非本票引入）。

**未覆盖范围（如实记录）**：
- 未起真实本地服务做端到端验证（端口隔离与 .mozhou_data 约束下未做 UI 路径验证）。
- 并发验证限于**单进程内** Promise 并发与嵌套借用；**多进程**竞争（两个 server 实例
  同开一本书）未验证——本票的 seam 管的是进程内句柄生命周期，不改变 SQLite 的
  跨进程锁语义。
- `retainBook` 的三个长活持有者未做「忘记 release」的行为测试（现有
  `stopReconciliationRuntime` 的既有测试覆盖了正常停机路径）。
- 未做 gitnexus `detect_changes()`（索引落后 HEAD 17 commits，P0 阶段已记录的
  权限阻塞未解除，重建索引超出本票授权）。

