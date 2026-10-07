// @vitest-environment node
/**
 * 定价目录 GET 可达性契约：`GET /api/billing/catalog` 必须返回 200 且 currency=CNY。
 *
 * 回归防护：该路径在 routePolicies.ts 登记 public、systemRoutes.ts:468 也有处理器分支，
 * 但入口方法闸此前只放行 POST 与 GET /api/membership，GET 一律 return false 穿透到
 * 兜底 404——scripts/release/navigation-acceptance.mjs:24 的导航验收因此 FAIL。
 * 与 healthRoutes.test.ts 同法：经真实路由器断言，不直接调用处理器。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'

let servers: ReturnType<typeof createServer>[] = []

beforeEach(() => {
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const server of servers) server.close()
  servers = []
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

describe('/api/billing/catalog · 公开定价目录读面', () => {
  it('GET ⇒ 200 且 ok=true、catalog.currency=CNY（navigation-acceptance 验收面）', async () => {
    const base = await listen()
    const res = await fetch(`${base}/api/billing/catalog`)
    const body = (await res.json()) as { ok: boolean; catalog: { currency: string; version: string } }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.catalog.currency).toBe('CNY')
    expect(typeof body.catalog.version).toBe('string')
  })

  it('POST ⇒ 仍 200（既有方法行为不变）', async () => {
    const base = await listen()
    const res = await fetch(`${base}/api/billing/catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const body = (await res.json()) as { ok: boolean; catalog: { currency: string } }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.catalog.currency).toBe('CNY')
  })

  it('GET /api/membership ⇒ 仍 200（既有 GET 放行不变）', async () => {
    const base = await listen()
    const res = await fetch(`${base}/api/membership`)
    const body = (await res.json()) as { ok: boolean; plans: unknown[] }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.plans)).toBe(true)
    expect(body.plans.length).toBeGreaterThanOrEqual(2)
  })

  it('DELETE ⇒ 仍被方法闸拒绝穿透 404（其余方法限制不变）', async () => {
    const base = await listen()
    const res = await fetch(`${base}/api/billing/catalog`, { method: 'DELETE' })

    expect(res.status).toBe(404)
  })
})
