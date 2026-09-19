// @vitest-environment node
/**
 * 官方模型配额与离线票据路由测试 (T15 · 真实 HTTP 级端到端测试)。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { defaultSessionManager, InMemoryAuthProvider } from '../auth/session.js'
import { defaultQuotaManager } from '../billing/quota.js'

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
})
