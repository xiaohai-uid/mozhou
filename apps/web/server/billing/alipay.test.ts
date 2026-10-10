// @vitest-environment node
/**
 * 支付宝 RSA2 验签单测（R2 支付回调验签旁路修复）。
 *
 * 修复后的行为契约：未配置公钥 → 一律 503（与 NODE_ENV 无关），不存在测试放行分支。
 * 本文件不使用旁路开关：经构造函数注入临时公钥，构造真实 RSA2 签名。
 */
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AlipayVerifier } from './alipay.js'
import { RequestBoundaryError } from '../security.js'

vi.hoisted(() => {
  for (const key of ['ALIPAY_APP_ID', 'ALIPAY_PUBLIC_KEY']) {
    delete process.env[key]
  }
})

function makeKeyPair(): { readonly publicKeyPem: string; readonly privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return { publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey }
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

const baseParams = (): Record<string, string> => ({
  app_id: 'app_unit_test',
  out_trade_no: 'order_ali_1',
  trade_no: 'trade_ali_1',
  total_amount: '39.00',
  trade_status: 'TRADE_SUCCESS',
  notify_time: new Date().toISOString(),
  sign_type: 'RSA2',
})

describe('AlipayVerifier · R2 fail-closed', () => {
  it('未配置公钥：即使 NODE_ENV 非 production，也返回 503（不再有非生产放行）', () => {
    const verifier = new AlipayVerifier({ appId: 'app_unit_test' })
    expect(verifier.isConfigured()).toBe(false)

    const original = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'development'
    try {
      for (const sign of ['anything', 'valid_signature_ali_ok', 'bad_signature']) {
        expectBoundaryError(() => verifier.verifyAndParseNotification({ ...baseParams(), sign }), 503, 'ALIPAY_KEY_MISSING')
      }
    } finally {
      if (original === undefined) delete process.env['NODE_ENV']
      else process.env['NODE_ENV'] = original
    }
  })

  it('配置齐全时接受真实 RSA2 签名', () => {
    const { publicKeyPem, privateKey } = makeKeyPair()
    const verifier = new AlipayVerifier({ appId: 'app_unit_test', alipayPublicKey: publicKeyPem })
    expect(verifier.isConfigured()).toBe(true)

    const params = baseParams()
    const sign = createSign('RSA-SHA256').update(verifier.buildSignMessage(params), 'utf8').sign(privateKey, 'base64')

    const tx = verifier.verifyAndParseNotification({ ...params, sign })
    expect(tx.outTradeNo).toBe('order_ali_1')
    expect(tx.totalAmountFen).toBe(3900)
    expect(tx.tradeStatus).toBe('TRADE_SUCCESS')
  })

  it('签名被篡改 → 401 INVALID_SIGNATURE', () => {
    const { publicKeyPem, privateKey } = makeKeyPair()
    const verifier = new AlipayVerifier({ appId: 'app_unit_test', alipayPublicKey: publicKeyPem })
    const params = baseParams()
    const good = createSign('RSA-SHA256').update(verifier.buildSignMessage(params), 'utf8').sign(privateKey, 'base64')

    expectBoundaryError(
      () => verifier.verifyAndParseNotification({ ...params, sign: good.slice(0, -4) + 'AAAA' }),
      401,
      'INVALID_SIGNATURE',
    )
  })

  it('app_id 不匹配 → 400 APPID_MISMATCH', () => {
    const { publicKeyPem, privateKey } = makeKeyPair()
    const verifier = new AlipayVerifier({ appId: 'app_expected', alipayPublicKey: publicKeyPem })
    const params = baseParams()
    const sign = createSign('RSA-SHA256').update(verifier.buildSignMessage(params), 'utf8').sign(privateKey, 'base64')

    expectBoundaryError(() => verifier.verifyAndParseNotification({ ...params, sign }), 400, 'APPID_MISMATCH')
  })
})
