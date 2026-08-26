/**
 * apps/web 同进程 API 中间件（Phase 6 · T31 R1 修订）。
 *
 * 修正理由（t76 R1）：后端库直接 import node:fs/node:crypto，浏览器端打包即炸——
 * 因此不在浏览器直引 workspace 包，改为 Node 侧中间件直调后端读面、JSON 直出；
 * dev = Vite middleware，prod = 薄 server serve dist + 挂载同一中间件。
 *
 * 形态：Connect-style (req, res, next)。全部读面函数在此直调（零契约翻译层）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createBook, readCanonState } from '@mozhou/data-plane'
import { readPipelineLedger } from '@mozhou/pipeline'

export type Middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    req.on('end', () => {
      try { resolve(JSON.parse(raw) as Record<string, unknown>) } catch { resolve({}) }
    })
  })
}

function urlPath(req: IncomingMessage): string {
  const url = req.url ?? '/'
  return url.split('?')[0] ?? '/'
}

/**
 * 中间件：仅处理 /api/* 前缀；非 API 请求交给 next()（Vite 静态或 prod serve）。
 * 端点：
 *   POST /api/book        {title, dir} → createBook
 *   POST /api/book.state  {root}      → readCanonState（Story Brain 基底）
 *   POST /api/ledger      {root}      → readPipelineLedger（Traversal/账本可见）
 */
export function apiMiddleware(): Middleware {
  return (req, res, next) => {
    const path = urlPath(req)
    if (!path.startsWith('/api/')) { next(); return }
    void (async () => {
      try {
        if (req.method === 'POST' && path === '/api/book') {
          const body = await bodyOf(req)
          const dir = typeof body['dir'] === 'string' ? body['dir'] : '/tmp/mozhou-book-' + Date.now()
          const title = typeof body['title'] === 'string' ? body['title'] : '未命名之书'
          const result = createBook({ dir, title })
          json(res, 200, { ok: true, root: result.root, bookId: result.book.id })
          return
        }
        if (req.method === 'POST' && path === '/api/book.state') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          if (root === null) { json(res, 400, { ok: false, error: 'root required' }); return }
          json(res, 200, { ok: true, state: readCanonState(root) })
          return
        }
        if (req.method === 'POST' && path === '/api/ledger') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          if (root === null) { json(res, 400, { ok: false, error: 'root required' }); return }
          json(res, 200, { ok: true, events: readPipelineLedger(root) })
          return
        }
        json(res, 404, { ok: false, error: 'no such api endpoint: ' + path })
      } catch (error) {
        // 失败显式（UVSD §14）：错误 JSON，绝不静默
        json(res, 500, { ok: false, error: (error as Error).message })
      }
    })()
  }
}

/**
 * Vite 插件形态：dev = configureServer 挂中间件；prod = configurePreviewServer
 * 挂同一中间件（vite preview 即『静态 dist + 同进程 API』，零额外进程，t76 R1）。
 */
import type { Plugin } from 'vite'

export function moZhouApi(): Plugin {
  const mw = apiMiddleware()
  return {
    name: 'mozhou-api',
    configureServer(server) {
      server.middlewares.use(mw)
    },
    configurePreviewServer(server) {
      server.middlewares.use(mw)
    },
  }
}
