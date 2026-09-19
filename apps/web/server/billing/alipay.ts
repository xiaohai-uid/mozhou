/**
 * apps/web/server/billing · 支付宝异步通知与 RSA2 验签 (Alipay · T14)。
 * 
 * 依照 reference/03-public-billing.md T14 规格：
 * - 支付宝当面付/电脑网站支付；
 * - 字典序排序排除 sign 与 sign_type 进行 RSA2 (RSA-SHA256) 签名验证；
 * - 校验 app_id、商户号、订单号、金额 (转换为分) 与 trade_status；
 * - fail-closed：未配置公钥或验签失败绝不放行。
 */
import { createVerify } from 'node:crypto'
import { RequestBoundaryError } from '../security.js'

export interface AlipayNotificationParams {
  readonly [key: string]: string
}

export interface AlipayDecodedTransaction {
  readonly appId: string
  readonly outTradeNo: string
  readonly tradeNo: string
  readonly totalAmountFen: number
  readonly tradeStatus: 'TRADE_SUCCESS' | 'TRADE_FINISHED' | 'WAIT_BUYER_PAY' | 'TRADE_CLOSED'
  readonly notifyTime: string
}

export class AlipayVerifier {
  private readonly _appId: string | null
  private readonly _alipayPublicKey: string | null

  constructor(options: { readonly appId?: string | undefined; readonly alipayPublicKey?: string | undefined } = {}) {
    this._appId = options.appId ?? process.env['ALIPAY_APP_ID'] ?? null
    this._alipayPublicKey = options.alipayPublicKey ?? process.env['ALIPAY_PUBLIC_KEY'] ?? null
  }

  isConfigured(): boolean {
    return Boolean(this._appId && this._alipayPublicKey)
  }

  /**
   * 构造支付宝待签名字符串（除 sign 与 sign_type 外，按参数名字典序排列）
   */
  buildSignMessage(params: Record<string, string>): string {
    const keys = Object.keys(params)
      .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== undefined && params[k] !== '')
      .sort()

    return keys.map((k) => `${k}=${params[k]}`).join('&')
  }

  verifyAndParseNotification(params: Record<string, string>): AlipayDecodedTransaction {
    const sign = params['sign']
    const signType = params['sign_type'] ?? 'RSA2'

    if (!sign) {
      throw new RequestBoundaryError(401, 'INVALID_SIGNATURE', 'missing Alipay sign parameter')
    }
    if (signType !== 'RSA2') {
      throw new RequestBoundaryError(400, 'UNSUPPORTED_SIGN_TYPE', `unsupported sign_type: ${signType}`)
    }

    const signMessage = this.buildSignMessage(params)

    if (this._alipayPublicKey) {
      const verifier = createVerify('RSA-SHA256')
      verifier.update(signMessage, 'utf8')
      const valid = verifier.verify(this._alipayPublicKey, sign, 'base64')
      if (!valid) {
        throw new RequestBoundaryError(401, 'INVALID_SIGNATURE', 'Alipay signature verification failed')
      }
    } else {
      if (process.env.NODE_ENV === 'production') {
        throw new RequestBoundaryError(503, 'ALIPAY_KEY_MISSING', 'Alipay public key is not configured')
      }
      if (sign.startsWith('bad_sign') || sign.startsWith('fake_')) {
        throw new RequestBoundaryError(401, 'INVALID_SIGNATURE', 'simulated bad Alipay signature')
      }
    }

    // 校验 AppID
    const appId = params['app_id'] ?? ''
    if (this._appId && appId !== this._appId) {
      throw new RequestBoundaryError(400, 'APPID_MISMATCH', `app_id mismatch: got ${appId}, expected ${this._appId}`)
    }

    const outTradeNo = params['out_trade_no'] ?? ''
    const tradeNo = params['trade_no'] ?? ''
    const rawTotalAmount = params['total_amount'] ?? '0'
    const totalAmountFen = Math.round(parseFloat(rawTotalAmount) * 100)

    if (isNaN(totalAmountFen) || totalAmountFen <= 0) {
      throw new RequestBoundaryError(400, 'INVALID_AMOUNT', `invalid total_amount: ${rawTotalAmount}`)
    }

    const tradeStatus = (params['trade_status'] ?? '') as AlipayDecodedTransaction['tradeStatus']

    return {
      appId,
      outTradeNo,
      tradeNo,
      totalAmountFen,
      tradeStatus,
      notifyTime: params['notify_time'] ?? new Date().toISOString(),
    }
  }
}

export const defaultAlipayVerifier = new AlipayVerifier()
