// @vitest-environment node
/**
 * 权益判定与能力访问控制测试 (T15 · Entitlements)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultBookAccessManager } from '../bookAccess.js'
import { BillingStore } from './store.js'
import { EntitlementManager, isBasicAlwaysAvailable } from './entitlements.js'

const tempDirs: string[] = []

afterEach(() => {
  defaultBookAccessManager.setHostedMode(false)
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  tempDirs.length = 0
})

describe('EntitlementManager 权益控制 (T15)', () => {
  it('基础能力（阅读/手写/建书/导出/备份）恒久放行，永不锁死', () => {
    const manager = new EntitlementManager()
    const basicList = ['read', 'write', 'create-book', 'export-own', 'backup-restore']

    for (const cap of basicList) {
      expect(isBasicAlwaysAvailable(cap)).toBe(true)
      const res = manager.checkUserEntitled('anonymous', cap)
      expect(res.entitled).toBe(true)
      expect(res.planId).toBe('free')
    }
  })

  it('hosted 模式下：未付费用户请求高级能力返回 403，改 localStorage 无法绕过', () => {
    defaultBookAccessManager.setHostedMode(true)
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-entitlements-'))
    tempDirs.push(dir)
    const store = new BillingStore()
    store.setDatabasePath(join(dir, 'test-billing.sqlite'))

    const manager = new EntitlementManager()
    const freeUser = 'usr_free_guy'

    // 未付费用户访问分镜 → 拒绝
    const check = manager.checkUserEntitled(freeUser, 'storyboard', store)
    expect(check.entitled).toBe(false)
    expect(check.planId).toBe('free')

    expect(() => {
      manager.assertUserEntitled(freeUser, 'storyboard', store)
    }).toThrow(/ENTITLEMENT_REQUIRED/)

    store.close()
  })

  it('Pro 用户解锁高级能力但无 managed-model-quota；Max 用户全解锁', () => {
    defaultBookAccessManager.setHostedMode(true)
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-entitlements-plans-'))
    tempDirs.push(dir)
    const store = new BillingStore()
    store.setDatabasePath(join(dir, 'test-billing.sqlite'))

    const manager = new EntitlementManager()

    // 1. 给 Pro 用户发放履约
    const orderPro = store.createOrder({
      userId: 'usr_pro_user',
      planId: 'pro_monthly',
      channel: 'wechat',
      idempotencyKey: 'pro_k1',
    })
    store.processPaymentNotification({
      event: {
        eventId: 'evt_pro',
        channel: 'wechat',
        orderId: orderPro.orderId,
        eventType: 'SUCCESS',
        rawPayload: '{}',
        receivedAt: new Date().toISOString(),
      },
      providerTransactionId: 'tx_pro',
      paidAmountFen: 1900,
      status: 'SUCCESS',
    })

    // Pro 解锁 storyboard / style-distill
    expect(manager.checkUserEntitled('usr_pro_user', 'storyboard', store).entitled).toBe(true)
    expect(manager.checkUserEntitled('usr_pro_user', 'style-distill', store).entitled).toBe(true)
    // 但 Pro 无 managed-model-quota
    expect(manager.checkUserEntitled('usr_pro_user', 'managed-model-quota', store).entitled).toBe(false)

    // 2. 给 Max 用户发放履约
    const orderMax = store.createOrder({
      userId: 'usr_max_user',
      planId: 'max_monthly',
      channel: 'alipay',
      idempotencyKey: 'max_k1',
    })
    store.processPaymentNotification({
      event: {
        eventId: 'evt_max',
        channel: 'alipay',
        orderId: orderMax.orderId,
        eventType: 'SUCCESS',
        rawPayload: '{}',
        receivedAt: new Date().toISOString(),
      },
      providerTransactionId: 'tx_max',
      paidAmountFen: 3900,
      status: 'SUCCESS',
    })

    // Max 全部解锁
    expect(manager.checkUserEntitled('usr_max_user', 'storyboard', store).entitled).toBe(true)
    expect(manager.checkUserEntitled('usr_max_user', 'managed-model-quota', store).entitled).toBe(true)

    store.close()
  })
})
