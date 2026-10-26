# Electron 桌面壳迁移计划（Windows x64 先行）

- 状态：**待实现与真实验收**。本文件是执行依据与合同草案，不是实现通过的证据。
- 依据：[ADR-0037](../adr/0037-electron-desktop-shell-migration.md)（决策）；外部评审两份意见已逐条吸收。
- 范围：Windows x64。macOS/Linux、自动更新启用、代码签名接入**不在本期**。
- 授权：本轮不提交、不推送。阶段 4 未通过前不切默认发行入口、不删旧链路。

---

## 1. 阶段 0 基线事实

### 1.1 版本与构建输入

| 项 | 值 | 出处 |
|---|---|---|
| 应用版本 | 0.3.0 | `package.json` |
| 包管理器 | pnpm 9.15.0 | `package.json` `packageManager` |
| 服务端打包 Node | 24.18.0（随包 `runtime/node.exe` + 许可证） | `scripts/release/windows/build.mjs:87-93`、`node-24.18.0-LICENSE.txt` |
| CI Node | 22.23.2 | `.github/workflows/*.yml`、`docs/development.md:11-13` |
| 引擎约束 | `node >= 22` | `package.json` `engines` |
| 现有打包输入 | `apps/web/{dist,dist-server,package.json}` + 物化的生产依赖树 | `build.mjs:29-33`、`:37-86` |
| 待锁版本（新增） | Electron、electron-builder（builder 配置按锁定主版本编写，v27 有破坏性变更） | 本计划阶段 2 |

### 1.2 旧安装身份（Inno，必须被新安装器识别）

| 项 | 值 | 出处 |
|---|---|---|
| AppId | `MoZhou.Local.Windows` | `installer.iss:8` |
| 安装目录 | `{localappdata}\Programs\MoZhou`（per-user） | `installer.iss:12,14` |
| 程序组 | `墨舟` | `installer.iss:13` |
| 快捷方式 | `{group}\墨舟`、`{group}\卸载墨舟`、可选 `{userdesktop}\墨舟` | `installer.iss:31-37` |
| 卸载器 | `{uninstallexe}`（Inno 默认 `unins000.exe`，位于安装目录内） | `installer.iss:33` |
| 安装前钩子 | `PrepareToInstall` 调 `MoZhou.exe --stop`，**非 0 即中止安装** | `installer.iss:43-55` |
| 卸载前钩子 | `InitializeUninstall` 同上，失败即中止卸载 | `installer.iss:57-61` |
| 不删用户数据 | 书稿与 `installation.key` 在安装目录之外，升级/卸载均保留 | `installer.iss:63-64` |

### 1.3 四类目录（必须分别识别，不得混用）

| 类别 | 现位置 | 说明 |
|---|---|---|
| 安装目录 | `%LOCALAPPDATA%\Programs\MoZhou` | 旧 Inno 写；新 NSIS 必须另定并避免与旧卸载器危险重叠 |
| 服务数据根 | `%LOCALAPPDATA%\MoZhou` | 书稿、`installation.key`、`billing.sqlite`、`desktop.log`、`desktop-session.json`、`.mozhou_instance.lock` |
| Electron profile | 新增 | `userData`/`sessionData` 必须显式固定，且开发/测试/正式分离 |
| 外部作品根 | 作者注册的任意路径 | 卸载器**永不**删除 |

### 1.4 localStorage 键清单（迁移白名单基础）

身份后缀 = `bookId || root`（`workbenchStorage.ts:110-116`）；键格式含至少两个下划线，旧版无归属键 `ch_<N>` 永不匹配。

