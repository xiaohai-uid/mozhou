// @vitest-environment node
/**
 * 待支付订单轮询与 24h 关单退避测试 (T14 · Polling Worker)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BillingStore } from './store.js'
import { pollAndReconcilePendingOrders, type IChannelOrderQuerier } from './pollingWorker.js'

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

describe('OrderPollingWorker 主动查单与关单 (T14)', () => {
  it('回调丢失时通过主动查单恢复为已支付并履约', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-poll-paid-'))
    tempDirs.push(dir)
    const store = new BillingStore()
    store.setDatabasePath(join(dir, 'test-billing.sqlite'))

    const order = store.createOrder({
      userId: 'usr_lost_callback',
      planId: 'pro_monthly',
      channel: 'wechat',
      idempotencyKey: 'lost_cb_1',
    })
    expect(order.state).toBe('created')

    // 模拟渠道查单接口：微信官方返回该订单实际已支付
    const mockQuerier: IChannelOrderQuerier = {
      queryOrder: (ord) =>
        Promise.resolve({
          status: 'paid',
          providerTransactionId: `wx_active_${ord.orderId}`,
          paidAmountFen: 1900,
        }),
    }

    const summary = await pollAndReconcilePendingOrders({
      store,
      querier: mockQuerier,
    })

    expect(summary.resolvedPaidCount).toBe(1)
    expect(summary.closedExpiredCount).toBe(0)

    // 验证订单状态已更新为 paid，权益已发放
    const updated = store.getOrder(order.orderId)
    expect(updated?.state).toBe('paid')
    expect(store.getActiveGrantForUser('usr_lost_callback')).not.toBeNull()

    store.close()
  })

  it('超过 24h 未支付订单自动关单', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-poll-expire-'))
    tempDirs.push(dir)
    const store = new BillingStore()
    store.setDatabasePath(join(dir, 'test-billing.sqlite'))

    const order = store.createOrder({
      userId: 'usr_unpaid_timeout',
      planId: 'pro_monthly',
      channel: 'alipay',
      idempotencyKey: 'unpaid_k1',
    })

    // 模拟 25 小时之后运行轮询器
    const futureTime = Date.now() + 25 * 3600 * 1000

    const summary = await pollAndReconcilePendingOrders({
      store,
      now: futureTime,
    })

    expect(summary.closedExpiredCount).toBe(1)

    const updated = store.getOrder(order.orderId)
    expect(updated?.state).toBe('closed')
    expect(store.getActiveGrantForUser('usr_unpaid_timeout')).toBeNull()

    store.close()
  })
})
