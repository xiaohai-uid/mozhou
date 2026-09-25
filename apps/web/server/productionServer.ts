/**
 * 墨舟商业发行版本地 HTTP 服务器。
 *
 * 生产职责：
 * - 复用同一套 ApiRouter，避免 Vite preview 承担生产流量；
 * - 只默认监听 127.0.0.1；
 * - 静态文件路径 fail-closed，禁止目录穿越；
 * - 为 Web 面统一附加基础安全响应头。
 */
import { createReadStream, statSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMoZhouApiRouter } from './api.js'
import { defaultBookAccessManager } from './bookAccess.js'
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

// T09 进程级排他启动锁：同一 dataRoot 禁止多实例并发争夺，争夺失败则抛错并不开始监听
defaultBookAccessManager.lock.acquire(defaultBookAccessManager.getDataRoot())
process.on('exit', () => { defaultBookAccessManager.lock.release() })
process.on('SIGINT', () => { defaultBookAccessManager.lock.release(); process.exit(0) })
process.on('SIGTERM', () => { defaultBookAccessManager.lock.release(); process.exit(0) })

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

const bootAttach = attachReconciliationForDataRoot(defaultBookAccessManager.getDataRoot())
if (bootAttach.attached.length > 0) {
  console.log(`[mozhou-reconciliation] 启动必检已挂接 ${bootAttach.attached.length} 本书`)
}
for (const failure of bootAttach.failed) {
  console.error(`[mozhou-reconciliation] 启动必检挂接失败 ${failure.root}: ${failure.error}`)
}

function shutdownReconciliation(): void {
  stopAllReconciliationRuntimes()
}
// 收口走 exit 而非 SIGINT/SIGTERM：上面两个信号处理器已先注册并直接 process.exit(0)，
// 后注册的信号监听器不会执行；exit 处理器必然跑到。
process.on('exit', shutdownReconciliation)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`invalid PORT: ${String(process.env['PORT'])}`)
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
    console.error('[mozhou-static] read failure', error)
    if (!res.headersSent) res.statusCode = 500
    res.end()
  })
  stream.pipe(res)
}

const server = createServer((req, res) => {
  void (async () => {
    setSecurityHeaders(res)

    if ((req.url ?? '/').startsWith('/api/')) {
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
    console.error('[mozhou-production] unhandled server error', error)
    if (!res.headersSent) res.statusCode = 500
    res.end()
  })
})

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
})

server.listen(port, host, () => {
  console.log(`[mozhou] production server listening on http://${host}:${port}`)
})
