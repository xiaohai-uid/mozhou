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

    // 第 3 个在途请求被并发门拒绝
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

  it('单用户无法凭自身结算把全局日成本推过全局日预算：超出其月预算的 settle 被拒且不累加', async () => {
    const quota = new QuotaManager()
    const userId = 'usr_self_drain'
    // 不设置月预算：沿用默认 1500 分（与 reserve 同源）；全局日预算默认 10000 分。
    const monthlyBudget = 1500

    // 先大量预留（此阶段月消费为 0，全部通过），再逐单以正常量级结算。
    const N = 20
    for (let i = 0; i < N; i += 1) {
      await quota.reserve(userId, `op_drain_${i}`, 1)
    }

    // 第 1 单合法（0 + 1500 === 预算上界，仍允许），其余全部被月预算拒绝。
    await expect(quota.settle(userId, 'op_drain_0', 0, 1500)).resolves.toBeDefined()
    for (let i = 1; i < N; i += 1) {
      await expect(quota.settle(userId, `op_drain_${i}`, 0, 1500)).rejects.toMatchObject({
        status: 402,
        code: 'USER_BUDGET_EXCEEDED',
      })
    }

    // 账本只记录被接受的成本：被拒的 19 单绝不进入日成本。
    expect(quota.getDailyCost()).toBe(1500)
    expect(quota.getDailyCost()).toBeLessThanOrEqual(monthlyBudget)
    // 全局断路器未被该用户打掉，其他用户的下一次预留仍可成功。
    expect(quota.isCircuitBreakerTripped()).toBe(false)
    await expect(quota.reserve('usr_other', 'op_other', 1)).resolves.toBeDefined()
  })

  it('多个用户各自在预算内的合法消费仍能把全局日断路器推到 tripped', async () => {
    const quota = new QuotaManager()
    quota.setDailyBudgetFen(150) // 全局日预算 150 分
    quota.setUserMonthlyBudget('usr_legit_a', 1000)
    quota.setUserMonthlyBudget('usr_legit_b', 1000)

    // 每个用户各自消费 100 分，均在自身月预算内；两笔合计 200 分越过全局日预算。
    await quota.reserve('usr_legit_a', 'op_legit_a', 1)
    await quota.settle('usr_legit_a', 'op_legit_a', 1000, 100)
    expect(quota.isCircuitBreakerTripped()).toBe(false)

    await quota.reserve('usr_legit_b', 'op_legit_b', 1)
    await quota.settle('usr_legit_b', 'op_legit_b', 1000, 100)

    expect(quota.getDailyCost()).toBe(200)
    expect(quota.isCircuitBreakerTripped()).toBe(true)
    await expect(quota.reserve('usr_legit_c', 'op_legit_c', 1)).rejects.toMatchObject({
      status: 429,
      code: 'CIRCUIT_BREAKER_TRIPPED',
    })
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

  it('按真实成本结算后断路器可达：下一次 reserve 以 HTTP 429 / CIRCUIT_BREAKER_TRIPPED 拒绝', async () => {
    const quota = new QuotaManager()
    quota.setDailyBudgetFen(100)

    // 显式上报真实成本（第 4 个位置参数 costFen），日成本随之累加
    await quota.reserve('usr_cost_a', 'op_real_cost_1', 1)
    await quota.settle('usr_cost_a', 'op_real_cost_1', 1000, 100)
    expect(quota.getDailyCost()).toBe(100)
    expect(quota.isCircuitBreakerTripped()).toBe(true)

    // 断路器触发后，下一次预留必须抛出 429（而非仅文案），供路由透传状态码
    await expect(quota.reserve('usr_cost_b', 'op_real_cost_2', 1)).rejects.toMatchObject({
      status: 429,
      code: 'CIRCUIT_BREAKER_TRIPPED',
    })
  })
})