| 键 | 内容 | 冲突判断所需信息 |
|---|---|---|
| `mozhou.workbench.v1` | `{ book: {root, bookId, title}, view }` | 作品身份 |
| `mozhou.draft.cache.<ch_<identity>_<N>>` | 草稿纯文本 | — |
| `mozhou.draft.baseline.<ch_<identity>_<N>>` | 草稿基线 SHA-256 | 保存基线 |
| `mozhou.candidate.cache.<cand_<identity>_<N>>` | `CandidateCache`：`candidateId`、`base{revision,sha256}`、`mode`、`draftText`、`phase`、`partial` | **候选 base revision/hash** |
| `mozhou.editor.projection.<ch_<identity>_<N>>` | `{savedAt, blocks}` 编辑器结构投影 | 结构 |
| `mozhou.wizard.done` | 首次向导完成标记 | — |
| `mozhou.scene.v1` | 场景偏好 | — |
| `mozhou.skills.active` | 已注入技能 | — |

### 1.5 现有运行时行为（新壳必须逐条对齐或明确改变）

| 行为 | 现状 | 出处 |
|---|---|---|
| 数据目录 | 默认 `%LOCALAPPDATA%\MoZhou`，`--data-dir` 可覆盖 | `MoZhou.cs:27,31` |
| 单实例 | 命名互斥量 `Local\MoZhou-<sha256(data 大写)>`；已存在则打开工作台并退出 0 | `MoZhou.cs:37-40,56-64` |
| 停止入口 | 停止事件 `<mutex>-stop`；`--stop` 设置该事件并等 20s | `MoZhou.cs:40-52` |
| 稳定端口 | `43000 + ((sha256(data)[0]<<8\|[1]) % 1000)`；**占用则 +1 递增** | `MoZhou.cs:147-169` |
| 服务启动 | `runtime\node.exe desktop-server.mjs`，注入 `MOZHOU_DATA_ROOT`、`PORT` | `MoZhou.cs:110-131` |
| 就绪判定 | 轮询 `/api/health` 至 `ok==true && pid==子进程 pid`，最多 30s；写 `desktop-session.json{url,pid,launcherPid}` | `MoZhou.cs:133-144` |
| 打开方式 | **系统默认浏览器**（新壳改为窗口加载同一 URL） | `MoZhou.cs:191` |
| 日志 | 子进程 stdout/stderr 追加 `%LOCALAPPDATA%\MoZhou\desktop.log` | `MoZhou.cs:54,192-197` |
| 停止流程 | stdin 写 `shutdown` → 等 15s → Kill | `MoZhou.cs:198-215` |
| 服务端排空 | SIGINT/SIGTERM 先关监听、排空在途、10s 超时强退 | `productionServer.ts:214-254` |
| stdin 桥接 | `desktop-server.mjs` 把 stdin `shutdown` 转 SIGTERM | `desktop-server.mjs:43-54` |
| 数据根排他锁 | `.mozhou_instance.lock`（`openSync 'wx'`），启动即抢 | `bookAccess.ts:111-146`、`productionServer.ts:40` |
| 前端请求 | 全部相对 `/api/...`，假定与页面同源 | 全仓调用点 |

---

## 2. 六条不变量

1. **内容完整**：保护作品、未保存草稿、AI 候选、编辑器结构与保存基线；不凭章节号猜作品，不自动覆盖冲突原稿。
2. **存储身份明确**：兼容期固定 URL；**另外单独固定** Electron `userData`/`sessionData`（持久 partition）；开发、测试与正式 profile 分离。
3. **目录与密钥完整**：分别识别 §1.3 四类目录；保留 `installation.key` 与对应密文；**已有密文但缺 key 时拒绝启动，禁止自动生成替代 key**。
4. **单一写服务**：按规范化数据根标识实例；保留服务端排他锁；新旧壳须有停止与交接协议；聚焦 / 拒绝 / 停止成功 / 停止超时各有明确结果。
5. **独立 Node**：服务用锁定的官方 Node，依赖与资源在 asar 外，壳不加载服务端原生模块；但不免除原生 DLL、模型与部署图实测。
6. **退出与恢复**：正常停止排空；异常或强杀可能中断，须保证提交原子性与重启恢复；**不得用进程消失代替提交成功证据**。

---

## 3. 三份合同

### 3.1 旧浏览器数据迁移合同（P0）

