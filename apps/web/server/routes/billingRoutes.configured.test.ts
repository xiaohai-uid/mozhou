// @vitest-environment node
/**
 * 支付回调端到端成功路径测试（R2 修复后）。
 *
 * 原 billingRoutes.test.ts 的「有效签名入账成功」断言依赖「非生产放行 + 明文透传」旁路，
 * 该行为契约已按 R2 移除（未配置一律拒绝）。为保留 HTTP 级成功路径覆盖，本文件用真实配置驱动：
 * - 环境变量注入临时 RSA 公钥与 32 字节 APIv3 密钥（无任何可用凭据字面量，全部运行时生成）；
 * - 构造真实 RSA 签名与真实 AES-256-GCM 密文。
 * 环境变量必须在动态 import 之前设置，使验签器单例读到配置（vi.hoisted 之外的显式顺序）。
 */
import { createCipheriv, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const { publicKeyPem, privateKey } = (() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return { publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey: pair.privateKey }
})()
const WECHAT_API_V3_KEY = randomBytes(16).toString('hex') // 32 字节

const ENV_KEYS = ['WECHAT_MCH_ID', 'WECHAT_APP_ID', 'WECHAT_APIV3_KEY', 'WECHAT_PLATFORM_CERT', 'ALIPAY_APP_ID', 'ALIPAY_PUBLIC_KEY'] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
process.env['WECHAT_MCH_ID'] = 'mch_e2e_test'
process.env['WECHAT_APP_ID'] = 'app_e2e_test'
process.env['WECHAT_APIV3_KEY'] = WECHAT_API_V3_KEY
process.env['WECHAT_PLATFORM_CERT'] = publicKeyPem
process.env['ALIPAY_APP_ID'] = 'app_e2e_test'
process.env['ALIPAY_PUBLIC_KEY'] = publicKeyPem

// 必须在环境变量就绪之后导入，验签器单例才带配置。
const { createMoZhouApiRouter, defaultBillingStore, defaultBookAccessManager } = await import('../api.js')

const nowSec = (): string => String(Math.floor(Date.now() / 1000))

function encryptResource(payload: unknown, nonce: string): string {
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(WECHAT_API_V3_KEY, 'utf8'), Buffer.from(nonce, 'utf8'))
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return Buffer.concat([body, cipher.getAuthTag()]).toString('base64')
}

function signWechat(ts: string, nonce: string, rawBody: string): string {
  return createSign('RSA-SHA256').update(`${ts}\n${nonce}\n${rawBody}\n`).sign(privateKey as KeyObject, 'base64')
}

function buildAlipaySignMessage(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
}

function signAlipay(params: Record<string, string>): string {
  return createSign('RSA-SHA256').update(buildAlipaySignMessage(params), 'utf8').sign(privateKey as KeyObject, 'base64')
}

let servers: ReturnType<typeof createServer>[] = []
let tempDirs: string[] = []

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

function setupStore(): string {
  const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-billing-configured-'))
  tempDirs.push(dataRoot)
  defaultBookAccessManager.setDataRoot(dataRoot)
  defaultBillingStore.setDatabasePath(join(dataRoot, 'billing.sqlite'))
  return dataRoot
}

