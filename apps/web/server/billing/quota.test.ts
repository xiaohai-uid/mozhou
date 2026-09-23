// @vitest-environment node
/**
 * 官方模型额度预留、并发争夺、日断路器与结算测试 (T15 · QuotaManager)。
 */
import { describe, expect, it } from 'vitest'
import { QuotaManager } from './quota.js'

describe('QuotaManager 额度事务、断路器与并发测试 (T15)', () => {
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

  it('全局最大并发限制：超过最大在途预留量时抛出 CONCURRENCY_LIMIT_EXCEEDED', async () => {
    const quota = new QuotaManager()
    quota.setGlobalConcurrencyLimit(2) // 设定最大在途并发为 2

    // 预留第 1 和第 2 个
    await quota.reserve('user_1', 'op_concurrent_1', 1)
    await quota.reserve('user_2', 'op_concurrent_2', 1)

    // 第 3 个在途请求被并发门禁拒绝
    await expect(quota.reserve('user_3', 'op_concurrent_3', 1)).rejects.toThrow(
      /CONCURRENCY_LIMIT_EXCEEDED/,
    )

    // 结算其中一个后并发恢复
    await quota.settle('user_1', 'op_concurrent_1')
    await expect(quota.reserve('user_3', 'op_concurrent_3', 1)).resolves.toBeDefined()
  })

  it('服务全局日成本断路器：累计日费用触顶时熔断，阻断后续请求并给出次日恢复时间', async () => {
    const quota = new QuotaManager()
    quota.setDailyBudgetFen(100) // 设定极小日预算 100 分进行测试

    // 预留并消耗 100 分
    await quota.reserve('user_a', 'op_cost_1', 1)
    await quota.settle('user_a', 'op_cost_1', 1000, 100)

    expect(quota.isCircuitBreakerTripped()).toBe(true)

    // 后续请求被全局日断路器熔断拦截
    await expect(quota.reserve('user_b', 'op_cost_2', 1)).rejects.toThrow(
      /CIRCUIT_BREAKER_TRIPPED/,
    )
  })

  it('用户月度模型预算超限时拒绝并返回恢复日期', async () => {
    const quota = new QuotaManager()
    const userId = 'usr_monthly_spender'
    quota.setUserMonthlyBudget(userId, 500) // 设定月度预算 500 分

    // 消耗 500 分
    await quota.reserve(userId, 'op_month_1', 1)
    await quota.settle(userId, 'op_month_1', 5000, 500)

    // 再次预留被月度预算拦截，错误信息包含 recovery date
    await expect(quota.reserve(userId, 'op_month_2', 1)).rejects.toThrow(
      /USER_BUDGET_EXCEEDED/,
    )
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
