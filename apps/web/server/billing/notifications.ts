/**
 * apps/web/server/billing · 统一支付通知分发与事务处理 (Notifications Handler · T14)。
 * 协调微信与支付宝通知验签，并在 BillingStore 单事务中原子完成记账与履约。
 */
import { defaultBillingStore } from './store.js'
import { defaultWechatPayVerifier } from './wechat.js'
import { defaultAlipayVerifier } from './alipay.js'
import type { OrderSnapshot, PaymentEventRecord } from './contracts.js'
import { randomBytes } from 'node:crypto'

export interface ProcessNotificationResult {
  readonly success: boolean
  readonly channel: 'wechat' | 'alipay'
  readonly orderId: string
  readonly alreadyProcessed: boolean
  readonly order?: OrderSnapshot | undefined
  readonly error?: string | undefined
}

export class PaymentNotificationDispatcher {
  /**
   * 处理微信支付通知
   */
  processWechatNotification(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): ProcessNotificationResult {
    try {
      const tx = defaultWechatPayVerifier.verifyAndParseNotification(headers, rawBody)
      const event: PaymentEventRecord = {
        eventId: 'evt_wx_' + tx.transaction_id,
        channel: 'wechat',
        orderId: tx.out_trade_no,
        eventType: 'TRANSACTION.SUCCESS',
        rawPayload: rawBody,
        receivedAt: new Date().toISOString(),
      }

      const status = tx.trade_state === 'SUCCESS' ? 'SUCCESS' : 'CLOSED'
      const outcome = defaultBillingStore.processPaymentNotification({
        event,
        providerTransactionId: tx.transaction_id,
        paidAmountFen: tx.amount.total,
        status,
      })

      return {
        success: true,
        channel: 'wechat',
        orderId: tx.out_trade_no,
        alreadyProcessed: outcome.alreadyProcessed,
        order: outcome.order,
      }
    } catch (err) {
      return {
        success: false,
        channel: 'wechat',
        orderId: '',
        alreadyProcessed: false,
        error: (err as Error).message,
      }
    }
  }

  /**
   * 处理支付宝异步通知
   */
  processAlipayNotification(params: Record<string, string>, rawPayloadText?: string): ProcessNotificationResult {
    try {
      const tx = defaultAlipayVerifier.verifyAndParseNotification(params)
      const event: PaymentEventRecord = {
        eventId: 'evt_ali_' + (params['notify_id'] || randomBytes(8).toString('hex')),
        channel: 'alipay',
        orderId: tx.outTradeNo,
        eventType: 'TRADE_STATUS_SYNC',
        rawPayload: rawPayloadText ?? JSON.stringify(params),
        receivedAt: tx.notifyTime,
      }

      const isSuccess = tx.tradeStatus === 'TRADE_SUCCESS' || tx.tradeStatus === 'TRADE_FINISHED'
      const status = isSuccess ? 'SUCCESS' : 'CLOSED'

      const outcome = defaultBillingStore.processPaymentNotification({
        event,
        providerTransactionId: tx.tradeNo,
        paidAmountFen: tx.totalAmountFen,
        status,
      })

      return {
        success: true,
        channel: 'alipay',
        orderId: tx.outTradeNo,
        alreadyProcessed: outcome.alreadyProcessed,
        order: outcome.order,
      }
    } catch (err) {
      return {
        success: false,
        channel: 'alipay',
        orderId: '',
        alreadyProcessed: false,
        error: (err as Error).message,
      }
    }
  }
}

export const defaultNotificationDispatcher = new PaymentNotificationDispatcher()
