// @vitest-environment node
/**
 * 订单库与事务履约单测 (T14 · BillingStore)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BillingStore } from './store.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  tempDirs.length = 0
})

describe('BillingStore 订单与事务履约 (T14)', () => {
  it('创建订单：金额来自 catalog，同用户同 key 幂等返回，不同参数 409 拒绝', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-billing-store-'))
    tempDirs.push(dir)
    const store = new BillingStore()
    store.setDatabasePath(join(dir, 'test-billing.sqlite'))

    // 1. 正常创建 Pro 订单（1900分）
    const order1 = store.createOrder({
      userId: 'usr_alice',
      planId: 'pro_monthly',
      channel: 'wechat',
      idempotencyKey: 'idem_key_1',
    })
    expect(order1.amountFen).toBe(1900)
    expect(order1.state).toBe('created')
    expect(order1.currency).toBe('CNY')

    // 2. 同用户同 idempotencyKey 重复请求：返回相同订单
    const order1Dup = store.createOrder({
      userId: 'usr_alice',
      planId: 'pro_monthly',
      channel: 'wechat',
      idempotencyKey: 'idem_key_1',
    })
    expect(order1Dup.orderId).toBe(order1.orderId)

    // 3. 同用户同 key 但参数不同（改变为 max_monthly）：409 拒绝
    expect(() => {
      store.createOrder({
        userId: 'usr_alice',
        planId: 'max_monthly',
        channel: 'wechat',
        idempotencyKey: 'idem_key_1',
      })
    }).toThrow(/IDEMPOTENCY_CONFLICT/)

    store.close()
  })

  it('单事务入账与履约：并发重复通知幂等处理，grants_once_per_order 守卫唯一权益', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-billing-fulfill-'))
    tempDirs.push(dir)
    const store = new BillingStore()
    store.setDatabasePath(join(dir, 'test-billing.sqlite'))

    const order = store.createOrder({
      userId: 'usr_bob',
      planId: 'pro_monthly',
      channel: 'wechat',
      idempotencyKey: 'bob_key_1',
    })

    const event = {
      eventId: 'wx_evt_1001',
      channel: 'wechat' as const,
      orderId: order.orderId,
      eventType: 'TRANSACTION.SUCCESS',
      rawPayload: '{"mock":1}',
      receivedAt: new Date().toISOString(),
    }

    // 首次通知入账
    const outcome1 = store.processPaymentNotification({
      event,
      providerTransactionId: 'wx_tx_99999',
      paidAmountFen: 1900,
      status: 'SUCCESS',
    })
    expect(outcome1.handled).toBe(true)
    expect(outcome1.alreadyProcessed).toBe(false)
    expect(outcome1.order.state).toBe('paid')

    // 验证用户已获得有效权益
    const grant = store.getActiveGrantForUser('usr_bob')
    expect(grant).not.toBeNull()
    expect(grant?.orderId).toBe(order.orderId)
    expect(grant?.planId).toBe('pro_monthly')

    // 20 次并发重复通知模拟
    for (let i = 0; i < 20; i += 1) {
      const dup = store.processPaymentNotification({
        event,
        providerTransactionId: 'wx_tx_99999',
        paidAmountFen: 1900,
        status: 'SUCCESS',
      })
      expect(dup.handled).toBe(true)
      expect(dup.alreadyProcessed).toBe(true)
    }

    store.close()
  })

  it('金额不匹配时拦截入账 (防付小发大)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-billing-mismatch-'))
    tempDirs.push(dir)
    const store = new BillingStore()
    store.setDatabasePath(join(dir, 'test-billing.sqlite'))

    const order = store.createOrder({
      userId: 'usr_charlie',
      planId: 'max_monthly', // 3900 分
      channel: 'alipay',
      idempotencyKey: 'charlie_key_1',
    })

    const event = {
      eventId: 'ali_evt_2001',
      channel: 'alipay' as const,
      orderId: order.orderId,
      eventType: 'TRADE_SUCCESS',
      rawPayload: '{"mock":2}',
      receivedAt: new Date().toISOString(),
    }

    // 支付通知金额仅 1 分，与应付 3900 分不符
    expect(() => {
      store.processPaymentNotification({
        event,
        providerTransactionId: 'ali_tx_123',
        paidAmountFen: 1,
        status: 'SUCCESS',
      })
    }).toThrow(/AMOUNT_MISMATCH/)

    store.close()
  })

  it('退款撤销权益并变更状态为 refunded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-billing-refund-'))
    tempDirs.push(dir)
    const store = new BillingStore()
    store.setDatabasePath(join(dir, 'test-billing.sqlite'))

    const order = store.createOrder({
      userId: 'usr_david',
      planId: 'pro_monthly',
      channel: 'wechat',
      idempotencyKey: 'david_key_1',
    })

    store.processPaymentNotification({
      event: {
        eventId: 'wx_evt_david',
        channel: 'wechat',
        orderId: order.orderId,
        eventType: 'TRANSACTION.SUCCESS',
        rawPayload: '{}',
        receivedAt: new Date().toISOString(),
      },
      providerTransactionId: 'wx_tx_david',
      paidAmountFen: 1900,
      status: 'SUCCESS',
    })

    expect(store.getActiveGrantForUser('usr_david')).not.toBeNull()

    // 退款
    const refunded = store.refundOrder(order.orderId, 1900)
    expect(refunded.state).toBe('refunded')
    // 权益已撤销
    expect(store.getActiveGrantForUser('usr_david')).toBeNull()

    store.close()
  })
})
