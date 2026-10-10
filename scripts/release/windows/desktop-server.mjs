// Packaged entry: settings are established before loading the application.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

// 数据根必须由启动器显式传入（MoZhou.exe 会设置 MOZHOU_DATA_ROOT 为绝对路径）。这里
// 刻意不回退到 cwd：回退会绕过启动器钉定的目录，造出第二个数据根与第二把
// installation.key，同一份 provider-settings.enc 跨入口读不出凭据。缺变量时给出可执行的
// 报错，而不是让 resolve(undefined) 抛裸 TypeError。
function requireDataRoot() {
  const override = process.env.MOZHOU_DATA_ROOT?.trim()
  if (!override) {
    throw new Error(
      'MOZHOU_DATA_ROOT is not set. Start MoZhou through its launcher (MoZhou.exe or scripts/launcher.mjs), ' +
        'which pins the data root. Refusing to fall back to the working directory: a fallback would create a ' +
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
