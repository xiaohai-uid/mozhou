# CHG-20261007-18 发布审计 NO-GO 修复：备份下载契约、定价目录 404、Web 构建、图谱解环与安装器重建

> 本文件是变更 CHG-20261007-18 的证据记录。触发原因：用户 2026-10-07 发布审计结论 **NO-GO**（五项），本次授权修复前四项 + 补 GET/query 测试 + 从当前 HEAD 重建安装器。
>
> **证据分层说明**：§4.1 为收口会话本机亲跑的只读核验（带命令与输出）；§4.2–§4.4 转记自各修复代理、导航验收执行者与审计员的实跑结果（命令与退出码随条目记录，收口会话未复跑）；§4.5 全量门禁由编排器统一执行，结论以编排器记录为准。

## 1. 触发与定性

发布审计（2026-10-07）结论 NO-GO，五项及本次处置：

| # | 问题 | 根因（读源定位） | 本次处置 |
|---|---|---|---|
| 1 | 备份下载 GET 契约断裂 | UI 走 GET query（`apps/web/src/cloud-sync/CloudSyncView.tsx:190`），服务端旧代码 `backupRoutes.ts:54` 只从 body 读 `backupId`；`server/security.ts:170-172` 对空 body GET 返回 `{ body: {} }` → GET 恒 400 `INVALID_BACKUP_ID` | **修复**（§3.1） |
| 2 | 定价目录 GET 404 | `systemRoutes.ts:183` 方法闸仅放行 `GET /api/membership`，`/api/billing/catalog` 的 GET 不可达（catalog 分支在 :473，路由策略 `routePolicies.ts:27` 已登记 public） | **修复**（§3.2） |
| 3 | Web 构建失败 | esbuild 对 >1MiB transform 输入写 `%TEMP%\esbuild-*` 临时文件，删除时撞 Windows Defender 实时扫描窗口 → `remove …: Access is denied`（Go 服务进程 PathError，exit 1） | **修复**（§3.3） |
| 4 | 图谱 1 循环 | `local-data-plane.ts` ↔ `compaction.ts` 互相导入：compaction（低层事务文件）反向依赖高层门面的 `rebuildProjectionFromCanon` | **修复**（§3.4） |
| 5 | 安装器基于旧提交 90b45a1 且未签名 | 构建脚本 `scripts/release/windows/build.mjs` 无签名步骤，本机无代码签名证书 | **从 HEAD 重建**；未签名如实保留（§3.5） |

## 2. 观察基线

- 分支 `feature/windows-local-release`，HEAD `06a5069e39359c521fd9db4b2b3f088c5f451181`（收口会话开工 `git rev-parse HEAD` 复核一致；各修复代理开工核对均为同一提交）。
- 工作区含并行会话未提交改动（`PROJECT-MAP.md`、`docs/changes/CHG-20261006-17-*.md`、`.archify/` 及并行代理在制文件）；全程零 git 写操作，他人改动原样保留。
- 修复前图谱检查：`node .gitnexus/run.cjs check --cycles --json -r .` → exit 1，`{"status":"cycles_found","cycleCount":1}`，循环 `compaction.ts ↔ local-data-plane.ts`。

## 3. 修复内容

### 3.1 备份下载 GET 契约断裂（契约 DELTA-007）

- **修复**：`apps/web/server/routes/backupRoutes.ts:53-66` —— GET 用 `URLSearchParams` 从 `req.url` query 读 `backupId`（`backupRoutes.ts:60`），POST 维持 body 读取；`trim + /^[a-zA-Z0-9_-]{1,64}$/` 白名单两通道一致；400/404/`Content-Type: application/zip`/`Content-Disposition: attachment; filename="<id>.zip"`/`Content-Length` 行为不变。文件头注释登记 DELTA-007。UI 未改。
- **测试**：`apps/web/server/routes/backupRoutes.test.ts` 新增「下载 GET query 通道」用例（经真实 `POST /api/backups` 生成归档后：合法 id 200 ZIP 且断言 Content-Type/Content-Disposition、路径穿越形状 id 400、不存在 id 404）；`git diff --numstat` = +55/0（测试）、+13/−2（handler），既有用例零改删。
- **契约登记**：`.scratch/mozhou-mvp/contracts/api-contract.md` 新增「## 28. 备份下载双通道：GET query + POST body（DELTA-007，2026-10-07）」（+22 行）并在历史节追加 DELTA-007 行；新建 `.scratch/mozhou-mvp/contracts/deltas/DELTA-007.md`（变更原因/Delta 表/同步修改清单/不做的事）。该文档此前无此端点条目（grep backup/归档/下载 均无命中），编号顺延自历史节 DELTA-006。
- **改前影响分析**：GitNexus `impact(target=backupRoutes, direction=upstream)` → impactedCount 0、risk LOW、epistemic exact（`.use()` 注册式装配不建类型化 CALLS 边，图谱表达局限）；文本交叉核实唯一装配点 `apps/web/server/api.ts:624`。改后 `detect_changes` → 6 条 backupRoutes 执行流波及，均为 step 1（handler 入口），符合分支内行为改动预期。

