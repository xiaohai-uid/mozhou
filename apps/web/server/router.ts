/**
 * apps/web · 轻量级 API 路由器与分发器 (ApiRouter / ApiDispatcher)。
 * 统一请求体解析、路径分发与异常包装。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { assertTrustedRequest, readJsonBody, RequestBoundaryError } from './security.js'

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  context: {
    readonly path: string
    readonly body: Record<string, unknown>
    readonly json: (status: number, body: unknown) => void
  },
) => Promise<boolean | void> | boolean | void

export class ApiRouter {
  private readonly _handlers: RouteHandler[] = []

  use(handler: RouteHandler): this {
    this._handlers.push(handler)
    return this
  }

  async dispatch(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url ?? '/'
    const path = url.split('?')[0] ?? '/'

    if (!path.startsWith('/api/')) {
      return false
    }

    const sendJson = (status: number, payload: unknown) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(payload))
    }

    let body: Record<string, unknown>
    try {
      assertTrustedRequest(req)
      body = await readJsonBody(req)
    } catch (error) {
      if (error instanceof RequestBoundaryError) {
        sendJson(error.status, { ok: false, code: error.code, error: error.message })
      } else {
        sendJson(400, { ok: false, code: 'BAD_REQUEST', error: 'invalid request' })
      }
      return true
    }

    const context = { path, body, json: sendJson }

    for (const handler of this._handlers) {
      try {
        const handled = await handler(req, res, context)
        if (handled === true || res.writableEnded) {
          return true
        }
      } catch (error) {
        if (!res.writableEnded) {
          sendJson(500, {
            ok: false,
            error: (error as Error)?.message ?? 'Internal Server Error',
          })
        }
        return true
      }
    }

    return false
  }
}
