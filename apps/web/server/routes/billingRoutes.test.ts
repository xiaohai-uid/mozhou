// @vitest-environment node
/**
 * 订单与支付回调 HTTP 接口测试 (T14 · 真实 HTTP 级端到端测试)。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBillingStore } from '../billing/store.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { defaultSessionManager, InMemoryAuthProvider } from '../auth/session.js'

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

  it('微信支付回调：伪造签名拒绝 (401)，有效签名入账成功 (200 SUCCESS)', async () => {
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
        ciphertext: JSON.stringify({
          mchid: process.env['WECHAT_MCH_ID'] || '',
          appid: process.env['WECHAT_APP_ID'] || '',
          out_trade_no: order.orderId,
          transaction_id: 'tx_wx_12345678',
          trade_type: 'NATIVE',
          trade_state: 'SUCCESS',
          amount: { total: 1900, currency: 'CNY' },
        }),
        nonce: '123456789012',
      },
    }

    const nowSec = String(Math.floor(Date.now() / 1000))

    // 1. 伪造签名 → 401
    const resBad = await fetch(`${base}/api/payments/wechat/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'wechatpay-timestamp': nowSec,
        'wechatpay-nonce': 'random_nonce',
        'wechatpay-signature': 'bad_signature_test',
      },
      body: JSON.stringify(payloadObj),
    })
    expect(resBad.status).toBe(401)

    // 2. 有效回调 → 200 SUCCESS
    const resGood = await fetch(`${base}/api/payments/wechat/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'wechatpay-timestamp': nowSec,
        'wechatpay-nonce': 'random_nonce',
        'wechatpay-signature': 'valid_sign_test_ok',
      },
      body: JSON.stringify(payloadObj),
    })
    expect(resGood.status).toBe(200)
    const resData = (await resGood.json()) as { code: string }
    expect(resData.code).toBe('SUCCESS')

    // 3. 验证订单状态已为 paid
    const updated = defaultBillingStore.getOrder(order.orderId)
    expect(updated?.state).toBe('paid')
  })

  it('支付宝异步通知：伪造签名拒绝 (401)，有效签名入账成功 (200 success)', async () => {
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
      app_id: process.env['ALIPAY_APP_ID'] || '',
      out_trade_no: order.orderId,
      trade_no: '20260918_ali_trade_888',
      total_amount: '39.00',
      trade_status: 'TRADE_SUCCESS',
      notify_time: new Date().toISOString(),
      sign_type: 'RSA2',
    }

    // 1. 伪造签名 → 401
    const resBad = await fetch(`${base}/api/payments/alipay/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, sign: 'bad_signature_ali' }),
    })
    expect(resBad.status).toBe(401)

    // 2. 有效签名 → 200
    const resGood = await fetch(`${base}/api/payments/alipay/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, sign: 'valid_signature_ali_ok' }),
    })
    expect(resGood.status).toBe(200)
    const text = await resGood.text()
    expect(text).toBe('success')

    // 验证状态已为 paid
    const updated = defaultBillingStore.getOrder(order.orderId)
    expect(updated?.state).toBe('paid')
  })

  it('退款处理：POST /api/billing/orders/refund 变更状态为 refunded', async () => {
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

    const resRefund = await fetch(`${base}/api/billing/orders/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.orderId,
        amountFen: 1900,
      }),
    })
    expect(resRefund.status).toBe(200)
    const data = (await resRefund.json()) as { ok: boolean; order: { state: string } }
    expect(data.ok).toBe(true)
    expect(data.order.state).toBe('refunded')
  })
})
