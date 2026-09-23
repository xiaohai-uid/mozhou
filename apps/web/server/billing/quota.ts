/**
 * apps/web/server/billing · 官方模型额度预留、并发控制与日成本断路器 (Quota Ledger · T15)。
 * 
 * 依照 reference/03-public-billing.md T15 规格：
 * - 事务预留 (userId, operationId) 的调用单位、Token 预算与费用；
 * - 20 并发在余额仅剩 1 时，原子保证仅有 1 个成功，其余 19 个全部拒绝；
 * - 设置账户月/日预算、服务全局日成本断路器和最大并发；
 * - 预算超限时清晰提示余额与恢复日期，绝不私自降级模型；
 * - 成功按实际 usage 结算并累加尝试成本；未调用的取消释放。
 */
import { RequestBoundaryError } from '../security.js'

export interface QuotaReservation {
  readonly reservationId: string
  readonly userId: string
  readonly operationId: string
  readonly units: number
  readonly status: 'reserved' | 'settled' | 'released'
  readonly reservedAt: string
  readonly settledAt?: string | undefined
  readonly actualTokens?: number | undefined
  readonly costFen?: number | undefined
}

export interface QuotaBalance {
  readonly userId: string
  readonly totalUnits: number
  readonly reservedUnits: number
  readonly consumedUnits: number
  readonly availableUnits: number
  readonly monthlyBudgetFen: number
  readonly monthlySpentFen: number
  readonly dailyCostFen: number
  readonly dailyBudgetFen: number
  readonly circuitBreakerTripped: boolean
}

export class QuotaManager {
  private readonly _reservations = new Map<string, QuotaReservation>() // `${userId}:${operationId}` -> record
  private readonly _userTotalUnits = new Map<string, number>() // userId -> total granted units
  private readonly _userMonthlyBudgetMap = new Map<string, number>() // userId -> monthly budget in fen
  private readonly _dailyCosts = new Map<string, number>() // YYYY-MM-DD -> accumulated cost in fen
  private readonly _userMonthlyCosts = new Map<string, number>() // `${userId}:YYYY-MM` -> accumulated cost in fen
  private readonly _lockMap = new Map<string, Promise<void>>()

  private _maxGlobalConcurrency = 20
  private _dailyBudgetFen = 10_000 // 默认全局每日模型预算 10000 分 = 100 元

  setUserQuota(userId: string, totalUnits: number): void {
    this._userTotalUnits.set(userId, totalUnits)
  }

  setUserMonthlyBudget(userId: string, budgetFen: number): void {
    this._userMonthlyBudgetMap.set(userId, budgetFen)
  }

  setDailyBudgetFen(budgetFen: number): void {
    this._dailyBudgetFen = budgetFen
  }

  setGlobalConcurrencyLimit(limit: number): void {
    this._maxGlobalConcurrency = limit
  }

  getDailyCost(now = Date.now()): number {
    const dateKey = new Date(now).toISOString().slice(0, 10)
    return this._dailyCosts.get(dateKey) ?? 0
  }

  isCircuitBreakerTripped(now = Date.now()): boolean {
    return this.getDailyCost(now) >= this._dailyBudgetFen
  }

  getActiveReservationCount(): number {
    let count = 0
    for (const r of this._reservations.values()) {
      if (r.status === 'reserved') count += 1
    }
    return count
  }

