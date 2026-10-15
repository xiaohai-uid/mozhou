// @vitest-environment node
/**
 * 切片 3 回归锁（爬虫出站）：逐跳 DNS 校验 + 连接固定到已验证地址。
 * 封闭式用例：DNS 与传输经 deps 注入内存夹具，不发真网。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fetchText, type FetchTextDeps } from './provider-utils.js'
import { pinnedRequest } from '../net/pinnedHttp.js'
import type { PinnedAddress, PinnedResponse } from '../net/pinnedHttp.js'

afterEach(() => vi.useRealTimers())

function bodyResponse(body: string): PinnedResponse {
  return {
    status: 200,
    ok: true,
    stream: Readable.from([Buffer.from(body, 'utf8')]),
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  }
}

function redirectResponse(location: string): PinnedResponse {
  return {
    status: 302,
    ok: false,
    stream: null,
    headers: { get: (name: string) => (name.toLowerCase() === 'location' ? location : null) },
    text: () => Promise.resolve(''),
  }
}

describe('fetchText · DNS 校验与连接绑定（切片 3）', () => {
  it('DNS 保持待决时也受请求时限约束，晚到解析不能发请求', async () => {
    vi.useFakeTimers()
    let releaseDns: ((addresses: PinnedAddress[]) => void) | undefined
    const dns = new Promise<PinnedAddress[]>((resolve) => { releaseDns = resolve })
    const request = vi.fn(() => Promise.resolve(bodyResponse('must not request')))
    const pending = fetchText('https://example.com/page', {}, 30, 0, { lookupAll: () => dns, request })
    await vi.advanceTimersByTimeAsync(30)
    const result = await pending
    expect(result).toMatchObject({ ok: false, status: 0, error: 'This operation was aborted' })
    releaseDns!([{ address: '93.184.216.34', family: 4 }])
    await Promise.resolve()
    expect(request).not.toHaveBeenCalled()
  })

  it.each([true, false])('真实回环重定向：同 origin=%s 时正确处理敏感头', async (sameOrigin) => {
    let received: import('node:http').IncomingHttpHeaders | undefined
    const server = createServer((req, res) => {
      if (req.url === '/start') {
        const port = (server.address() as AddressInfo).port
        res.writeHead(302, { Location: `http://${sameOrigin ? 'origin' : 'different'}.fixture.test:${port}/end` })
        res.end()
      } else {
        received = req.headers
        res.end('redirected')
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as AddressInfo).port
      const headers = { Authorization: 'Bearer synthetic-fixture', cookie: 'synthetic=fixture', 'X-API-Key': 'synthetic', accept: 'text/html' }
      const result = await fetchText(`http://origin.fixture.test:${port}/start`, headers, 1000, 0, {
        lookupAll: () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]),
        // 仅替换 DNS/网络路由边界；HTTP 请求、逐跳策略、请求头处理均走真实实现。
        request: (target, init) => pinnedRequest(target, { ...init, addresses: [{ address: '127.0.0.1', family: 4 }] }),
      })
      expect(result).toMatchObject({ ok: true, body: 'redirected' })
      expect(received?.authorization).toBe(sameOrigin ? headers.Authorization : undefined)
      expect(received?.cookie).toBe(sameOrigin ? headers.cookie : undefined)
      expect(received?.['x-api-key']).toBe(sameOrigin ? headers['X-API-Key'] : undefined)
      expect(received?.accept).toBe('text/html')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('解析到私网地址 ⇒ 拒绝且不发请求', async () => {
    const calls: unknown[] = []
    const deps: FetchTextDeps = {
      lookupAll: () => Promise.resolve([{ address: '10.0.0.5', family: 4 }]),
      request: () => {
        calls.push(1)
        throw new Error('request must not be called')
      },
    }

    const res = await fetchText('https://example.com/page', {}, 1000, 0, deps)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/SECURITY_REJECT/)
    expect(calls).toHaveLength(0)
  })

  it('合法公网地址 ⇒ 连接固定到已验证地址，正文正常返回', async () => {
    const verified: PinnedAddress[] = [{ address: '93.184.216.34', family: 4 }]
    let seen: readonly PinnedAddress[] | undefined
    const deps: FetchTextDeps = {
      lookupAll: () => Promise.resolve(verified),
      request: (_target, init) => {
        seen = init.addresses
        return Promise.resolve(bodyResponse('hello'))
      },
    }

    const res = await fetchText('https://example.com/page', {}, 1000, 0, deps)
    expect(res.ok).toBe(true)
    expect(res.body).toBe('hello')
    expect(seen).toEqual(verified)
  })

  it('重定向目标解析到私网 ⇒ 逐跳校验拒绝，不访问目标', async () => {
    const requested: string[] = []
    const deps: FetchTextDeps = {
      lookupAll: (hostname) =>
        Promise.resolve(
          hostname === 'evil.example.com'
            ? [{ address: '169.254.169.254', family: 4 }]
            : [{ address: '93.184.216.34', family: 4 }],
        ),
      request: (target) => {
        requested.push(target.hostname)
        return Promise.resolve(redirectResponse('https://evil.example.com/meta'))
      },
    }

    const res = await fetchText('https://example.com/page', {}, 1000, 0, deps)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/SECURITY_REJECT/)
    // 只访问了第一跳；私网目标从未被请求
    expect(requested).toEqual(['example.com'])
  })
})
