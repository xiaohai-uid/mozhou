# 墨舟 · 代码图谱全面体检报告

日期：2026-09-28 · 仓库：`C:\zcode\novel-ai` · 分支：`feature/windows-local-release` · HEAD `0f23e55`
图谱基线：`f9e425c`（**落后 HEAD 17 个提交 / 81 个文件**）· 本次**未改动任何代码**

---

## 阅读须知：本报告的事实基线

| 项 | 值 | 来源 |
|---|---|---|
| 图谱导出 | 7681 节点 / 14982 边 | `apps/web/src/code-graph/codeGraphData.json`（脚本内解析，未进上下文） |
| 实时索引全量 | 19064 边，其中 `MEMBER_OF` 1939 + `STEP_IN_PROCESS` 2143 未导出 | GitNexus 只读 cypher |
| 功能域 | 269 个 cluster | 同上 |
| 执行流 | 533 条 | 同上（快照 `codeGraphSnapshot.ts` 亦为 533） |
| 源码语料 | 487 个 `.ts/.tsx`（已排除 `dist-server` 等构建产物） | 见附录 A |

**三件必须先说的事：**

1. **图谱比 HEAD 落后 17 个提交。** 这 17 个提交改动的 81 个文件里包含 `server/security.ts`、`routePolicies.ts`、全部 server 路由、`data-plane`、`pipeline`、ADR-0030 —— 也就是本报告第 ④ 节的全部素材。**第 ④ 节以源码为准，图谱只作旁证。**
2. **`AGENTS.md` / `CLAUDE.md` 里的 gitnexus 头部统计与实际对不上。** 头部写「8455 符号 / 19013 关系 / 534 流」，实测 7681 / 14982 / 533，且未定义口径（是否含 `Process`/`Community` 节点不明）。这会让下一位 agent 按头部数字做判断时算错。置信度：高。
3. **本报告未跑六门禁**，因为没有改动任何代码。按 `AGENTS.md` 规则 19，没实跑就不报绿，所以这里一个字都不提门禁状态。

**词汇约定**：本报告用 `codebase-design` 的词汇——模块 / 接口 / 实现 / 深度 / 缝 / 适配器 / 局部性 / 杠杆。真指 React 时写「React 组件」，其余一律写「模块」。

---

## ① 执行流全景

### 1.1 「534 条执行流」不是 534 条链路

| 度量 | 值 |
|---|---|
| 流程数 | 533 |
| 步骤总数 | 2143（均值 4.02 步） |
| 步骤数分布 | 3 步 194 条 / 4 步 196 条 / 5 步 95 条 / 6 步 34 条 / 7 步 14 条 |
| **不同入口符号** | **143** |
| 不同步骤符号 | 593（其中 **338 个出现在 >1 条流程里**） |
| 跨层流程 | 179 条 |
| 全测试流程 | 0 |

流程标签形如 `OnSettled → Sha256Hex`、`SystemRoutes → IsSemver`、`UpdateEntityCard → FlowParser`——这是 GitNexus 自动生成的**「起点符号 → 终点符号」配对名**，不是用户旅程。证据：533 条流程的名字空间只有 143 个不同起点，338/593 个步骤符号被反复复用，步骤数被压在 3–7 步的窄带里。**同一段代码被切成几十条「流程」是常态。**

所以「真实链路数」的合理口径是 **143 个入口符号**，而不是 533。报告后续一律用 143 这个数。

### 1.2 跨层形状

| 跨的层 | 流程数 |
|---|---|
| `apps/web/server` + `packages/data-plane` | 87 |
| `apps/web/server` + `apps/web/src` | 31 |
| `packages/data-plane` + `packages/pipeline` | 24 |
| `apps/web/server` + `packages/pipeline` | 14 |
| `packages/context-compiler` + `packages/data-plane` | 11 |
| 其余 5 种 | 12 |

**真实链路集中在一条轴上：HTTP 入口 → data-plane。** 这与调用图一致——`apps/web/server` 直接调用 `data-plane` 内部 **181 处**（`CALLS` 171 + `ACCESSES` 10），而 `data-plane` 对外只有 16 个 import 点。

