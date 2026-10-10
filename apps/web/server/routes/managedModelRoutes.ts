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
import { RequestBoundaryError } from '../security.js'
import { defaultLicenseTicketManager } from '../billing/license.js'
import { defaultQuotaManager } from '../billing/quota.js'
import { defaultEntitlementManager } from '../billing/entitlements.js'
import { billingCatalog } from '../billing/catalog.js'

/**
 * 单次结算成本上界（分）。取自冻结目录 catalog.ts 的「每月模型成本经营保护上限（分）」
 * （billingCatalog.managed.budget.modelBudgetFenPerMonth，当前 1500），并写进代码注释固定依据：
 * settle 的 costFen 会由 quota.ts 直接累加进全局日成本（_dailyCosts），若单次成本可任意大，
 * 一个普通登录用户即可打掉全体用户共用的日成本断路器（后续 reserve 全部 429）。
 * 单次调用成本超过整月经营保护上限本身即不合理，故以此冻结值为上界。
 * 不采用 quota.ts 的 _dailyBudgetFen：它是运行期可变配置（setDailyBudgetFen），非冻结值。
 */
const MAX_SETTLE_COST_FEN = billingCatalog.managed.budget.modelBudgetFenPerMonth

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

    // 权益判定结果必须用于票据：只有确实享有该能力的用户才沿用其付费套餐，
    // 否则一律降为 free。票据能力由 planId 推导，free 不再获得任何 pro 能力。
    const entitlement = defaultEntitlementManager.checkUserEntitled(userId, 'storyboard')
    const planId = entitlement.entitled ? (entitlement.planId ?? 'free') : 'free'

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
        // 保留额度层给出的状态码：日成本断路器为 429、额度耗尽为 402，
        // 若统一压成 402，断路器对客户端就不可见。
        const boundary = err instanceof RequestBoundaryError ? err : null
        json(boundary?.status ?? 402, {
          ok: false,
          code: boundary?.code ?? 'QUOTA_EXHAUSTED',
          error: (err as Error).message,
        })
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

    // costFen 必须由调用方提供：settle 时点无法确定适用的套餐/模型，
    // 冻结目录 catalog.ts 的 pricePerMTokenFen 亦为 null（T18 未实测），
    // 因此这里绝不能凭 tokens 自算价格。缺省视为 0；给出非法值时显式 400，不静默当 0。
    const rawCostFen = body['costFen']
    let costFen = 0
    if (rawCostFen !== undefined) {
      if (typeof rawCostFen !== 'number' || !Number.isFinite(rawCostFen) || rawCostFen < 0) {
        json(400, {
          ok: false,
          code: 'INVALID_COST_FEN',
          error: 'costFen must be a finite non-negative number',
        })
        return true
      }
      // 上界：见 MAX_SETTLE_COST_FEN 注释。超过即显式 400，绝不进入全局成本累加。
      if (rawCostFen > MAX_SETTLE_COST_FEN) {
        json(400, {
          ok: false,
          code: 'COST_FEN_EXCEEDS_LIMIT',
          error: `costFen must not exceed the monthly model cost protection limit (${MAX_SETTLE_COST_FEN} fen)`,
        })
        return true
      }
      costFen = rawCostFen
    }

    void (async () => {
      try {
        const result = await defaultQuotaManager.settle(userId, operationId, tokens, costFen)
        json(200, { ok: true, reservation: result })
      } catch (err) {
        const boundary = err instanceof RequestBoundaryError ? err : null
        json(boundary?.status ?? 400, {
          ok: false,
          code: boundary?.code ?? 'SETTLE_FAILED',
          error: (err as Error).message,
        })
      }
    })()
    return true
  }

  return false
}
