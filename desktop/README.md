# 墨舟 Electron 桌面壳（`desktop/`）

Windows x64 先行。依据 [ADR-0037](../docs/adr/0037-electron-desktop-shell-migration.md) 与
[迁移计划 §3.2](../docs/plans/2026-10-12-electron-desktop-migration.md)。本目录只做**壳**：
窗口、托盘、单实例、稳定端口、就绪握手、优雅停机、导航与权限边界。

## 为什么单独一个目录、单独的锁文件

壳是**按需安装入口**：Electron 二进制约 235MB，不进 pnpm workspace，避免所有开发者例行下载。
根 `pnpm-workspace.yaml` 只收 `packages/*` 与 `apps/*`，`desktop/` 天然不在其中。

实测（2026-10-12）：在 `desktop/` 里直接跑 `pnpm install`（不带 `--ignore-workspace`）**不会安装本目录**，
pnpm 会向上找到仓库根、按 workspace 根（10 个项目）执行，然后被根的 `preinstall` 环境检查挡下。
所以 **`--ignore-workspace` 是必需的**。

## 安装

```bash
cd desktop
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install --ignore-workspace
```

- `.npmrc` 已把 `electron_mirror` 指向 npmmirror，国内网络不必再手设环境变量。
- `postinstall` 会执行 `install-electron`。**Electron 44 没有 `postinstall` 脚本**，二进制靠
  这个 bin 下载；不跑它的话 `node_modules/electron/dist/` 会缺失，而 `electron` 包本身不报错——
  这正是第一次安装时「装完却起不来」的原因。装完可自检：`node_modules/electron/dist/electron.exe` 应存在。

## 运行

```bash
cd desktop
pnpm start            # = electron .
```

### 命令行

| 参数 | 作用 |
|---|---|
| `--data-dir <path>` | 覆盖服务数据根（默认 `%LOCALAPPDATA%\MoZhou`，与旧 C# 启动器一致） |
| `--stop` | 停止本数据根上由本代壳托管的实例，并等端口/锁释放；失败非零退出 |
| `--no-open` | 启动后不显示窗口 |
| `--headless` | 不建托盘、不弹对话框（自动化/自检用） |

未知参数一律忽略：Electron/Chromium 会注入自己的开关，按位置解析会误判。

### 环境变量

| 变量 | 用途 |
|---|---|
| `MOZHOU_DATA_ROOT` | 数据根（优先级低于 `--data-dir`） |
| `MOZHOU_DESKTOP_PROFILE_ROOT` | Electron profile 根（默认 `<数据根>/.desktop-profile/<通道>`） |
| `MOZHOU_DESKTOP_CHANNEL` | profile 通道（默认打包为 `prod`、仓库内直跑为 `dev`） |
| `MOZHOU_DESKTOP_SERVER_ENTRY` | `desktop-server.mjs` 路径 |
| `MOZHOU_APP_DIR` | 服务端应用目录（含 `dist/`、`dist-server/`）；壳会转成 `file://` URL 再传下去 |
| `MOZHOU_APP_URL` | 应用目录的 `file://` URL，直接交给 `desktop-server.mjs` 做动态 import（一般不必手设） |
| `MOZHOU_NODE_EXE` | 官方 Node 可执行文件 |

## 自检

```bash
cd desktop
pnpm run self-check
```

用 Playwright 的 Electron 支持**真实启动**这个壳，共 23 条断言，任一失败即非零退出：

- **A（正常路径）** 窗口打开且 URL 是 `http://127.0.0.1:<派生端口>`（非 `file://`）；工作台标题、
  React 挂载点、页面内同源 `fetch('/api/health')`；`nodeIntegration=false` / `contextIsolation=true` /
  `sandbox=true` / `webviewTag=false`；服务端是独立进程；退出码 0 且走排空而非 Kill；端口随后释放。
