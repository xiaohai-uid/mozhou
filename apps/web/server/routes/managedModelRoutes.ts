/**
 * apps/web · 官方托管模型配额与离线票据路由 (Managed Model & License Routes · T15)。
 * 
 * 依照 reference/03-public-billing.md T15 规格：
 * - POST /api/billing/license/ticket：颁发 Ed25519 签名离线票据；
 * - POST /api/billing/quota/status：查询当前账户调用配额余额；
 * - POST /api/billing/quota/reserve：原子预留官方模型配额；
 * - POST /api/billing/quota/settle：结算实际 Token 消耗。
 */
import type { RouteHandler } from '../router.js'
import { defaultLicenseTicketManager } from '../billing/license.js'
import { defaultQuotaManager } from '../billing/quota.js'
import { defaultEntitlementManager } from '../billing/entitlements.js'

export const managedModelRoutes: RouteHandler = (req, res, { path, body, json, principal }) => {
  const userId = principal?.userId
  if (!userId) {
    if (path.startsWith('/api/billing/license') || path.startsWith('/api/billing/quota')) {
      json(401, { ok: false, code: 'UNAUTHORIZED', error: 'login required' })
      return true
    }
    return false
  }

  /* ---- 1. 颁发离线授权票据 ---- */
  if (path === '/api/billing/license/ticket' && req.method === 'POST') {
    const deviceId = typeof body['deviceId'] === 'string' ? body['deviceId'].trim() : ''
    if (!deviceId) {
      json(400, { ok: false, code: 'DEVICE_ID_REQUIRED', error: 'deviceId required' })
      return true
    }

    const entitlement = defaultEntitlementManager.checkUserEntitled(userId, 'storyboard')
    const planId = entitlement.planId ?? 'free'

    const ticket = defaultLicenseTicketManager.issueTicket({
      userId,
      deviceId,
      planId,
    })

    json(200, { ok: true, ticket })
    return true
  }

  /* ---- 2. 查询模型配额余额 ---- */
  if (path === '/api/billing/quota/status' && (req.method === 'POST' || req.method === 'GET')) {
    const balance = defaultQuotaManager.getBalance(userId)
    json(200, { ok: true, balance })
    return true
  }

  /* ---- 3. 预留模型配额 ---- */
  if (path === '/api/billing/quota/reserve' && req.method === 'POST') {
    const operationId = typeof body['operationId'] === 'string' ? body['operationId'].trim() : ''
    const units = typeof body['units'] === 'number' ? body['units'] : 1
    if (!operationId) {
      json(400, { ok: false, code: 'OPERATION_ID_REQUIRED', error: 'operationId required' })
      return true
    }

    void (async () => {
      try {
        const reservation = await defaultQuotaManager.reserve(userId, operationId, units)
        json(200, { ok: true, reservation })
      } catch (err) {
        json(402, { ok: false, code: 'QUOTA_EXHAUSTED', error: (err as Error).message })
      }
    })()
    return true
  }

  /* ---- 4. 结算模型配额 ---- */
  if (path === '/api/billing/quota/settle' && req.method === 'POST') {
    const operationId = typeof body['operationId'] === 'string' ? body['operationId'].trim() : ''
    const tokens = typeof body['tokens'] === 'number' ? body['tokens'] : 0
    if (!operationId) {
      json(400, { ok: false, code: 'OPERATION_ID_REQUIRED', error: 'operationId required' })
      return true
    }

    void (async () => {
      try {
        const result = await defaultQuotaManager.settle(userId, operationId, tokens)
        json(200, { ok: true, reservation: result })
      } catch (err) {
        json(400, { ok: false, code: 'SETTLE_FAILED', error: (err as Error).message })
      }
    })()
    return true
  }

  return false
}
