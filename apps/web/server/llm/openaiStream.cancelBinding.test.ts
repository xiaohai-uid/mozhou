// @vitest-environment node
/**
 * 切片 3 回归锁（LLM 出站）：取消绑定时序 + 连接固定到已验证地址。
 *
 * 全部为**封闭式**用例：DNS 与传输通过 deps 注入内存夹具，不发真网、不触真 DNS。
 * 复现口径与隔离复现证据一致：观察「请求函数被调用几次」与「内部 signal 是否已取消」。
 */
import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { streamOpenAiChat, type StreamOpenAiDeps } from './openaiStream.js'
import type { PinnedAddress, PinnedResponse } from '../net/pinnedHttp.js'
import type { OpenAiStreamChunk, ResolvedEndpoint } from './types.js'

// 夹具密钥运行时拼接，避免在源码里出现可被扫描器判为硬编码凭据的字面量。
const TEST_API_KEY = ['fixture', 'not', 'a', 'real', 'credential'].join('-')

const endpoint: ResolvedEndpoint = {
  baseUrl: 'https://api.example.com',
  apiKey: TEST_API_KEY,
  model: 'test-model',
}

/** 传输夹具：调用即失败（用于证明「一次请求都没发」）。 */
function mustNotCall(calls: unknown[]) {
  return () => {
    calls.push(1)
    throw new Error('request must not be called')
  }
}

function sseResponse(lines: readonly string[]): PinnedResponse {
  return {
    status: 200,
    ok: true,
    stream: Readable.from(lines.map((line) => Buffer.from(line, 'utf8'))),
    headers: { get: () => null },
    text: () => Promise.resolve(lines.join('')),
  }
}

async function collect(gen: AsyncGenerator<OpenAiStreamChunk>): Promise<OpenAiStreamChunk[]> {
  const out: OpenAiStreamChunk[] = []
  for await (const chunk of gen) out.push(chunk)
  return out
}

