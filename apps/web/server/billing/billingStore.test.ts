// @vitest-environment node
/**
 * 订单库与事务履约单测 (T14 · BillingStore)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlanId } from './contracts.js'
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

  it('单事务入账与履约：并发重复通知幂等处理，grants_once_per_order 唯一性门', () => {
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

  it('运营手动授予：直接发放权益，manual_ 前缀订单号，非法套餐与非法天数拒绝', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-billing-manual-grant-'))
    tempDirs.push(dir)
    const store = new BillingStore()
    store.setDatabasePath(join(dir, 'test-billing.sqlite'))

    // 1. 正常手动授予 Max 权益
    const grant = store.grantManualEntitlement({ userId: 'usr_ops_test', planId: 'max_monthly' })
    expect(grant.planId).toBe('max_monthly')
    expect(grant.orderId.startsWith('manual_')).toBe(true)
    expect(grant.periodEnd > grant.periodStart).toBe(true)

    // 2. 权益可被权益判定面读到
    const active = store.getActiveGrantForUser('usr_ops_test')
    expect(active?.grantId).toBe(grant.grantId)

    // 3. 自定义天数：90 天授权的周期更远，成为当前有效权益
    const grant90 = store.grantManualEntitlement({ userId: 'usr_ops_test', planId: 'pro_monthly', durationDays: 90 })
    expect(store.getActiveGrantForUser('usr_ops_test')?.periodEnd).toBe(grant90.periodEnd)

    // 4. 非法套餐拒绝（与支付下单同口径，运行时可绕过类型系统传入任意串）
    expect(() => {
      store.grantManualEntitlement({ userId: 'usr_ops_test', planId: 'free_forever' as PlanId })
    }).toThrow(/INVALID_PLAN/)

    // 5. 非法天数拒绝
    expect(() => {
      store.grantManualEntitlement({ userId: 'usr_ops_test', planId: 'pro_monthly', durationDays: 0 })
    }).toThrow(/INVALID_DURATION/)

    // 6. 空 userId 拒绝
    expect(() => {
      store.grantManualEntitlement({ userId: '  ', planId: 'pro_monthly' })
    }).toThrow(/INVALID_USER/)

    store.close()
  })
})
