# 代码层重复裁决清单 (Code Duplication Inventory)

> 生成日期：2026-10-01 · 方法：**静态分析**（import/export 解析、文件存在性、`git ls-files`、行数统计）
> **未执行**应用、测试或 `scripts/audit-unreferenced.mjs`。因此每条结论都是「代码怎么写的」，不是「跑起来是什么行为」。

本清单回答 Q13=(ii) 承诺但上一轮未交付的那件事：**每个被标记为「重复」的项，到底是有意的分层成本、真死代码，还是真重复。**

## 0. 裁决总表

| # | 项 | 裁决 | 决定性证据 |
|---|---|---|---|
| 1 | 两套 tier router | **(a) 有意分层** — 根本不是重复 | `apps/web/server/llm/tierRouting.ts:30` **import** 了 `@mozhou/runtime` 的 `selectTierRoute`，并未重定义 |
| 2 | 24MB BGE 「加载两次」 | **(a) 前提不成立** — 全仓只有一个 `.onnx`、一个工厂 | `apps/web/server/localEmbedding.ts:24` import 同一工厂；惰性包装是**有意**的 |
| 3 | 7 个落盘 store | **混合：4 活 / 1 死 / 2 根本不是 store** | `dataRoot.ts`(34 行) 只解析路径；`localEmbedding.ts`(60 行) 只缓存 Promise |
| 4 | 3 个生产启动器 | **(a) 分层：一个 server + 两个前置 shim** | 三者最终都进 `productionServer.js` |
| 5 | 3 套 UI CSS | **(a) ink-orbit/ink-realm 都是活的**；但 **ADR-0029 状态陈旧** | `globals.css:7-8` 两个都 `@import` |
| 6 | 两套 SQLite 约定 | **(c) 真重复** — 且其中一份是死的 | `migrations/001-orders.sql` 零读者；`store.ts:72-112` 是逐语句相同的内联副本 |
| 7a | sha256 双份 | **(a) 合理分层** | data-plane 用 `node:crypto`；web 用 Web Crypto + 纯 JS 回退（浏览器包） |
| 7b | txt-clean 双份 | **(b)+(c) 真漂移** | `txtCleanExporter.ts:6` 零调用者，且**类型已漂移** |
| 7c | 微信 vs 支付宝 | **(a) 不是重复** | 协议不同：header 签名+AES-GCM vs 字典序参数+RSA2 |
| 8 | `codeGraphSnapshot.ts` 8296 行 | **(a) 活的生成物** | `CodeGraphView.tsx:2`、`CodeNodeExplorer.tsx:4` 都 import 它 |
| 9 | `api.test.ts` 1446 行 | **(a) 前提错误** — 它不是契约复述 | `api.test.ts:3-5` 黑盒真 HTTP；`src/api/client.ts:27` **从服务端 import 类型** |

> **裁决 (a) = 有意分层 / 前提不成立；(b) = 死代码；(c) = 真重复。**

## 1. 两套 tier router —— 我上一轮说错了

`packages/runtime/src/tierRouting.ts:18-20` 声称分层是**有意的，这个说法为真**。

- `apps/web/server/llm/tierRouting.ts:30` **import** `selectTierRoute`，`:127` 调用。它从不重定义选择逻辑，只加 IO 层：配置路径(`:101`)、存在性探测(`:124`)、`api_key_ref` 拒绝(`:138-146`)、SSRF 闸门与密钥解析(`:167-215`)。
- 合并会怎样：`packages/runtime` 是**浏览器安全**的领域包。把 `node:fs/os/path`(`:27-29`) 和 SSRF 闸门（它 import `./openaiStream.js`, `:32`）拉进去会**打爆 Vite 客户端包**并反转依赖方向。

**附带发现**：`applyTierModel`(`apps/web/server/llm/tierRouting.ts:225`) 在生产中**已死**，它自己的注释(`:220-223`) 就承认了，只剩单测消费者。

**要你答**：删掉它，还是作为「同一语义只应有一份实现」的单实现原语保留？注释说要有唯一实现，同文件里却坐着第二份无引用的。

## 2. 「24MB 模型加载两次」—— 前提不成立

全仓**只有一个** `*.onnx`：`packages/context-compiler/assets/models/bge-small-zh-v1.5/model_quantized.onnx`（24,010,842 字节）。只有一个 `bge*` 目录。