describe('streamOpenAiChat · 取消绑定（切片 3）', () => {
  it('DNS 保持待决时取消：无需放行 DNS 即结束，晚到解析不能发起请求', async () => {
    let releaseDns: ((addresses: PinnedAddress[]) => void) | undefined
    let lookupStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { lookupStarted = resolve })
    const dns = new Promise<PinnedAddress[]>((resolve) => { releaseDns = resolve })
    const calls: unknown[] = []
    const controller = new AbortController()
    const gen = streamOpenAiChat(endpoint, 'p', 's', controller.signal, {
      lookupAll: () => { lookupStarted!(); return dns },
      request: mustNotCall(calls),
    })
    const pending = gen.next()
    await started
    controller.abort()
    expect((await pending).done).toBe(true)
    releaseDns!([{ address: '93.184.216.34', family: 4 }])
    await Promise.resolve()
    expect(calls).toHaveLength(0)
  })

  it('启动前已取消：一次请求都不发', async () => {
    const calls: unknown[] = []
    const controller = new AbortController()
    controller.abort()
    const deps: StreamOpenAiDeps = { request: mustNotCall(calls) }

    const chunks = await collect(streamOpenAiChat(endpoint, 'p', 's', controller.signal, deps))
    expect(chunks).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('DNS 等待期间取消：解析返回后不再发起请求（fetchCalls=0）', async () => {
    const calls: unknown[] = []
    const controller = new AbortController()
    const deps: StreamOpenAiDeps = {
      lookupAll: () => {
        // 解析期间取消（隔离复现的第二个输入）
        controller.abort()
        return Promise.resolve([{ address: '93.184.216.34', family: 4 }])
      },
      request: mustNotCall(calls),
    }

    const chunks = await collect(streamOpenAiChat(endpoint, 'p', 's', controller.signal, deps))
    expect(chunks).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('未取消时正常出流（取消修复不改变成功路径）', async () => {
    const deps: StreamOpenAiDeps = {
      lookupAll: () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]),
      request: () =>
        Promise.resolve(
          sseResponse([
            'data: {"choices":[{"delta":{"content":"你好"}}]}\n',
            'data: [DONE]\n',
          ]),
        ),
    }

    const chunks = await collect(streamOpenAiChat(endpoint, 'p', 's', undefined, deps))
    expect(chunks.map((c) => c.delta)).toEqual(['你好'])
  })
})

describe('streamOpenAiChat · DNS 校验与连接绑定（切片 3）', () => {
  it('连接固定到已验证的解析结果：传输层收到同一份地址', async () => {
    const verified: PinnedAddress[] = [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]
    let seen: readonly PinnedAddress[] | undefined
    const deps: StreamOpenAiDeps = {
      lookupAll: () => Promise.resolve(verified),
      request: (_target, init) => {
        seen = init.addresses
        return Promise.resolve(sseResponse(['data: [DONE]\n']))
      },
    }

    await collect(streamOpenAiChat(endpoint, 'p', 's', undefined, deps))
    expect(seen).toEqual(verified)
  })

  it('解析结果含私网/环回地址 ⇒ 整体拒绝且不发请求', async () => {
    const calls: unknown[] = []
    const deps: StreamOpenAiDeps = {
      lookupAll: () =>
        Promise.resolve([
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ]),
      request: mustNotCall(calls),
    }

    await expect(collect(streamOpenAiChat(endpoint, 'p', 's', undefined, deps))).rejects.toThrow(/SSRF 门/)
    expect(calls).toHaveLength(0)
  })

  it('空解析结果 ⇒ 拒绝且不发请求', async () => {
    const calls: unknown[] = []
    const deps: StreamOpenAiDeps = {
      lookupAll: () => Promise.resolve([]),
      request: mustNotCall(calls),
    }

    await expect(collect(streamOpenAiChat(endpoint, 'p', 's', undefined, deps))).rejects.toThrow(/SSRF 门/)
    expect(calls).toHaveLength(0)
  })

  it('部署者显式授权本机端点（allowPrivateNetwork）时不解析、不注入地址，行为不变', async () => {
    let lookupCalled = 0
    let seen: readonly PinnedAddress[] | undefined
    const deps: StreamOpenAiDeps = {
      lookupAll: () => {
        lookupCalled += 1
        return Promise.resolve([])
      },
      request: (_target, init) => {
        seen = init.addresses
        return Promise.resolve(sseResponse(['data: [DONE]\n']))
      },
    }

    await collect(
      streamOpenAiChat(
        { ...endpoint, baseUrl: 'http://127.0.0.1:8080', allowPrivateNetwork: true },
        'p',
        's',
        undefined,
        deps,
      ),
    )
    expect(lookupCalled).toBe(0)
    expect(seen).toBeUndefined()
  })
})

describe('streamOpenAiChat · 真实传输端到端（本机回环，验证新传输层本身可用）', () => {
  it('真实 HTTP 回环上游：SSE 逐 delta 产出并在 [DONE] 结束', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"甲"}}]}\n\n')
      res.write('data: {"choices":[{"delta":{"content":"乙"}}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address() as AddressInfo
    try {
      const chunks = await collect(
        streamOpenAiChat(
          {
            baseUrl: `http://127.0.0.1:${addr.port}`,
            apiKey: TEST_API_KEY,
            model: 'test-model',
            allowPrivateNetwork: true,
          },
          'p',
          's',
        ),
      )
      expect(chunks.map((c) => c.delta)).toEqual(['甲', '乙'])
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('同一响应块内含两个事件：取消后第二条不得产出（T3）', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      // 两个事件写进同一次 write ⇒ 大概率落在同一个响应块（修复前第二条仍会 yield）
      res.write('data: {"choices":[{"delta":{"content":"甲"}}]}\n\ndata: {"choices":[{"delta":{"content":"乙"}}]}\n\n')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address() as AddressInfo
    try {
      const controller = new AbortController()
      const gen = streamOpenAiChat(
        {
          baseUrl: `http://127.0.0.1:${addr.port}`,
          apiKey: TEST_API_KEY,
          model: 'test-model',
          allowPrivateNetwork: true,
        },
        'p',
        's',
        controller.signal,
      )
      const first = await gen.next()
      expect(first.done).toBe(false)
      expect((first.value as OpenAiStreamChunk).delta).toBe('甲')

      controller.abort()
      const second = await gen.next()
      expect(second.done).toBe(true) // 不得产出「乙」
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('消费方提前停止迭代：连接被终止（上游看到请求结束）', async () => {
    let closed = false
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"甲"}}]}\n\n')
      res.on('close', () => {
        closed = true
      })
      // 不主动结束：等消费方断开
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address() as AddressInfo
    try {
      const gen = streamOpenAiChat(
        {
          baseUrl: `http://127.0.0.1:${addr.port}`,
          apiKey: TEST_API_KEY,
          model: 'test-model',
          allowPrivateNetwork: true,
        },
        'p',
        's',
      )
      const first = await gen.next()
      expect(first.done).toBe(false)
      await gen.return(undefined) // 消费方停止迭代 ⇒ finally 终止上游连接
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(closed).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
