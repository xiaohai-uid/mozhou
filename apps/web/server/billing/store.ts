/**
 * apps/web/server/billing · 独立订单与履约存储引擎 (Billing Store · T14)。
 * 
 * 依照 reference/03-public-billing.md T14 规格：
 * - 独立订单 SQLite 数据库（位于 dataRoot/billing.sqlite，绝不污染每书 runtime.sqlite）；
 * - 核心唯一索引保证 (userId, idempotencyKey)、(channel, providerTransactionId)、(orderId) 唯一履约；
 * - 单事务内原子执行 recordEvent → 确认订单 → grant entitlement 一次；
 * - 幂等处理重复/乱序通知，不重复延长有效期；
 * - 金额从 catalog 获取，防客户端篡改降价。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { openDatabase, type SqliteDatabase } from '@mozhou/data-plane'
import { defaultBookAccessManager } from '../bookAccess.js'
import { RequestBoundaryError } from '../security.js'
import {
  type EntitlementGrant,
  type OrderSnapshot,
  type OrderState,
  type PayChannel,
  type PaymentEventRecord,
  type PlanId,
} from './contracts.js'
import { billingCatalog } from './catalog.js'

export interface CreateOrderParams {
  readonly userId: string
  readonly planId: PlanId
  readonly channel: PayChannel
  readonly idempotencyKey: string
  readonly customOrderId?: string | undefined
}

interface OrderRow {
  order_id: string
  user_id: string
  plan_id: string
  channel: string
  idempotency_key: string
  price_version: string
  amount_fen: number
  currency: string
  state: string
  provider_transaction_id: string | null
  checkout_url: string | null
  period_start: string
  period_end: string
  created_at: string
  updated_at: string
}

interface PaymentEventRow {
  event_id: string
  channel: string
  order_id: string
  event_type: string
  raw_payload: string
  received_at: string
}

interface EntitlementGrantRow {
  grant_id: string
  order_id: string
  user_id: string
  plan_id: string
  period_start: string
  period_end: string
  granted_at: string
}

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    price_version TEXT NOT NULL,
    amount_fen INTEGER NOT NULL CHECK(amount_fen > 0),
    currency TEXT NOT NULL DEFAULT 'CNY',
    state TEXT NOT NULL,
    provider_transaction_id TEXT,
    checkout_url TEXT,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS orders_user_idempotency ON orders(user_id, idempotency_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_tx ON orders(channel, provider_transaction_id)
    WHERE provider_transaction_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS payment_events (
    event_id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    order_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    raw_payload TEXT NOT NULL,
    received_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS payment_events_unique ON payment_events(channel, event_id)`,
  `CREATE TABLE IF NOT EXISTS entitlement_grants (
    grant_id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    granted_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS grants_once_per_order ON entitlement_grants(order_id)`,
]

export class BillingStore {
  private _db: SqliteDatabase | null = null
  private _customDbPath: string | null = null

  setDatabasePath(path: string): void {
    if (this._db) {
      this._db.close()
      this._db = null
    }
    this._customDbPath = resolve(path)
  }

  private getDb(): SqliteDatabase {
    if (this._db) return this._db

    const dbPath = this._customDbPath ?? resolve(defaultBookAccessManager.getDataRoot(), 'billing.sqlite')
    const parent = resolve(dbPath, '..')
    mkdirSync(parent, { recursive: true })

    const db = openDatabase({ path: dbPath })
    this._db = db
    for (const statement of DDL_STATEMENTS) {
      db.prepare(statement).run()
    }
    return db
  }

  createOrder(params: CreateOrderParams): OrderSnapshot {
    const db = this.getDb()
    const { userId, planId, channel, idempotencyKey } = params

    // 校验 planId 并取冻结价格
    let expectedAmountFen = 0
    if (planId === 'pro_monthly') {
      expectedAmountFen = billingCatalog.pro.amountFen
    } else if (planId === 'max_monthly') {
      expectedAmountFen = billingCatalog.max.amountFen
    } else {
      throw new RequestBoundaryError(400, 'INVALID_PLAN', `invalid planId: ${String(planId)}`)
    }

    // 检查幂等性：同用户同 idempotencyKey
    const existing = db
      .prepare<[string, string], OrderRow>(
        'SELECT * FROM orders WHERE user_id = ? AND idempotency_key = ?',
      )
      .get(userId, idempotencyKey)

    if (existing) {
      // 相同请求参数返回已存在订单
      if (existing.plan_id === planId && existing.channel === channel && existing.amount_fen === expectedAmountFen) {
        return this.mapOrderRow(existing)
      }
      // 不同参数冲突拒绝 (409)
      throw new RequestBoundaryError(
        409,
        'IDEMPOTENCY_CONFLICT',
        `IDEMPOTENCY_CONFLICT: idempotencyKey ${idempotencyKey} has already been used with different order parameters`,
      )
    }

    const orderId = params.customOrderId ?? 'ord_' + randomBytes(16).toString('hex')
    const now = new Date()
    const periodStart = now.toISOString()
    // 月度周期：+30 天
    const periodEnd = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString()
    const checkoutUrl = `https://pay.${channel}.com/mock_checkout/${orderId}`

    db.prepare(`
      INSERT INTO orders (
        order_id, user_id, plan_id, channel, idempotency_key, price_version,
        amount_fen, currency, state, checkout_url, period_start, period_end,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, 'CNY', 'created', ?, ?, ?,
        ?, ?
      )
    `).run(
      orderId,
      userId,
      planId,
      channel,
      idempotencyKey,
      billingCatalog.version,
      expectedAmountFen,
      checkoutUrl,
      periodStart,
      periodEnd,
      periodStart,
      periodStart,
    )

    return {
      orderId,
      userId,
      planId,
      channel,
      idempotencyKey,
      priceVersion: billingCatalog.version,
      amountFen: expectedAmountFen,
      currency: 'CNY',
      state: 'created',
      checkoutUrl,
      periodStart,
      periodEnd,
      createdAt: periodStart,
      updatedAt: periodStart,
    }
  }

  getOrder(orderId: string): OrderSnapshot | null {
    const db = this.getDb()
    const row = db.prepare<[string], OrderRow>('SELECT * FROM orders WHERE order_id = ?').get(orderId)
    return row ? this.mapOrderRow(row) : null
  }

  /**
   * 单事务内执行支付通知入账与履约：
   * 1. 记录原始事件并保证 (channel, eventId) 唯一；
   * 2. 检查订单金额与商户匹配；
   * 3. 状态变更为 paid，记录 providerTransactionId；
   * 4. 唯一发放 entitlement 权益（grants_once_per_order 强约束）；
   * 5. 重复通知幂等返回，不重复延期。
   */
  processPaymentNotification(params: {
    readonly event: PaymentEventRecord
    readonly providerTransactionId: string
    readonly paidAmountFen: number
    readonly status: 'SUCCESS' | 'CLOSED'
  }): { readonly handled: boolean; readonly order: OrderSnapshot; readonly alreadyProcessed: boolean } {
    const db = this.getDb()
    const { event, providerTransactionId, paidAmountFen, status } = params

    return db.transaction(() => {
      // 1. 检查事件是否已经处理过
      const existingEvent = db
        .prepare<[string, string], PaymentEventRow>('SELECT * FROM payment_events WHERE channel = ? AND event_id = ?')
        .get(event.channel, event.eventId)

      const orderRow = db
        .prepare<[string], OrderRow>('SELECT * FROM orders WHERE order_id = ?')
        .get(event.orderId)

      if (!orderRow) {
        throw new RequestBoundaryError(404, 'ORDER_NOT_FOUND', `order ${event.orderId} not found`)
      }

      if (existingEvent) {
        // 重复通知幂等返回，不重复开事务加权益
        return { handled: true, order: this.mapOrderRow(orderRow), alreadyProcessed: true }
      }

      // 记录支付事件
      db.prepare(`
        INSERT INTO payment_events (event_id, channel, order_id, event_type, raw_payload, received_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(event.eventId, event.channel, event.orderId, event.eventType, event.rawPayload, event.receivedAt)

      // 订单金额校验 (防付小发大)
      if (orderRow.amount_fen !== paidAmountFen) {
        throw new RequestBoundaryError(
          400,
          'AMOUNT_MISMATCH',
          `AMOUNT_MISMATCH: paid amount ${paidAmountFen} does not match order amount ${orderRow.amount_fen}`,
        )
      }

      if (status === 'CLOSED') {
        if (orderRow.state === 'created' || orderRow.state === 'pending') {
          db.prepare('UPDATE orders SET state = ?, updated_at = ? WHERE order_id = ?').run(
            'closed',
            new Date().toISOString(),
            event.orderId,
          )
        }
        const updated = db.prepare<[string], OrderRow>('SELECT * FROM orders WHERE order_id = ?').get(event.orderId)
        return { handled: true, order: this.mapOrderRow(updated!), alreadyProcessed: false }
      }

      if (orderRow.state === 'paid') {
        // 订单此前已被其他并发处理标记为 paid
        return { handled: true, order: this.mapOrderRow(orderRow), alreadyProcessed: true }
      }

      const nowIso = new Date().toISOString()
      // 更新订单为 paid
      db.prepare(`
        UPDATE orders
        SET state = 'paid', provider_transaction_id = ?, updated_at = ?
        WHERE order_id = ?
      `).run(providerTransactionId, nowIso, event.orderId)

      // 履约发放权益：grants_once_per_order 强约束
      const grantId = 'grt_' + randomBytes(16).toString('hex')
      db.prepare(`
        INSERT INTO entitlement_grants (grant_id, order_id, user_id, plan_id, period_start, period_end, granted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        grantId,
        orderRow.order_id,
        orderRow.user_id,
        orderRow.plan_id,
        orderRow.period_start,
        orderRow.period_end,
        nowIso,
      )

      const finalOrder = db.prepare<[string], OrderRow>('SELECT * FROM orders WHERE order_id = ?').get(event.orderId)
      return { handled: true, order: this.mapOrderRow(finalOrder!), alreadyProcessed: false }
    })()
  }

  /**
   * 运营退款：撤销未消费权益，状态迁移为 refunded。
   */
  refundOrder(orderId: string, refundAmountFen: number): OrderSnapshot {
    const db = this.getDb()
    return db.transaction(() => {
      const order = db.prepare<[string], OrderRow>('SELECT * FROM orders WHERE order_id = ?').get(orderId)
      if (!order) {
        throw new RequestBoundaryError(404, 'ORDER_NOT_FOUND', `order ${orderId} not found`)
      }
      if (order.state !== 'paid') {
        throw new RequestBoundaryError(400, 'CANNOT_REFUND', `order in state "${order.state}" cannot be refunded`)
      }
      if (refundAmountFen > order.amount_fen || refundAmountFen <= 0) {
        throw new RequestBoundaryError(400, 'INVALID_REFUND_AMOUNT', 'refund amount must be between 1 and paid amount')
      }

      const now = new Date().toISOString()
      db.prepare('UPDATE orders SET state = ?, updated_at = ? WHERE order_id = ?').run('refunded', now, orderId)
      // 撤销该订单关联的权益发放
      db.prepare('DELETE FROM entitlement_grants WHERE order_id = ?').run(orderId)

      const updated = db.prepare<[string], OrderRow>('SELECT * FROM orders WHERE order_id = ?').get(orderId)
      return this.mapOrderRow(updated!)
    })()
  }

  getActiveGrantForUser(userId: string): EntitlementGrant | null {
    const db = this.getDb()
    const nowIso = new Date().toISOString()
    const row = db
      .prepare<[string, string], EntitlementGrantRow>(
        'SELECT * FROM entitlement_grants WHERE user_id = ? AND period_end > ? ORDER BY period_end DESC LIMIT 1',
      )
      .get(userId, nowIso)

    if (!row) return null
    return {
      grantId: row.grant_id,
      orderId: row.order_id,
      userId: row.user_id,
      planId: row.plan_id as PlanId,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      grantedAt: row.granted_at,
    }
  }

  listPendingOrders(olderThanMs?: number, now = Date.now()): readonly OrderSnapshot[] {
    const db = this.getDb()
    if (olderThanMs !== undefined && olderThanMs > 0) {
      const cutoff = new Date(now - olderThanMs).toISOString()
      const rows = db
        .prepare<[string], OrderRow>(
          "SELECT * FROM orders WHERE state IN ('created', 'pending') AND created_at <= ? ORDER BY created_at ASC",
        )
        .all(cutoff)
      return rows.map((r) => this.mapOrderRow(r))
    }
    const rows = db
      .prepare<[], OrderRow>("SELECT * FROM orders WHERE state IN ('created', 'pending') ORDER BY created_at ASC")
      .all()
    return rows.map((r) => this.mapOrderRow(r))
  }

  closeExpiredOrders(maxAgeMs = 24 * 3600 * 1000, now = Date.now()): readonly OrderSnapshot[] {
    const db = this.getDb()
    const cutoff = new Date(now - maxAgeMs).toISOString()
    const nowIso = new Date(now).toISOString()

    return db.transaction(() => {
      const expired = db
        .prepare<[string], OrderRow>(
          "SELECT * FROM orders WHERE state IN ('created', 'pending') AND created_at <= ?",
        )
        .all(cutoff)

      if (expired.length > 0) {
        db.prepare(
          "UPDATE orders SET state = 'closed', updated_at = ? WHERE state IN ('created', 'pending') AND created_at <= ?",
        ).run(nowIso, cutoff)
      }

      return expired.map((r) => ({
        ...this.mapOrderRow(r),
        state: 'closed' as const,
        updatedAt: nowIso,
      }))
    })()
  }

  private mapOrderRow(row: OrderRow): OrderSnapshot {
    return {
      orderId: row.order_id,
      userId: row.user_id,
      planId: row.plan_id as PlanId,
      channel: row.channel as PayChannel,
      idempotencyKey: row.idempotency_key,
      priceVersion: row.price_version,
      amountFen: row.amount_fen,
      currency: row.currency as 'CNY',
      state: row.state as OrderState,
      providerTransactionId: row.provider_transaction_id ?? null,
      checkoutUrl: row.checkout_url ?? null,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  close(): void {
    if (this._db) {
      this._db.close()
      this._db = null
    }
  }
}

export const defaultBillingStore = new BillingStore()
