/**
 * 桌面壳的路径解析（单一事实来源）。
 *
 * 四类目录必须分别识别、不得混用（迁移计划 §1.3）：
 *   1. 安装目录         —— 由安装器决定，壳不关心；
 *   2. 服务数据根       —— 书稿 / installation.key / 锁文件，本模块 resolveDataRoot；
 *   3. Electron profile —— userData / sessionData，本模块 resolveProfileRoot（**必须显式固定**，
 *                          否则 Electron 会退到 `%APPDATA%\<产品名>`，与旧浏览器 profile 混在一起，
 *                          且开发/测试/正式互相污染）；
 *   4. 外部作品根       —— 作者注册的任意路径，壳只做只读打开，永不删除。
 *
 * 服务端入口与应用目录在打包布局与仓库内布局不同，两者都显式解析，缺一即报错而不是猜。
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 服务数据根。优先级：`--data-dir` > `MOZHOU_DATA_ROOT` > `%LOCALAPPDATA%\MoZhou`。
 * 最后一项与旧 C# 启动器（MoZhou.cs:27）完全一致，保证新旧壳指向同一份书稿与同一把
 * installation.key —— 两个数据根会产生两把 key，跨入口读不出同一份 provider-settings.enc。
 */
export function resolveDataRoot(cliDataDir) {
  if (cliDataDir) return resolve(cliDataDir)
  const fromEnv = process.env.MOZHOU_DATA_ROOT?.trim()
  if (fromEnv) return resolve(fromEnv)
  const localAppData = process.env.LOCALAPPDATA?.trim()
  if (!localAppData) {
    throw new Error('LOCALAPPDATA 未设置，无法确定默认数据目录；请用 --data-dir 显式指定。')
  }
  return join(localAppData, 'MoZhou')
}

/**
 * profile 通道。开发、测试与正式必须分离（不变量 2），否则开发期的实验数据会写进
 * 作者的真实 profile。`app.isPackaged` 为真即正式；仓库内直跑一律 dev。
 */
export function resolveChannel() {
  const explicit = process.env.MOZHOU_DESKTOP_CHANNEL?.trim()
  if (explicit) return explicit
  return app.isPackaged ? 'prod' : 'dev'
}

/**
 * Electron profile 根。默认放在数据根下的 `.desktop-profile/<通道>`：
 * 点号前缀避免被服务端的书根扫描（reconciliationRoutes.ts:243-249 只扫 books/ 与
 * users/<用户>/books/）当成作品目录；随 `--data-dir` 一起走，卸载器保留数据根即保留 profile。
 */
export function resolveProfileRoot(dataRoot, channel) {
  const override = process.env.MOZHOU_DESKTOP_PROFILE_ROOT?.trim()
  if (override) return resolve(override)
  return join(dataRoot, '.desktop-profile', channel)
}

/** 仓库根：仓库内直跑时为 `<仓库>/desktop` 的上一级。 */
export function repoRoot() {
  return resolve(app.getAppPath(), '..')
}

/**
 * 服务端入口 `desktop-server.mjs`。打包布局由 build.mjs 放在 resources 根；
 * 仓库内直跑时用 `scripts/release/windows/desktop-server.mjs`（即打包时被复制的那一份）。
 */
export function resolveServerEntry() {
  const override = process.env.MOZHOU_DESKTOP_SERVER_ENTRY?.trim()
  if (override) return resolve(override)
  if (app.isPackaged) return join(process.resourcesPath, 'desktop-server.mjs')
  return join(repoRoot(), 'scripts', 'release', 'windows', 'desktop-server.mjs')
}

/**
 * 服务端应用目录（含 dist/ 与 dist-server/）的 **file:// URL**，经 `MOZHOU_APP_URL`
 * 传给 `desktop-server.mjs`。打包布局在 `desktop-server.mjs` 同级的 `app/`；仓库内直跑指向
 * `apps/web`。传 URL 而不是裸路径：动态 import 只认 file/data/node 三种 scheme，Windows 绝对
 * 路径必须先转 URL，转换放在壳这一侧（壳本就在 Node 侧拼路径），`desktop-server.mjs` 不加依赖。
 * 末尾分隔符不能省：`new URL(相对路径, base)` 会把 base 的最后一段当文件替换掉。
 */
export function resolveAppUrl() {
  const override = process.env.MOZHOU_APP_DIR?.trim()
  const dir = override
    ? resolve(override)
    : app.isPackaged
      ? join(process.resourcesPath, 'app')
      : join(repoRoot(), 'apps', 'web')
  return pathToFileURL(dir.endsWith(sep) ? dir : dir + sep).href
}

/**
 * 官方 Node 可执行文件。壳**绝不**用 Electron 自带的 Node 跑服务端：
 * 那会把服务端原生模块（better-sqlite3 / onnxruntime-node / tokenizers）绑到 Electron ABI 上，
 * 正是 ADR-0037 决策 2 要避免的耦合。打包产物必须带 `runtime/node.exe`，缺失即报错不降级。
 */
export function resolveNodeExe() {
  const override = process.env.MOZHOU_NODE_EXE?.trim()
  if (override) return resolve(override)
  if (app.isPackaged) {
    const packaged = join(process.resourcesPath, 'runtime', 'node.exe')
    if (!existsSync(packaged)) {
      throw new Error(`打包产物缺少官方 Node：${packaged}。请检查 extraResources 配置。`)
    }
    return packaged
  }
  // 仓库内直跑：PATH 上的官方 Node（自检脚本会显式传 process.execPath，避免歧义）
  return 'node'
}
