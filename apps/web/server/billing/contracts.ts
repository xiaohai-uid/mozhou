/**
 * apps/web/server/billing · 支付、订单与履约契约定义 (Contracts · C4 · T14/T15)。
 * 
 * 依照 reference/CONTRACTS.md C4 规范：
 * - 计划：pro_monthly (1900分) / max_monthly (3900分)；
 * - 渠道：wechat (微信 Native) / alipay (支付宝当面付/电脑支付)；
 * - 订单状态：created | pending | paid | closed | refund_pending | refunded；
 * - 金额与货币：固定 CNY，以人民币“分”计量，严禁浮点数运算。
 */

export type PlanId = 'pro_monthly' | 'max_monthly'
export type PayChannel = 'wechat' | 'alipay'
export type OrderState = 'created' | 'pending' | 'paid' | 'closed' | 'refund_pending' | 'refunded'

export interface Money {
  readonly currency: 'CNY'
  readonly amountFen: 1900 | 3900
}

export interface OrderSnapshot {
  readonly orderId: string
  readonly userId: string
  readonly planId: PlanId
  readonly channel: PayChannel
  readonly idempotencyKey: string
  readonly priceVersion: string
  readonly amountFen: number
  readonly currency: 'CNY'
  readonly state: OrderState
  readonly providerTransactionId?: string | null | undefined
  readonly checkoutUrl?: string | null | undefined
  readonly periodStart: string
  readonly periodEnd: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PaymentEventRecord {
  readonly eventId: string
  readonly channel: PayChannel
  readonly orderId: string
  readonly eventType: string
  readonly rawPayload: string
  readonly receivedAt: string
}

export interface EntitlementGrant {
  readonly grantId: string
  readonly orderId: string
  readonly userId: string
  readonly planId: PlanId
  readonly periodStart: string
  readonly periodEnd: string
  readonly grantedAt: string
}
