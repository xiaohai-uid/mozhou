// @vitest-environment node
/**
 * 微信支付 APIv3 验签/解密单测（R2 支付回调验签旁路修复）。
 *
 * 修复后的行为契约：
 * - 未配置平台证书 → 一律 503（与 NODE_ENV 无关），不存在测试放行分支；
 * - ciphertext 一律按真实 AES-256-GCM 解密，不存在明文 JSON 透传分支。
 * 因此本文件不使用任何旁路开关：经构造函数注入临时密钥，构造真实 RSA 签名与真实密文。
 */
import { createCipheriv, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { WechatPayVerifier, type WechatDecryptedTransaction } from './wechat.js'
import { RequestBoundaryError } from '../security.js'

// 确定性负路径：清空微信凭据环境变量，早于任何单例/模块加载。
vi.hoisted(() => {
  for (const key of ['WECHAT_MCH_ID', 'WECHAT_APP_ID', 'WECHAT_APIV3_KEY', 'WECHAT_PLATFORM_CERT']) {
    delete process.env[key]
  }
})

function makeKeyPair(): { readonly publicKeyPem: string; readonly privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return { publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey }
}

/** AES-256-GCM 加密（32 字节密钥 / 12 字节 nonce，末 16 字节为 authTag，base64 编码）。 */
function encryptResource(payload: unknown, apiV3Key: string, nonce: string): string {
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(nonce, 'utf8'))
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return Buffer.concat([body, cipher.getAuthTag()]).toString('base64')
}

function signWechat(privateKey: KeyObject, timestamp: string, nonce: string, rawBody: string): string {
  return createSign('RSA-SHA256')
    .update(`${timestamp}\n${nonce}\n${rawBody}\n`)
    .sign(privateKey, 'base64')
}

function expectBoundaryError(fn: () => unknown, status: number, code: string): void {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(RequestBoundaryError)
    expect((err as RequestBoundaryError).status).toBe(status)
    expect((err as RequestBoundaryError).code).toBe(code)
    return
  }
  throw new Error(`expected RequestBoundaryError(${status}, ${code}) but nothing was thrown`)
}

const nowSec = (): string => String(Math.floor(Date.now() / 1000))

function makePayload(outTradeNo: string, overrides: Partial<WechatDecryptedTransaction> = {}) {
  return {
    mchid: 'mch_unit_test',
    appid: 'app_unit_test',
    out_trade_no: outTradeNo,
    transaction_id: 'tx_unit_test_1',
    trade_type: 'NATIVE',
    trade_state: 'SUCCESS',
    amount: { total: 1900, currency: 'CNY' },
    ...overrides,
  }
}

