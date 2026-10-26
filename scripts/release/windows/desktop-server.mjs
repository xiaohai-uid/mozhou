// Packaged entry: settings are established before loading the application.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

// 数据根必须由启动器显式传入：Windows 安装器的 MoZhou.exe（scripts/release/windows/MoZhou.cs
// 设置 MOZHOU_DATA_ROOT 后启动本文件），或 Tauri 桌面壳（src-tauri/src/server_manager.rs
// 拉起服务进程时设置）。这里刻意不回退到 cwd：回退会绕过启动器钉定的目录，造出第二个数据根
// 与第二把 installation.key，同一份 provider-settings.enc 跨入口读不出凭据。缺变量时给出可执行
// 的报错，而不是让 resolve(undefined) 抛裸 TypeError。
// 注意：scripts/launcher.mjs 是另一个入口——它直接启动 apps/web 的 productionServer.js，不启动
// 本文件，故不要在报错文案里把它列为本入口的启动者。
function requireDataRoot() {
  const override = process.env.MOZHOU_DATA_ROOT?.trim()
  if (!override) {
    throw new Error(
      'MOZHOU_DATA_ROOT is not set. Start MoZhou through the launcher that pins the data root ' +
        '(the Windows installer MoZhou.exe, or the Tauri desktop shell). ' +
        'Refusing to fall back to the working directory: a fallback would create a ' +
        'second data root and a second installation.key.',
    )
  }
  return override
}

const root = resolve(requireDataRoot())
mkdirSync(root, { recursive: true })
const keyFile = join(root, 'installation.key')

// 恢复护栏（E05）：已有受保护密文却缺 key 时**拒绝重铸**。
// 重铸一把新 key 解不开既有密文，用户的 BYOK 凭据会静默变成不可恢复——而旧代码只做
// `wx` 新建，正好会在「恢复副本丢了 key、密文还在」这条最常见的路径上重铸。
// 受保护位置与本机服务端同源（`providerSettings.getSettingsPath`）：本地单机为
// `<dataRoot>/local-provider-settings.enc`。本入口固定 MOZHOU_HOSTED=false，hosted 用户
// 的 `users/<id>/provider-settings.enc` 由 hosted 入口负责，这里不越界清点。
const protectedLocalSettings = join(root, 'local-provider-settings.enc')
if (!existsSync(keyFile) && existsSync(protectedLocalSettings)) {
  throw new Error(
    `installation.key is missing, but encrypted credentials already exist: ${protectedLocalSettings}. ` +
      'Refusing to create a replacement key: a new key cannot decrypt the existing credentials, ' +
      'so creating one would silently make them unrecoverable. ' +
      `Restore ${keyFile} from backup — it is the only key that can read these files. ` +
      'If the key is genuinely lost, move the .enc files aside first, then start again to initialize fresh.',
  )
}

try {
  writeFileSync(keyFile, randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 })
} catch (error) {
  // EEXIST：并发首启的输家，读回赢家写的钥匙。
  // EISDIR：路径被目录占位——同样交给下面的读取分支给出可读报错，不在这里冒泡裸 errno。
  if (error.code !== 'EEXIST' && error.code !== 'EISDIR') throw error
}
let keyText
try {
  keyText = readFileSync(keyFile, 'utf8').trim()
} catch (error) {
  // 权限、被占用、路径被目录占位：明确失败并给出可执行动作，不冒泡成裸 errno。
  throw new Error(
    `installation.key cannot be read (${keyFile}): ${error.message}. ` +
      'Fix the file permissions or restore it from backup; do not delete it.',
  )
}
process.env.MOZHOU_SECRET_KEY = keyText
if (!/^[0-9a-f]{96}$/.test(process.env.MOZHOU_SECRET_KEY)) {
  throw new Error('Installation key is damaged. Restore it from backup; do not replace it.')
}
process.env.NODE_ENV = 'production'
process.env.MOZHOU_HOSTED = 'false'
process.env.HOST = '127.0.0.1'

// 应用目录：打包布局是与本文件同级的 `app/`（build.mjs 复制 dist/dist-server/package.json）。
// 仓库内直跑（Electron 壳尚未打包、自检场景）时 `app/` 不在同级，由启动器经 MOZHOU_APP_URL
// 传入应用目录的 file:// URL。用 URL 而不是裸路径：动态 import 只接受 file/data/node 三种
// scheme，Windows 绝对路径必须先转成 file:// URL——转换交给启动器（它本就在 Node 侧拼路径），
// 本文件保持零新增依赖，缺省分支也仍是既有的打包布局。
const appBaseUrl = process.env.MOZHOU_APP_URL?.trim()
  ? new URL(process.env.MOZHOU_APP_URL.trim())
  : new URL('./app/', import.meta.url)
await import(new URL('dist-server/productionServer.js', appBaseUrl))

// Windows cannot send POSIX SIGTERM. The owning launcher uses its private stdin
// pipe to enter the server's existing drain-and-release shutdown handler.
let pending = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  pending += chunk
  if (pending.includes('\n')) {
    if (pending.trim() === 'shutdown') process.emit('SIGTERM')
    pending = ''
  }
})
process.stdin.on('end', () => process.emit('SIGTERM'))
process.stdin.resume()