> **判断**：`data-plane` 是本仓最深的模块之一——16 个 import 点换来 181 个调用点、56 个外部调用文件。这是高杠杆，**不是问题**。真正的问题是它同时被 server 层与 pipeline 层直接穿透调用（181 + 177），改它的影响面覆盖两条主链路。

### 1.3 「124 个零入度入口」不是死代码

按流程标签取出的 143 个入口符号里，有 **124 个在 `CALLS` 图中入度为 0**。初看像一批永远不会被触发的链路，**但绝大多数不是**：

- `SystemRoutes`、`CrawlerRoutes`、`StoryboardRoutes` 等是**回调注册**的路由模块——`apps/web/server/api.ts:583-598` 用 `.use()` 挂载 16 个路由模块，模块标识符本身不产生 `CALLS` 边。
- `RunBenchmark`、`RunScenario`、`RunTaskModelEvaluation` 是 CLI/脚本入口，由 `process.argv` 分发。
- `ReadSuggestions`、`matrixRowRefFor` 等已在 `pnpm audit:unreferenced` 里确认为真零引用（见 ⑤）。

> **结论**：这 124 个必须逐个分类才能下结论，图谱的单看入度不足以判死。本报告只把其中与 `pnpm audit:unreferenced` 结果重合的部分列为问题（见 ⑤）。置信度：高（回调注册机制已在 `api.ts:580-598` 读到原文）。

---

## ② cluster 体检

### 2.1 自动聚类不可直接用

| 事实 | 值 |
|---|---|
| cluster 数 / 成员边 | 269 / 1939（均值 7.2 成员） |
| 快照声明 `symbolCount` 合计 vs 实际成员边 | 1939 vs 1939，**差 0**（这一项图谱自洽） |
| 不同标签 | 176 |
| 一个标签对应多个 cluster 的情况 | 24 个标签，其中 `Routes` **×19**、`Server` ×12、`Evaluator` ×9、`Storyboard` ×9 |
| **占位标签 `Cluster_NN`** | **141 个 cluster（52%），覆盖 870/1939 条成员边（45%）** |
| 合并同标签后没有任何外部调用者的域 | 51 / 176 |
| 横跨 >1 层的域 | 13 / 176 |

**超过一半的 cluster 没有人类可读的标签。** 所以本节把 269 个 cluster 按标签合并成 176 个「域」，用成员文件分布重述。

### 2.2 前 14 个域

列：合并 cluster 数 / 成员 / 文件 / 其中生产文件 / 域外调用它的文件数 / 跨的层 / 代表文件

| cluster | 成员 | 文件 | 生产 | 域外调用 | 跨层 | 域 | 代表文件 |
|---:|---:|---:|---:|---:|---|---|---|
| 19 | 307 | 86 | 86 | **112** | **7 层** | Routes | `packages/pipeline/src/session.ts` |
| 12 | 68 | 27 | 27 | 39 | 5 | Server | `apps/web/server/draftContext.test.ts` |
| 9 | 64 | 9 | 8 | 7 | server+web | Storyboard | `apps/web/src/storyboard/StoryboardView.tsx` |
| 9 | 62 | 16 | 16 | 13 | benchmark+flywheel+runtime | Evaluator | `packages/flywheel/src/evaluator/thresholds.ts` |
| 5 | 52 | 8 | 8 | 26 | server | Auth | `apps/web/server/auth/session.ts` |
| 3 | 49 | 7 | 7 | 42 | web | Api | `apps/web/src/api/client.ts` |
| 3 | 44 | 22 | 21 | 18 | web | Shell | `apps/web/src/App.tsx` |
| 1 | 42 | 13 | 13 | 66 | data-plane | Cluster_29 | `packages/data-plane/src/chapter.ts` |
| 5 | 41 | 9 | 9 | 17 | context-compiler+server | Llm | `apps/web/server/llm/providerSettings.ts` |
| 4 | 37 | 16 | 4 | 27 | web | Workbench | `apps/web/src/workbench/DialogueStream.tsx` |
| 2 | 36 | 3 | 3 | **1** | runtime | Recipe | `packages/runtime/src/recipe/recipe.test.ts` |
| 5 | 34 | 10 | 10 | 8 | server | Billing | `apps/web/server/billing/store.ts` |
| 1 | 26 | 7 | 7 | 12 | data-plane | Cluster_33 | `packages/data-plane/src/entity-cards.ts` |
| 4 | 24 | 10 | 10 | 9 | web | Components | `apps/web/src/mobile/components/MobileIcons.tsx` |

