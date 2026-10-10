// Packaged entry: settings are established before loading the application.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
try {
  writeFileSync(keyFile, randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 })
} catch (error) {
  if (error.code !== 'EEXIST') throw error
}
process.env.MOZHOU_SECRET_KEY = readFileSync(keyFile, 'utf8').trim()
if (!/^[0-9a-f]{96}$/.test(process.env.MOZHOU_SECRET_KEY)) {
  throw new Error('Installation key is damaged. Restore it from backup; do not replace it.')
}
process.env.NODE_ENV = 'production'
process.env.MOZHOU_HOSTED = 'false'
process.env.HOST = '127.0.0.1'
await import('./app/dist-server/productionServer.js')

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