`localEmbedding.ts` 是**同一个工厂的惰性包装**，不是第二份实现：

- 惰性策略**有意不同**：`embedding.ts:154-172` 调用即加载；`localEmbedding.ts:33,51-54` 记忆化 Promise，使 24MB + 逐文件 sha256 复核（其 `:4-7` 自述「秒级成本」）**只在首次召回付一次**，而不是启动时。
- 失败策略**有意不同**：`embedding.ts` 在资产损坏时 `throw ModelAssetsError`；`localEmbedding.ts:35-45` 捕获、记可执行的日志、返回 `null`，使召回**降级为关键词+图**。理由写在其 `:9-19`。
- 合并会怎样：没有可合并的。删掉 `localEmbedding.ts` 会（i）让 24MB+sha256 落到启动期，（ii）失去让章节仍可生成的降级，（iii）打断 `draftContext.test.ts:587,602,619`。

**建议**：把 `localEmbedding.ts` 改名为 `lazyEmbeddingProvider.ts`，让「包装器」性质一眼可见。

## 3. 落盘 store —— 只有一个真死

| 文件 | 存什么 | 活？ |
|---|---|---|
| `memo/memoStore.ts` | 作者便签 `<dataRoot>/memo/<sha256>.json` | **活** — `memoRoutes.ts:14,62,85,104,132` |
| `account/store.ts` | 用户档案 `users/<id>/profile.json` | **死** — `accountRoutes.ts` 从不 import 它 |
| `billing/store.ts` | orders / payment_events / entitlement_grants | **活** — `billingRoutes.ts`、`notifications.ts`、`entitlements.ts`、`pollingWorker.ts` |
| `storyboard/store.ts` | 分镜文档 | **活** — `storyboardRoutes.ts:24` |
| `dataRoot.ts` | **不是 store**，只解析 `MOZHOU_DATA_ROOT`(`:17`) | 活但**被我上一轮误计** |
| `llm/providerSettings.ts` | BYOK 端点 + AES-256-GCM 密钥 | **活** — `providerRoutes.ts`、`openaiStream.ts:180` |
| `localEmbedding.ts` | **不是 store**，只缓存 Promise(`:33`) | 活但**被我上一轮误计** |

**唯一真死**：`apps/web/server/account/store.ts`。`recordBookForUser`(`:45`) 与 `getProfile`(`:30`) **零调用者**；`saveProfile` 唯一调用者是测试（`dataRoot.test.ts:96`，且只把类当探针用）。

**要你答**：`AccountStore` 若死，删掉。若它是给 hosted 模式预留的档案存储，那么**错的是 `accountRoutes.ts`** —— 该路由声称服务 `/api/account`(`:16`) 却从会话提供方读身份。`UserProfile.plan` / `bookIds` 的家到底该是谁？

## 4. 启动器 —— 分层，不是三选一

- `apps/web/server/productionServer.ts`（264 行）= **唯一的服务端**。
- `scripts/launcher.mjs` = 源码运行便利层：缺 dist 就先构建(`:33-50`)，spawn `productionServer.js`，开浏览器(`:68-79`)。被 `启动墨舟.bat:49`、`start.sh:35` 调用。
- `scripts/release/windows/desktop-server.mjs` = **安装器预载**，不是启动器：铸造 installation.key → `MOZHOU_SECRET_KEY`(`:8-17`)，钉死 `NODE_ENV=production`(`:18-20`)，再 import 服务端，最后补一个 Windows 没有 SIGTERM 的 stdin→SIGTERM shim(`:25-34`)。被编译后的托盘程序 `MoZhou.cs:114` 调用。

**附带死脚本**：`scripts/build-windows-runtime.mjs`（60 行）**零调用者** —— 无 npm script、无脚本引用，唯一提及是一份计划文档。而且它写的 `run.mjs`(`:39-46`) 设了 `NODE_ENV=production` 却**从不设 `MOZHOU_SECRET_KEY`**，因此它产出的产物**根本起不来**（`productionServer.ts:37` 会拒绝启动）。

## 5. UI 主题 —— ADR-0029 状态陈旧

`apps/web/src/main.tsx:4` → `globals.css:7-8` **同时** `@import` ink-orbit 与 ink-realm。**两个都是活的**，级联覆盖是 ADR-0028 `:23,:31` 明确记录的设计（「ink-orbit 为过渡底座，退役票未做」）。

