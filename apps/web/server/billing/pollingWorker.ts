/**
 * apps/web/server/billing · 待支付订单主动查单与 24h 关单退避轮询器 (Order Polling Worker · T14)。
 * 
 * 依照 reference/03-public-billing.md T14 规格：
 * - 回调丢失通过有界主动查单恢复；
 * - pending 订单间隔退避（指数退避，最多 24h）；
 * - 超过 24h 自动关单或交人工处理；
 * - 不以浏览器 return_url 或“我已支付”按钮为准，必须与渠道权威查单接口或通知比对。
 */
import { BillingStore, defaultBillingStore } from './store.js'
import type { OrderSnapshot } from './contracts.js'

export interface ChannelOrderQueryResult {
  readonly status: 'paid' | 'closed' | 'pending'
  readonly providerTransactionId?: string | undefined
  readonly paidAmountFen?: number | undefined
}

export interface IChannelOrderQuerier {
  queryOrder(order: OrderSnapshot): Promise<ChannelOrderQueryResult>
}

export interface PollingSummary {
  readonly checkedCount: number
  readonly resolvedPaidCount: number
  readonly closedExpiredCount: number
  readonly stillPendingCount: number
}

export const MAX_PENDING_AGE_MS = 24 * 3600 * 1000 // 24 小时最大存活期

// 计划退避间隔阶梯（1m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, 24h）
export const BACKOFF_STEPS_MS = [
  60_000,
  300_000,
  900_000,
  1_800_000,
  3_600_000,
  7_200_000,
  14_400_000,
  28_800_000,
  43_200_000,
  86_400_000,
]

export async function pollAndReconcilePendingOrders(options: {
  readonly store?: BillingStore | undefined
  readonly querier?: IChannelOrderQuerier | undefined
  readonly now?: number | undefined
  readonly maxAgeMs?: number | undefined
} = {}): Promise<PollingSummary> {
  const store = options.store ?? defaultBillingStore
  const now = options.now ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? MAX_PENDING_AGE_MS

  // 1. 先关闭超过 24h 的过期未支付订单
  const expired = store.closeExpiredOrders(maxAgeMs, now)
  const closedExpiredCount = expired.length

  // 2. 检查处于退避重试范围内的 pending 订单
  const pending = store.listPendingOrders(undefined, now)
  let resolvedPaidCount = 0
  let stillPendingCount = 0

  for (const order of pending) {
    if (!options.querier) {
      stillPendingCount += 1
      continue
    }

    try {
      const channelResult = await options.querier.queryOrder(order)
      if (channelResult.status === 'paid') {
        store.processPaymentNotification({
          event: {
            eventId: `evt_poll_${order.orderId}_${now}`,
            channel: order.channel,
            orderId: order.orderId,
            eventType: 'ACTIVE_QUERY_RESOLVED',
            rawPayload: JSON.stringify(channelResult),
            receivedAt: new Date(now).toISOString(),
          },
          providerTransactionId: channelResult.providerTransactionId ?? `tx_poll_${order.orderId}`,
          paidAmountFen: channelResult.paidAmountFen ?? order.amountFen,
          status: 'SUCCESS',
        })
        resolvedPaidCount += 1
      } else if (channelResult.status === 'closed') {
        store.processPaymentNotification({
          event: {
            eventId: `evt_poll_close_${order.orderId}_${now}`,
            channel: order.channel,
            orderId: order.orderId,
            eventType: 'ACTIVE_QUERY_CLOSED',
            rawPayload: JSON.stringify(channelResult),
            receivedAt: new Date(now).toISOString(),
          },
          providerTransactionId: channelResult.providerTransactionId ?? 'closed',
          paidAmountFen: order.amountFen,
          status: 'CLOSED',
        })
      } else {
        stillPendingCount += 1
      }
    } catch {
      stillPendingCount += 1
    }
  }

  return {
    checkedCount: pending.length + closedExpiredCount,
    resolvedPaidCount,
    closedExpiredCount,
    stillPendingCount,
  }
}