### 3.2 定价目录 GET 404

- **修复**：`apps/web/server/routes/systemRoutes.ts:183-189` 方法闸改为 `!(req.method === 'GET' && (path === '/api/membership' || path === '/api/billing/catalog'))`；`git diff` 核对 +6/−1，membership 与其余方法限制逐字未动；价格数据 `apps/web/server/billing/catalog.ts` 零改动。
- **测试**：新增独立文件 `apps/web/server/routes/systemRoutes.billingCatalog.test.ts`，4 用例：GET 200+`currency==='CNY'` / POST 仍 200 / `GET /api/membership` 仍 200 / DELETE 仍 404。冲突排查：全仓 grep `api/billing/catalog` 于既有测试零匹配，无断言 404 的既有用例，既有测试零改删。
- **改前影响分析**：GitNexus `impact(target=systemRoutes, upstream)` → impactedCount 0、risk LOW、epistemic exact（同 3.1 的 `.use()` 注册图谱局限，源码交叉核实装配点 `api.ts:620/636/652`）；改后 `detect_changes` → 9 条 SystemRoutes 执行流波及（方法闸所在入口步）。

### 3.3 Web 构建失败（esbuild × Defender 实时扫描）

- **复现**：`pnpm --filter @mozhou/web build` → exit 1，`[vite:esbuild-transpile] remove C:\Users\a1691\AppData\Local\Temp\esbuild-faa86601…: Access is denied.`（esbuild Go 服务进程回传，非 Node unlink EPERM）。
- **机制取证**（esbuild@0.25.12 `lib/main.js`）：transform 输入 >1MiB 走临时文件（:770-773），临时名 = `os.tmpdir()` 下 64 hex 随机（:2095-2097），spawn 未传 env → 继承 node 环境。对照实验：3.4MB 输入在默认 Temp 下 8/8 失败（exit 42）、417KB 输入 3/3 全过（不走临时文件）、TMP/TEMP 重定向仓库内目录后 8/8 全过、纯 Node 写后即删两目录均 0 失败 —— 锁定为 esbuild 写→读→删约 400ms 时序落入 Defender 对新落盘大文件的实时扫描窗口；`Get-MpComputerStatus` RealTimeProtectionEnabled=True，唯一杀软为 Windows Defender；`%LOCALAPPDATA%\Temp` 有 18 个跨期 `esbuild-*` 残留互证。
- **修复**：`apps/web/vite.config.ts:1-20` 新增 17 行 —— `process.platform==='win32'` 时在配置求值期递归创建 `apps/web/node_modules/.tmp/esbuild`（`.gitignore:32` node_modules/ 已覆盖）并设 `process.env.TMP/TEMP`，JS 侧 `os.tmpdir()` 与 Go 子进程 `os.TempDir()` 同时重定向；目录创建失败原样抛错不静默降级；非 Windows 行为不变；不装新依赖、不改 lockfile。
- **验证**：修复后两次真实构建均 exit 0（181 modules，✓ built in 1.87s / 2.00s）；第二次构建期间 50ms 轮询 2/120 采样点观察到临时文件存在后即被清理 —— 重定向正面生效；系统 Temp 的 13 个 09-27→10-06 历史残留原样保留，构建零新增。
- **影响分析**：`impact(File:apps/web/vite.config.ts, upstream)` → impactedCount 0、risk LOW、epistemic exact（CLI 无 impact/detect_changes 子命令，经 MCP 工具执行，如实披露）。

