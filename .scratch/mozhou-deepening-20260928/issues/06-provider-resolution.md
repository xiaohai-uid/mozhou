---
title: 「我在跟哪个模型说话」：21 处调用点、3 套不兼容协议
status: ready-for-agent
---

## 问题

领域规则只写了一遍——`tierRouting.ts:146-158`：「端点身份 = providerId … 账本记录的 providerId 必然就是实际服务的那一个」。
**只有一条路径遵守它。**

| 调用点 | 协议 |
|---|---|
| `pipelineRoutes.ts:169` `makeStreamEngine` | 注册表分档 → BYOK → 类型化 throw ✓ |
| `pipelineRoutes.ts:110` `hasDraftProvider` | mock ∥ hasUsableCredentials ∥ hasResolvableTierRoute |
| `pipelineRoutes.ts:80` `hasResolvableTierRoute` | 只探注册表，异常吞成 false |
| `proseRoutes.ts:606` Final Extract | **只走 BYOK，绕过注册表** |
| `semanticSettled.ts:118` | **只走 BYOK，且不传 userId** |

生产代码里问「能不能生成」共 **21 次，散在 7 个文件**，5 个近义函数；`resolveChatEndpoint` 自身 **14 处引用跨 5 个文件**。

## 已爆过一次的

`4423db4`「hosted 无 principal 显式拒答」修的是**跨用户凭据泄漏**，
`semanticSettled.ts:100-113` 自己写着「用户的落定语义分析会用别人的 Key 去调 LLM」。

而它是在**一个调用点**上打的补丁，不是在一个 module 里。

## 今天就存在、还没爆的

只配了 `~/.mozhou/settings.yaml` 注册表的作者：用私有端点起草一章 ⇒ Final Extract（`proseRoutes.ts:604-606`）
回落 BYOK 或失败 ⇒ **写增量的是 A 端点，账本里的 providerId 是 B**。
这恰好是 `tierRouting.ts:146-158` 要禁止的事。

## 目标 interface

```
resolveGenerationTarget({ taskType, principal, env })
  → { endpoint, providerId, model, source }
  | Unavailable(reason)
```
失败**带原因**，不再是 `null` 加上散在别处的解释。

## YAGNI 警告

这个 seam 是**真的**——注册表与 BYOK 两种 adapter 今天就在并存。
**但不要顺手加 registry 插件机制**，那才是规则 4 禁止的投机抽象。

## 验收

- 6 个调用点收敛为 1 次调用。
- 账本里出现的 providerId 与实际服务端点**同源**（可断言）。
- 六门禁全绿。

## 依赖

与 01-05 无文件重叠，可并行。

## 执行记录（2026-09-28 ZCode 工作流）

### 判定

**done**。目标接口已落地并接线到全部生产调用点；三类失败原因可断言；账本/出站同源有断言保护且做过变异检验。

### 修改文件

| 文件 | 改动 |
|---|---|
| `apps/web/server/llm/generationTarget.ts`（新增） | `resolveGenerationTarget` 单一解析缝：hosted 无主体拒答 → 注册表 → BYOK → 带原因 `Unavailable` |
| `apps/web/server/llm/generationTarget.test.ts`（新增） | 本票四类验收点的专门回归（14 例） |
| `apps/web/server/routes/pipelineRoutes.ts` | 删上一轮遗留的 `tierRoute` 死代码（重复 `setGlobalOverride`）；`hasDraftProvider` / `makeStreamEngine` / draft.stream 前置闸收敛到单缝 |
| `apps/web/server/semanticSettled.ts` | `ResolvedDeps` 补 `available: true` 判别位（联合类型窄化根因） |
| `apps/web/server/analysis/deltaExtractor.ts` | deps 缝由 `resolveEndpoint`（裸端点/null）改为 `resolveTarget`（带 reason 的显式结果） |
| `apps/web/server/storyboard/generate.ts` | 同上 |
| `apps/web/server/routes/proseRoutes.ts` | Final Extract 注入带 principal 的 `resolveTarget` |
| `apps/web/server/routes/storyboardRoutes.ts` | 同上 |
| `apps/web/server/analysis/deltaExtractor.test.ts`、`storyboard/generate.test.ts`、`proseRoutes.test.ts` | 测试迁到新缝；`proseRoutes.test.ts` 的 reason 断言随契约更新 |