describe('WechatPayVerifier · R2 fail-closed', () => {
  it('未配置平台证书：即使 NODE_ENV 非 production，也返回 503（不再有非生产放行）', () => {
    const verifier = new WechatPayVerifier({ mchId: 'm', appId: 'a', apiV3Key: 'k'.repeat(32) })
    expect(verifier.isConfigured()).toBe(false)

    const original = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'development'
    try {
      // 任意签名（含此前会被放行的“合法形状”签名）都必须在验签前被拒。
      for (const signature of ['anything', 'valid_sign_test_ok', 'bad_signature']) {
        expectBoundaryError(
          () =>
            verifier.verifyAndParseNotification(
              { 'wechatpay-timestamp': nowSec(), 'wechatpay-nonce': 'n', 'wechatpay-signature': signature },
              '{}',
            ),
          503,
          'WECHAT_CERT_MISSING',
        )
      }
    } finally {
      if (original === undefined) delete process.env['NODE_ENV']
      else process.env['NODE_ENV'] = original
    }
  })

  it('配置齐全时接受真实 RSA 签名与真实 AES-256-GCM 密文', () => {
    const { publicKeyPem, privateKey } = makeKeyPair()
    const apiV3Key = randomBytes(16).toString('hex') // 32 字节
    const nonce = randomBytes(6).toString('hex') // 12 字节
    const verifier = new WechatPayVerifier({
      mchId: 'mch_unit_test',
      appId: 'app_unit_test',
      apiV3Key,
      platformCert: publicKeyPem,
    })
    expect(verifier.isConfigured()).toBe(true)

    const rawBody = JSON.stringify({
      id: 'EVT_UNIT',
      create_time: new Date().toISOString(),
      resource_type: 'encrypt-resource',
      event_type: 'TRANSACTION.SUCCESS',
      summary: 'ok',
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        ciphertext: encryptResource(makePayload('order_unit_1'), apiV3Key, nonce),
        nonce,
      },
    })
    const ts = nowSec()

    const tx = verifier.verifyAndParseNotification(
      {
        'wechatpay-timestamp': ts,
        'wechatpay-nonce': nonce,
        'wechatpay-signature': signWechat(privateKey, ts, nonce, rawBody),
      },
      rawBody,
    )
    expect(tx.out_trade_no).toBe('order_unit_1')
    expect(tx.amount.total).toBe(1900)
  })

  it('签名被篡改 → 401 INVALID_SIGNATURE', () => {
    const { publicKeyPem, privateKey } = makeKeyPair()
    const apiV3Key = randomBytes(16).toString('hex')
    const nonce = randomBytes(6).toString('hex')
    const verifier = new WechatPayVerifier({ mchId: 'm', appId: 'a', apiV3Key, platformCert: publicKeyPem })

    const rawBody = JSON.stringify({ resource: { algorithm: 'AEAD_AES_256_GCM', ciphertext: 'x', nonce } })
    const ts = nowSec()
    const good = signWechat(privateKey, ts, nonce, rawBody)

    expectBoundaryError(
      () =>
        verifier.verifyAndParseNotification(
          { 'wechatpay-timestamp': ts, 'wechatpay-nonce': nonce, 'wechatpay-signature': good.slice(0, -4) + 'AAAA' },
          rawBody,
        ),
      401,
      'INVALID_SIGNATURE',
    )
  })

  it('明文 JSON ciphertext（以 { 开头）→ 400 DECRYPT_FAILED（明文透传分支已删除）', () => {
    const { publicKeyPem, privateKey } = makeKeyPair()
    const apiV3Key = randomBytes(16).toString('hex')
    const nonce = randomBytes(6).toString('hex')
    const verifier = new WechatPayVerifier({ mchId: 'm', appId: 'a', apiV3Key, platformCert: publicKeyPem })

    const rawBody = JSON.stringify({
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        ciphertext: JSON.stringify(makePayload('order_plaintext')),
        nonce,
      },
    })
    const ts = nowSec()

    expectBoundaryError(
      () =>
        verifier.verifyAndParseNotification(
          {
            'wechatpay-timestamp': ts,
            'wechatpay-nonce': nonce,
            'wechatpay-signature': signWechat(privateKey, ts, nonce, rawBody),
          },
          rawBody,
        ),
      400,
      'DECRYPT_FAILED',
    )
  })

  it('密文短于 16 字节标签 → 400 DECRYPT_FAILED（不做截断放行）', () => {
    const { publicKeyPem, privateKey } = makeKeyPair()
    const apiV3Key = randomBytes(16).toString('hex')
    const nonce = randomBytes(6).toString('hex')
    const verifier = new WechatPayVerifier({ mchId: 'm', appId: 'a', apiV3Key, platformCert: publicKeyPem })

    // 12 字符 base64 = 9 字节，连一个完整 GCM 标签都放不下。
    const shortCiphertext = Buffer.alloc(9, 7).toString('base64')
    const rawBody = JSON.stringify({ resource: { algorithm: 'AEAD_AES_256_GCM', ciphertext: shortCiphertext, nonce } })
    const ts = nowSec()

    expectBoundaryError(
      () =>
        verifier.verifyAndParseNotification(
          {
            'wechatpay-timestamp': ts,
            'wechatpay-nonce': nonce,
            'wechatpay-signature': signWechat(privateKey, ts, nonce, rawBody),
          },
          rawBody,
        ),
      400,
      'DECRYPT_FAILED',
    )
  })

  it('有平台证书但缺 APIv3 密钥 → 503 APIV3_KEY_MISSING', () => {
    const { publicKeyPem, privateKey } = makeKeyPair()
    const verifier = new WechatPayVerifier({ mchId: 'm', appId: 'a', platformCert: publicKeyPem })
    const nonce = randomBytes(6).toString('hex')
    const rawBody = JSON.stringify({ resource: { algorithm: 'AEAD_AES_256_GCM', ciphertext: 'AAAA', nonce } })
    const ts = nowSec()

    expectBoundaryError(
      () =>
        verifier.verifyAndParseNotification(
          {
            'wechatpay-timestamp': ts,
            'wechatpay-nonce': nonce,
            'wechatpay-signature': signWechat(privateKey, ts, nonce, rawBody),
          },
          rawBody,
        ),
      503,
      'APIV3_KEY_MISSING',
    )
  })

  it('mchid / 币种不匹配 → 400 拒绝', () => {
    const { publicKeyPem, privateKey } = makeKeyPair()
    const apiV3Key = randomBytes(16).toString('hex')
    const nonce = randomBytes(6).toString('hex')
    const verifier = new WechatPayVerifier({ mchId: 'mch_expected', appId: 'app_unit_test', apiV3Key, platformCert: publicKeyPem })

    const build = (payload: unknown): { headers: Record<string, string>; rawBody: string } => {
      const rawBody = JSON.stringify({ resource: { algorithm: 'AEAD_AES_256_GCM', ciphertext: encryptResource(payload, apiV3Key, nonce), nonce } })
      const ts = nowSec()
      return {
        headers: { 'wechatpay-timestamp': ts, 'wechatpay-nonce': nonce, 'wechatpay-signature': signWechat(privateKey, ts, nonce, rawBody) },
        rawBody,
      }
    }

    const wrongMch = build(makePayload('o1', { mchid: 'mch_other' }))
    expectBoundaryError(() => verifier.verifyAndParseNotification(wrongMch.headers, wrongMch.rawBody), 400, 'MCHID_MISMATCH')

    const wrongCurrency = build(makePayload('o2', { mchid: 'mch_expected', amount: { total: 1900, currency: 'USD' } }))
    expectBoundaryError(
      () => verifier.verifyAndParseNotification(wrongCurrency.headers, wrongCurrency.rawBody),
      400,
      'CURRENCY_MISMATCH',
    )
  })
})
