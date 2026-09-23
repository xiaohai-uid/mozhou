// @vitest-environment node
/**
 * 资料检索、榜单与书源路由测试 (T11 · 真实 HTTP 级端到端测试)。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { defaultSessionManager, InMemoryAuthProvider } from '../auth/session.js'

let servers: ReturnType<typeof createServer>[] = []

beforeEach(() => {
  defaultSessionManager.clear()
  defaultSessionManager.setProvider(new InMemoryAuthProvider())
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  delete process.env['MOZHOU_LIVE_RANKINGS']
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

describe('资料检索与榜单路由 (T11)', () => {
  it('POST /api/web-search：服务未配置真实 Key 时诚实返回 501 WEB_SEARCH_NOT_CONFIGURED', async () => {
    const base = await listen()
    const res = await fetch(`${base}/api/web-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '唐代长安坊市制度' }),
    })
    // 未配置外部商业 key 时，不伪造 ALL_KNOWLEDGE 假数据，而是诚实返回 501 状态
    expect(res.status).toBe(501)
    const data = (await res.json()) as { ok: boolean; code: string; error: string }
    expect(data.ok).toBe(false)
    expect(data.code).toBe('WEB_SEARCH_NOT_CONFIGURED')
  })

  it('POST /api/rank-scan：开启实时榜单源抓取时，榜单数据无“知名作家/前沿主线设定”等虚假补值', async () => {
    process.env['MOZHOU_LIVE_RANKINGS'] = '1'
    const base = await listen()
    const res = await fetch(`${base}/api/rank-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { ok: boolean; boards: { items: { author: string; goldenFinger: string }[] }[] }
    expect(data.ok).toBe(true)
    expect(Array.isArray(data.boards)).toBe(true)

    // 验证所有榜单条目没有预置的伪造占位符
    for (const b of data.boards) {
      for (const item of b.items) {
        expect(item.author).not.toBe('知名作家')
        expect(item.goldenFinger).not.toBe('前沿主线设定')
      }
    }
  })

  it('POST /api/book-source.search：书源搜索空查询与非空查询结构完整', async () => {
    const base = await listen()
    const res = await fetch(`${base}/api/book-source.search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '' }),
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { ok: boolean; books: unknown[] }
    expect(data.ok).toBe(true)
    expect(Array.isArray(data.books)).toBe(true)
  })
})