未新增插件机制，未改用户模型配置，未加 registry 抽象。

### 测试命令与退出码

| 命令 | 结果 |
|---|---|
| `cd apps/web && npx tsc -b` | exit 0 |
| `cd apps/web && npx tsc -p tsconfig.server.json --noEmit` | exit 0 |
| `cd apps/web && npx vitest run server/llm/generationTarget.test.ts server/llm/tierRouting.test.ts server/analysis/deltaExtractor.test.ts server/storyboard/generate.test.ts server/routes/pipelineRoutes.tierRoute.test.ts server/routes/proseRoutes.test.ts server/routes/reconciliationRoutes.semantic.test.ts` | 7 files / 93 passed, 1 skipped |
| `cd apps/web && npx vitest run server/routes/storyboardRoutes.test.ts server/routes/proseRoutes.{commitExternalChange,commitRevision,repeatCommit,sessionComplete,gate,proposal,flywheelRecord,resubmit,resubmitAbandon,authorEditSignal,dependencyManifest}.test.ts` | 12 files / 78 passed |
| `node .gitnexus/run.cjs check --cycles -r "C:\zcode\novel-ai"` | exit 0，No circular imports found |

未跑：根包全套测试、lint、build（按分工由脚本统一跑）。

### 门禁复核（2026-09-28 脚本统一门禁反馈后追加）

脚本报「根包测试 exit=1」，失败点为 `packages/flywheel/src/semantic/batch.test.ts:124`
「投影视图排序稳定：created_at 升序」`Test timed out in 5000ms`。

**结论：非本票引入，且当前复现不出来。** 依据：

1. **本票未触碰该包。** `git status --porcelain -- packages/flywheel` 无输出（该包在 HEAD 上干净）；本票 before/after 补丁里的文件全部在 `apps/web/server/**`，`grep "^diff --git" 06-before.patch` 六项皆然。补丁内两处 `packages/` 字样是 `proseRoutes.ts` 注释里提到工单04 的 `commit-orchestration.ts`，非包文件改动。
2. **依赖方向反了。** `packages/flywheel/package.json` 的 dependencies 只有 benchmark / data-plane / kernel / pipeline / runtime 五项，**不含 apps/web**。本票所有改动都在 `apps/web/server/**`，flywheel 的测试在物理上无法加载它们。
3. **单跑稳定。** `npx vitest run --root packages/flywheel src/semantic/batch.test.ts` → 3 passed / **140ms**（远超通过所需的 5000ms 余量）；整包连跑三次均 exit=0；该用例单独 `-t` 连跑 5 次全 passed。
4. **全套连跑三次 exit=0。** `npx vitest run` → 101 files / 873 tests passed，日志 `logs/06-root-run-2.log`、`06-root-run-3.log`，两次 ROOT_EXIT=0。
5. **并发跑仍绿。** 根包与 web 同时跑：ROOT=0 / WEB=0，`grep -c "timed out"` 两份日志均为 0（`logs/06-root-parallel.log`、`06-web-parallel.log`）。wall time 从 13.18s 涨到 24.36s，证实该失败确属资源竞争型超时，而非逻辑错误。

**未改任何东西来「修」它。** 理由：该用例（`batch.test.ts:124-134`）做真实 FS 目录扫描重建，在 vitest 默认 5000ms 超时下对机器负载敏感；而它在无竞争时只需 ~140ms。给它加 `testTimeout` 属于修改一个不在本票范围、且本身通过的测试来消除一次环境抖动 —— 按 AGENTS §5.17/5.20（不得为让验证通过而改无关测试）与本票「只修本票引入的问题」的约束，这是错误的做法，故不做。若该超时再次出现，应作为**独立的门禁稳定性问题**处理（收口项：给做真实 FS 扫描的用例显式 timeout，或给根 vitest 配置加全局 testTimeout），不属于工单 06。

同期三项门禁最终状态（本轮实测）：

| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | `cd apps/web && npx tsc -b && npx tsc -p tsconfig.server.json --noEmit` | exit 0 |
| 根包测试 | `npx vitest run`（根，include `packages/*/src/**/*.test.ts`） | exit 0 —— 101 files / 873 tests |
| web 测试 | `cd apps/web && npx vitest run` | exit 0 —— 104 files / 745 passed / 1 skipped |

