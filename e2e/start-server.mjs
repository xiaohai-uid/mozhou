#!/usr/bin/env node
/**
 * e2e/start-server.mjs —— Playwright webServer 的启动器：把生产服务跑在隔离数据根上。
 *
 * 为什么需要这一层（做法对齐 perf/k6/run-smoke.mjs 与 scripts/verify-mock-journey.mjs）：
 * 数据根有进程级排他锁，服务必须跑在专用临时目录，否则会撞开发者本机正在跑的实例。
 * Playwright 的 webServer 只接受一条命令，无法在配置里表达「先建临时目录再起服务」，
 * 所以把 cwd + MOZHOU_DATA_ROOT 的隔离做成脚本默认行为，调用方没有机会忘。
 *
 * 退出码：
 *   服务进程的退出码原样透传；构建产物缺失/端口非法时 exit 2——这是「这次没测成」
 *   的环境阻塞，不是测试失败，两者不能混报。
 *
 *   注意：Playwright 会把 webServer 提前退出统一折成测试失败（退出码 1），本脚本的
 *   exit 2 只在直调本脚本时可见。要让 `pnpm test:e2e` 真正区分 BLOCKED 与 FAIL，
 *   入口必须是 e2e/run-e2e.mjs——它在 Playwright 之外做同样的前置检查。
 *
 * 清理：正常信号路径会删掉临时数据根。Playwright 在 Windows 上用 taskkill /T /F
 * 结束整个进程树，SIGTERM 处理器可能来不及跑，此时临时目录残留在系统临时区
 * （不影响判定，也不会污染仓库）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const serverEntry = resolve(repoRoot, 'apps/web/dist-server/productionServer.js')
const rawPort = process.env['MOZHOU_E2E_PORT']
const port = Number(rawPort ?? '5310')

if (!existsSync(serverEntry)) {
  console.error('[e2e] BLOCKED: 未找到 apps/web/dist-server/productionServer.js')
  console.error('[e2e] 先执行 pnpm --filter @mozhou/web build')
  process.exit(2)
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`[e2e] BLOCKED: MOZHOU_E2E_PORT 非法：${String(rawPort)}`)
  process.exit(2)
}

const serverCwd = mkdtempSync(join(tmpdir(), 'mozhou-e2e-server-'))
const dataRoot = join(serverCwd, '.mozhou_data')

// Playwright 在 Windows 上用 taskkill /T /F 结束进程树，上面的 exit 清理跑不到，
// 于是每次运行都会在系统临时区留一个数据根。下次启动时顺手回收超过一天的残留：
// 阈值远大于单次运行时长，不会误删并发运行中的目录。
const STALE_MS = 24 * 60 * 60 * 1000
function pruneStaleServerDirs() {
  const parent = tmpdir()
  for (const entry of readdirSync(parent)) {
    if (!entry.startsWith('mozhou-e2e-server-')) continue
    const full = join(parent, entry)
    try {
      if (Date.now() - statSync(full).mtimeMs > STALE_MS) {
        rmSync(full, { recursive: true, force: true })
      }
    } catch {
      // 另一进程可能正在使用该目录：跳过即可，不影响本次运行。
    }
  }
}
pruneStaleServerDirs()

console.log(`[e2e] server cwd（数据根隔离）: ${serverCwd}`)

const child = spawn(process.execPath, [serverEntry], {
  cwd: serverCwd,
  env: {
    ...process.env,
    PORT: String(port),
    // 与 perf 冒烟同口径：只监听回环，LLM 走 mock，保证 E2E 不打真实上游。
    HOST: '127.0.0.1',
    MOZHOU_DATA_ROOT: dataRoot,
    MOZHOU_DRAFT_PROVIDER: 'mock',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

/** @param {Buffer} chunk */
function forwardStdout(chunk) {
  const text = chunk.toString().trim()
  if (text) console.log(`[e2e:server] ${text}`)
}

/** @param {Buffer} chunk */
function forwardStderr(chunk) {
  const text = chunk.toString().trim()
  if (text) console.error(`[e2e:server:err] ${text}`)
}

child.stdout.on('data', forwardStdout)
child.stderr.on('data', forwardStderr)

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  try {
    rmSync(serverCwd, { recursive: true, force: true })
  } catch {
    // 清理失败不影响判定：临时目录残留好过误报测试结论。
    console.error(`[e2e] WARN: 临时数据根清理失败（可手工删除）: ${serverCwd}`)
  }
}

/** @param {NodeJS.Signals} signal */
function stopChild(signal) {
  if (child.exitCode === null && !child.killed) child.kill(signal)
}

process.on('SIGINT', () => {
  stopChild('SIGINT')
  process.exitCode = 130
})
process.on('SIGTERM', () => {
  stopChild('SIGTERM')
})
process.on('exit', cleanup)

child.on('exit', (code, signal) => {
  cleanup()
  if (code !== null) {
    process.exit(code)
  }
  // 被信号终止：非零退出，让 Playwright 把「服务没了」当失败而不是通过。
  console.error(`[e2e] 服务进程被信号终止: ${String(signal)}`)
  process.exit(1)
})