### 3.4 图谱 1 循环（compaction ↔ local-data-plane）

- **根因**：正向边 `local-data-plane.ts:64-69` 从 `./compaction.js` 导入 `executeVolumeCompaction`/`markVolumeCompleted` 等（使用点 :429-430、444）；反向边 `compaction.ts:33` 从 `./local-data-plane.js` 导入 `rebuildProjectionFromCanon`（使用点 :155、305）—— 低层事务文件反向依赖高层门面的工具函数，方向错误。
- **改前影响分析**：GitNexus `impact(rebuildProjectionFromCanon, upstream)` → risk=CRITICAL（epistemic exact），d=1 直接调用者 3（`compaction.ts` 两函数、`LocalDataPlane.openOrRebuild` @ `local-data-plane.ts:150`）；d=2 含 `withBook`/`retainBook`/`LocalDataPlane.compactVolume` 等；外部消费者 5 文件（含 `packages/context-compiler/src/l1-lifecycle-bench.ts:38` 经包入口导入）。
- **修复（下沉共享工具，行为零改动）**：新建 `packages/data-plane/src/projection-rebuild.ts`，`rebuildProjectionFromCanon` 与私有 `removeProjectionFiles` 自 `local-data-plane.ts` 原文逐字搬移；`local-data-plane.ts:70-73` 改 import + re-export（维持 `./local-data-plane.js` 与包入口 `index.ts:11` 的既有公共导入路径不变）；`compaction.ts:33` 改引 `./projection-rebuild.js`。未选 `projection.ts` 作目标（`index.ts:8` 已 `export * from './projection.js'`，再 re-export 会致 TS2308 双 `export *` 歧义）；未选依赖倒置（会改 `executeVolumeCompaction` 公开 options 契约）。
- **解环门禁（已先刷新索引）**：`node .gitnexus/run.cjs analyze`（增量 changed=5, added=2, 28.8s）→ `node .gitnexus/run.cjs check --cycles --json -r .` → exit 0，`{"status":"clean","cycleCount":0,"cycles":[]}`。

### 3.5 安装器重建与签名状态

- 从 HEAD `06a5069e39359c521fd9db4b2b3f088c5f451181` 重建：`release-artifacts/MoZhou-0.3.0-windows-x64-setup.exe`（122.7M）。
- SHA-256：`5e1133208c9ee8009d60a5b597fa26684c07c8ea7b5c89aa043c7785586cd9dd`（收口会话 `sha256sum` 复算，与构建报告逐字一致，passed）。
- **签名状态：NotSigned（如实记录，非通过项）**：`scripts/release/windows/build.mjs` 全文无签名步骤（仅 tsc/Vite 打包 + csc 编译 MoZhou.exe + ISCC 编译安装器 + SHA-256 侧车）；本机无代码签名证书，`Get-AuthenticodeSignature` 返回 Status=NotSigned。按要求未伪造签名、未临时自签。**签名仍为挂账**。

## 4. 验证

### 4.1 收口核验（本会话亲跑，passed）

| 命令 | 结果 |
|---|---|
| `git rev-parse HEAD` | `06a5069e39359c521fd9db4b2b3f088c5f451181`，与基线一致 |
| `git diff --stat`（7 个修复文件） | 与各代理报告逐项吻合：backupRoutes.test +55/0、backupRoutes +13/−2、systemRoutes +6/−1、vite.config +17、compaction 1 行、local-data-plane −75 净、api-contract +22 |
| `ls` 新增文件 | `deltas/DELTA-007.md`、`projection-rebuild.ts`、`systemRoutes.billingCatalog.test.ts`、`navigation-acceptance-report.json` 均存在 |
| `sha256sum release-artifacts/MoZhou-0.3.0-windows-x64-setup.exe` | `5e113320…cd9dd`，与构建报告一致 |
| `grep`/`sed` 关键行 | `backupRoutes.ts:60`（URLSearchParams）、`systemRoutes.ts:186`（方法闸含 billing/catalog）、`vite.config.ts:17`（TEMP 重定向）、`compaction.ts:33` + `local-data-plane.ts:72-73`（解环改动）均在实际工作区 |
| 读 `navigation-acceptance-report.json` | 7 探针 6 过 1 失败（web-search 501），allPass=false，与验收执行报告一致 |