**但 ADR-0029「银白」既不是第三个 CSS 文件，而且被部分回滚了**：

- ADR-0029 `:3` 声称「状态：已实施（生产构建）」，`:9-10` 声称 `:root` 已换成 `#e6ecf2`。
- 实测 `globals.css:12` 是 `--background: #080b11`（暗色），`:2` 仍写「Night Manuscript Studio… 暗色后台」。
- git 历史：`046d166`(2026-09-14 银白换肤推广) → `a3bd0db`(2026-09-19 「Linear obsidian design system」) → `1676677`。
- **回滚残留**：`scenePreference.ts:56` 仍默认 `sceneId: 'silver-atrium'`（**暗色 UI 底图用银白场景**）；`storyboard.css:11` 仍是 `#e6ecf2`；`mobile.css:524` 仍带 `#e6ecf2`。

**要你答**：ADR-0029 是否应改状态为「被 a3bd0db 部分回滚」？`silver-atrium` 是否该停止做默认场景？现状是**暗色主题配银白默认底图，且没有任何 ADR 记录这次回滚**。

## 6. 两套 SQLite 约定 —— 真重复，且有一份是死的

- 约定 A（data-plane）：`PROJECTION_SCHEMA_VERSION = 2`(`:8`)，注释**明令禁止增量迁移**(`:4-5`)，`assertProjectionVersion` 在 `local-data-plane.ts:116` 强制。从正典重建，从不迁移。
- 约定 B（billing）：**完全没有版本闸**。`store.ts:133` 调 `openDatabase`（只设 WAL + foreign_keys）后直接执行内联 DDL(`:135-137`)。从不读 `user_version`。
- **重复点**：`billing/migrations/001-orders.sql`（45 行）与 `store.ts:72-112` 的 `DDL_STATEMENTS` **逐语句相同**（7 条语句、同名、同索引、同 CHECK、同偏索引）。执行的是 `store.ts:135-137`。**那个 `.sql` 没有任何读者**，且 `scripts/release/windows/build.mjs:17` 只拷 dist/dist-server/package.json，**它根本没被打包**。

**要你答**：billing 到底该像投影那样**版本化**，还是像投影那样**重建**？现在是两者都不是：DDL 重复、闸门缺失、且**旧版本留下的 `billing.sqlite` 会静默保留旧 schema**，因为 `CREATE TABLE IF NOT EXISTS` 对已存在的表是空操作。选一个：(a) 删 `.sql`、认内联 DDL 为真源（零风险、诚实）；或 (b) 采用 data-plane 的 `user_version` 闸门并让 `.sql` 成为唯一源。

## 7b. txt-clean —— 真漂移

`packages/data-plane/src/txt-clean.ts:9-28` 与 `apps/web/src/export-suite/txtCleanExporter.ts:6-25` 是**逐行相同**的同一函数。

- `txtCleanExporter.ts:6` 的 `exportCleanTxt` **零调用者**；只有它的**类型**被 import（`PublicationExportModal.tsx:2`、`exportDownload.ts:1`，都是 `import type`）。
- 服务端用的是 data-plane 那份（`exportRoutes.ts:8,71`）。
- **类型已经漂移**：data-plane 声明 `readonly title/content`，副本声明可变的 `title: string;`，还混了分号与英文注释。将来一次改动会在客户端副本编译通过、在服务端副本失败。

**要你答**：客户端那份是计划中的离线导出，还是路由出现前的遗留？若遗留，删函数、只保留一个 re-export 的类型。

## 9. `api.test.ts` —— 我上一轮说错了

