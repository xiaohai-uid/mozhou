/**
 * apps/web · 订单创建、查询与支付回调路由控制器 (Billing Routes · T14)。
 * 
 * 依照 reference/CONTRACTS.md C4 与 reference/03-public-billing.md T14 规格：
 * - POST /api/billing/orders：创建订单（同用户同 idempotencyKey 幂等返回，不同参数 409）；
 * - POST /api/billing/order（或通过 body 传 orderId）：主体只能查自己的订单（A 查 B 返回 404）；
 * - POST /api/payments/wechat/notify：微信支付异步通知回调（豁免普通登录，以 APIv3 验签为边界）；
 * - POST /api/payments/alipay/notify：支付宝异步通知回调（豁免普通登录，以 RSA2 验签为边界）；
 * - POST /api/billing/orders/refund：退款审计接口。
 */
import type { RouteHandler } from '../router.js'
import { defaultBillingStore } from '../billing/store.js'
import { defaultNotificationDispatcher } from '../billing/notifications.js'
import type { PayChannel, PlanId } from '../billing/contracts.js'
import { defaultWechatPayVerifier } from '../billing/wechat.js'
import { defaultAlipayVerifier } from '../billing/alipay.js'

export const billingRoutes: RouteHandler = (req, res, { path, body, json, principal }) => {
  /* ---- 1. 创建订单 ---- */
  if (path === '/api/billing/orders' && req.method === 'POST') {
    const userId = principal?.userId
    if (!userId) {
      json(401, { ok: false, code: 'UNAUTHORIZED', error: 'login required to create order' })
      return true
    }

    const planId = body['planId'] as PlanId
    const channel = body['channel'] as PayChannel
    const idempotencyKey = typeof body['idempotencyKey'] === 'string' ? body['idempotencyKey'].trim() : null

    if (!planId || !channel || !idempotencyKey) {
      json(400, { ok: false, code: 'INVALID_PARAMETERS', error: 'planId, channel, and idempotencyKey required' })
      return true
    }

    try {
      const order = defaultBillingStore.createOrder({
        userId,
        planId,
        channel,
        idempotencyKey,
      })

      json(200, {
        ok: true,
        orderId: order.orderId,
        checkoutUrl: order.checkoutUrl,
        amountFen: order.amountFen,
        currency: order.currency,
        state: order.state,
        expiresAt: order.periodEnd,
      })
    } catch (err) {
      json(409, { ok: false, code: 'ORDER_CREATION_FAILED', error: (err as Error).message })
    }
    return true
  }

  /* ---- 2. 查询订单状态 (A 查 B 订单 → 404) ---- */
  if (
    (path === '/api/billing/order' || (path.startsWith('/api/billing/orders/') && path !== '/api/billing/orders/refund')) &&
    (req.method === 'POST' || req.method === 'GET')
  ) {
    const userId = principal?.userId
    if (!userId) {
      json(401, { ok: false, code: 'UNAUTHORIZED', error: 'login required to view order' })
      return true
    }

    let orderId = typeof body['orderId'] === 'string' ? body['orderId'].trim() : ''
    if (!orderId && path.startsWith('/api/billing/orders/')) {
      orderId = path.slice('/api/billing/orders/'.length).trim()
    }

    if (!orderId) {
      json(400, { ok: false, code: 'ORDER_ID_REQUIRED', error: 'orderId required' })
      return true
    }

    const order = defaultBillingStore.getOrder(orderId)
    // 若订单不存在，或订单不属于当前主体，统一返回 404 越权拒绝
    if (!order || order.userId !== userId) {
      json(404, { ok: false, code: 'ORDER_NOT_FOUND', error: `order ${orderId} not found` })
      return true
    }

    json(200, {
      ok: true,
      order: {
        orderId: order.orderId,
        planId: order.planId,
        channel: order.channel,
        amountFen: order.amountFen,
        currency: order.currency,
        state: order.state,
        periodStart: order.periodStart,
        periodEnd: order.periodEnd,
        createdAt: order.createdAt,
      },
    })
    return true
  }

  /* ---- 3. 微信支付异步通知回调 ---- */
  if (path === '/api/payments/wechat/notify' && req.method === 'POST') {
    try {
      const rawBody = JSON.stringify(body)
      defaultWechatPayVerifier.verifyAndParseNotification(req.headers, rawBody)
      const result = defaultNotificationDispatcher.processWechatNotification(req.headers, rawBody)

      if (result.success) {
        json(200, { code: 'SUCCESS', message: '成功' })
      } else {
        json(400, { code: 'FAIL', message: result.error })
      }
    } catch (err) {
      json(401, { code: 'FAIL', message: (err as Error).message })
    }
    return true
  }

  /* ---- 4. 支付宝异步通知回调 ---- */
  if (path === '/api/payments/alipay/notify' && req.method === 'POST') {
    try {
      const params = body as Record<string, string>
      defaultAlipayVerifier.verifyAndParseNotification(params)
      const result = defaultNotificationDispatcher.processAlipayNotification(params)

      if (result.success) {
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end('success')
      } else {
        res.statusCode = 400
        res.end('fail')
      }
    } catch (err) {
      res.statusCode = 401
      res.end('fail: ' + (err as Error).message)
    }
    return true
  }

  /* ---- 5. 订单退款处理 ---- */
  if (path === '/api/billing/orders/refund' && req.method === 'POST') {
    const orderId = typeof body['orderId'] === 'string' ? body['orderId'].trim() : ''
    const amountFen = typeof body['amountFen'] === 'number' ? body['amountFen'] : 0

    if (!orderId || amountFen <= 0) {
      json(400, { ok: false, code: 'INVALID_PARAMETERS', error: 'orderId and positive amountFen required' })
      return true
    }

    try {
      const refunded = defaultBillingStore.refundOrder(orderId, amountFen)
      json(200, { ok: true, order: refunded })
    } catch (err) {
      json(400, { ok: false, code: 'REFUND_FAILED', error: (err as Error).message })
    }
    return true
  }

  return false
}