### 4.2 各修复代理定向验证（转记，收口未复跑）

| 修复 | 命令 | 结果 |
|---|---|---|
| 备份下载 | `pnpm -C C:/zcode/novel-ai/apps/web exec vitest run server/routes/backupRoutes.test.ts` | exit 0，Test Files 1 passed，Tests 3 passed（原 2 + 新增 1），1.65s |
| 备份下载 | `pnpm -C C:/zcode/novel-ai/apps/web exec tsc -p tsconfig.server.json --noEmit` | exit 0，无错误 |
| 定价目录 | `pnpm -C C:/zcode/novel-ai/apps/web test server/routes/systemRoutes.billingCatalog.test.ts` | exit 0，Test Files 1 passed，Tests 4 passed |
| 定价目录 | `pnpm -C C:/zcode/novel-ai/apps/web exec tsc -p tsconfig.server.json --noEmit` | exit 0 |
| 图谱解环 | `pnpm vitest run packages/data-plane/src/compaction.test.ts packages/data-plane/src/local-data-plane.test.ts` | exit 0，2 文件 17 用例全过 |
| 图谱解环 | `pnpm vitest run packages/data-plane/src/entity-cards.test.ts packages/data-plane/src/stale.test.ts packages/data-plane/src/with-plane.test.ts` | exit 0，3 文件 43 用例全过（覆盖 re-export 路径）；合计 60 用例全过，无测试被改删跳过 |
| 图谱解环 | data-plane / context-compiler 各自 `pnpm exec tsc -p . --noEmit` | 均 exit 0（跨包消费面无损） |
| Web 构建 | `pnpm --filter @mozhou/web build`（修复后两次） | 均 exit 0（含 tsc -b 与 server typecheck 全链） |

### 4.3 导航验收（真实服务实跑）

- 执行：`scripts/release/navigation-acceptance.mjs` 起真实服务（`http://127.0.0.1:5190`，probedAt 2026-10-07T12:48:49.550Z），报告落盘 `navigation-acceptance-report.json`。
- 结果：**7 探针 6 过**，`allPass=false`，脚本退出码 1。唯一失败 `/api/web-search` POST→501（脚本预期 200）——**审计前已知的未实现项，按任务要求未修、未改脚本**；`/api/novel-breakdown` POST→501 落在允许区间 [400,501] 通过。本轮修复的 `/api/billing/catalog` GET→200（latencyMs 17）在真实服务上生效。
- **验证状态：passed（6/7）+ failed（1/7，已知项）**，报告 JSON 原样保留 `allPass: false`，不得解读为全过。

### 4.4 审计复核（独立审计员）

- 结论：工作区相对 HEAD 的审计范围内改动均落在四项授权修复及其测试与契约文档内，无既有测试被删改削弱，无调试残留；定向测试 7/7 与 60/60 通过、`gitnexus check` clean（cycleCount 0），无 blocking 问题。
- 两条 note：①`vite.config.ts:11-17` 的宣称效果（Defender 机理）待编排器 Web 构建门禁确认（修复逻辑、win32 限定、mkdirSync 抛错、`.gitignore` 覆盖已复核一致）；②`AGENTS.md:125`/`CLAUDE.md:4` 各一行改动为 gitnexus 托管块内自动统计行（11610→12097 symbols 等），系图谱解环后重建索引的工具生成副作用，非手工改规则条文。

### 4.5 全量门禁（编排器统一执行，收口未复跑）

编排器提供的门禁清单及结论：`pnpm test`（包测试+Web 测试）exit=0；`pnpm build`（tsc -b）exit=0；Web 构建（Vite）exit=0；图谱门禁 clean、cycleCount=0。**本收口会话未执行上述全量命令，本文件不为其背书；结论以编排器执行记录为准。**

## 5. 风险与未验证维度