  private async withUserLock<T>(userId: string, fn: () => T): Promise<T> {
    while (this._lockMap.has(userId)) {
      await this._lockMap.get(userId)
    }
    let resolveLock!: () => void
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve
    })
    this._lockMap.set(userId, lockPromise)
    try {
      return fn()
    } finally {
      this._lockMap.delete(userId)
      resolveLock()
    }
  }

  getBalance(userId: string, now = Date.now()): QuotaBalance {
    const total = this._userTotalUnits.get(userId) ?? 50
    let reserved = 0
    let consumed = 0

    for (const res of this._reservations.values()) {
      if (res.userId === userId) {
        if (res.status === 'reserved') {
          reserved += res.units
        } else if (res.status === 'settled') {
          consumed += res.units
        }
      }
    }

    const monthKey = `${userId}:${new Date(now).toISOString().slice(0, 7)}`
    const monthlySpent = this._userMonthlyCosts.get(monthKey) ?? 0
    const monthlyBudget = this._userMonthlyBudgetMap.get(userId) ?? 1500
    const available = Math.max(0, total - reserved - consumed)

    return {
      userId,
      totalUnits: total,
      reservedUnits: reserved,
      consumedUnits: consumed,
      availableUnits: available,
      monthlyBudgetFen: monthlyBudget,
      monthlySpentFen: monthlySpent,
      dailyCostFen: this.getDailyCost(now),
      dailyBudgetFen: this._dailyBudgetFen,
      circuitBreakerTripped: this.isCircuitBreakerTripped(now),
    }
  }

  /**
   * 原子预留配额 (并发控制、断路器、月度预算与单元余额原子保证)
   */
  async reserve(
    userId: string,
    operationId: string,
    units = 1,
    options: { readonly now?: number | undefined } = {},
  ): Promise<QuotaReservation> {
    if (units <= 0) {
      throw new RequestBoundaryError(400, 'INVALID_UNITS', 'quota reservation units must be positive')
    }

    const now = options.now ?? Date.now()

    // 1. 全局日成本断路器校验
    if (this.isCircuitBreakerTripped(now)) {
      const tomorrow = new Date(now + 24 * 3600 * 1000).toISOString().slice(0, 10)
      throw new RequestBoundaryError(
        429,
        'CIRCUIT_BREAKER_TRIPPED',
        `CIRCUIT_BREAKER_TRIPPED: global daily model cost limit (${this._dailyBudgetFen} fen) reached; service operations resume at ${tomorrow}T00:00:00Z`,
      )
    }

    // 2. 全局最大并发限额校验
    if (this.getActiveReservationCount() >= this._maxGlobalConcurrency) {
      throw new RequestBoundaryError(
        429,
        'CONCURRENCY_LIMIT_EXCEEDED',
        `CONCURRENCY_LIMIT_EXCEEDED: server maximum concurrency limit (${this._maxGlobalConcurrency}) reached`,
      )
    }

    return this.withUserLock(userId, () => {
      const key = `${userId}:${operationId}`
      const existing = this._reservations.get(key)
      if (existing) {
        if (existing.status === 'reserved') return existing
        throw new RequestBoundaryError(409, 'OPERATION_ALREADY_SETTLED', `operation ${operationId} already settled`)
      }

      // 3. 账户月度预算校验（预算超限时给出恢复日期）
      const monthKey = `${userId}:${new Date(now).toISOString().slice(0, 7)}`
      const spent = this._userMonthlyCosts.get(monthKey) ?? 0
      const budget = this._userMonthlyBudgetMap.get(userId) ?? 1500
      if (spent >= budget) {
        const nextMonth = new Date(now)
        nextMonth.setMonth(nextMonth.getMonth() + 1)
        nextMonth.setDate(1)
        const recoveryDate = nextMonth.toISOString().slice(0, 10)
        throw new RequestBoundaryError(
          402,
          'USER_BUDGET_EXCEEDED',
          `USER_BUDGET_EXCEEDED: monthly model budget (${budget} fen) reached; current balance: 0 fen; recovery date: ${recoveryDate}`,
        )
      }

      // 4. 用户单元配额余额校验
      const balance = this.getBalance(userId, now)
      if (balance.availableUnits < units) {
        throw new RequestBoundaryError(
          402,
          'QUOTA_EXHAUSTED',
          `QUOTA_EXHAUSTED: insufficient quota balance (available: ${balance.availableUnits}, requested: ${units})`,
        )
      }

      const reservation: QuotaReservation = {
        reservationId: `res_${userId.slice(0, 6)}_${Date.now()}`,
        userId,
        operationId,
        units,
        status: 'reserved',
        reservedAt: new Date(now).toISOString(),
      }
      this._reservations.set(key, reservation)
      return reservation
    })
  }

  /**
   * 实际使用量与成本结算
   */
  async settle(
    userId: string,
    operationId: string,
    actualTokens = 0,
    costFen = 0,
    now = Date.now(),
  ): Promise<QuotaReservation> {
    return this.withUserLock(userId, () => {
      const key = `${userId}:${operationId}`
      const existing = this._reservations.get(key)
      if (!existing) {
        throw new RequestBoundaryError(404, 'RESERVATION_NOT_FOUND', `reservation for ${operationId} not found`)
      }
      if (existing.status === 'settled') return existing

      if (costFen > 0) {
        const dateKey = new Date(now).toISOString().slice(0, 10)
        const curDaily = this._dailyCosts.get(dateKey) ?? 0
        this._dailyCosts.set(dateKey, curDaily + costFen)

        const monthKey = `${userId}:${new Date(now).toISOString().slice(0, 7)}`
        const curMonth = this._userMonthlyCosts.get(monthKey) ?? 0
        this._userMonthlyCosts.set(monthKey, curMonth + costFen)
      }

      const updated: QuotaReservation = {
        ...existing,
        status: 'settled',
        settledAt: new Date(now).toISOString(),
        actualTokens,
        costFen,
      }
      this._reservations.set(key, updated)
      return updated
    })
  }

  /**
   * 释放已预留未消耗的额度（用于请求取消或非计费失败）
   */
  async release(userId: string, operationId: string): Promise<void> {
    await this.withUserLock(userId, () => {
      const key = `${userId}:${operationId}`
      const existing = this._reservations.get(key)
      if (existing && existing.status === 'reserved') {
        const updated: QuotaReservation = {
          ...existing,
          status: 'released',
          settledAt: new Date().toISOString(),
        }
        this._reservations.set(key, updated)
      }
    })
  }

  clear(): void {
    this._reservations.clear()
    this._userTotalUnits.clear()
    this._userMonthlyBudgetMap.clear()
    this._dailyCosts.clear()
    this._userMonthlyCosts.clear()
    this._lockMap.clear()
    this._maxGlobalConcurrency = 20
    this._dailyBudgetFen = 10_000
  }
}

export const defaultQuotaManager = new QuotaManager()
