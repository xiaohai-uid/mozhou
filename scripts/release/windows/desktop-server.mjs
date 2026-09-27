// Packaged entry: settings are established before loading the application.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const root = resolve(process.env.MOZHOU_DATA_ROOT)
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
