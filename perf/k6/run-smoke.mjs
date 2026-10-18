/**
 * perf/k6/run-smoke.mjs —— 起服务 → 跑 K6 冒烟 → 收服务，一条命令。
 *
 * 为什么用脚本包一层而不是让人手动「先起服务再 k6 run」：
 * 数据根有进程级排他锁，服务必须跑在专用临时目录（cwd 决定数据根位置），
 * 手动起服务的人极易忘掉这件事，一忘就撞开发者本机实例。脚本把 cwd 隔离
 * 做成默认，调用方没有机会忘。
 *
 * 与 scripts/verify-mock-journey.mjs 的关系：复用同一套起服务机制
 * （独立 cwd + MOZHOU_DRAFT_PROVIDER=mock + 轮询 /api/health），
 * 但本脚本只负责「服务活着的时候被压」，不跑十步主旅程。两者互不替代。
 *
 * 退出码（CI 可依赖）：
 *   0 = 冒烟通过（K6 阈值全绿）
 *   1 = 冒烟失败（K6 阈值红，或端点错误率超线）
 *   2 = 环境阻塞（dist-server 未构建 / 服务起不来 / k6 不在 PATH）——不是性能问题，
 *       是「这次没测成」，与「测了但没过」必须分开，否则 CI 会把构建缺失
 *       误报成性能回归。
 *
 * 用法：
 *   node perf/k6/run-smoke.mjs
 *   node perf/k6/run-smoke.mjs --keep-server   # 压完留着服务，方便手工复现
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(__dirname, '..', '..')

const PORT = Number(process.env.MOZHOU_PERF_PORT ?? 5199)
const BASE_URL = `http://127.0.0.1:${PORT}`
const K6 = process.env.K6_BIN ?? 'k6'
const KEEP_SERVER = process.argv.includes('--keep-server')

function log(msg) {
  console.log(`[perf-smoke] ${msg}`)
}

/** 环境阻塞：返回码 2，与「测了但没过」严格分开。 */
function blocked(reason, hint) {
  console.error(`[perf-smoke] BLOCKED: ${reason}`)
  if (hint) console.error(`[perf-smoke] 处理: ${hint}`)
  process.exit(2)
}

const serverEntry = resolve(repoRoot, 'apps/web/dist-server/productionServer.js')
if (!existsSync(serverEntry)) {
  blocked(
    '未找到 apps/web/dist-server/productionServer.js',
    '先执行 pnpm --filter @mozhou/web build（tsc -b && vite build && tsc -p tsconfig.server.json）',
  )
}

// k6 可用性预检：让「没装 k6」在起服务之前就失败，别等压测阶段才炸。
const k6Probe = spawnSync(K6, ['version'], { encoding: 'utf8' })
if (k6Probe.error || k6Probe.status !== 0) {
  blocked(
    `k6 不可用（命令：${K6}）`,
    '安装 k6（winget install GrafanaLabs.k6，或 GitHub releases 解压后加入 PATH），或用 K6_BIN 指定绝对路径',
  )
}
log(`k6: ${k6Probe.stdout.trim().split('\n')[0]}`)

// cwd = 专用临时目录 ⇒ 数据根落在临时区，不碰开发者本机实例（数据根有进程级排他锁）。
const serverCwd = mkdtempSync(join(tmpdir(), 'mozhou-perf-smoke-server-'))
log(`server cwd（数据根隔离）: ${serverCwd}`)

const server = spawn('node', [serverEntry], {
  cwd: serverCwd,
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    // 冒烟只打只读端点，本不经 LLM；mock 档是双保险——万一日后加了写端点
    // 也不至于把未授权请求打到真实上游。
    MOZHOU_DRAFT_PROVIDER: 'mock',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (d) => {
  const s = d.toString().trim()
  if (s) log(`[server] ${s}`)
})
server.stderr.on('data', (d) => {
  const s = d.toString().trim()
  if (s) log(`[server:err] ${s}`)
})

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  if (server.exitCode === null) server.kill('SIGTERM')
  if (!KEEP_SERVER) {
    try {
      rmSync(serverCwd, { recursive: true, force: true })
      log(`cleaned: ${serverCwd}`)
    } catch {
      // 清理失败不影响判定，只提示——临时目录残留好过误报性能结论。
      log(`WARN: 临时目录清理失败（可手工删除）: ${serverCwd}`)
    }
  } else {
    log(`--keep-server: 服务与数据根保留 ${serverCwd}`)
  }
}
process.on('exit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      blocked('服务进程提前退出', '看上面的 [server] / [server:err] 输出定位')
    }
    try {
      const res = await fetch(`${BASE_URL}/api/health`, { method: 'GET' })
      if (res.ok) return
    } catch {
      // 还没起来，继续等
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  blocked('服务 30 秒内未就绪（/api/health 未返回 200）', '检查 PORT 占用（可用 MOZHOU_PERF_PORT 换端口）')
}

await waitForServer()
log(`server ready: ${BASE_URL}`)

log('k6 run 开始')
const k6 = spawn(
  K6,
  [
    'run',
    resolve(__dirname, 'smoke.js'),
    '-e',
    `BASE_URL=${BASE_URL}`,
  ],
  { stdio: 'inherit' },
)

k6.on('exit', (code) => {
  cleanup()
  if (code === 0) {
    log('冒烟通过：K6 阈值全绿')
    process.exit(0)
  }
  console.error(`[perf-smoke] FAILED: K6 退出码 ${code}（阈值红或端点错误率超线）`)
  process.exit(1)
})