### 2.3 三条结构性判断

**（1）`Routes` 域是唯一的「上帝域」。** 19 个 cluster 合并后 307 个成员、86 个文件、112 个域外调用文件，横跨全部 7 层（data-plane / flywheel / kernel / pipeline / runtime / server / web）。代表文件 `packages/pipeline/src/session.ts` 同时是全仓扇入最高的模块之一：

- `session.ts:320 advance` 扇入 **119**
- `session.ts:266 start` 扇入 **52**
- `session.ts:258 currentStep` 扇入 **29**

**这是局部性最差的一处**：编排状态机被 86 个文件、112 个调用点穿透。任何对 session 语义的改动，验证面横跨整个仓库。这是本报告最值得排进施工单的结构性发现。置信度：高（图谱 + `session.ts` 行号双证）。

**（2）`Api` 域是本仓最健康的深模块。** 7 个文件、49 个成员，却服务 42 个域外调用文件，代表文件 `apps/web/src/api/client.ts`。小接口、大实现、高杠杆——教科书式的深模块。**不要动它。**

**（3）`Recipe` 域只有 1 个域外调用者。** 36 个成员挤在 3 个文件里，代表文件是 `packages/runtime/src/recipe/recipe.test.ts`（测试），唯一的外部调用者也是测试侧。这说明 `runtime/recipe` 目前基本是**评测/自测资产**，不是生产链路。是否属于「该接线未接线」，需要产品判断，**本报告不下结论**。置信度：中（仅图谱）。

**（4）51 个域没有任何域外调用者。** 其中包含 `Windows`、`Embedding-calib`、`Scripts` 等合理域，也包含大量 `Cluster_NN`。占位标签让这批域无法人工判读，属于图谱的可用性缺陷而非代码缺陷。

---

## ③ 分层检查

**方法**：不走图谱的 `IMPORTS` 边，改为**从 487 个源文件逐行解析 import/export/require 语句**（`dist-server` 等构建产物已排除），得到真值矩阵。图谱的 import 边被证伪过一次（见 ③.3）。

### 3.1 包依赖矩阵（生产代码，源码真值）

```text
kernel           → (无)                      ← 纯叶子
quality-engine   → (无)                      ← 纯叶子
data-plane       → kernel            (12)
runtime          → kernel (3), data-plane (1)
context-compiler → kernel (5), data-plane (1)
pipeline         → kernel(17) runtime(8) data-plane(15) quality-engine(3) context-compiler(1)
benchmark        → kernel(3) pipeline(2) context-compiler(1) quality-engine runtime
flywheel         → kernel(6) runtime(4) data-plane(5) pipeline(6) benchmark(5)
apps/web         → data-plane(16) kernel(9) pipeline(9) context-compiler(7) runtime(7)
                   quality-engine(6) flywheel(6)
```

**结论一：这是一个干净的 DAG，没有任何环。** `pnpm graph:check` 报的「No circular imports found」属实。分层本身没有问题。

**结论二：声明与实际零漂移。** 逐包对账 `package.json` 的 `dependencies` 与实际 import：

| 包 | 声明 | 实际 | 未用 | 未声明 |
|---|---|---|---|---|
| benchmark | context-compiler, kernel, pipeline, quality-engine, runtime | 同 | — | — |
| context-compiler | data-plane, kernel | 同 | — | — |
| data-plane | kernel | 同 | — | — |
| flywheel | benchmark, data-plane, kernel, pipeline, runtime | 同 | — | — |
| kernel | （无） | （无） | — | — |
| pipeline | context-compiler, data-plane, kernel, quality-engine, runtime | 同 | — | — |
| quality-engine | （无） | （无） | — | — |
| runtime | data-plane, kernel | 同 | — | — |
| apps/web | 7 个 @mozhou 包 | 7 个 | — | — |