- **触发时机**：切换发行入口之前。
- **导出侧**：在**实际旧浏览器页面**内提供导出入口，读取 §1.4 白名单键。禁止直接搬运 Chromium 内部存储数据库，禁止全量复制浏览器 profile。
- **迁移包**：含 `formatVersion`、作品身份（`bookId`+`root`+`title`）、章节身份、来源 origin、文本，以及 §1.4 标注的恢复元数据（尤其候选 `base.revision`/`base.sha256` 与草稿基线）。
- **导入侧**：校验作品归属、格式版本与保存基线。
  - 身份不明 → 进**待认领区**，不自动分配给任何作品。
  - 与服务端现状冲突 → **保留双份**，不覆盖。
  - 重复导入 → 幂等，不产生副作用。
- **失败处理**：保留原包与旧缓存，失败不清空源端；仅在结果可确认后标记已迁移。
- **边界**：SHA-256 内容校验证明完整性，**不证明来源认证**。

### 3.2 实例、端口与安全合同（P0/P1）

- **端口**：仍以 localStorage 为恢复来源期间，**不得占用后静默换端口**。现 `FindStablePort` 会 +1 递增且重启从基准端口起，会造成 P→P+1→P 的可见性切换。新壳：基准端口被正确实例占用则**聚焦**，被其他进程占用则**明确失败并可见**。若将来必须允许换端口，先补独立于 origin 的恢复策略。
- **就绪与身份**：子进程**实际绑定完成后经私有启动通道**报告就绪与实例身份；健康 JSON 的 `ok`/`pid` 不足以证明归属（防止假健康服务被误加载）。
- **跨代停止**：兼容旧 C# 的 Mutex/Event 停止入口，或提供明确迁移助手。Electron 自带单实例锁**不替代**跨代交接。`--stop` 须确定目标、等待服务/锁/句柄释放；失败以非零退出码阻止安装覆盖。
- **安全**：显式 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`；保留现 Host/Origin 与 CSP 防护；限定导航、新窗口、外链协议、权限与 IPC sender；不新增通用进程或文件桥；不顺手重做认证系统。
- **支持范围**：沿用现合同（多 Windows 登录会话不在支持范围内），不扩大。

### 3.3 安装升级与回退合同（P0）

- **身份固定**：新 appId/GUID、安装位置、持久 profile 位置、快捷方式一次定死；per-user 模式须在实际配置中固定（不得凭 `perMachine:false` 推断没有安装模式选择）。
- **升级顺序**：发现旧版（`AppId=MoZhou.Local.Windows`、`%LOCALAPPDATA%\Programs\MoZhou`、`unins000.exe`）→ 确认版本与目标 → 停止旧实例并**验证释放** → 按既定策略处置旧程序/卸载器 → 安装新版 → 验数据与迁移结果。
- **目录安全**：旧卸载器与新程序不得有危险目录重叠；明确旧卸载器保留与否，避免误删新程序。
- **失败保留可恢复路径**：停止失败、迁移失败或安装中断时不得留下半装状态。
- **卸载**：默认保留服务数据、密钥与 Electron profile；外部作品永不删除；重装可恢复。
- **回退**：须确认数据格式兼容；不兼容时明确阻止，不盲目覆盖。**备份存在 ≠ 恢复已验证。**

---

## 4. 分期与通过条件

| 阶段 | 交付 | 通过条件 |
|---|---|---|
| **0 基线与决策** | 本文件 §1、ADR-0037、INDEX 登记、合成迁移样本 | 基线事实有出处；ADR accepted |
| **1 迁移与兼容** | 浏览器导出/导入合同与工具；固定 profile、端口策略、跨代停止协议 | 合成样本能导出、导入、去重、冲突保留双份 |
| **2 Electron 壳** | 窗口、托盘、单实例、私有就绪握手、停机、安全与异常提示 | §5 中壳相关行可观察通过；行为变化附快照或预期输出 |
| **3 打包与自动验证** | per-user 安装器；资源与原生模块验证；Windows 自动验收入口与预期输出 | 安装后的 Node 跑通 SQLite + 真实分词 + ONNX 最小推理 |
| **4 真包迁移与回退** | 干净安装、存量迁移、Inno 升级、并发、异常、重装、回退证据 | §5 全表通过；**未通过不切入口** |
| **5 切换与退役** | 切 `package:windows`；同步门禁文档；删除无人消费的旧入口 | 活入口无悬空引用；旧版本与迁移助手保留 |

实现要点（阶段 2/3）：壳放**按需安装入口**（不进 workspace，单独锁版本，避免全员例行下载 Electron）；依赖物化复用 `build.mjs:37-86` 但须实测；`extraResources` 显式限定 app、Node、入口与资源，避免重复打包、漏 DLL/模型、残留 pnpm junction、误带真实数据或秘密；壳依赖与服务依赖分离，防止打包器把服务端原生模块重建为 Electron ABI。

---

## 5. 验收矩阵（必须能拒绝错误方案）

| 场景 | 可观察的通过条件 |
|---|---|
| 全新 Windows 安装 | 未装 Node/pnpm 的环境能启动、建书、写作、保存 |
| 旧 Edge/Chrome → Electron | 未提交草稿、候选、结构与基线按正确作品迁入；旧缓存保留 |
| 重复导入与冲突 | 重复操作不复制不覆盖；两边不同稿都可恢复 |
| 旧 Inno 运行中升级 | 正确停止旧服务；单一写者；卸载项与快捷方式符合约定 |
| 端口占用与启动抢占 | 不加载错误服务、不悄悄换 origin；错误可见 |
| 托盘退出 / 系统结束会话 | 排空或超时结果明确；无悬挂实例；再启动可恢复 |
| 合成副本缺密钥 | 含密文但缺 key 明确失败，不生成替代 key |
| 卸载后重装 | 外部作品、服务数据、key、持久 profile 按合同保留并恢复 |
| 安装中断与回退旧版 | 原稿可打开；候选可找回；不兼容格式明确阻止 |
| 原生模块与资源 | **安装后的 Node** 能跑 SQLite、真实分词与 ONNX 最小推理 |
| 导航与权限边界 | 未允许页面/协议/IPC 被拒绝；正常写作路径仍可用 |

执行记录须含包版本、来源戳、安装环境、合成测试根、操作输入、可见结果与证据，分别标 passed / failed / blocked / unverified。**未验证不得切换默认发行入口。** 桌面行为变化附同变更快照或预期输出，CI 只比较不更新基线。

---

## 6. 交付物

ADR；本计划；依赖与资源清单；浏览器迁移格式与工具；实例与生命周期合同；安装器 + 版本 + 哈希 + `windows-build-result.json`；迁移/故障/回滚证据；发行边界与已知缺口；文档与门禁同步（`docs/gates.md`、`verify-gates-contract.mjs` 的 `DELIVERABLE_ENTRIES`、`release-config.test.ts` 的 Tauri CSP 断言、`desktopLifecycle.contract.test.ts` 措辞、`docs/windows-local-install.md`、`docs/development.md`、`docs/deployment.md`、`README.md`、`docs/user-guide.md`、`GLOSSARY.md`、`.gitignore`、`docs/architecture.md`、`PROJECT-MAP.md`）。

## 7. 明确不做

macOS/Linux（写入锁在 macOS 直接抛 `WRITER_LOCK_UNSUPPORTED_PLATFORM`）；把服务端并入 Electron 主进程；改动前端 origin/localStorage 契约；代码签名（仍无证书，单列缺口）；不扩大现有多 Windows 登录会话支持范围。

## 8. 未实测（unverified）

压缩安装包体、安装占用、冷启动、空闲内存；Electron 壳在本机的实际运行；Inno→NSIS 升级与回退的真实行为；原生模块在打包产物内的实测。以上均须在阶段 3/4 实测后回填，估算不作为验收事实。
