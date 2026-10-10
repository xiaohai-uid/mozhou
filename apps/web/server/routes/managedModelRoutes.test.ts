// @vitest-environment node
/**
 * 官方模型配额与离线票据路由测试 (T15 · 真实 HTTP 级端到端测试)。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { defaultSessionManager, InMemoryAuthProvider } from '../auth/session.js'
import { defaultQuotaManager } from '../billing/quota.js'
import { defaultBillingStore } from '../billing/store.js'
import { billingCatalog, PRO_ENTITLEMENT_KEYS } from '../billing/catalog.js'

let servers: ReturnType<typeof createServer>[] = []

beforeEach(() => {
  defaultSessionManager.clear()
  defaultSessionManager.setProvider(new InMemoryAuthProvider())
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
  defaultQuotaManager.clear()
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  defaultQuotaManager.clear()
})

function listen(): Promise<string> {
  return new Promise((resolveUrl) => {
    const router = createMoZhouApiRouter()
    const server = createServer((req, res) => {
      void router.dispatch(req, res).then((handled) => {
        if (!handled && !res.writableEnded) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'not found' }))
        }
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolveUrl(`http://127.0.0.1:${addr.port}`)
    })
  })
}

describe('托管模型额度与离线票据路由 (T15)', () => {
  it('未登录请求票据或额度 → 401，登录后正常颁发离线票据与查询额度', async () => {
    defaultBookAccessManager.setHostedMode(true)
    const base = await listen()

    // 1. 未登录访问 → 401
    const resNoAuth = await fetch(`${base}/api/billing/license/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'dev_123' }),
    })
    expect(resNoAuth.status).toBe(401)

    // 2. 登录用户
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user } = await provider.signUp('author@client.com', 'pass123')
    const { cookie } = defaultSessionManager.createSession({ userId: user.id, email: user.email })

    // 3. 获取离线票据
    const resTicket = await fetch(`${base}/api/billing/license/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ deviceId: 'dev_win_laptop_001' }),
    })
    expect(resTicket.status).toBe(200)
    const dataTicket = (await resTicket.json()) as { ok: boolean; ticket: { signature: string; publicKey: string } }
    expect(dataTicket.ok).toBe(true)
    expect(typeof dataTicket.ticket.signature).toBe('string')
    expect(dataTicket.ticket.publicKey).toContain('PUBLIC KEY')

    // 4. 查询配额余额
    const resQuota = await fetch(`${base}/api/billing/quota/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    })
    expect(resQuota.status).toBe(200)
    const dataQuota = (await resQuota.json()) as { ok: boolean; balance: { totalUnits: number; availableUnits: number } }
    expect(dataQuota.ok).toBe(true)
    expect(dataQuota.balance.availableUnits).toBeGreaterThan(0)
  })

  it('额度预留与结算全流程', async () => {
    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user } = await provider.signUp('reserve_user@client.com', 'pass123')
    const { cookie } = defaultSessionManager.createSession({ userId: user.id, email: user.email })

    // 1. 预留额度
    const resReserve = await fetch(`${base}/api/billing/quota/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ operationId: 'draft_gen_op_101', units: 1 }),
    })
    expect(resReserve.status).toBe(200)
    const dataReserve = (await resReserve.json()) as { ok: boolean; reservation: { status: string } }
    expect(dataReserve.ok).toBe(true)
    expect(dataReserve.reservation.status).toBe('reserved')

    // 2. 结算额度
    const resSettle = await fetch(`${base}/api/billing/quota/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ operationId: 'draft_gen_op_101', tokens: 2500 }),
    })
    expect(resSettle.status).toBe(200)
    const dataSettle = (await resSettle.json()) as { ok: boolean; reservation: { status: string; actualTokens: number } }
    expect(dataSettle.ok).toBe(true)
    expect(dataSettle.reservation.status).toBe('settled')
    expect(dataSettle.reservation.actualTokens).toBe(2500)
  })

  it('免费用户票据能力为空，不再默认授予 pro', async () => {
    defaultBookAccessManager.setHostedMode(true)
    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user } = await provider.signUp('free_ticket@client.com', 'pass123')
    const { cookie } = defaultSessionManager.createSession({ userId: user.id, email: user.email })

    const resTicket = await fetch(`${base}/api/billing/license/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ deviceId: 'dev_free_001' }),
    })
    expect(resTicket.status).toBe(200)
    const data = (await resTicket.json()) as {
      ticket: { data: { planId: string; capabilities: string[] } }
    }
    expect(data.ticket.data.planId).toBe('free')
    expect(data.ticket.data.capabilities).toEqual([])
    expect(data.ticket.data.capabilities).not.toContain('pro-features')
  })

  it('Pro 用户票据能力等于 PRO_ENTITLEMENT_KEYS，与 planId 一致', async () => {
    defaultBookAccessManager.setHostedMode(true)
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-managed-route-'))
    defaultBillingStore.setDatabasePath(join(dir, 'billing.sqlite'))
    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user } = await provider.signUp('pro_ticket@client.com', 'pass123')
    const { cookie } = defaultSessionManager.createSession({ userId: user.id, email: user.email })

    // 为该用户发放 Pro 履约
    const order = defaultBillingStore.createOrder({
      userId: user.id,
      planId: 'pro_monthly',
      channel: 'wechat',
      idempotencyKey: 'pro_ticket_k1',
    })
    defaultBillingStore.processPaymentNotification({
      event: {
        eventId: 'evt_pro_ticket',
        channel: 'wechat',
        orderId: order.orderId,
        eventType: 'SUCCESS',
        rawPayload: '{}',
        receivedAt: new Date().toISOString(),
      },
      providerTransactionId: 'tx_pro_ticket',
      paidAmountFen: 1900,
      status: 'SUCCESS',
    })

    try {
      const resTicket = await fetch(`${base}/api/billing/license/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ deviceId: 'dev_pro_001' }),
      })
      expect(resTicket.status).toBe(200)
      const data = (await resTicket.json()) as {
        ticket: { data: { planId: string; capabilities: string[] } }
      }
      expect(data.ticket.data.planId).toBe('pro_monthly')
      expect([...data.ticket.data.capabilities].sort()).toEqual([...PRO_ENTITLEMENT_KEYS].sort())
    } finally {
      defaultBillingStore.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('结算路由接受 costFen 并按真实成本累加日成本', async () => {
    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user } = await provider.signUp('cost_user@client.com', 'pass123')
    const { cookie } = defaultSessionManager.createSession({ userId: user.id, email: user.email })

    await fetch(`${base}/api/billing/quota/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ operationId: 'op_cost_real', units: 1 }),
    })

    const resSettle = await fetch(`${base}/api/billing/quota/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ operationId: 'op_cost_real', tokens: 1200, costFen: 250 }),
    })
    expect(resSettle.status).toBe(200)
    expect(defaultQuotaManager.getDailyCost()).toBe(250)
  })

  it('非法 costFen 显式拒绝 400，不静默当 0', async () => {
    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user } = await provider.signUp('bad_cost@client.com', 'pass123')
    const { cookie } = defaultSessionManager.createSession({ userId: user.id, email: user.email })

    for (const bad of [-1, 'abc']) {
      const res = await fetch(`${base}/api/billing/quota/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ operationId: 'op_bad_cost', tokens: 10, costFen: bad }),
      })
      expect(res.status).toBe(400)
      const data = (await res.json()) as { code: string }
      expect(data.code).toBe('INVALID_COST_FEN')
    }
  })

  it('成本累加触发日成本断路器：下一次 reserve 返回 HTTP 429 CIRCUIT_BREAKER_TRIPPED', async () => {
    const base = await listen()
    defaultQuotaManager.setDailyBudgetFen(100)
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user } = await provider.signUp('breaker_user@client.com', 'pass123')
    const { cookie } = defaultSessionManager.createSession({ userId: user.id, email: user.email })

    await fetch(`${base}/api/billing/quota/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ operationId: 'op_breaker_1', units: 1 }),
    })
    const resSettle = await fetch(`${base}/api/billing/quota/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ operationId: 'op_breaker_1', tokens: 1000, costFen: 100 }),
    })
    expect(resSettle.status).toBe(200)
    expect(defaultQuotaManager.isCircuitBreakerTripped()).toBe(true)

    const resReserve = await fetch(`${base}/api/billing/quota/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ operationId: 'op_breaker_2', units: 1 }),
    })
    expect(resReserve.status).toBe(429)
    const data = (await resReserve.json()) as { code: string }
    expect(data.code).toBe('CIRCUIT_BREAKER_TRIPPED')
  })

  it('极大 costFen（1e308）被 400 拒绝，不进入全局成本累加', async () => {
    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user } = await provider.signUp('huge_cost@client.com', 'pass123')
    const { cookie } = defaultSessionManager.createSession({ userId: user.id, email: user.email })

    const res = await fetch(`${base}/api/billing/quota/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ operationId: 'op_huge_cost', tokens: 10, costFen: 1e308 }),
    })
    expect(res.status).toBe(400)
    const data = (await res.json()) as { code: string }
    expect(data.code).toBe('COST_FEN_EXCEEDS_LIMIT')
    // 关键：未累加，全局断路器不受影响，其他用户不会被连坐。
    expect(defaultQuotaManager.getDailyCost()).toBe(0)
    expect(defaultQuotaManager.isCircuitBreakerTripped()).toBe(false)
  })

  it('合法量级 costFen 仍被接受：累加后可触发断路器并让下一次 reserve 返回 429', async () => {
    const base = await listen()
    defaultQuotaManager.setDailyBudgetFen(200)
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user } = await provider.signUp('legal_cost@client.com', 'pass123')
    const { cookie } = defaultSessionManager.createSession({ userId: user.id, email: user.email })

    const legalCostFen = 250 // <= 上界（1500）的正常量级，证明上界未把正常路径一起挡掉
    await fetch(`${base}/api/billing/quota/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ operationId: 'op_legal_1', units: 1 }),
    })
    const resSettle = await fetch(`${base}/api/billing/quota/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ operationId: 'op_legal_1', tokens: 1000, costFen: legalCostFen }),
    })
    expect(resSettle.status).toBe(200)
    expect(defaultQuotaManager.getDailyCost()).toBe(legalCostFen)
    expect(defaultQuotaManager.isCircuitBreakerTripped()).toBe(true)

    const resReserve = await fetch(`${base}/api/billing/quota/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ operationId: 'op_legal_2', units: 1 }),
    })
    expect(resReserve.status).toBe(429)
    const data = (await resReserve.json()) as { code: string }
    expect(data.code).toBe('CIRCUIT_BREAKER_TRIPPED')
  })

  it('costFen 边界：恰好等于上界放行，超过一点即 400', async () => {
    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user } = await provider.signUp('bound_cost@client.com', 'pass123')
    const { cookie } = defaultSessionManager.createSession({ userId: user.id, email: user.email })

    const bound = billingCatalog.managed.budget.modelBudgetFenPerMonth
    await fetch(`${base}/api/billing/quota/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ operationId: 'op_bound_ok', units: 1 }),
    })
    const resAtBound = await fetch(`${base}/api/billing/quota/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ operationId: 'op_bound_ok', tokens: 10, costFen: bound }),
    })
    expect(resAtBound.status).toBe(200)

    const resOver = await fetch(`${base}/api/billing/quota/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ operationId: 'op_bound_over', tokens: 10, costFen: bound + 1 }),
    })
    expect(resOver.status).toBe(400)
    const data = (await resOver.json()) as { code: string }
    expect(data.code).toBe('COST_FEN_EXCEEDS_LIMIT')
  })
})
