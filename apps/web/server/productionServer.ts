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

const port = Number.parseInt(process.env['PORT'] ?? '5173', 10)
const host = process.env['HOST'] ?? '127.0.0.1'
const distDir = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const indexPath = resolve(distDir, 'index.html')
const apiRouter = createMoZhouApiRouter()

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
