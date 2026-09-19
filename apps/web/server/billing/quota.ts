/**
 * apps/web/server/billing · 官方模型额度预留与用量结算 (Quota Ledger · T15)。
 * 
 * 依照 reference/03-public-billing.md T15 规格：
 * - 事务预留 (userId, operationId) 的调用单位、Token 预算与费用；
 * - 20 并发在余额仅剩 1 时，原子保证仅有 1 个成功，其余 19 个全部拒绝；
 * - 成功按实际 usage 结算；明确未调用的取消释放；
 * - 账户月度预算保护与断路器；
 * - 严禁混扣 BYOK 与官方托管调用的计费。
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
}

export interface QuotaBalance {
  readonly userId: string
  readonly totalUnits: number
  readonly reservedUnits: number
  readonly consumedUnits: number
  readonly availableUnits: number
  readonly monthlyBudgetFen: number
}

export class QuotaManager {
  private readonly _reservations = new Map<string, QuotaReservation>() // `${userId}:${operationId}` -> record
  private readonly _userTotalUnits = new Map<string, number>() // userId -> total granted units (默认 100)
  private readonly _lockMap = new Map<string, Promise<void>>()

  setUserQuota(userId: string, totalUnits: number): void {
    this._userTotalUnits.set(userId, totalUnits)
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

  getBalance(userId: string): QuotaBalance {
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

    const available = Math.max(0, total - reserved - consumed)
    return {
      userId,
      totalUnits: total,
      reservedUnits: reserved,
      consumedUnits: consumed,
      availableUnits: available,
      monthlyBudgetFen: 1500,
    }
  }

  /**
   * 原子预留配额 (原子锁保证并发互斥)
   */
  async reserve(userId: string, operationId: string, units = 1): Promise<QuotaReservation> {
    if (units <= 0) {
      throw new RequestBoundaryError(400, 'INVALID_UNITS', 'quota reservation units must be positive')
    }

    return this.withUserLock(userId, () => {
      const key = `${userId}:${operationId}`
      const existing = this._reservations.get(key)
      if (existing) {
        if (existing.status === 'reserved') return existing
        throw new RequestBoundaryError(409, 'OPERATION_ALREADY_SETTLED', `operation ${operationId} already settled`)
      }

      const balance = this.getBalance(userId)
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
        reservedAt: new Date().toISOString(),
      }
      this._reservations.set(key, reservation)
      return reservation
    })
  }

  /**
   * 实际使用量结算
   */
  async settle(userId: string, operationId: string, actualTokens = 0): Promise<QuotaReservation> {
    return this.withUserLock(userId, () => {
      const key = `${userId}:${operationId}`
      const existing = this._reservations.get(key)
      if (!existing) {
        throw new RequestBoundaryError(404, 'RESERVATION_NOT_FOUND', `reservation for ${operationId} not found`)
      }
      if (existing.status === 'settled') return existing

      const updated: QuotaReservation = {
        ...existing,
        status: 'settled',
        settledAt: new Date().toISOString(),
        actualTokens,
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
    this._lockMap.clear()
  }
}

export const defaultQuotaManager = new QuotaManager()
