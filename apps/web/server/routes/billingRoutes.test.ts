// @vitest-environment node
/**
 * 订单与支付回调 HTTP 接口测试 (T14 · 真实 HTTP 级端到端测试)。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBillingStore } from '../billing/store.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { defaultSessionManager, InMemoryAuthProvider } from '../auth/session.js'

// R2：支付验签改为 fail-closed 后，「未配置」负路径断言必须确定性——清空支付凭据环境变量，
// 使 defaultWechatPayVerifier/defaultAlipayVerifier 单例在模块加载时即为未配置。
// vi.hoisted 在 import 之前执行，早于单例构造。
vi.hoisted(() => {
  for (const key of [
    'WECHAT_MCH_ID',
    'WECHAT_APP_ID',
    'WECHAT_APIV3_KEY',
    'WECHAT_PLATFORM_CERT',
    'ALIPAY_APP_ID',
    'ALIPAY_PUBLIC_KEY',
    'MOZHOU_OPS_TOKEN',
  ]) {
    delete process.env[key]
  }
})

let servers: ReturnType<typeof createServer>[] = []
let tempDirs: string[] = []

beforeEach(() => {
  defaultSessionManager.clear()
  defaultSessionManager.setProvider(new InMemoryAuthProvider())
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  defaultBillingStore.close()
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  tempDirs = []
})

function listen(): Promise<string> {
  return new Promise((resolveUrl) => {
    const router = createMoZhouApiRouter()
    const server = createServer((req, res) => {
      void router.dispatch(req, res).then((handled) => {
        if (!handled && !res.writableEnded) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'not found' }))
        }
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolveUrl(`http://127.0.0.1:${addr.port}`)
    })
  })
}

describe('订单与支付回调路由 (T14)', () => {
  it('未登录创建订单 → 401，登录后成功创建订单', async () => {
    defaultBookAccessManager.setHostedMode(true)
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-billing-route-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)
    defaultBillingStore.setDatabasePath(join(dataRoot, 'billing.sqlite'))

    const base = await listen()

    // 1. 未登录创建订单 → 401
    const resNoAuth = await fetch(`${base}/api/billing/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: 'pro_monthly', channel: 'wechat', idempotencyKey: 'k1' }),
    })
    expect(resNoAuth.status).toBe(401)

    // 2. 登录后创建
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user } = await provider.signUp('order_user@test.com', 'pass123')
    const { cookie } = defaultSessionManager.createSession({ userId: user.id, email: user.email })

    const resAuth = await fetch(`${base}/api/billing/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        planId: 'pro_monthly',
        channel: 'wechat',
        idempotencyKey: 'user_k1',
      }),
    })
    expect(resAuth.status).toBe(200)
    const data = (await resAuth.json()) as { ok: boolean; orderId: string; amountFen: number }
    expect(data.ok).toBe(true)
    expect(data.amountFen).toBe(1900)
    expect(typeof data.orderId).toBe('string')
  })

  it('主体 A 查询主体 B 的订单 → 404 越权拒绝', async () => {
    defaultBookAccessManager.setHostedMode(true)
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-billing-priv-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)
    defaultBillingStore.setDatabasePath(join(dataRoot, 'billing.sqlite'))

    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)

    const { user: userA } = await provider.signUp('a@pay.com', 'passA123')
    const { user: userB } = await provider.signUp('b@pay.com', 'passB123')
    const { cookie: cookieA } = defaultSessionManager.createSession({ userId: userA.id, email: userA.email })

    // 为用户 B 创建订单
    const orderB = defaultBillingStore.createOrder({
      userId: userB.id,
      planId: 'max_monthly',
      channel: 'alipay',
      idempotencyKey: 'key_b_secret',
    })

    // 主体 A 尝试查询主体 B 的 orderId
    const res = await fetch(`${base}/api/billing/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({ orderId: orderB.orderId }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('ORDER_NOT_FOUND')
  })

  it('CONTRACTS.md:129 路径形态 GET /api/billing/orders/<id> 可达且做主体隔离', async () => {
    defaultBookAccessManager.setHostedMode(true)
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-billing-path-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)
    defaultBillingStore.setDatabasePath(join(dataRoot, 'billing.sqlite'))

    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user: userA } = await provider.signUp('pathA@pay.com', 'passA123')
    const { user: userB } = await provider.signUp('pathB@pay.com', 'passB123')
    const { cookie: cookieA } = defaultSessionManager.createSession({ userId: userA.id, email: userA.email })
    const { cookie: cookieB } = defaultSessionManager.createSession({ userId: userB.id, email: userB.email })

    const orderB = defaultBillingStore.createOrder({
      userId: userB.id,
      planId: 'max_monthly',
      channel: 'alipay',
      idempotencyKey: 'path_key_b',
    })

    // 主体 A 用路径形态查主体 B 的订单 → 404 越权拒绝（不是 403 未登记策略）
    const resA = await fetch(`${base}/api/billing/orders/${orderB.orderId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    })
    expect(resA.status).toBe(404)
    const bodyA = (await resA.json()) as { ok: boolean; code: string }
    expect(bodyA.code).toBe('ORDER_NOT_FOUND')

    // 主体 B 查自己的订单 → 200 脱敏状态
    const resB = await fetch(`${base}/api/billing/orders/${orderB.orderId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Cookie: cookieB },
    })
    expect(resB.status).toBe(200)
    const bodyB = (await resB.json()) as { ok: boolean; order: { orderId: string } }
    expect(bodyB.ok).toBe(true)
    expect(bodyB.order.orderId).toBe(orderB.orderId)
  })

  it('微信支付回调：验签器未配置时任意签名一律拒绝 (503，fail-closed)', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-wx-notify-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)
    defaultBillingStore.setDatabasePath(join(dataRoot, 'billing.sqlite'))

    const base = await listen()

    const order = defaultBillingStore.createOrder({
      userId: 'usr_wx_payer',
      planId: 'pro_monthly',
      channel: 'wechat',
      idempotencyKey: 'wx_pay_k1',
    })

    const payloadObj = {
      id: 'EVT_WX_1',
      create_time: new Date().toISOString(),
      resource_type: 'encrypt-resource',
      event_type: 'TRANSACTION.SUCCESS',
      summary: '支付成功',
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        ciphertext: JSON.stringify({ out_trade_no: order.orderId }),
        nonce: '123456789012',
      },
    }

    const nowSec = String(Math.floor(Date.now() / 1000))

    // 行为契约变化（R2）：未配置平台证书/APIv3 密钥时，不再有「非生产放行」分支。
    // 无论签名是历史伪签名还是此前会被放行的「合法形状」签名，都返回 503。
    for (const signature of ['bad_signature_test', 'valid_sign_test_ok', 'anything']) {
      const res = await fetch(`${base}/api/payments/wechat/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'wechatpay-timestamp': nowSec,
          'wechatpay-nonce': 'random_nonce',
          'wechatpay-signature': signature,
        },
        body: JSON.stringify(payloadObj),
      })
      expect(res.status).toBe(503)
      const body = (await res.json()) as { ok: boolean; code: string }
      expect(body.ok).toBe(false)
      expect(body.code).toBe('WECHAT_NOT_CONFIGURED')
    }

    // 未配置即拒绝，订单绝不被入账。
    const updated = defaultBillingStore.getOrder(order.orderId)
    expect(updated?.state).not.toBe('paid')
  })

  it('支付宝异步通知：验签器未配置时任意签名一律拒绝 (503，fail-closed)', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-ali-notify-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)
    defaultBillingStore.setDatabasePath(join(dataRoot, 'billing.sqlite'))

    const base = await listen()

    const order = defaultBillingStore.createOrder({
      userId: 'usr_ali_payer',
      planId: 'max_monthly',
      channel: 'alipay',
      idempotencyKey: 'ali_pay_k1',
    })

    const params = {
      out_trade_no: order.orderId,
      trade_no: '20260918_ali_trade_888',
      total_amount: '39.00',
      trade_status: 'TRADE_SUCCESS',
      notify_time: new Date().toISOString(),
      sign_type: 'RSA2',
    }

    // 行为契约变化（R2）：未配置公钥时任意签名都返回 503，不再有「非生产放行」分支。
    for (const sign of ['bad_signature_ali', 'valid_signature_ali_ok', 'anything']) {
      const res = await fetch(`${base}/api/payments/alipay/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, sign }),
      })
      expect(res.status).toBe(503)
    }

    const updated = defaultBillingStore.getOrder(order.orderId)
    expect(updated?.state).not.toBe('paid')
  })

  it('退款凭据校验：未配置 MOZHOU_OPS_TOKEN 503 fail-closed，令牌不符 401', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-refund-gate-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)
    defaultBillingStore.setDatabasePath(join(dataRoot, 'billing.sqlite'))

    const base = await listen()
    const order = defaultBillingStore.createOrder({
      userId: 'usr_refund_gate',
      planId: 'pro_monthly',
      channel: 'wechat',
      idempotencyKey: 'refund_gate_k1',
    })
    defaultBillingStore.processPaymentNotification({
      event: {
        eventId: 'evt_wx_ref_gate',
        channel: 'wechat',
        orderId: order.orderId,
        eventType: 'TRANSACTION.SUCCESS',
        rawPayload: '{}',
        receivedAt: new Date().toISOString(),
      },
      providerTransactionId: 'wx_tx_ref_gate',
      paidAmountFen: 1900,
      status: 'SUCCESS',
    })

    try {
      // 1. 未配置运营凭据 → 503 fail-closed（即使本地模式带默认主体也不放行）
      const resNoConfig = await fetch(`${base}/api/billing/orders/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.orderId, amountFen: 1900 }),
      })
      expect(resNoConfig.status).toBe(503)
      const noConfigData = (await resNoConfig.json()) as { code: string }
      expect(noConfigData.code).toBe('REFUND_OPS_NOT_CONFIGURED')

      // 2. 已配置但令牌不符 → 401
      process.env['MOZHOU_OPS_TOKEN'] = 'ops_real_token'
      const resWrongToken = await fetch(`${base}/api/billing/orders/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ops_wrong_token' },
        body: JSON.stringify({ orderId: order.orderId, amountFen: 1900 }),
      })
      expect(resWrongToken.status).toBe(401)
      const wrongData = (await resWrongToken.json()) as { code: string }
      expect(wrongData.code).toBe('REFUND_UNAUTHORIZED')

      // 3. 订单状态未被改动
      expect(defaultBillingStore.getOrder(order.orderId)?.state).toBe('paid')
    } finally {
      delete process.env['MOZHOU_OPS_TOKEN']
    }
  })

  it('退款处理：携带运营令牌 POST /api/billing/orders/refund 变更状态为 refunded', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-refund-route-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)
    defaultBillingStore.setDatabasePath(join(dataRoot, 'billing.sqlite'))

    const base = await listen()
    const order = defaultBillingStore.createOrder({
      userId: 'usr_refund_user',
      planId: 'pro_monthly',
      channel: 'wechat',
      idempotencyKey: 'refund_k1',
    })

    defaultBillingStore.processPaymentNotification({
      event: {
        eventId: 'evt_wx_ref',
        channel: 'wechat',
        orderId: order.orderId,
        eventType: 'TRANSACTION.SUCCESS',
        rawPayload: '{}',
        receivedAt: new Date().toISOString(),
      },
      providerTransactionId: 'wx_tx_ref',
      paidAmountFen: 1900,
      status: 'SUCCESS',
    })

    process.env['MOZHOU_OPS_TOKEN'] = 'ops_test_token'
    try {
      const resRefund = await fetch(`${base}/api/billing/orders/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ops_test_token' },
        body: JSON.stringify({
          orderId: order.orderId,
          amountFen: 1900,
        }),
      })
      expect(resRefund.status).toBe(200)
      const data = (await resRefund.json()) as { ok: boolean; order: { state: string } }
      expect(data.ok).toBe(true)
      expect(data.order.state).toBe('refunded')
    } finally {
      delete process.env['MOZHOU_OPS_TOKEN']
    }
  })
})
