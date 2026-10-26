// @vitest-environment node
/**
 * 资料检索服务适配器单测 (T11 · Search Provider)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { pinnedRequest } from '../net/pinnedHttp.js'
import {
  ApiSearchProvider,
  InMemorySearchProvider,
  validateSearchQuery,
  type SearchCitation,
} from './provider.js'
import type { PinnedAddress, PinnedResponse } from '../net/pinnedHttp.js'

afterEach(() => vi.useRealTimers())

// 夹具密钥运行时拼接，避免在源码里出现可被扫描器判为硬编码凭据的字面量。
const FIXTURE_KEY = ['fixture', 'not', 'a', 'real', 'credential'].join('-')

function jsonResponse(body: unknown): PinnedResponse {
  const text = JSON.stringify(body)
  return {
    status: 200,
    ok: true,
    stream: Readable.from([Buffer.from(text, 'utf8')]),
    headers: { get: () => null },
    text: () => Promise.resolve(text),
  }
}

describe('Search Provider (T11)', () => {
  it('检索 10s 时限覆盖 DNS 等待，超时后晚到 DNS 不得发请求', async () => {
    vi.useFakeTimers()
    let releaseDns: ((addresses: PinnedAddress[]) => void) | undefined
    const dns = new Promise<PinnedAddress[]>((resolve) => { releaseDns = resolve })
    const request = vi.fn(() => Promise.resolve(jsonResponse({})))
    const provider = new ApiSearchProvider({ apiKey: FIXTURE_KEY, endpoint: 'https://search.fixture.test', lookupAll: () => dns, request })
    const pending = provider.search('fixture')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toMatchObject({ ok: false, error: 'SEARCH_FAILED: This operation was aborted' })
    releaseDns!([{ address: '93.184.216.34', family: 4 }])
    await Promise.resolve()
    expect(request).not.toHaveBeenCalled()
  })

  it('真实回环非成功响应无需消费无限错误体，返回后即释放连接', async () => {
    let closed: Promise<void> | undefined
    const server = createServer((_req, res) => {
      closed = new Promise<void>((resolve) => res.on('close', resolve))
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.write('unbounded error fixture')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as AddressInfo).port
      const provider = new ApiSearchProvider({
        apiKey: FIXTURE_KEY, endpoint: `http://search.fixture.test:${port}`,
        lookupAll: () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]),
        request: (target, init) => pinnedRequest(target, { ...init, addresses: [{ address: '127.0.0.1', family: 4 }] }),
      })
      expect(await provider.search('fixture')).toMatchObject({ ok: false, error: 'UPSTREAM_ERROR: search upstream returned HTTP 500' })
      await closed
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('真实回环成功响应头后，JSON 体等待仍受同一 10s 时限约束', async () => {
    let headersArrived: (() => void) | undefined
    const headers = new Promise<void>((resolve) => { headersArrived = resolve })
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write('{"data":')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as AddressInfo).port
      vi.useFakeTimers()
      const provider = new ApiSearchProvider({
        apiKey: FIXTURE_KEY, endpoint: `http://search.fixture.test:${port}`,
        lookupAll: () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]),
        request: async (target, init) => {
          const response = await pinnedRequest(target, { ...init, addresses: [{ address: '127.0.0.1', family: 4 }] })
          headersArrived!()
          return response
        },
      })
      const pending = provider.search('fixture')
      await headers
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await pending).toMatchObject({ ok: false, error: 'SEARCH_FAILED: This operation was aborted' })
    } finally {
      vi.useRealTimers()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('validateSearchQuery 严格校验查询长度与边界', () => {
    expect(() => validateSearchQuery('')).toThrow(/empty/)
    expect(() => validateSearchQuery('   ')).toThrow(/empty/)
    expect(() => validateSearchQuery(123)).toThrow(/string/)
    expect(() => validateSearchQuery('a'.repeat(201))).toThrow(/200 characters/)
    expect(validateSearchQuery('  唐代夜禁制度  ')).toBe('唐代夜禁制度')
  })

  it('未配置 Key 时 ApiSearchProvider 诚实返回未配置与空列表', async () => {
    const provider = new ApiSearchProvider({ apiKey: '' })
    expect(provider.isConfigured()).toBe(false)

    const result = await provider.search('唐代夜禁')
    expect(result.ok).toBe(false)
    expect(result.configured).toBe(false)
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(result.error).toContain('PROVIDER_UNAVAILABLE')
  })

  it('端点解析到私网地址 ⇒ 拒绝且不发请求（DNS rebinding 第二半）', async () => {
    const calls: unknown[] = []
    const provider = new ApiSearchProvider({
      apiKey: FIXTURE_KEY,
      endpoint: 'https://search.example.com/v1',
      lookupAll: () => Promise.resolve([{ address: '10.0.0.9', family: 4 }]),
      request: () => {
        calls.push(1)
        throw new Error('request must not be called')
      },
    })

    const result = await provider.search('唐代夜禁')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/SECURITY_REJECT/)
    expect(calls).toHaveLength(0)
  })

  it('合法公网端点 ⇒ 连接固定到已验证地址，引用正常解析', async () => {
    const verified: PinnedAddress[] = [{ address: '93.184.216.34', family: 4 }]
    let seen: readonly PinnedAddress[] | undefined
    const provider = new ApiSearchProvider({
      apiKey: FIXTURE_KEY,
      endpoint: 'https://search.example.com/v1',
      lookupAll: () => Promise.resolve(verified),
      request: (_target, init) => {
        seen = init.addresses
        return Promise.resolve(
          jsonResponse({
            data: { webPages: { value: [{ name: '唐代长安城坊里制度', url: 'https://example.com/a', snippet: '夜禁' }] } },
          }),
        )
      },
    })

    const result = await provider.search('唐代夜禁')
    expect(result.ok).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.title).toBe('唐代长安城坊里制度')
    expect(seen).toEqual(verified)
  })

  it('InMemorySearchProvider 真实检索匹配与零匹配空结果', async () => {
    const corpus: SearchCitation[] = [
      {
        id: 'src_01',
        title: '唐代长安城坊里制度',
        url: 'https://example.com/tang-chang-an',
        source: 'example.com',
        snippet: '一百零八坊棋盘布局，金吾卫巡夜禁断私行。',
        sourceHash: 'hash_01',
        fetchedAt: '2026-09-18T00:00:00Z',
      },
    ]
    const provider = new InMemorySearchProvider(corpus)
    expect(provider.isConfigured()).toBe(true)

    // 匹配查询
    const matched = await provider.search('长安')
    expect(matched.ok).toBe(true)
    expect(matched.items.length).toBe(1)
    expect(matched.items[0]!.title).toBe('唐代长安城坊里制度')
    expect(matched.items[0]!.url.startsWith('https://')).toBe(true)

    // 无匹配查询：返回空数组，绝不伪造虚假内容
    const empty = await provider.search('绝对不存在的火星遗迹百科')
    expect(empty.ok).toBe(true)
    expect(empty.items).toEqual([])
    expect(empty.total).toBe(0)
  })
})