置信度：高（487 文件逐行扫描 + 逐包 `package.json` 对账）。

### 3.2 两处值得记一笔的分层倒挂（都不是 bug，但都没有 ADR）

- **`runtime → data-plane`（1 处）**：`packages/runtime/src/eventBus.ts:9` 导入 `RUNTIME_EVENTS_PATH`。该文件第 3–4 行的注释说明这是有意为之（「append 动作委托 data-plane 既有 IO，runtime 不自持文件路径常量」）。代价是 `@mozhou/runtime` 无法脱离 `@mozhou/data-plane` 独立使用，「runtime 是底层」这个读法不再成立。**建议补一条 ADR 记录这个取舍**，否则下一个人会以为是失误并「修」掉它。
- **`flywheel → benchmark`（5 处）**：`@mozhou/benchmark` 是评测/基准包，`@mozhou/flywheel` 是被 `apps/web/server/draftContext.ts:7` 引用的生产模块。**生产包依赖测量包**，且经由 `apps/web → flywheel` 把 benchmark 拖进发布路径。代表点 `packages/flywheel/src/evaluator/project.ts:23` 从 `@mozhou/benchmark` 取 `readRecipeVersionFromPayload`。

### 3.3 图谱的三次证伪（重要，方法论资产）

这一节记录图谱在本次体检中被源码推翻的三处，**每一处都会导致「高估问题数」**：

1. **假环 `data-plane → pipeline`。** 图谱 `CALLS` 边显示 `packages/data-plane/src/reconciliation.ts` 调用 `packages/pipeline/src/extract-step.test.ts`。grep `data-plane/src` 下的 `extractStep` / `@mozhou/pipeline`：**0 命中**；import 矩阵里也没有 data-plane→pipeline 边。**图谱假阳性**（同名符号误连）。
2. **假环 `flywheel → benchmark`。** 图谱显示 `packages/flywheel/src/evaluator/run.ts` 调用 `packages/benchmark/src/run.test.ts`。该文件里 `benchmark` 的全部出现都是标识符 `benchmarkGatePassed`（:92/:112/:142/:240/:282）和注释（:14），**没有 import**。**图谱假阳性**。
3. **假「越层深导入」。** 图谱 `IMPORTS` 显示 `apps/web/src/workbench/editor/EditorQualityTelemetry.tsx` 导入 `packages/quality-engine/src/de-ai.ts`。实际上那只是第 14 行注释里的文字（`不变量由 packages/quality-engine/src/de-ai.browser-safe.test.ts 约束`），**源码里没有这条 import**。

> **正面结论**：`apps/web` **完全没有绕过包接口直接摸实现**——0 处深导入，全部走 `@mozhou/*` 包名。这条结论只靠源码扫描得出；靠图谱会得出相反的错误结论。

### 3.4 图谱的取样偏差

图谱 7681 个节点里，**`docs` 占 2027（26.4%）、`scripts` 占 370（4.8%），合计 31% 是非代码**。cluster 与执行流的聚类因此被文档稀释。建议下次 `analyze` 时把 `docs/` `specs/` 排除出索引范围，或至少在图谱视图里默认折叠——否则「最大域」的规模会被 prose 撑大。

---

## ④ 信任边界（判据：`docs/adr/0030-local-api-trust-model.md`）

### 4.1 六个守卫的接线复核 —— 与 ADR 一致

逐个给 `文件:行号`：

| 守卫 | 定义 | 生产调用点 | 判定 |
|---|---|---|---|
| `assertTrustedRequest` | `apps/web/server/security.ts:106` | **仅 `apps/web/server/router.ts:82`** | 已接线，1 个调用点 |
| `readRequestPayload` | `security.ts:137` | `router.ts:85` | 已接线 |
| `parseCookies` | `security.ts:223` | `apps/web/server/auth/session.ts` | 已接线 |
| `RateLimiter` | `security.ts:241` | `apps/web/server/auth/session.ts` | 已接线 |
| `assertSafeBookRoot` | `security.ts:23` | 10 个文件 48 处（pipelineRoutes 9 / proseRoutes 7 / storyBrainRoutes 7 / worksRoutes 7 / storyboardRoutes 6 / bookAccess 3 / reconciliationRoutes 3 / styleAnalysis 3 …） | 已接线 |
| `assertSafeParentDirectory` | `security.ts:53` | `routes/worksRoutes.ts` 3 处 | 已接线 |

