# 02 · 真实模块清点、架构三图与逐模块边界证据卡
# (MoZhou / Novel OS 模块架构审计 · 2026-10-03)

> **审计依据**：`00-audit-charter.md`（章程口径）、`01-baseline-and-graph-gate.md`（基线事实）、`inventory.json`（全量运行单元）。  
> **基线标识**：`HEAD:90b45a1`（提交哈希 `90b45a1a1bf15a97b1cc690ad0b9872018aeebcb`，分支 `feature/windows-local-release`，ahead 7）。  
> **工作区状态**：既有未提交 42 项（`-uall` 展开 50 个文件）。凡触及未提交路径的结论一律标注 `WORKTREE(未提交)`。  
> **图谱通道状态**：CLI 通道已通过门禁（`gitnexus` CLI 1.6.10-rc.123 实测 `query` / `context` / `impact` / `check --cycles` 可用；索引建于 2026-10-02 21:22，未包含后续改动）；Rust、IPC、HTTP、文件约定与副作用标注「图谱未覆盖」。  
> **配套图文件**：`audit-2026-10-03/figs/01-source-dependency-graph.mmd`、`02-runtime-process-graph.mmd`、`03-data-ownership-graph.mmd`。

---

## 目录

1. [一、 模块架构总体发现与独立清点](#一-模块架构总体发现与独立清点)
2. [二、 架构三图与深度技术剖析](#二-架构三图与深度技术剖析)
   - [2.1 图一：源码依赖图 (Source Dependency Graph)](#21-图一源码依赖图-source-dependency-graph)
   - [2.2 图二：运行图 (Runtime Process & Execution Graph)](#22-图二运行图-runtime-process--execution-graph)
   - [2.3 图三：数据所有权图 (Data Ownership & Persistence Graph)](#23-图三数据所有权图-data-ownership--persistence-graph)
3. [三、 逐模块/子系统边界证据卡](#三-逐模块子系统边界证据卡)
   - [卡 01：@mozhou/kernel (纯领域核心与类型契约)](#卡-01mozhoukernel-纯领域核心与类型契约)
   - [卡 02：@mozhou/quality-engine (机检规则与 De-AI 引擎)](#卡-02mozhouquality-engine-机检规则与-de-ai-引擎)
   - [卡 03：@mozhou/data-plane (本地优先数据平面与 SQLite 投影)](#卡-03mozhoudata-plane-本地优先数据平面与-sqlite-投影)
   - [卡 04：@mozhou/context-compiler (上下文编译器与三通道召回)](#卡-04mozhoucontext-compiler-上下文编译器与三通道召回)
   - [卡 05：@mozhou/pipeline (十步长篇创作状态机与提交编排)](#卡-05mozhoupipeline-十步长篇创作状态机与提交编排)
   - [卡 06：@mozhou/runtime (模型路由、配方装载与事件总线)](#卡-06mozhouruntime-模型路由配方装载与事件总线)
   - [卡 07：@mozhou/flywheel (文风画像学习器与评测闭环)](#卡-07mozhouflywheel-文风画像学习器与评测闭环)
   - [卡 08：@mozhou/benchmark (六指标断言与夹具套件)](#卡-08mozhoubenchmark-六指标断言与夹具套件)
   - [卡 09：apps/web/src (Web 前端客户端总成)](#卡-09appswebsrc-web-前端客户端总成)
   - [卡 10：apps/web/server (Node.js BFF 服务端与核心能力路由)](#卡-10appswebserver-nodejs-bff-服务端与核心能力路由)
   - [卡 11：src-tauri (Tauri 桌面外壳宿主)](#卡-11src-tauri-tauri-桌面外壳宿主)
   - [卡 12：MoZhou.cs & desktop-server.mjs (Windows 商业桌面宿主启动器)](#卡-12mozhoucs--desktop-servermjs-windows-商业桌面宿主启动器)
   - [卡 13：scripts/launcher.mjs (开发与统一 CLI 启动器)](#卡-13scriptslaunchermjs-开发与统一-cli-启动器)
   - [卡 14：installer.iss (Inno Setup 安装包与升级生命周期规约)](#卡-14installeriss-inno-setup-安装包与升级生命周期规约)
4. [四、 明确不成立的模块架构说法 (逐条事实批驳)](#四-明确不成立的模块架构说法-逐条事实批驳)
5. [五、 图谱未覆盖域与补证结论](#五-图谱未覆盖域与补证结论)

---

## 一、 模块架构总体发现与独立清点

### 1.1 核心裁决：打破「只有 9 个模块」的误判

上一份报告（`MOZHOU_MODULE_ARCHITECTURE_AUDIT.md` 第 5、16–25 行）将系统边界简单化归为「Monorepo 全量 9 个模块」（即 `packages/*` 下 8 个包 + `apps/web`），并将 `src-tauri` 作为「不属于 Pnpm 包的原生打包外壳」轻描淡写略过。

**本次独立清点裁决：该说法不成立，遮蔽了真正的系统拓扑与关键单点。**  
通过代码静态测绘、运行时进程与启动脚本逆向、构建目标配置文件核查，MoZhou 实际包含 **14 个具有独立职责边界、执行上下文、状态归属或发布形态的架构单元**：

| # | 单元标识 | 物理路径 | 类别 | 运行位置 / 进程形态 | package.json 声明 | 真实角色与边界核心 |
|---|---|---|---|---|:---:|---|
| U01 | `kernel` | `packages/kernel` | 基础包 | 纯内存库 (被其他包导入) | `@mozhou/kernel` | 领域基石：九柱类型、不可变核心不变量断言、ULID 生成 |
| U02 | `quality-engine` | `packages/quality-engine` | 基础包 | 纯算术/正则库 (服务端 + 浏览器) | `@mozhou/quality-engine` | 机械质量红线核验、De-AI 腔调诊断（含浏览器安全子路径导出） |
| U03 | `data-plane` | `packages/data-plane` | 存储包 | 服务端 Node 进程内 (同步 C++) | `@mozhou/data-plane` | 本地文件 I/O 门面、YAML 正典、SQLite 投影与外部对账核心 |
| U04 | `context-compiler` | `packages/context-compiler` | 编译包 | 服务端 Node 进程内 (ONNX 线程) | `@mozhou/context-compiler` | 实体三通道召回、Token 预算两阶段装配、不可变 Receipt 凭证生成 |
| U05 | `pipeline` | `packages/pipeline` | 编排包 | 服务端 Node 进程内 | `@mozhou/pipeline` | 十步长篇状态机、候选隔离、双阶段提交编排与 Proposal 门面 |
| U06 | `runtime` | `packages/runtime` | 基础设施 | 服务端 Node 进程内 | `@mozhou/runtime` | 模型供应商适配、分级路由、JSON Schema 校验、PublishBus 事件总线 |
| U07 | `flywheel` | `packages/flywheel` | 学习包 | 服务端 Node 进程内 | `@mozhou/flywheel` | 作者偏好增量学习、四场景文风画像演化、模型路由建议评测 |
| U08 | `benchmark` | `packages/benchmark` | 评测包 | 服务端 Node 进程内 (只读计算) | `@mozhou/benchmark` | 六指标 L1 纯机械判定器、连续性断言编译器（被 flywheel 生产依赖） |
| U09 | `web-client` | `apps/web/src` | 前端应用 | 浏览器 / WebView2 渲染进程 | (共享 apps/web) | React 18 SPA、正文编辑器工作台、前端 De-AI 实时遥测 |
| U10 | `bff-server` | `apps/web/server` | 服务端总成 | 独立 Node.js 进程 (监听 HTTP) | (共享 apps/web) | Web API 路由总成 (19 个子路由)、租户沙箱、进程锁、数据根解析 |
| U11 | `tauri-host` | `src-tauri` | 桌面外壳 | 独立 Rust 原生 GUI 进程 | `Cargo.toml` (0.2.0) | Tauri 2.0 桌面外壳，**仅 12 行空壳代码**，不拉起 Node 服务端 |
| U12 | `desktop-launcher` | `scripts/release/windows/MoZhou.cs` & `desktop-server.mjs` | 桌面宿主启动器 | 编译为 `MoZhou.exe` + Node 子进程 | C# (.NET) + 脚本 | **真实 Windows 桌面总编排者**：单实例 Mutex、系统托盘、端口派生、管道停机 |
| U13 | `cli-launcher` | `scripts/launcher.mjs` | CLI 启动器 | Node 进程 (执行 `pnpm start`) | 脚本 | 开发与容器通用启动器：按需触发构建、拉起 dist-server、自动打开浏览器 |
| U14 | `installer-lifecycle` | `scripts/release/windows/installer.iss` | 安装与生命周期 | Inno Setup 安装包 | 配置文件 | 商业发行包生命周期约定：升级/卸载保留用户数据、静默停止旧进程 |

---

## 二、 架构三图与深度技术剖析

### 2.1 图一：源码依赖图 (Source Dependency Graph)

> **对应图文件**：`audit-2026-10-03/figs/01-source-dependency-graph.mmd`  
> **取证依据**：`logs/035-package-json-declarations.txt`、`logs/039-unit-dependency-matrix.txt`、`logs/040-actual-imports.json`、`logs/040-web-src-server-cross-edges.txt`。

```mermaid
graph TD
  %% 源码依赖关键拓扑概览
  kernel["@mozhou/kernel [HEAD:90b45a1]"]
  quality["@mozhou/quality-engine [HEAD:90b45a1]"]
  dataPlane["@mozhou/data-plane [HEAD:90b45a1]"]
  contextCompiler["@mozhou/context-compiler [WORKTREE(未提交)]"]
  runtime["@mozhou/runtime [HEAD:90b45a1]"]
  pipeline["@mozhou/pipeline [WORKTREE(未提交)]"]
  flywheel["@mozhou/flywheel [HEAD:90b45a1]"]
  benchmark["@mozhou/benchmark [HEAD:90b45a1]"]
  bffServer["apps/web/server (BFF) [WORKTREE(未提交)]"]
  webClient["apps/web/src (UI) [WORKTREE(未提交)]"]

  dataPlane --> kernel
  contextCompiler --> kernel
  contextCompiler --> dataPlane
  runtime --> kernel
  runtime --> dataPlane
  pipeline --> kernel
  pipeline --> dataPlane
  pipeline --> contextCompiler
  pipeline --> quality
  pipeline --> runtime
  flywheel --> kernel
  flywheel --> dataPlane
  flywheel --> pipeline
  flywheel --> runtime
  flywheel --> benchmark

  bffServer --> kernel
  bffServer --> dataPlane
  bffServer --> contextCompiler
  bffServer --> quality
  bffServer --> pipeline
  bffServer --> runtime
  bffServer --> flywheel

  webClient -. "subpath export" .-> quality
  webClient ==> "DEEP IMPORT: billingCatalog" ==> bffServer
  webClient -. "type-only" .-> bffServer
```

#### 2.1.1 依赖三面对账表 (声明 vs 实际使用 vs 测试)

通过对比 `package.json` 中的声明依赖、生产代码 AST 实际 import、测试文件专属 import，梳理出如下偏差矩阵：

| 单元 | 声明依赖 (`dependencies`) | 生产源码实际 import (PROD) | 测试专属 import (TEST) | 偏差性质与审计发现 |
|---|---|---|---|---|
| **`kernel`** | (空) | (空) | 自身循环测试 | **完全一致**。纯叶子包，零外部依赖。[`HEAD:90b45a1`] |
| **`quality-engine`** | (空) | `node:crypto`, `node:fs`, `node:path` | `node:os`, `vitest` | **一致**。仅用 Node 原生内置模块；含前端安全子路径 `/de-ai`。[`HEAD:90b45a1`] |
| **`data-plane`** | `@mozhou/kernel`, `better-sqlite3` | `@mozhou/kernel`, `better-sqlite3` | `vitest` | **完全一致**。被 62 处生产调用引用，是核心基础层。[`HEAD:90b45a1`] |
| **`context-compiler`** | `@mozhou/data-plane`, `@mozhou/kernel`, `fastembed` | `@mozhou/data-plane`, `@mozhou/kernel`, `fastembed` | `vitest` | **一致**。`fastembed` 需根目录 `patches/fastembed@2.1.0.patch` 配合生效。[`WORKTREE(未提交)`] |
| **`pipeline`** | `context-compiler`, `data-plane`, `kernel`, `quality-engine`, `runtime` | 声明的 5 个包全量运行时调用 | `vitest` | **完全一致**。高聚合十步状态机，真实衔接各底层。[`WORKTREE(未提交)`] |
| **`runtime`** | `ajv`, `@mozhou/data-plane`, `@mozhou/kernel`, `yaml` | 声明的 4 项全量调用 (`eventBus` 读 `data-plane`) | `vitest` | **完全一致**。唯一使用 `ajv` 与 `yaml` 的包。[`HEAD:90b45a1`] |
| **`flywheel`** | `benchmark`, `data-plane`, `kernel`, `pipeline`, `runtime` | 声明的 5 个包全量调用 (含 `benchmark` 门限) | `vitest` | **完全一致**。实锤 `benchmark` 属于生产链路依赖。[`HEAD:90b45a1`] |
| **`benchmark`** | `context-compiler`, `kernel`, `pipeline`, `quality-engine`, `runtime` (5项) | **生产仅 3 项且全部为仅类型依赖 (`import type`)**：`kernel`, `pipeline`, `context-compiler`；**`quality-engine` 与 `runtime` 生产 0 引用！** | `quality-engine`, `runtime`, `vitest` | ⚠️ **重大声明漂移**：`package.json` 声明了 5 个包，实际生产代码运行期**零 JS 运行时依赖**（全被 tsc 擦除为 0 依赖 JS）；`quality-engine` 与 `runtime` 仅在测试文件中被导入。[`HEAD:90b45a1`] |
| **`web-client`** (`apps/web/src`) | (与 web 共享 7 个包声明) | **仅 1 项子路径运行时引用**：`@mozhou/quality-engine/de-ai`；`data-plane` 与 `quality-engine` (根) 仅为 `import type`；其余 5 包生产零引用。 | `context-compiler`, `kernel`, `pipeline`, `runtime` (测试夹具) | ⚠️ **架构跨层穿透**：客户端直接 import 了服务端私有文件 `apps/web/server/billing/catalog.ts` 的 `billingCatalog` 运行时常量对象！[`HEAD:90b45a1`] |
| **`bff-server`** (`apps/web/server`) | (与 web 共享 7 个包声明) | 消费 7 个核心包：`context-compiler`, `data-plane`, `flywheel`, `kernel`, `pipeline`, `quality-engine`, `runtime`。 | 对应包的测试套件 | **一致**。全功能后端编排枢纽。[`WORKTREE(未提交)`] |

#### 2.1.2 关键依赖细节发现

1. **`@mozhou/quality-engine/de-ai` 子路径安全导出**（`packages/quality-engine/package.json:94-97`）：
   - 该包根导出（`index.ts`）因重导出了 `policy.ts`（`node:crypto`）与 `staleness.ts`（`node:fs`），无法被打包进纯浏览器运行环境。
   - 官方开辟了独立子路径入口 `./de-ai` 指向 `dist/de-ai.js`，该入口受自动化测试 `de-ai.browser-safe.test.ts` 严格守卫，严禁包含任何 `node:*` 依赖。
   - `apps/web/src/workbench/editor/EditorQualityTelemetry.tsx:2` 正是通过该子路径引入 `runDeAiDiagnostics`，在浏览器前端实现 0 开销的逐键实时机检。
2. **`apps/web/src` 对 `apps/web/server` 的硬性运行时穿透**（`logs/040-web-src-server-cross-edges.txt:27`）：
   - `apps/web/src/public/PublicSite.tsx:12`：`import { billingCatalog } from '../../server/billing/catalog'`。
   - 前端公网门户直接在渲染层打包并引用了服务端定价目录单例，绕过了 `/api/billing/catalog` HTTP 端点。虽然 `catalog.ts` 本身未引 Node 原生库而侥幸构建成功，但这构成了典型的**实现细节泄漏与单体代码穿透**。

---

### 2.2 图二：运行图 (Runtime Process & Execution Graph)

> **对应图文件**：`audit-2026-10-03/figs/02-runtime-process-graph.mmd`  
> **取证依据**：`scripts/release/windows/MoZhou.cs`、`scripts/release/windows/desktop-server.mjs`、`scripts/launcher.mjs`、`apps/web/server/productionServer.ts`、`src-tauri/src/main.rs`。

#### 2.2.1 启动模式与进程模型剖析

MoZhou 在不同交付形态下具有两套截然不同的进程拉起机制：

```
【形态 A：Windows 商业安装包运行路径】
Inno Setup (安装) 
   │ 
   ▼
MoZhou.exe (C# WinForms 宿主) ──[Win32 Mutex 单实例]──> Local\MoZhou-{hash}
   │                                                 Local\MoZhou-{hash}-stop
   ├─► 系统托盘 NotifyIcon (双击打开浏览器 / 菜单退出)
   ├─► 派生确定性端口 (43000-43999, SHA256 算法)
   │
   ▼ spawn (私有重定向 stdin 管道)
runtime\node.exe desktop-server.mjs ──[检验 installation.key]──► MOZHOU_SECRET_KEY
   │
   ▼ 动态 import
apps/web/dist-server/productionServer.js ──[获取文件排他锁]──► .mozhou_instance.lock
   ├─► 挂接双向对账 Watcher 线程池 (FS Events)
   ├─► 加载 better-sqlite3 (同步 C++ 进程内引擎)
   ├─► 惰性加载 fastembed ONNX 线程池 (CPU 向量检索)
   ├─► HTTP 监听 127.0.0.1:PORT
   │
   ▼ 浏览器进程 (Chrome / Edge 等打开 http://127.0.0.1:43xxx)

【形态 B：源码开发运行路径 (pnpm start)】
scripts/launcher.mjs ──► 检查缺失则 build ──► spawn node productionServer.js (默认 5173) ──► 打开浏览器
```

#### 2.2.2 线程、Worker 与原生绑定核实

经全代码库 AST 与文本检索（`grep "Worker|fork|child_process"`），核实以下关键并发事实：
1. **是否存在独立 Worker 进程（如 Embedding Worker / Indexing Worker）？**
   - **否，不存在独立 Worker 进程。**
   - `apps/web/server/localEmbedding.ts:24-54` 证实：BGE-small 向量模型（24MB ONNX int8）是通过 `fastembed` 在 **Node.js 服务端主进程内**通过 ONNX Runtime 原生 C++ 动态库以单例模式惰性加载。装载与推理由 ONNX Runtime 内部线程池执行，未创建独立 Node 子进程或 Worker 线程。
2. **是否存在后台计费 Worker 进程？**
   - **否。** `apps/web/server/billing/pollingWorker.ts` 虽然命名为 `pollingWorker`，但本质是一个纯异步函数 `pollAndReconcilePendingOrders`，由定时器或路由按需驱动，非 OS 级或 WorkerThread 线程。
3. **文件监听并发模型**：
   - `apps/web/server/routes/reconciliationRoutes.ts` 与 `packages/data-plane/src/reconciliation.ts`：通过 Node.js 原生 `fs.watch` 监听各书稿目录。由 libuv 线程池捕获外部 Obsidian 修改事件，并在防抖队列内触发对账逻辑。

#### 2.2.3 进程通信、独占锁与优雅停机通道

1. **单实例排他与并发防护（双重锁闭环）**：
   - **第一道（宿主级）**：`MoZhou.cs:38-56` 通过 `Local\MoZhou-{SHA256(data)}` Win32 命名 Mutex 实现单数据根多实例拦截。后启动者检测到 Mutex 存在，直接激活既有实例并唤起浏览器，返回 exit 0。
   - **第二道（服务级）**：`apps/web/server/bookAccess.ts:41-80` 在 `productionServer.ts:40` 启动初期，对数据根目录写入 `.mozhou_instance.lock`。内含当前 Node 进程 PID，并在争夺时通过 `process.kill(pid, 0)` 检测原进程存活性，防止死锁残留。
2. **优雅停机与管道协议**：
   - Windows 平台下无法向 Node 子进程可靠发送 POSIX `SIGTERM` 信号。`MoZhou.cs:175-185` 创新性地利用**私有 stdin 管道**，在退出时向子进程写入 `shutdown\n`。
   - `desktop-server.mjs:27-33` 监听 `process.stdin`，一旦收到 `shutdown` 即在 Node 内部发出 `process.emit('SIGTERM')`。
   - `productionServer.ts:224-243` 捕获 `SIGTERM` 后，进入 10 秒倒计时排空逻辑（`server.close()` + `server.closeIdleConnections()`），并在退出钩子 `process.on('exit')` 中同步调用 `releaseResources()`，安全清理 `.mozhou_instance.lock` 并关闭全部 SQLite 连接与文件监听句柄。

---

### 2.3 图三：数据所有权图 (Data Ownership & Persistence Graph)

> **对应图文件**：`audit-2026-10-03/figs/03-data-ownership-graph.mmd`  
> **取证依据**：`packages/data-plane/src/*`、`packages/context-compiler/src/receipt-file.ts`、`packages/pipeline/src/ledger.ts`、`packages/flywheel/src/storage.ts`、`apps/web/server/billing/store.ts`。

#### 2.3.1 7 大持久化状态矩阵分析

| # | 持久化状态类别 | 物理文件落盘路径 | 权威所有者 (Single Source of Truth) | 读取者 (Readers) | 写入者 (Writers) | 派生副本与缓存 | 崩溃恢复 / 重建路径 |
|---|---|---|---|---|---|---|---|
| **S1** | **正典书稿与大纲** | `<book>/chapters/ch-*.md`<br/>`<book>/book.json`<br/>`<book>/canon/` | **文件系统 Markdown 正典** (作者+管线双权威) | `data-plane`<br/>`context-compiler`<br/>`pipeline` | `data-plane` (`atomicWriteFileSync`)<br/>`pipeline` (`acceptDraft`)<br/>外部 Obsidian 编辑器 | `runtime.sqlite`<br/>(全量数据库表) | `rebuildProjectionFromCanon()`：100% 从 Markdown 扫描反向重建 SQLite。[`HEAD:90b45a1`] |
| **S2** | **SQLite 投影数据库** | `<book>/.mozhou/runtime.sqlite` | **`@mozhou/data-plane` 投影引擎** | `bff-server`<br/>`data-plane` | `LocalDataPlane`<br/>(`populateProjection`) | 内存查询缓存 | **纯派生只读缓存**。随时可全库删除，无数据丢失风险。[`HEAD:90b45a1`] |
| **S3** | **事件账本 (Journal)** | `<book>/.mozhou/runtime-events.jsonl` | **`@mozhou/runtime` PublishBus** | `pipeline` (`ledger.ts`)<br/>`flywheel` (`project.ts`) | `PublishBus.publishEvent` (顺序只追加写) | 内存事件总线缓存 | 顺序追加 JSONL，遇撕裂行静默跳过，天然具备崩溃恢复容错性。[`HEAD:90b45a1`] |
| **S4** | **上下文编译凭据** | `<book>/.mozhou/receipts/<id>.json` | **`@mozhou/context-compiler`** | `pipeline`<br/>`bff-server` | `persistReceipt` (一证一文件，写后不可变) | `ContextReceipt` 内存对象 | `replayReceiptFromInputs()`：通过不可变输入与 recomputationHash 精确复算。[`HEAD:90b45a1`] |
| **S5** | **文风画像与偏好观察** | `<book>/.mozhou/preference/`<br/>`<book>/style-profiles.yaml` | **`@mozhou/flywheel` StyleProfileStore** | `context-compiler`<br/>`pipeline` | `writeStyleProfiles`<br/>`runPreferenceLearning` | `style_profiles` 表 | `rebuildPreference()`：重放事件账本自起始位置重建七维偏好。[`HEAD:90b45a1`] |
| **S6** | **哈希清单 (Manifest)** | `<book>/manifest.json` | **`@mozhou/data-plane` manifest.ts** | `reconciliation`<br/>`data-plane` | `refreshManifestEntries` (逐文件记录 SHA256) | 内存文件树索引 | `buildManifest(root)`：遍历文件系统重新计算各文件哈希。[`HEAD:90b45a1`] |
| **S7** | **商业计费与主凭据** | `<dataRoot>/billing.sqlite`<br/>`<dataRoot>/installation.key` | **`apps/web/server` BillingStore & desktop-server** | `bff-server` 认证与计费路由 | `BillingStore`<br/>`desktop-server.mjs` | 内存订单与配额缓存 | 订单通过外部支付渠道主动查单（`pollingWorker`）补偿对账；主密钥严禁删除。[`HEAD:90b45a1`] |

---

## 三、 逐模块/子系统边界证据卡

---

### 卡 01：@mozhou/kernel (纯领域核心与类型契约)
- **存在目的**：定义全系统的统一领域实体、九柱数据结构、保护位状态机与因果断言契约。若删除此包，全系统失去统一的领域类型与不可变语义支撑。
- **实际职责**：
  1. 领域模型与九柱契约声明（`EntityCard`, `TemporalFact`, `TimelineEvent`, `CausalContract`, `ChapterCommit` 等）；
  2. 核心状态约束纯函数断言（保护位防篡改、变更挂起 Stale 状态机）；
  3. ULID 确定性与单调性标识符生成（`newUlid`, `newFactId`, `newTimelineEventId`）；
  4. **明确不负责**：任何文件 I/O、数据库操作、网络请求、外部进程通信或复杂业务流程。
- **物理路径与真实导出**：
  - 路径：`packages/kernel/src/index.ts` -> `dist/index.js`；
  - 真实导出：`kernel-schema.js` (含工作区新增的 `ChannelContribution`), `domain-events.js`, `narrative-state.js`, `protection.js`, `ulid.js`, `entity-directory.js`, `causal-contract.js`。
  - 运行位置：纯内存共享库，编译内联于各消费包。
- **直接调用方与依赖**：
  - 生产调用方：`data-plane`, `context-compiler`, `pipeline`, `runtime`, `flywheel`, `bff-server`；
  - 测试调用方：`benchmark`, `web-client`；
  - 实际依赖：零依赖（无 `node:*`，无外部 npm 包）。
- **拥有的状态、锁与资源**：零持久化状态，零锁，纯函数无副作用。
- **可执行副作用及授权边界**：无副作用，无授权边界。
- **初始化与释放方式**：无初始化流程，随垃圾回收自然释放。
- **对外契约与泄漏的实现细节**：纯类型与纯函数契约，未发现泄漏内部状态。
- **隐式耦合**：各领域实体的 ID 格式约束（如 `char:lin-feng` 命名约定）贯穿全系统。
- **独立验证与证据**：
  - `gitnexus check --cycles -r "C:\zcode\novel-ai"` -> 0 cycles；
  - 源码文件：`packages/kernel/src/kernel-schema.ts:1-120`。
- **已证实问题与风险**：
  - 工作区修改了 `kernel-schema.ts`（新增 `ChannelContribution`），导致当前工作区与 `HEAD:90b45a1` 产生接口语义偏移。[`WORKTREE(未提交)`]

---

### 卡 02：@mozhou/quality-engine (机检规则与 De-AI 引擎)
- **存在目的**：提供确定性的机械质量规则核验（4-gram 复读、敏感红线、标点间距）与 De-AI 腔调实时诊断，保障小说生成质量。若删除它，系统失去自动化审校与防 AI 味能力。
- **实际职责**：
  1. 机械质量核验（`evaluateMechanicalGates`, `detect4GramRepetition`）；
  2. 确定性静态规则评审（`evaluateDeterministicRules`）；
  3. 读者体验增量与记忆锚点回读（`reader-experience.ts`, `memory-anchor.ts`）；
  4. De-AI 诊断算法（`runDeAiDiagnostics`, Tier1/Tier2 模式串检索）；
  5. **明确不负责**：LLM 语义审校（语义部分由 pipeline/runtime 驱动）、章节提交持久化。
- **物理路径与真实导出**：
  - 路径：`packages/quality-engine/src/index.ts` -> `dist/index.js`，另具子路径 `src/de-ai.ts` -> `dist/de-ai.js`；
  - 真实导出：包根导出核验全集；`./de-ai` 仅导出纯算法 `runDeAiDiagnostics`, `TIER_1_PATTERNS`, `TIER_2_CLUSTER_TERMS`；
  - 运行位置：包根运行于 Node.js 服务端；`./de-ai` 同时运行于浏览器渲染主线程。
- **直接调用方与依赖**：
  - 生产调用方：`pipeline` (`review-step.ts`), `bff-server` (`styleAnalysis.ts`), `web-client` (`EditorQualityTelemetry.tsx` 调 `./de-ai`)；
  - 实际依赖：零 npm 依赖；包根生产仅使用 `node:crypto`, `node:fs`, `node:path`。
- **拥有的状态、锁与资源**：无持久化数据库或锁，内存纯算术与正则匹配。
- **可执行副作用及授权边界**：无外部副作用。
- **对外契约与泄漏的实现细节**：子路径 `./de-ai` 经 `de-ai.browser-safe.test.ts` 严格守卫，成功杜绝 Node 原生模块渗入浏览器包。
- **已证实问题与风险**：
  - `packages/benchmark/package.json` 声明了此包为生产依赖，但实际生产源码中完全零引用（仅在测试文件引用）。[`HEAD:90b45a1`]

---

### 卡 03：@mozhou/data-plane (本地优先数据平面与 SQLite 投影)
- **存在目的**：作为本地优先核心，管理 Markdown 正典文件读写、YAML Frontmatter 确定性序列化、SQLite 投影生成及双向外部文件对账。若删除它，MoZhou 失去与 Obsidian 协同及本地持久化能力。
- **实际职责**：
  1. 原子文件落盘（`atomicWriteFileSync`，通过 `.tmp` 写入 + `fsync` + `rename`）；
  2. YAML frontmatter 确定性子集解析与逐字节发射（零第三方库）；
  3. 作品正典目录规范（`layout.ts`）与 Manifest 文件哈希追踪；
  4. SQLite 投影生成（`populateProjection`）与版本迁移断言；
  5. 章节草稿与正典合并持久化（`saveProseDraft`, `readProseChapter`）；
  6. 外部修改监听与对账协调（`reconciliation.ts`）；
  7. ZIP 纯手工打包解包（`zip-util.ts`）与作品全量备份恢复；
  8. **明确不负责**：长篇流程状态推进逻辑、Prompt 组装、网络路由。
- **物理路径与真实导出**：
  - 路径：`packages/data-plane/src/index.ts` -> `dist/index.js`；
  - 真实导出：26 个功能子模块的完整聚合导出（`atomic-write`, `database`, `layout`, `projection`, `local-data-plane` 等）。
  - 运行位置：服务端 Node.js 进程内。
- **直接调用方与依赖**：
  - 生产调用方：`context-compiler`, `pipeline`, `runtime`, `flywheel`, `bff-server`；
  - 声明依赖：`@mozhou/kernel`, `better-sqlite3@^12.2.0`；
  - 实际使用依赖：同声明，外加 Node 内置模块。
- **拥有的状态、锁与资源**：
  - 状态：持有各作品下的 `runtime.sqlite` 数据库连接句柄；
  - 资源：管理文件系统 `manifest.json`、`chapters/*.md`、备份 ZIP 文件。
- **可执行副作用及授权边界**：直接落盘写文件、删除临时文件、写入 SQLite。严格受 `withStrictBook` 与 `assertSafeBookRoot` 沙箱检查约束。
- **对外契约与泄漏的实现细节**：
  - 泄漏细节：直接将 `RUNTIME_EVENTS_PATH` 物理路径常量暴露给 `runtime` 与 `pipeline` 使用，形成路径约定依赖。
- **已证实问题与风险**：
  - SQLite 在 Windows 跨进程争夺时依赖文件锁，多进程直连可能导致 `SQLITE_BUSY`（已由 t1/t5 测试探针证实）。[`HEAD:90b45a1`]

---

### 卡 04：@mozhou/context-compiler (上下文编译器与三通道召回)
- **存在目的**：解决长篇小说海量设定召回与大模型上下文窗口超限问题。实现关键词、k-hop 知识图谱、本地向量检索的三通道召回与 Reserved 两阶段确定性预算装配，生成不可变 Receipt 凭证。
- **实际职责**：
  1. 随仓 BGE-small 向量模型与 WordPiece 词表装载（`fastembed` + 本地 ONNX）；
  2. 关键词正则匹配通道与 k-hop 图谱子图遍历通道；
  3. RRF (Reciprocal Rank Fusion) 多通道加权混排算法；
  4. 两阶段预扣 Token 预算装配（`assembleBudgetedContext`）；
  5. Receipt 一证一文件不可变持久化（`persistReceipt`）与确定性重放验证（`receipt-replay.ts`）；
  6. **明确不负责**：向大模型发请求、章节正文修改。
- **物理路径与真实导出**：
  - 路径：`packages/context-compiler/src/index.ts` -> `dist/index.js`；
  - 真实导出：`assembleBudgetedContext`, `compile`, `createLocalTokenizer`, `createLocalEmbeddingProvider`, `persistReceipt`, `replayReceiptFromInputs` 等。
- **直接调用方与依赖**：
  - 生产调用方：`pipeline` (`compile-step.ts`), `bff-server` (`draftContext.ts`, `localEmbedding.ts`)；
  - 声明依赖：`@mozhou/data-plane`, `@mozhou/kernel`, `fastembed@^2.1.0`；
  - 实际依赖：同声明，受 `patches/fastembed@2.1.0.patch` 修正。
- **拥有的状态、锁与资源**：
  - 状态：在 Node 进程内持有 BGE-small 模型权重内存缓存及 WordPiece 词表缓存；
  - 资源：管理 `<book>/.mozhou/receipts/` 目录下的不可变 JSON 凭证文件。
- **可执行副作用及授权边界**：写入不可变 Receipt 文件（若文件已存在则抛 `ReceiptAlreadyExistsError` 确保幂等安全）。
- **已证实问题与风险**：
  - 工作区修改了 `assemble.ts`（新增 `summarizeByChannel`），且该改动已被编译进 `dist/assemble.js`。真实运行时执行的是包含该改动的工作区代码。[`WORKTREE(未提交)`]

---

### 卡 05：@mozhou/pipeline (十步长篇创作状态机与提交编排)
- **存在目的**：将长篇小说写作抽象为严格的「十步事务流水线」，通过单飞状态机、候选隔离区与两阶段提交，防止大模型幻觉污染正典。
- **实际职责**：
  1. 十步管线状态机控制（Prepare -> Compile -> Draft -> Review -> Gate -> Proposal -> Commit 等）；
  2. C2 候选区隔离（未经 Accept 仅写 `.mozhou/candidates/`，严禁碰正典）；
  3. 意图日志与原子提交（`commit-orchestration.ts`, `draft-accept.ts`）；
  4. 提案统一决策出口（`ProposalPort`，支持 low/med/high 分流）；
  5. 连续性守卫门禁（`gate-step.ts`，机械校验时间线与秘密隔离）；
  6. 重提交机制（`resubmit.ts`，相位回退但保留历史提交锚）；
  7. **明确不负责**：大模型具体 HTTP 连接、UI 渲染、底层 SQLite 物理建表。
- **物理路径与真实导出**：
  - 路径：`packages/pipeline/src/index.ts` -> `dist/index.js`；
  - 真实导出：`ChapterProductionSession`, `runChapterCommit`, `createDraftCandidate`, `acceptDraft`, `runCompileStep`, `runContinuityGate`, `ProposalPort` 等。
- **直接调用方与依赖**：
  - 生产调用方：`flywheel` (`learner.ts`), `bff-server` (`pipelineRoutes.ts`, `proseRoutes.ts`)；
  - 声明依赖：`context-compiler`, `data-plane`, `kernel`, `quality-engine`, `runtime`；
  - 实际依赖：同声明。
- **拥有的状态、锁与资源**：
  - 内存持有 `ChapterProductionSession` 活跃会话；
  - 磁盘管理 `<book>/.mozhou/candidates/`、`<book>/.mozhou/proposals/`。
- **可执行副作用及授权边界**：驱动候选采纳落盘、提案归档、触发事件账本追加。
- **已证实问题与风险**：
  - `pipelineRoutes.ts` 与 `guardrails-hardening.test.ts` 存在已暂存及未跟踪改动（守卫增强）。[`WORKTREE(未提交)`]

---

### 卡 06：@mozhou/runtime (模型路由、配方装载与事件总线)
- **存在目的**：解耦具体大模型供应商（OpenAI/Claude/DeepSeek 等），提供分级配方装载、JSON Schema 校验与统一领域事件账本总线。
- **实际职责**：
  1. 供应商适配与流式事件解析（`openai-compat.ts`, `anthropic-events.ts`）；
  2. 任务配方 YAML 解析与 Ajv 严格校验（`schema.ts`, `canonical-recipes.ts`）；
  3. 分级智能路由选择（`tierRouting.ts`，支持 fast/deep/cheap 等分级）；
  4. 唯一领域事件账本发布者（`PublishBus.publishEvent`，强制成对事件闭合）；
  5. **明确不负责**：长篇流程状态流转、具体小说情节决策。
- **物理路径与真实导出**：
  - 路径：`packages/runtime/src/index.ts` -> `dist/index.js`；
  - 真实导出：`RuntimeEngine`, `PublishBus`, `selectTierRoute`, `createDraftRecipe` 等。
- **直接调用方与依赖**：
  - 生产调用方：`pipeline`, `flywheel`, `bff-server`；
  - 声明依赖：`ajv@^8.17.1`, `@mozhou/data-plane`, `@mozhou/kernel`, `yaml@^2.6.1`；
  - 实际依赖：同声明。
- **拥有的状态、锁与资源**：PublishBus 单例序列号维护；管理 `<book>/.mozhou/runtime-events.jsonl` 文件追加。
- **可执行副作用及授权边界**：唯一直接向事件账本执行追加写操作的模块。
- **已证实问题与风险**：
  - 同样被 `benchmark` 的 `package.json` 声明为依赖，但 `benchmark` 生产代码对其零调用。[`HEAD:90b45a1`]

---

### 卡 07：@mozhou/flywheel (文风画像学习器与评测闭环)
- **存在目的**：通过作者实际编辑行为（修改、采纳、删除、回炉）闭环反哺系统，自动演化四场景文风画像与模型路由推荐，实现越写越顺手的飞轮效应。
- **实际职责**：
  1. 从事件账本与正文差异提取七维特征（对话比、句长、TTR 等）；
  2. 贝叶斯增量推断作者偏好（`posteriorMean`, `driftSigma`）；
  3. 四场景型 StyleProfile 演化与禁忌词统计（`style-learner.ts`）；
  4. 模型建议生成与 Wilson 置信区间评估（`evaluator/`）；
  5. 语义分析报告异步回灌与一报一文件存储；
  6. **明确不负责**：直接修改作者正典正文、自动切换生产路由（需人工确认）。
- **物理路径与真实导出**：
  - 路径：`packages/flywheel/src/index.ts` -> `dist/index.js`；
  - 真实导出：`runPreferenceLearning`, `rebuildPreference`, `writeStyleProfiles`, `runStyleLearnerForWindow`, `runTaskModelEvaluation` 等。
- **直接调用方与依赖**：
  - 生产调用方：`bff-server` (`proseRoutes.ts`, `systemRoutes.ts`, `semanticSettled.ts`)；
  - 声明依赖：`benchmark`, `data-plane`, `kernel`, `pipeline`, `runtime`；
  - 实际依赖：全量消费，特别是调用 `benchmark` 的 `METRIC_IDS` 与 `evaluateMetricGate`。
- **拥有的状态、锁与资源**：管理 `<book>/.mozhou/preference/`、`<book>/style-profiles.yaml`。
- **可执行副作用及授权边界**：落盘文风配置文件与评测建议日志。

---

### 卡 08：@mozhou/benchmark (六指标断言与夹具套件)
- **存在目的**：为系统提供 0 Token、零时钟、纯机械的 L1 连续性与质量六指标判定器，并作为长篇测试夹具基准。
- **实际职责**：
  1. 六指标确定性数学判定（`judgeCanonAccuracy`, `judgeKnowledgeLeakRate`, `judgeContextBudgetOverflow` 等）；
  2. L1 确定性连续性断言引擎与测试用例导出（`continuity-assertions.ts`）；
  3. Recipe 与 Benchmark 版本矩阵对齐（`version-matrix.ts`）；
  4. 随仓长篇小说夹具库（`long-novel-50.json` 等）；
  5. **明确不负责**：运行时业务分发、在线用户请求处理。
- **物理路径与真实导出**：
  - 路径：`packages/benchmark/src/index.ts` -> `dist/index.js`；
  - 真实导出：`METRIC_IDS`, `evaluateMetricGate`, `runBenchmark`, `readRecipeVersionFromPayload`, `evaluateContinuityPacket` 等。
- **直接调用方与依赖**：
  - 生产调用方：`flywheel` (消费其指标常量与判定函数)；
  - 声明依赖：`context-compiler`, `kernel`, `pipeline`, `quality-engine`, `runtime`；
  - **实际依赖事实**：生产源码中，`context-compiler`, `kernel`, `pipeline` **全部为 `import type`（编译后 0 运行时依赖）**；`quality-engine` 与 `runtime` 在生产源码中**完全零引用**！
- **拥有的状态、锁与资源**：纯计算库，零状态，零锁。
- **已证实问题与风险**：
  - **虚假声明依赖**：`package.json` 中的 5 项生产依赖在构建产物中全部不产生真实 JS 导入，存在过度声明与认知误导。[`HEAD:90b45a1`]

---

### 卡 09：apps/web/src (Web 前端客户端总成)
- **存在目的**：为小说创作者提供基于浏览器的沉浸式交互工作台（编辑器、故事脑、大纲图谱、漫剧分镜、De-AI 遥测）。
- **实际职责**：
  1. React 18 SPA 视图渲染与状态管理；
  2. 正文编辑器与选区交互（`ProseEditorPanel.tsx`, `NovelEditorCanvas.tsx`）；
  3. 前端实时质量与 De-AI 腔调分析（`EditorQualityTelemetry.tsx`）；
  4. 对话流与实时草稿流式接收（`DialogueStream.tsx`，消费 SSE）；
  5. **明确不负责**：直接操作服务端数据库或底层文件（必须经由 BFF HTTP 接口）。
- **物理路径与真实导出**：
  - 路径：`apps/web/src/` -> `apps/web/dist/` (经 Vite 构建为静态资产)；
  - 入口：`index.html` + `src/main.tsx`。
- **直接调用方与依赖**：
  - 调用方：终端用户（通过浏览器访问）；
  - 生产实际依赖：`react`, `react-dom`，子路径引用 `@mozhou/quality-engine/de-ai`；
  - **跨层代码穿透**：直接静态 import 了 `apps/web/server/billing/catalog.ts` 的 `billingCatalog` 单例！
- **拥有的状态、锁与资源**：浏览器 LocalStorage（`shell/workbenchStorage.ts` 记录当前打开的书与视图）。
- **已证实问题与风险**：
  - 工作区中 `App.tsx`（+211 / -118）、`WorkbenchView.tsx`、`ProseEditorPanel.tsx` 发生大量未提交改动。[`WORKTREE(未提交)`]

---

### 卡 10：apps/web/server (Node.js BFF 服务端与核心能力路由)
- **存在目的**：作为前端与底层多包之间的业务中枢，承担多租户隔离、安全边界守卫、进程单实例锁、长篇提交编排及所有 REST/SSE 接口分发。
- **实际职责**：
  1. 19 个业务子路由的解码、权限校验与响应封装；
  2. 数据根目录解析与进程排他启动锁（`.mozhou_instance.lock`）；
  3. 每书异步并发操作队列（`BookOperationQueue.withBookLock`）；
  4. 启动对账与运行时 FS Watcher 自动化挂接；
  5. 本地密钥安全校验与 BYOK 本地 AES 加密（`assertMasterKeyConfigured`）；
  6. 静态资源 fail-closed 安全托管与优雅停机（Drain and Release）；
  7. **明确不负责**：原生窗口创建、安装包构建。
- **物理路径与真实导出**：
  - 路径：`apps/web/server/` -> `apps/web/dist-server/`；
  - 入口：`productionServer.ts` -> `dist-server/productionServer.js`。
- **直接调用方与依赖**：
  - 调用方：前端 HTTP 请求、`MoZhou.cs` (桌面宿主)、`launcher.mjs`；
  - 实际依赖：全量依赖底层 7 个 packages（除 `benchmark`）。
- **拥有的状态、锁与资源**：
  - 独占持有数据根 `.mozhou_instance.lock`；
  - 管理 `<dataRoot>/billing.sqlite` 数据库连接与内存并发锁 Map。
- **可执行副作用及授权边界**：全系统最高权限执行单元，直接调用 OS 原生能力与文件写操作。
- **已证实问题与风险**：
  - `pipelineRoutes.ts` 与 `proseRoutes.ts` 存在已暂存及未提交修改。[`WORKTREE(未提交)`]

---

### 卡 11：src-tauri (Tauri 桌面外壳宿主)
- **存在目的**：提供基于 Rust + Webview2 的跨平台轻量级桌面窗口外壳。
- **实际职责**：
  1. 提供原生窗口容器展示 `apps/web/dist`；
  2. **明确不负责**：Node.js 后端服务生命周期管理、本地数据库初始化、桌面托盘功能。
- **物理路径与真实导出**：
  - 路径：`src-tauri/src/main.rs`；
  - 代码量：**全文仅 12 行纯 Rust 代码**，仅包含 `println!` 初始化日志。
- **直接调用方与依赖**：
  - 由 `tauri dev` 或 `tauri build` 编译调用；
  - 依赖：Tauri 2.0 原生库。
- **已证实问题与风险**：
  - **严重版本分叉**：`tauri.conf.json` 与 `Cargo.toml` 中声明版本为 `0.2.0`，而项目根目录 `package.json` 为 `0.3.0`！
  - **空壳真相**：未注册任何 Tauri command，未配置 sidecar，未绑定任何原生系统托盘逻辑。在当前商业发行版中，其角色已被 `MoZhou.cs` 完全取代！[`HEAD:90b45a1`]

---

### 卡 12：MoZhou.cs & desktop-server.mjs (Windows 商业桌面宿主启动器)
- **存在目的**：专为 Windows 生产环境设计的桌面宿主编排器，接管真正的单实例互斥、端口派生、系统托盘管理及 Node 服务拉起与关闭。
- **实际职责**：
  1. Win32 命名 Mutex `Local\MoZhou-{SHA256}` 排他防护与重复启动前台唤起；
  2. Win32 EventWaitHandle 停机信号管理；
  3. 基于数据根哈希派生 43000-43999 确定性端口；
  4. 生产系统托盘（`NotifyIcon`）及右键菜单事件响应；
  5. 校验并生成 48 字节 `installation.key` 主凭据（`desktop-server.mjs`）；
  6. 经私有 stdin 管道下发 `shutdown\n` 驱动服务端优雅停机；
  7. **明确不负责**：具体 Web 业务路由与数据处理。
- **物理路径与真实导出**：
  - 编译前：`scripts/release/windows/MoZhou.cs` + `desktop-server.mjs`；
  - 编译后：`%LOCALAPPDATA%\Programs\MoZhou\MoZhou.exe` (13.8 KB)。
- **拥有的状态、锁与资源**：持有操作系统级 Mutex 句柄、托盘图标句柄与子进程管道。
- **已证实问题与风险**：
  - **数据根契约不一致**：`desktop-server.mjs:6` 对 `MOZHOU_DATA_ROOT` 未设即直接抛错（Fail-fast），而 `dataRoot.ts:25` 却默认回退到 `cwd/.mozhou_data`。二者行为契约不一致。[`HEAD:90b45a1`]

---

### 卡 13：scripts/launcher.mjs (开发与统一 CLI 启动器)
- **存在目的**：为开发者及容器化环境提供开箱即用的启动器（`pnpm start`），负责产物自检、自动构建、服务启动与浏览器打开。
- **实际职责**：
  1. 检查 `apps/web/dist` 与 `dist-server`，若缺失自动触发 `pnpm --filter @mozhou/web build`；
  2. 提取环境变量 `PORT` (默认 5173) 与 `HOST` (默认 127.0.0.1)；
  3. spawn 独立子进程启动 `productionServer.js`；
  4. 监听 `MOZHOU_NO_OPEN`，延迟唤起系统默认浏览器。
- **物理路径**：`scripts/launcher.mjs` (87 行 ES Module 脚本)。
- **运行特征**：工作目录为仓库根目录，故其默认数据根落于 `C:\zcode\novel-ai\.mozhou_data`。[`HEAD:90b45a1`]

---

### 卡 14：installer.iss (Inno Setup 安装包与升级生命周期规约)
- **存在目的**：Windows 商业安装包打包规约，定义程序安装路径、最低权限要求与用户数据保护边界。
- **实际职责**：
  1. 打包输出 `MoZhou-0.3.0-windows-x64-setup.exe`；
  2. 约束安装路径为最低权限目录 `{localappdata}\Programs\MoZhou`（无需管理员 UAC 提权）；
  3. 强制在安装、升级、卸载前调用 `MoZhou.exe --stop` 优雅排空旧进程；
  4. **硬性数据保护规约**：卸载与升级严禁触碰 `{localappdata}\MoZhou`，确保用户小说与密钥永不丢失。
- **物理路径**：`scripts/release/windows/installer.iss` (64 行 Inno 脚本)。[`HEAD:90b45a1`]

---

## 四、 明确不成立的模块架构说法 (逐条事实批驳)

根据全代码库取证，对上一轮报告或流传架构理解中的 7 项典型不实断言进行逐条批驳并给出反证：

| # | 错误断言 / 误区 | 事实判决 | 确凿代码证据与逻辑反证 |
|---|---|:---:|---|
| **F1** | **「MoZhou 架构全量只有 9 个模块」** | **彻底推翻 (REVERSED)** | **反证**：忽视了运行时的关键支柱。Node BFF（`apps/web/server`，1.5万行+19个路由）、桌面宿主编排器（`MoZhou.cs` / `desktop-server.mjs`）、桌面外壳（`src-tauri`）均具有不可替代的一致性边界。系统实际是由 **14 个架构单元** 协同运行。 |
| **F2** | **「Tauri 是商业桌面版的宿主核心与后端拉起者」** | **彻底推翻 (REVERSED)** | **反证**：`src-tauri/src/main.rs` 全文仅 12 行，无 tauri command、无 sidecar、不拉起 Node 服务端。真正的 Windows 桌面编排、Win32 Mutex 单实例互斥、确定性端口分配、系统托盘及管道停机控制**全由 `MoZhou.cs` (C#) 实现**。Tauri 在当前版本仅为空壳。 |
| **F3** | **「@mozhou/benchmark 是纯测试模块，不属于生产架构」** | **彻底推翻 (REVERSED)** | **反证**：`packages/flywheel/src/evaluator/storage.ts:14` 与 `thresholds.ts:18` 在生产代码中直接 import 了 `@mozhou/benchmark` 的 `METRIC_IDS` 与 `evaluateMetricGate`。`benchmark` 的六指标判定逻辑已作为生产依赖嵌入飞轮闭环。 |
| **F4** | **「Web 前端完全解耦，纯粹通过 HTTP API 访问后端」** | **彻底推翻 (REVERSED)** | **反证**：存在严重代码穿透。`apps/web/src/public/PublicSite.tsx:12` 直接静态 import 了服务端私有目录文件 `../../server/billing/catalog` 中的 `billingCatalog` 运行时单例对象。前端与服务端存在直接文件级耦合。 |
| **F5** | **「Embedding 向量检索运行在独立 Worker 进程或微服务中」** | **彻底推翻 (REVERSED)** | **反证**：`apps/web/server/localEmbedding.ts:30-54` 证实，BGE-small 模型（24MB）完全在 Node.js 服务端主进程内通过 fastembed / ONNX Runtime CPU 原生动态库以单例模式惰性加载，同进程运行，且装载失败即降级为双通道召回，无独立进程。 |
| **F6** | **「数据目录契约全系统统一为 cwd/.mozhou_data」** | **彻底推翻 (REVERSED)** | **反证**：系统存在双重互斥契约。`dataRoot.ts` 无 env 时默认回退到 `cwd/.mozhou_data`；而商业发行版入口 `desktop-server.mjs:6` 对 `MOZHOU_DATA_ROOT` 未设即直接抛错。二者对缺省环境变量的行为定义存在实质冲突。 |
| **F7** | **「package.json 的 dependencies 真实反映了各包的生产调用」** | **彻底推翻 (REVERSED)** | **反证**：`packages/benchmark/package.json` 声明了 5 个包依赖，但生产源码中 3 个仅为 `import type`（运行时完全擦除），其余 2 个在生产代码中零引用（仅测试使用）。依赖声明存在严重冗余。 |

---

## 五、 图谱未覆盖域与补证结论

依据 `00-audit-charter.md` §7 与 `01-baseline-and-graph-gate.md` §5.7，本次审计所涉以下边界完全**超出 GitNexus 代码图谱索引能力**，已全量采用 E1 级源码 AST 与 E4 级本地命令取证补齐：

1. **Rust 语言边界（`src-tauri`）**：
   - 图谱未索引 `.rs` 文件。本次通过直接阅读 `src-tauri/src/main.rs:1-12` 与 `Cargo.toml`，确认其无自定义命令、无与 Node.js 进程连线的客观事实。
2. **Junction 软链接与动态构建依赖**：
   - 图谱仅静态分析 TS 符号。本次通过文件系统核对，确证 `apps/web/node_modules/@mozhou/*` 实际上是指向 `packages/*` 的 NTFS Junction，并在运行时动态解析为 `packages/*/dist`。
3. **IPC 与进程管道边界**：
   - C# `MoZhou.cs` 与 Node.js `desktop-server.mjs` 之间的 stdin 管道通信（`shutdown\n`）及 Win32 互斥锁（`Local\MoZhou-*`）均属操作系统运行时原语，图谱无法建边。
4. **HTTP 动态路由分发**：
   - `apps/web/server/productionServer.ts` 对 `apiRouter.dispatch` 的动态请求派发（基于 URL 字符串模式匹配），图谱无法捕捉其与客户端 `fetch` 的对应关系。
5. **外部副作用与凭据存储**：
   - 48 字节主密钥 `installation.key` 的读写、AES 加密 BYOK 存储、`billing.sqlite` 数据库操作，均属外部系统副作用，已由代码审计证实。

---

> **报告完成声明**：本报告完成了对 MoZhou / Novel OS 实际运行单元的独立清点，绘制并输出了源码依赖、运行时进程、数据所有权三张架构图，建立了覆盖 14 个架构单元的完整边界证据卡，并逐条批驳了 7 项不实架构说法。全篇结论均严格标注证据标签，证据链完整、可独立复核。
