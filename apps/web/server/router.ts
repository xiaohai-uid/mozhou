/**
 * apps/web · 轻量级 API 路由器与多租户安全分发网关 (ApiRouter / ApiDispatcher · T09)。
 * 统一请求体解析、路由策略分类、租户身份解析与跨模块边界防护。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { assertTrustedRequest, readRequestPayload, RequestBoundaryError, DEFAULT_MAX_JSON_BODY_BYTES } from './security.js'
import { getRoutePolicy, type RouteCategory } from './routePolicies.js'
import { defaultBookAccessManager, type AuthorizedBook } from './bookAccess.js'
import { defaultSessionManager, type VerifiedPrincipal } from './auth/session.js'

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  context: {
    readonly path: string
    readonly body: Record<string, unknown>
    readonly rawBuffer?: Buffer | undefined
    readonly rawText?: string | undefined
    readonly json: (status: number, body: unknown) => void
    readonly principal?: VerifiedPrincipal | null | undefined
    readonly authorizedBook?: AuthorizedBook | null | undefined
    readonly bookRoot?: string | null | undefined
    readonly policy?: RouteCategory | undefined
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
      if (res.writableEnded) return
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(payload))
    }

    // 1. 全路由策略检索与白名单校验（未登记路径默认拒绝）
    const policy = getRoutePolicy(path)
    if (!policy) {
      sendJson(403, {
        ok: false,
        code: 'UNREGISTERED_ROUTE_POLICY',
        error: `Route ${path} has no registered security policy`,
      })
      return true
    }

    // 2. 本地专属路由隔离：hosted 模式下禁止访问 local-native 端点
    if (defaultBookAccessManager.isHostedMode() && policy === 'local-native') {
      sendJson(403, {
        ok: false,
        code: 'LOCAL_NATIVE_ONLY',
        error: 'Endpoint is only available in local mode',
      })
      return true
    }

    let body: Record<string, unknown>
    let rawBuffer: Buffer | undefined
    let rawText: string | undefined
    try {
      assertTrustedRequest(req)
      // T14: 支付通知路由限制 ≤256KiB，其余使用默认最大限制
      const maxBytes = policy === 'payment-webhook' ? 256 * 1024 : DEFAULT_MAX_JSON_BODY_BYTES
      const payload = await readRequestPayload(req, maxBytes)
      body = payload.body
      rawBuffer = payload.rawBuffer
      rawText = payload.rawText
    } catch (error) {
      if (error instanceof RequestBoundaryError) {
        sendJson(error.status, { ok: false, code: error.code, error: error.message })
      } else {
        sendJson(400, { ok: false, code: 'BAD_REQUEST', error: 'invalid request' })
      }
      return true
    }

    // 3. 用户主体认证解析
    let principal: VerifiedPrincipal | null = null
    if (policy !== 'public' && policy !== 'payment-webhook') {
      try {
        principal = await defaultSessionManager.verifyRequestSession(req)
      } catch {
        if (defaultBookAccessManager.isHostedMode()) {
          sendJson(401, {
            ok: false,
            code: 'UNAUTHORIZED',
            error: 'authentication required',
          })
          return true
        }
        // local 模式下若未登录，回退至本地单机默认主体
        principal = { userId: 'local_user', email: 'local@mozhou.internal' }
      }
    } else {
      // public 路由尝试提取可选身份
      try {
        principal = await defaultSessionManager.verifyRequestSession(req)
      } catch {
        principal = null
      }
    }

    // 4. 作品级多租户所有权校验与沙箱解析 (Book Access Control)
    let authorizedBook: AuthorizedBook | null = null
    if (policy === 'book') {
      try {
        authorizedBook = defaultBookAccessManager.resolveAuthorizedBook(principal, body)
      } catch (bookErr) {
        if (bookErr instanceof RequestBoundaryError) {
          sendJson(bookErr.status, {
            ok: false,
            code: bookErr.code,
            error: bookErr.message,
          })
        } else {
          sendJson(404, {
            ok: false,
            code: 'BOOK_NOT_FOUND',
            error: (bookErr as Error).message,
          })
        }
        return true
      }
    }

    const bookRoot = authorizedBook?.root ?? (typeof body['root'] === 'string' ? body['root'] : null)

    const context = {
      path,
      body,
      rawBuffer,
      rawText,
      json: sendJson,
      principal,
      authorizedBook,
      bookRoot,
      policy,
    }

    for (const handler of this._handlers) {
      try {
        const handled = await handler(req, res, context)
        if (handled === true || res.writableEnded) {
          return true
        }
      } catch (error) {
        if (!res.writableEnded) {
          if (error instanceof RequestBoundaryError) {
            sendJson(error.status, { ok: false, code: error.code, error: error.message })
            return true
          }
          console.error('[mozhou-api] unhandled route error', error)
          sendJson(500, {
            ok: false,
            code: 'INTERNAL_SERVER_ERROR',
            error: 'Internal Server Error',
          })
        }
        return true
      }
    }

    return false
  }
}