**ADR-0030 决定 3 的「安全面零悬空」与源码一致，本次复核确认。** 置信度：高（6/6 守卫的声明处与全部生产调用点都有行号）。

路由装配面也复核过：`apps/web/server/api.ts:580-598` 的 `createMoZhouApiRouter()` 用 `.use()` 挂载 16 个路由模块；`apps/web/server/productionServer.ts:29` 创建唯一实例。策略检索 `routePolicies.ts:156 getRoutePolicy` 由 `router.ts:58` 调用，**未登记路径 fail-closed**。

### 4.2 五处缺口

**【G1｜高】静态资源分发完全无守卫。**
`apps/web/server/productionServer.ts:152` 把 `/api/` 前缀交给 `apiRouter.dispatch`（内含 `assertTrustedRequest`）；**其余路径（:162–192）只做 `insideDist` 目录穿越检查（:179），没有任何身份校验，直接从 `dist/` 发文件**。
组合 `docker-compose.yml:18` 的 `HOST=0.0.0.0`（容器内监听全部接口）与 `docker-compose.windows.yml:13` 的 `network_mode: host`（宿主网络直连、`ports: []`），局域网任意主机可取走 `index.html` 与全部前端 JS。
ADR-0030 只讨论了 `/api/` 与 token 投递，**没有覆盖这条路径**。置信度：高（代码与 compose 行号双证；可利用性取决于是否真的用该 overlay 启动）。

**【G2｜中】`HOST` 没有 loopback 校验。**
`productionServer.ts:26` `const host = process.env['HOST'] ?? '127.0.0.1'`。默认值安全，但代码不阻止把它改成对外地址，且 compose 明确这么做了。与 G1 是同一条因果链。置信度：高。

**【G3｜中】策略检索排在信任校验之前。**
`router.ts:58` 先查策略、未命中即返回 403 `UNREGISTERED_ROUTE_POLICY`，`assertTrustedRequest` 到 `router.ts:82` 才执行。结果是：能区分「哪些路径已登记」的探测面。fail-closed 成立，**不构成绕过**，但顺序与 ADR 决定 1 的表述不一致。置信度：高（行号双证），严重性低。

**【G4｜低】`getAllRegisteredRoutes()` 是死导出。**
`apps/web/server/routePolicies.ts:183`，`pnpm audit:unreferenced` 判定生产 0 引用 + 测试 0 引用（全仓仅 :183 定义与 :184 内部使用）。它的职责已由 `apps/web/server/tenancy.test.ts:138-169` 承担——该测试遍历各路由文件的 `/api/` 字面量并断言全部被 `getRoutePolicy` 覆盖。**说明 `routePolicies.ts:7` 注释里承诺的「自动化检查」是活的，只是实现落在测试里而不是这个导出上。**

**【G5｜记录项，非缺陷】`security.ts:113 if (origin === undefined) return`。**
ADR-0030 决定 2 已明示接受。它是「本机任意进程可驱动全部 API」的成因，也正是 G1 严重性的分界：**局域网能拿静态资源，但调不动 API**。报告点名以免将来被当成新发现。

### 4.3 顺带确认的正面事实

- `productionServer.ts:37` `assertMasterKeyConfigured()`：生产/hosted 缺主密钥**在监听前**拒绝启动。
- `productionServer.ts:40` 启动期进程级排他锁，抢不到直接抛错。
- `productionServer.ts:81-89` CSP / X-Frame-Options / nosniff / no-referrer 全套响应头，静态与 API 都在 `setSecurityHeaders` 之后。
- `productionServer.ts:214-255` 优雅停机：先 `close` 排空再退出，含 `closeIdleConnections` 与 10s 强超时。

---

## ⑤ 问题清单

排序：合规缺口 > 安全 > 断链 > 结构 > 死代码。置信度：**高** = 图谱与源码双证；**中** = 仅图谱（图谱陈旧度见开头）；**低** = 仅 grep/源码单证。