- **B（端口被外来进程占用）** 明确失败（退出码 3），日志给出原因，**不静默换端口**。
- **C（单实例）** 同数据根第二实例立即退出 0，首实例不受影响。
- **D（`--stop`）** 宿主服务就绪后 `--stop` 退出 0，宿主被停止，端口释放。

失败即非零退出（已实测：去掉 `--no-sandbox` 时 Electron 无法初始化，脚本退出 1）。

### 受限环境下要加 `--no-sandbox`

```bash
MOZHOU_SELFCHECK_ELECTRON_ARGS="--no-sandbox" pnpm run self-check
```

默认**不加**：`--no-sandbox` 会关掉 Chromium 的 OS 沙箱，默认加上等于用更弱的配置掩盖真实发布配置。
只有当前用户的令牌无法初始化 Chromium 沙箱时（本开发机即如此，Electron 直接退出码 3）才需要它。
这与 `webPreferences.sandbox` 是两件事：后者（渲染器沙箱）始终为 `true`，A8 断言的就是它。

## 打包与自动化校验

```bash
cd desktop
pnpm run package:dir       # 构建独立免安装绿色运行目录（位于 release-artifacts/）
pnpm run package:windows   # 构建并编译 Windows 完整安装包（若具备 Inno Setup 6）
pnpm run verify:package    # 运行桌面安装包自动化结构与原生模块健康校验 (10 项断言)
pnpm run test:journey      # 运行 Electron 桌面端端到端作者旅程回归 (16 项断言)
```

## 安全姿态

- 渲染进程：`nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、`webviewTag:false`，
  **不设 preload**——壳不暴露任何 IPC/文件桥。
- 导航：只允许同源 `http://127.0.0.1:<端口>`；其余取消导航。
- 新窗口一律拒绝；`http/https` 外链交给系统浏览器；`file:`/`javascript:`/`data:` 等协议拒绝。
- 权限请求（摄像头/麦克风/定位/通知…）全部拒绝。
- CSP 与 Host/Origin 防护仍由服务端响应头承担（`apps/web/server/productionServer.ts:81-89`）。

## 已知限制与未覆盖

- **本机 43000–43999 有 745 个端口不可绑定**（`EADDRINUSE`，但 netstat 查不到监听者；疑似
  Hyper-V/HNS 保留）。实测该区间仅 254 个可绑定。按合同「不得静默换端口」，派生端口落在保留段时
  壳会**明确失败**（退出码 3）。自检因此会先挑一个派生端口可用的临时数据根（测试准备，不是壳换端口）。
  这影响迁移计划 §3.2 的前提，值得在阶段 3/4 前确认目标机器。
- 本开发机上，非受信任安装位置的可执行文件**不能写 `C:\Users\...`**（实测：把 `node.exe` 复制到工作区
  后同样被拒；Electron 亦然）。故自检的临时数据根放在 `desktop/.self-check/`（工作区内）。
  这意味着**默认数据根 `%LOCALAPPDATA%\MoZhou` 在本开发环境无法验证**——只验证了 `--data-dir` 路径。
- `--stop` 只覆盖本代（Electron）实例。旧 C# 的命名 Mutex/Event 停止入口**未兼容**；检测到本数据根上
  有墨舟服务但不是本代壳托管时，`--stop` 退出码 8 并明确报告，不假装停成功。
- 托盘存在性只在 A 场景非 headless 运行时被间接验证（`Tray` 构造失败会让启动失败），未做图标/菜单交互断言。
- **仓库的 `pnpm lint` 不覆盖本目录**：根 ESLint 用 typescript-eslint 的类型化 lint，`allowDefaultProject`
  未收录 `desktop/`，会直接报解析错误。本目录用独立规则集自查（`eslint --no-config-lookup` + 基础正确性规则）
  无告警。要把本目录纳入仓库 lint，需在 `eslint.config.js` 的 `allowDefaultProject` 增加 `desktop/**/*.mjs`。
- 打包（electron-builder / NSIS）、自动更新、代码签名不在本目录范围（阶段 3/5）。