function listen(): Promise<string> {
  return new Promise((resolveUrl) => {
    const router = createMoZhouApiRouter()
    const server = createServer((req, res) => {
      void router.dispatch(req, res).then((handled) => {
        if (!handled && !res.writableEnded) {
          res.statusCode = 404
          res.end('not found')
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

describe('支付回调 HTTP 成功路径（真实配置 · R2）', () => {
  it('微信：真实签名 + 真实 AES 密文 → 200 SUCCESS 且订单入账', async () => {
    setupStore()
    const base = await listen()
    const order = defaultBillingStore.createOrder({
      userId: 'usr_wx_e2e',
      planId: 'pro_monthly',
      channel: 'wechat',
      idempotencyKey: 'wx_e2e_k1',
    })

    const nonce = randomBytes(6).toString('hex')
    const rawBody = JSON.stringify({
      id: 'EVT_WX_E2E',
      create_time: new Date().toISOString(),
      resource_type: 'encrypt-resource',
      event_type: 'TRANSACTION.SUCCESS',
      summary: '支付成功',
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        ciphertext: encryptResource(
          {
            mchid: 'mch_e2e_test',
            appid: 'app_e2e_test',
            out_trade_no: order.orderId,
            transaction_id: 'tx_wx_e2e_1',
            trade_type: 'NATIVE',
            trade_state: 'SUCCESS',
            amount: { total: 1900, currency: 'CNY' },
          },
          nonce,
        ),
        nonce,
      },
    })
    const ts = nowSec()

    const res = await fetch(`${base}/api/payments/wechat/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'wechatpay-timestamp': ts,
        'wechatpay-nonce': nonce,
        'wechatpay-signature': signWechat(ts, nonce, rawBody),
      },
      body: rawBody,
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { code: string }).code).toBe('SUCCESS')
    expect(defaultBillingStore.getOrder(order.orderId)?.state).toBe('paid')
  })

  it('微信：签名被篡改 → 401（配置齐全时仍拒绝）', async () => {
    setupStore()
    const base = await listen()
    const order = defaultBillingStore.createOrder({
      userId: 'usr_wx_bad',
      planId: 'pro_monthly',
      channel: 'wechat',
      idempotencyKey: 'wx_e2e_bad',
    })
    const nonce = randomBytes(6).toString('hex')
    const rawBody = JSON.stringify({
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        ciphertext: encryptResource({ out_trade_no: order.orderId, amount: { total: 1900, currency: 'CNY' } }, nonce),
        nonce,
      },
    })
    const ts = nowSec()
    const good = signWechat(ts, nonce, rawBody)

    const res = await fetch(`${base}/api/payments/wechat/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'wechatpay-timestamp': ts,
        'wechatpay-nonce': nonce,
        'wechatpay-signature': good.slice(0, -4) + 'AAAA',
      },
      body: rawBody,
    })
    expect(res.status).toBe(401)
    expect(defaultBillingStore.getOrder(order.orderId)?.state).not.toBe('paid')
  })

  it('支付宝：真实签名 → 200 success 且订单入账', async () => {
    setupStore()
    const base = await listen()
    const order = defaultBillingStore.createOrder({
      userId: 'usr_ali_e2e',
      planId: 'max_monthly',
      channel: 'alipay',
      idempotencyKey: 'ali_e2e_k1',
    })

    const params: Record<string, string> = {
      app_id: 'app_e2e_test',
      out_trade_no: order.orderId,
      trade_no: 'trade_ali_e2e_1',
      total_amount: '39.00',
      trade_status: 'TRADE_SUCCESS',
      notify_time: new Date().toISOString(),
      sign_type: 'RSA2',
    }
    const res = await fetch(`${base}/api/payments/alipay/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, sign: signAlipay(params) }),
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('success')
    expect(defaultBillingStore.getOrder(order.orderId)?.state).toBe('paid')
  })

  it('支付宝：签名被篡改 → 401', async () => {
    setupStore()
    const base = await listen()
    const order = defaultBillingStore.createOrder({
      userId: 'usr_ali_bad',
      planId: 'max_monthly',
      channel: 'alipay',
      idempotencyKey: 'ali_e2e_bad',
    })
    const params: Record<string, string> = {
      app_id: 'app_e2e_test',
      out_trade_no: order.orderId,
      trade_no: 'trade_ali_bad_1',
      total_amount: '39.00',
      trade_status: 'TRADE_SUCCESS',
      notify_time: new Date().toISOString(),
      sign_type: 'RSA2',
    }
    const good = signAlipay(params)

    const res = await fetch(`${base}/api/payments/alipay/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, sign: good.slice(0, -4) + 'AAAA' }),
    })
    expect(res.status).toBe(401)
    expect(defaultBillingStore.getOrder(order.orderId)?.state).not.toBe('paid')
  })
})

// 恢复环境变量，避免污染同进程后续文件。
afterEach(() => {
  for (const k of ENV_KEYS) {
    const prev = savedEnv[k]
    if (prev === undefined) delete process.env[k]
    else process.env[k] = prev
  }
})