| # | 级别 | 位置 | 现象 | 建议 | 置信度 |
|---|---|---|---|---|---|
| 1 | **合规** | `apps/web/src/public/PublicSite.tsx:14` | F16 要求「新建 PublicSite.tsx **及测试**，接到现有 App 路由」。实测：文件在，全仓仅 3 处提及——自身定义、`apps/web/server/auditUnreferenced.test.ts:31`（**测试夹具里的字符串字面量，不是 import**）、计划文档。**未挂路由、0 个测试**。同一计划 `docs/superpowers/plans/2026-09-15-full-release/02-features.md` 全文 `- [x]` **0** 项、`- [ ]` **32** 项 | 要么接线+补测，要么从计划里划掉。**注意 grep 陷阱**：那处测试夹具会让关键词搜索得出「有引用」的错误结论 | 高 |
| 2 | 安全 | `apps/web/server/productionServer.ts:152-192` | 非 `/api/` 的 GET/HEAD 无身份校验直接发 `dist/` 文件；配合 `docker-compose.yml:18` `HOST=0.0.0.0` 与 `docker-compose.windows.yml:13` host 网络，静态前端对局域网开放 | 静态分发前加 loopback 校验，或在 compose 里锁死回环 | 高 |
| 3 | 安全 | `apps/web/server/productionServer.ts:26` | `HOST` 无 loopback 断言 | 启动时 `HOST` 非回环直接拒绝启动 | 高 |
| 4 | 结构 | `packages/pipeline/src/session.ts:258,266,320` | 编排状态机扇入 119/52/29；`Routes` 域 19 个 cluster、86 文件、112 域外调用、横跨 7 层。局部性最差的一处 | 先出 ADR 记录「session 是唯一编排入口」的约束，再谈是否收窄 | 高 |
| 5 | 结构 | `packages/runtime/src/eventBus.ts:9` | `runtime → data-plane` 反向依赖，注释说是有意为之但无 ADR | 补 ADR | 高 |
| 6 | 结构 | `packages/flywheel/src/evaluator/project.ts:23` | 生产包 `flywheel` 依赖测量包 `benchmark`，经 `apps/web` 进入发布路径 | 明确 benchmark 是否该留在生产依赖里 | 高 |
| 7 | 工具 | `AGENTS.md` / `CLAUDE.md` gitnexus 头部 | 声明 8455 符号 / 19013 关系 / 534 流，实测 7681 / 14982 / 533，口径未定义 | 改头部或注明口径 | 高 |
| 8 | 工具 | `scripts/audit-unreferenced.mjs:90-101` | 候选过滤器要求 `kind === 'Function'`，**不覆盖以其它 kind 落盘的符号**。本次实跑：图谱候选 186 → 真零引用 **16**，另有 **5 个 file-missing**（图谱有、磁盘无）。交接文档记录的 17 与本次 16 不一致，且 `PublicSite` 不在自动名单里（只能靠人工发现） | 候选集合放宽到全部 kind；file-missing 桶单列输出 | 高 |
| 9 | 工具 | 图谱取样 | 31% 节点是 `docs`/`scripts`，聚类被 prose 稀释 | 下次 analyze 排除文档目录 | 高 |
| 10 | 死代码 | `apps/web/server/routePolicies.ts:183` | `getAllRegisteredRoutes()` 生产 0 + 测试 0 引用，职责已被 `tenancy.test.ts:138-169` 覆盖 | 删 | 高 |
| 11 | 死代码 | 见下方清单 | `pnpm audit:unreferenced` 判定的真零引用 | 分三类处置，见下 | 高 |
| 12 | 顺序 | `apps/web/server/router.ts:58` vs `:82` | 策略检索早于信任校验 | 调整顺序或补注说明 | 中 |
| 13 | 接线 | `packages/runtime/src/recipe/` | 36 成员 / 3 文件的域只有 1 个域外调用者，代表文件是测试 | 产品判断是否属于「该接线未接线」 | 中 |

### 11 号明细：真零引用清单

`pnpm audit:unreferenced` 判为 `unreferenced`（生产 0 + 测试 0）共 16 项。按交接文档的分类：

