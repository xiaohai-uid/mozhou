/**
 * 墨舟商业发行版本地 HTTP 服务器。
 *
 * 生产职责：
 * - 复用同一套 ApiRouter，避免 Vite preview 承担生产流量；
 * - 只默认监听 127.0.0.1；
 * - 静态文件路径 fail-closed，禁止目录穿越；
 * - 为 Web 面统一附加基础安全响应头；
 * - 单行 JSON 请求日志（stdout/stderr）与优雅停机，供编排层排障与滚动升级。
 */
import { createReadStream, statSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMoZhouApiRouter } from './api.js'
import { defaultBookAccessManager } from './bookAccess.js'
import { assertMasterKeyConfigured } from './llm/providerSettings.js'
import { log, nextRequestId } from './observability.js'
import {
  attachReconciliationForDataRoot,
  installReconciliationAutoAttach,
  stopAllReconciliationRuntimes,
} from './routes/reconciliationRoutes.js'

const port = Number.parseInt(process.env['PORT'] ?? '5173', 10)
const host = process.env['HOST'] ?? '127.0.0.1'
const distDir = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const indexPath = resolve(distDir, 'index.html')
const apiRouter = createMoZhouApiRouter()

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`invalid PORT: ${String(process.env['PORT'])}`)
}

// 生产/hosted 缺 MOZHOU_SECRET_KEY 即在开始服务前拒绝启动：此时尚无任何凭据被
// 加密，但一旦放行，后续写入的 BYOK 密钥就会用源码可见的默认密钥落盘。
assertMasterKeyConfigured()

// T09 进程级排他启动锁：同一 dataRoot 禁止多实例并发争夺，争夺失败则抛错并不开始监听
defaultBookAccessManager.lock.acquire(defaultBookAccessManager.getDataRoot())

/* ============================================================================
 * T5 对账接线：启动必检 + 运行期 watcher（dual-plane-sync-spec Q4）
 * ==========================================================================
 * 与 Obsidian 并行使用是本产品的核心场景，规格承诺「外部修改最终必被检出」。
 * 两条挂接路径合起来覆盖全部书：
 *   1. 启动必检：进程启动即对数据根下已知书（books 目录与 users 用户书目录）各做一次
 *      基线核对并起 watcher；
 *   2. 首次访问必检：书可位于任意目录（书架可指向任意 parentDir），无法靠启动扫描
 *      穷举——ApiRouter 解析出书根时经 onBookResolved 钩子挂接，此后该书的 watcher
 *      持续运行。挂接失败落 stderr 并可经 /api/reconciliation.list 观测，绝不静默。
 * 常驻宿主持有 runtime.sqlite 句柄，故退出时必须显式收口（否则进程不干净退出）。
 */
installReconciliationAutoAttach(apiRouter)

const dataRoot = defaultBookAccessManager.getDataRoot()
const bootAttach = attachReconciliationForDataRoot(dataRoot)
if (bootAttach.attached.length > 0) {
  log('info', 'reconciliation.boot_attached', { books: bootAttach.attached.length })
}
for (const failure of bootAttach.failed) {
  log('error', 'reconciliation.boot_attach_failed', { root: failure.root, error: failure.error })
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  )
}

function insideDist(candidate: string): boolean {
  return candidate === distDir || candidate.startsWith(distDir + sep)
}

/** 只记路径，不记 query：查询串可能带凭据或令牌，不应进日志。 */
function requestPath(url: string | undefined): string {
  return (url ?? '/').split('?')[0] ?? '/'
}

function serveFile(res: ServerResponse, absolutePath: string, headOnly: boolean): void {
  let stat
  try {
    stat = statSync(absolutePath)
  } catch {
    res.statusCode = 404
    res.end('Not Found')
    return
  }
  if (!stat.isFile()) {
    res.statusCode = 404
    res.end('Not Found')
    return
  }

  res.statusCode = 200
  res.setHeader('Content-Type', CONTENT_TYPES[extname(absolutePath).toLowerCase()] ?? 'application/octet-stream')
  res.setHeader('Content-Length', String(stat.size))
  if (headOnly) {
    res.end()
    return
  }
  const stream = createReadStream(absolutePath)
  stream.on('error', (error) => {
    log('error', 'static.read_failed', { path: absolutePath, error: String(error) })
    if (!res.headersSent) res.statusCode = 500
    res.end()
  })
  stream.pipe(res)
}