- **未验证**：浏览器级点击下载（UI 未改，HTTP 层契约测试已用真实服务端+真实归档覆盖 UI 链接形状）；hosted 模式下备份下载端点的会话鉴权行为未新增用例（路由策略 account 层不变，属既有机制）；`navigation-acceptance.mjs` 内部断言与真实服务探针的等价性已覆盖，但起服后完整导航验收仅 6/7（web-search 已知项未修）。
- **环境敏感型修复**：esbuild/Defender 竞争修复将时序敏感临时文件移出 `%LOCALAPPDATA%\Temp` 扫描上下文，以 8 次独立探测 + 两次真实构建验证；换机器/换杀软（360、火绒等）理论上可能在新目录复现同类竞争，届时在杀软侧为仓库目录加排除，属环境配置而非代码问题。vite 进程内所有 `os.tmpdir()` 消费方在 Windows 下改用新临时目录（实测两次构建无副作用，属有意取舍）。
- **清理披露（如实记录）**：Web 构建修复代理清理 `%TEMP%` 探测残留时，日期过滤（10-07）误把 4 个会话开始前已存在的当日残留一并删除；均为无进程占用的陈旧临时垃圾，无功能影响，但超出本意清理范围；09-27→10-06 的 13 个历史残留未动。
- **图谱局限**：`.use()` 注册式调用链在 GitNexus 图谱中不建 CALLS 边（改前 impact 报 0 上游），已用源码交叉核实装配点；`detect_changes` 的 critical/high 评级混入并行会话在制改动，非本轮修复单独所致。
- **安装器未签名**：见 §3.5；发布链路仍差签名一步。
- **工作区并行性**：本轮多代理并行，`git status` 中 `systemRoutes.ts`、data-plane 三文件、`backupRoutes*` 各归其主；`PROJECT-MAP.md`、`docs/changes/`、`.archify/` 为收口人既有改动，他人条目一字未动。

## 6. 回滚方法

- 本变更未做任何 git 操作，全部改动停留在工作区。回滚 = 丢弃对应工作区文件改动（并行代理改动不属本收口授权，回滚范围需按文件归属确认）：
  - 备份下载：还原 `apps/web/server/routes/backupRoutes.ts`、`backupRoutes.test.ts`、`.scratch/mozhou-mvp/contracts/api-contract.md`，删除 `.scratch/mozhou-mvp/contracts/deltas/DELTA-007.md`；
  - 定价目录：还原 `apps/web/server/routes/systemRoutes.ts`，删除 `systemRoutes.billingCatalog.test.ts`；
  - Web 构建：还原 `apps/web/vite.config.ts`（非 Windows 无行为变化）；
  - 图谱解环：还原 `packages/data-plane/src/{compaction,local-data-plane}.ts`，删除 `projection-rebuild.ts`，随后重跑 `node .gitnexus/run.cjs analyze` 刷新索引（注意：还原即恢复 1 循环，`check --cycles` 将回到 exit 1）；
  - 安装器：删除 `release-artifacts/MoZhou-0.3.0-windows-x64-setup.exe`（产物目录，gitignore 内）。
- 提交后如需回滚：`git revert <本批次提交 SHA>`。

## 7. 收口补记（2026-10-07，收口会话亲跑）

- 本变更前六节记录时全部改动尚在工作区；随后按「修复并落账」授权，修复按单一目的落账为 5 个提交：`0c3b4f3`（备份下载 GET 通道 + DELTA-007）、`e8a49e9`（定价目录 GET 放行）、`a0f4473`（data-plane 解环下沉）、`285778e`（vite 构建临时目录）、`8cf72b0`（本变更文档与地图登记）。基线 06a5069 不变，均在 feature/windows-local-release，未推送。
- 安装器最终产物自 HEAD `8cf72b0` 重建（`pnpm package:windows` exit 0）：SHA-256 `9aa2c2862eea63cdf4c22fc4a406f8b72ebef1b4fc919e0514f85687695f28f4`（收口复算一致，128626434 字节）；`release-artifacts/windows-build-result.json` 戳 `sourceCommit=8cf72b0bafe17fb05cd4af03ad2ceaa6c8c9eaf3` 与 HEAD 逐字一致；`Get-AuthenticodeSignature`（pwsh 7）复核仍 `NotSigned`（build.mjs 无签名步骤、本机无证书）。§3.5 记录的 `5e1133208c…`（HEAD 06a5069、工作区=修复内容的过渡产物）由本条取代为最终记录。
- 图谱门禁收口复跑：`node .gitnexus/run.cjs check --cycles --json -r .` → exit 0，`{"status":"clean","cycleCount":0}`。
- 导航验收报告复读：6/7 过（唯一失败 /api/web-search 501，清单外已知项），报告 `navigation-acceptance-report.json` 保留在仓库根（未跟踪）。