### 证据

**收敛（验收点 1）** —— 三个解析原语在生产代码中各自只剩一个调用方，全在 `generationTarget.ts`：

- `resolveChatEndpoint`：`generationTarget.ts:195`（另有 `openaiStream.ts:93` 的注释与 `semanticSettled.ts:113` 的历史说明，均非调用）
- `resolveDraftTierRoute`：`generationTarget.ts:173`
- `resolveTierEndpoint`：`generationTarget.ts:179`

调用点：`pipelineRoutes.ts:94`（能力探针）、`pipelineRoutes.ts:210`（draft 引擎）、`pipelineRoutes.ts:438`（draft.stream 前置闸）、`proseRoutes.ts:562`（Final Extract）、`semanticSettled.ts:121`（落定语义）、`storyboardRoutes.ts:92`（分镜）——六处，全部经单缝。

**同源（验收点 2）**：

- `generationTarget.ts:178-187` —— registry 分支里 `providerId`（`route.selection.route.providerId`，:183）与 `endpoint`（`resolveTierEndpoint(route)`，:179）由**同一次** `resolveDraftTierRoute` 解析（:173）产出。
- `generationTarget.ts:128` —— `ok()` 的 `model` 恒取 `endpoint.model`，不另开来源。
- 端到端断言（HTTP 级）：`pipelineRoutes.tierRoute.test.ts`「★ providerId 决定实际出站端点：BYOK 指向诱饵上游时，请求仍落在注册表那家，账本与之一致」与「★ 注册表配好 + BYOK 环境变量全部清空 ⇒ /api/draft.stream 成功出流，账本 providerId 是注册表那家」——本次运行通过（见上方 stdout 的 `[mozhou-tier-route] … providerId=deepseek→glm` 两行）。
- 单元级断言：`generationTarget.test.ts`「账本 providerId 与实际出站端点同源」与「即使环境变量里躺着 BYOK 诱饵，注册表部署仍只走注册表那家」。

**失败带原因（验收点 3）** —— `generationTarget.ts:75-82` 定义三类 reason，`generationTarget.ts:84-89` 定义 Unavailable 形状，`generationTarget.ts:134-140` 构造结果。断言见 `generationTarget.test.ts`（`provider_config_invalid` / `no_provider_configured` / `hosted_no_principal` 各有用例）。

**变异检验（证明断言不是空转）**：临时把 hosted 闸短路（`if (false && …)`）→ 2 例失败；临时让注册表解析失败回落 BYOK → 2 例失败（均为「绝不回落 BYOK」与凭据隔离用例）。两次变异均已还原，`grep "MUTATION-CHECK\|false &&"` 在 `generationTarget.ts` 上无命中，14 例恢复全绿。

**凭据隔离**：`generationTarget.ts:166-168` hosted 闸。本轮一处必要修正 —— 原实现只读 `defaultBookAccessManager.isHostedMode()`（进程位），不看注入的 `env`，导致该闸无法被确定性测试覆盖、`env` 参数沦为摆设；改为 `isHosted(env)`（`generationTarget.ts:104-106`）= 进程位 ∥ 注入 env 的 `MOZHOU_HOSTED==='true'`。生产调用方一律传 `process.env`，两种判据同值，**运行时行为不变**，换来的是这道闸有了回归保护。

**联合类型窄化**：`semanticSettled.ts:94` 给 `ResolvedDeps` 补 `available: true` 判别位（与 `GenerationTargetOk` 同一判别键），TS 才能真正窄化 `ResolvedDeps | GenerationTargetUnavailable`；构造处 `semanticSettled.ts:124`。

### 未验证范围

- 真实模型端到端：本轮全部为确定性验证（本地临时配置文件 + 环境变量 + 注入式传输桩），未起真实本地服务、未调任何收费 API。
- GitNexus 索引落后 HEAD 17 commits（`impact` 返回的 staleness 提示），故影响面结论反映既有拓扑而非本轮改动；索引刷新属工单 08 范围。
- 根包测试 / lint / build 未跑（分工所致）。