它**不是**客户端契约复述。文件头(`:3-5`)自述「黑盒：真实 HTTP 起服 → POST /api/* 断言 JSON 直出」；`:13` import 的是**真实调度器** `apiMiddleware`；`:55-59` 每个测试绑一个真的 `node:http` 到 `127.0.0.1:0`；`:14-31` 用**真的包**播种状态，没有 fixture。

UI 侧也没有复述契约：`apps/web/src/api/client.ts:27` **从 `../../server/api` import 类型**，所有 view 都如此（`MemoView.tsx:9`、`WorksView.tsx:13`、`StoryboardView.tsx:18`…）。一份声明，两边消费 —— 这是标准的防漂移设计。

它的 1446 行来自**纵向**集成（建书 → 实体卡 → 编译 → 草稿 → 提交 → 收据），体量跟的是真实行为。`:798` 已把路由细节让给 `server/routes/pipelineRoutes.tierRoute.test.ts`，仓库约定是「薄的跨切面 + 厚的按路由文件」。

**要你答**：1446 行单文件**无论对错都是评审负担**。要不要按旅程（setup / book / context / draft / commit）拆分，与既有按路由的套件并存？纯移动文件，行为不变。

## 顺带发现的两件事（比上面多数条目更该先处理）

### A. `scripts/build-windows-runtime.mjs` 产出的产物**起不来**
零调用者，且它生成的 `run.mjs` 设 `NODE_ENV=production` 却不设 `MOZHOU_SECRET_KEY`，`productionServer.ts:37` 会拒绝启动。

### B. `NODE_ENV` 缺失曾导致验签降级 —— **已关闭（R2 修复后不存在），边界仍要说清**

- ✅ **已核实**：`scripts/launcher.mjs` **从不设置** `NODE_ENV`；安装器路径 `desktop-server.mjs:18` **会**设 `production`。
- ⚠️ **已过期（R2 修复后，2026-10-10 复核）**：本节原称 `wechat.ts` / `alipay.ts` 在「未配置公钥」分支里，只有 `NODE_ENV === 'production'` 才抛 503 缺证书。**该行为已不存在**：两个 verifier 现为**无条件 fail-closed**——未配置证书/公钥一律抛 503，与 `NODE_ENV` 无关（`wechat.ts:94-99`、`alipay.ts:63-67`，注释明写「与 NODE_ENV 无关」；两文件已无 `NODE_ENV` 引用）。
- ⚠️ **原「措辞纠正」已失效**：原称「未配置公钥 + 非 production 时，不以那两个前缀开头的签名会静默穿过验签，无任何错误」——该放行分支已随 R2 修复删除，此暴露不再成立。
- ⚠️ **未核实**：伪造通知是否真能推进订单/权益变更 —— 需运行时验证，本清单未跑应用。
- ✅ **已核实（缓解事实）**：`productionServer.ts:37` 启动即 `assertMasterKeyConfigured()`。所以 `pnpm start` 没有 `MOZHOU_SECRET_KEY` 就**拒绝启动**，`providerSettings.ts:99` 的 `DEV_FALLBACK_SECRET` 派生在该路径上够不到服务。

**结论（2026-10-10 更新）**：验签降级暴露已随 R2 修复关闭，本条不再是安全缺陷。仍存的是**文档口径问题** —— `docs/deployment.md:15` 把 `pnpm start` 列为本地运行入口，但 `scripts/launcher.mjs` 不满足 `MOZHOU_SECRET_KEY` 的生产前提（`productionServer.ts:37` 缺主密钥即拒绝启动）。**要你答**：`pnpm start` 到底是不是面向终端用户的真实运行路径？如果是，它需要 `desktop-server.mjs:8-17` 那套 installation.key 引导；如果不是，`docs/deployment.md` 应改写，别让它读起来像生产入口。

## 我上一轮说错、在此更正的四项

| 我说过的 | 实测 |
|---|---|
| 「两套 tier router」是重复 | **根本不是** —— web 层 import 了 runtime 层 |
| 「同一 24MB 模型加载两次」 | **前提不成立** —— 一个 onnx、一个工厂、一个惰性包装 |
| `api.test.ts` 是客户端契约复述 | **前提错误** —— 黑盒 HTTP 集成，类型从服务端 import |
| 「7 个 store」 | 只有 **1 个**死，**2 个不是 store** |

行数也报错过：`ink-orbit.css` 是 1348（我说 1160）、`ink-realm.css` 1594（1542）、`api.test.ts` 1446（1328）、`codeGraphSnapshot.ts` 8296（8295）。

## 下一步的方法论

**任何要动手的死代码结论，先跑 `pnpm audit:unreferenced`**（`package.json:27` → `scripts/audit-unreferenced.mjs`），不要靠 grep。该脚本头部(`:4-10`)自述它**故意不信代码图**，因为图谱产生过三类误报（63 个组件、52 个闭包、16 个路由工厂被误报为无引用）。