const server = createServer((req, res) => {
  const startedAt = process.hrtime.bigint()
  const requestId = nextRequestId()
  res.setHeader('X-Request-Id', requestId)

  // 用 close 而非 finish：客户端中断时 finish 不触发，那条请求会从访问日志里消失，
  // 而「请求发出但没有响应」恰是排障最需要看到的一类。499 沿用 nginx 的语义。
  res.on('close', () => {
    const status = res.writableFinished ? res.statusCode : 499
    log(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'http.request', {
      requestId,
      method: req.method ?? 'UNKNOWN',
      path: requestPath(req.url),
      status,
      durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100,
    })
  })

  void (async () => {
    setSecurityHeaders(res)

    if (requestPath(req.url).startsWith('/api/')) {
      const handled = await apiRouter.dispatch(req, res)
      if (!handled && !res.writableEnded) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'API route not found' }))
      }
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.setHeader('Allow', 'GET, HEAD')
      res.end('Method Not Allowed')
      return
    }

    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    } catch {
      res.statusCode = 400
      res.end('Bad Request')
      return
    }

    const candidate = resolve(distDir, '.' + pathname)
    if (!insideDist(candidate)) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    let chosen = candidate
    try {
      if (!statSync(chosen).isFile()) chosen = indexPath
    } catch {
      // SPA 路由无扩展名时回退 index；真实静态资产缺失则 404。
      if (extname(pathname) === '') chosen = indexPath
    }
    serveFile(res, chosen, req.method === 'HEAD')
  })().catch((error) => {
    log('error', 'server.unhandled_error', { requestId, error: String(error) })
    if (!res.headersSent) res.statusCode = 500
    res.end()
  })
})

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
})

/* ============================================================================
 * 优雅停机
 * ==========================================================================
 * 此前 SIGINT/SIGTERM 直接 process.exit(0)：在途的章节提交会被就地掐断，连接
 * 不做排空。改为先关闭监听、排空在途请求，超时才强制退出——滚动升级与
 * `docker compose restart` 都会走这条路径。
 *
 * 退出收口统一挂在 `exit` 钩子上（同步、必然执行），故强制超时路径与正常排空
 * 路径共享同一份资源释放逻辑，不会漏放锁。
 */
const SHUTDOWN_TIMEOUT_MS = 10_000
let shuttingDown = false

function releaseResources(): void {
  defaultBookAccessManager.lock.release()
  stopAllReconciliationRuntimes()
}

process.on('exit', releaseResources)

function shutdown(reason: string, exitCode: number): void {
  if (shuttingDown) return
  shuttingDown = true
  log('info', 'shutdown.start', { reason, exitCode })

  const force = setTimeout(() => {
    log('warn', 'shutdown.timeout', { timeoutMs: SHUTDOWN_TIMEOUT_MS })
    process.exit(exitCode)
  }, SHUTDOWN_TIMEOUT_MS)
  force.unref()

  server.close(() => {
    log('info', 'shutdown.drained', {})
    clearTimeout(force)
    process.exit(exitCode)
  })
  // 空闲 keep-alive 连接不会自己断开，会一直挡住 close 回调；显式关闭它们，
  // 在途请求不受影响。
  server.closeIdleConnections()
}

process.on('SIGINT', () => { shutdown('SIGINT', 0) })
process.on('SIGTERM', () => { shutdown('SIGTERM', 0) })
process.on('uncaughtException', (error) => {
  log('error', 'process.uncaught_exception', { error: String(error), stack: error.stack })
  shutdown('uncaughtException', 1)
})
process.on('unhandledRejection', (reason) => {
  log('error', 'process.unhandled_rejection', { reason: String(reason) })
  shutdown('unhandledRejection', 1)
})

server.listen(port, host, () => {
  log('info', 'server.listening', {
    url: `http://${host}:${port}`,
    dataRoot,
    nodeEnv: process.env['NODE_ENV'] ?? null,
    hostedMode: defaultBookAccessManager.isHostedMode(),
    pid: process.pid,
  })
})