- **合规缺口（1）**：`PublicSite`（见 1 号；不在自动名单，人工发现）
- **设计清单点名、但无动作动词（3）**：`PublicationExportModal`、`InlineDiffViewer`、`useEditorSelection` —— 见 `docs/superpowers/specs/2026-09-12-mozhou-ink-realm-design.md:505-511,867`
- **无任何文档背书（12）**：`isCrawl4aiAlive`、`getAllRegisteredRoutes`、`listReconciliationRuntimes`、`syncContractToLocalCanon`、`parseTextToBlocks`、`serializeBlocksToText`、`computeSha256Hex`、`exportSubmissionDocxHtml`、`canonSeedFilePaths`、`readSuggestions`、`matrixRowRefFor`、`GoalProgressWidget`
- **本次新增（交接文档未列）**：`FloatingInspirationDrawer`（`apps/web/src/workbench/dialogue/FloatingInspirationDrawer.tsx:9`）

> 差异原因：`apps/web/src/code-graph/codeGraphData.json` 已被他人重新生成（工作区未提交改动），图谱候选从 174 变为 186，分类随之变化。**这说明「零引用数」依赖图谱快照，不是稳定事实**——本清单的权威来源是 `pnpm audit:unreferenced` 的当次实跑输出。

---

## 附录 A · 复算方式

本次体检的全部中间脚本在 `%TEMP%\mozhou-graph-audit\`（**不在仓库内**）：

| 脚本 | 产出 |
|---|---|
| `probe.mjs` | 图谱 schema、cluster/流程快照概览 |
| `cy.mjs` / `cyprobe*.mjs` | GitNexus 只读 cypher 的可用查询形态 |
| `pull-all.mjs` | 19064 条边全量落盘（all-edges.json） |
| `flows.mjs` | 第 ① 节：执行流统计 |
| `domains.mjs` | 第 ② 节：269→176 域合并表 |
| `imports2.mjs` | 第 ③ 节：487 文件真实 import 矩阵 |
| `local-graph.mjs` | 层级矩阵、扇入扇出 |
| `verify.mjs` | 零引用复核（目标符号计数段有 bug，未采用） |

**GitNexus 只读 cypher 的已知约束**（踩坑记录）：CLI 只接受 `MATCH (a)-[r]->(b)` 或 `MATCH (a)-[r:CodeRelation]->(b)` 两种关系形态。`-[r:MEMBER_OF]->`、`-[r:STEP_IN_PROCESS]->` 以及在关系端点上加 `:Community` / `:Process` 标签，**全部会失败且错误信息被吞成 "Command failed"**。绕过办法：拉全量边再按 `labels(c)` 在脚本侧分流。

**重跑前置**：图谱基线已陈旧 17 个提交。若要让结论完全对齐 HEAD，需先跑 `node .gitnexus/run.cjs analyze` 刷新索引——本次按约定**未跑**。

---

## 附录 B · 本次未覆盖 / 仍然挂账

**未验证的维度：**
- `src-tauri` 未编译验证，Rust 侧 6 个图谱节点未逐个核
- 所有 LLM 路径未实跑（环境无 provider API key）
- 163 处 `LocalDataPlane.open` 只有源码级保证，**无压力测试**，句柄泄漏未验证
- 静态资源暴露（G1）未做实际渗透验证，只做了代码路径推演
- `pnpm graph:check` 未重跑（本次只读源码矩阵，结论一致但未实跑门禁）

**两条未解事实（沿用交接文档，本次未推进）：**
1. 六门禁跑批时 web 套件出现过**一次** `1 failed | 706 passed`，随后连跑 4 次全绿，**那个用例至今不知是谁**。未稳定前不要宣称该套件稳定。
2. GitNexus `impact` / `detect_changes` **全程未跑**（`CLAUDE.md` 要求编辑符号前必跑）。本次是只读体检，不构成豁免——**一旦开始改代码，这一条必须先补上**。

**本次未做的事**：未改任何代码、未 commit、未 push、未重新生成图谱、未跑 `gitnexus analyze`、未碰 5 个他人未提交文件、未动 5192/43000-43002 上运行中的实例。
