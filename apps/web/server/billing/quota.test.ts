// @vitest-environment node
/**
 * 官方模型额度预留、并发争夺与结算测试 (T15 · QuotaManager)。
 */
import { describe, expect, it } from 'vitest'
import { QuotaManager } from './quota.js'

describe('QuotaManager 额度事务与并发测试 (T15)', () => {
  it('20 并发争夺余额 1：原子保证仅 1 个成功，其余 19 个抛出 QUOTA_EXHAUSTED', async () => {
    const quota = new QuotaManager()
    const userId = 'usr_tight_budget'
    // 设置该用户总额度仅有 1
    quota.setUserQuota(userId, 1)

    const results: { success: boolean; error?: string }[] = []
    const promises: Promise<void>[] = []

    for (let i = 0; i < 20; i += 1) {
      const p = quota
        .reserve(userId, `op_${i}`, 1)
        .then(() => {
          results.push({ success: true })
        })
        .catch((err: Error) => {
          results.push({ success: false, error: err.message })
        })
      promises.push(p)
    }

    await Promise.all(promises)

    const successes = results.filter((r) => r.success)
    const failures = results.filter((r) => !r.success)

    // 严密断言：恰好 1 个成功，19 个失败并携带 QUOTA_EXHAUSTED
    expect(successes.length).toBe(1)
    expect(failures.length).toBe(19)
    for (const f of failures) {
      expect(f.error).toContain('QUOTA_EXHAUSTED')
    }

    // 此时可用余额为 0
    expect(quota.getBalance(userId).availableUnits).toBe(0)
  })

  it('成功结算扣减用量，取消释放保留额度', async () => {
    const quota = new QuotaManager()
    const userId = 'usr_settle_release'
    quota.setUserQuota(userId, 5)

    // 预留 op_A
    await quota.reserve(userId, 'op_A', 2)
    expect(quota.getBalance(userId).availableUnits).toBe(3)

    // 成功结算 op_A
    const settled = await quota.settle(userId, 'op_A', 3500)
    expect(settled.status).toBe('settled')
    expect(settled.actualTokens).toBe(3500)
    expect(quota.getBalance(userId).consumedUnits).toBe(2)
    expect(quota.getBalance(userId).availableUnits).toBe(3)

    // 预留 op_B 然后取消释放
    await quota.reserve(userId, 'op_B', 1)
    expect(quota.getBalance(userId).availableUnits).toBe(2)

    await quota.release(userId, 'op_B')
    // 释放后额度回退可用
    expect(quota.getBalance(userId).availableUnits).toBe(3)
  })
})
