// @vitest-environment node
/**
 * T1 / T2 回归锁（传输层）：按 Content-Encoding 解压，以及响应体阶段取消的错误分类。
 *
 * 全部走**真实回环 HTTP**（127.0.0.1，无外部网络）：独立验收实跑输入是
 * 「上游分别返回 gzip 与 br 编码的 SSE / HTML」——修复前 SSE 为空数组、HTML 为乱码。
 */
import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { brotliCompressSync, constants, createGzip, deflateSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { pinnedRequest } from './pinnedHttp.js'

let servers: Server[] = []
afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  servers = []
})

interface Fixture {
  readonly url: string
  readonly seenAcceptEncoding: () => string | undefined
}

function start(handler: (req: IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<Fixture> {
  let acceptEncoding: string | undefined
  const server = createServer((req, res) => {
    acceptEncoding = req.headers['accept-encoding']
    handler(req, res)
  })
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({ url: `http://127.0.0.1:${addr.port}/`, seenAcceptEncoding: () => acceptEncoding })
    })
  })
}

async function readUntilError(body: AsyncIterable<Buffer>, onFirst?: () => void): Promise<unknown> {
  const iterator = body[Symbol.asyncIterator]()
  let seen = 0
  try {
    for (;;) {
      const next = await iterator.next()
      if (next.done === true) return null
      seen += 1
      if (seen === 1) onFirst?.()
    }
  } catch (error) {
    return error
  }
}

describe('pinnedRequest · Content-Encoding 解压（T1）', () => {
  it('默认发送 Accept-Encoding（与原生 fetch 的协商行为一致）', async () => {
    const fixture = await start((_req, res) => res.end('plain'))
    await pinnedRequest(new URL(fixture.url), { method: 'GET', headers: {} })
    expect(fixture.seenAcceptEncoding()).toBe('gzip, deflate')
  })

  it.each([
    ['gzip', (body: Buffer) => gzipSync(body)],
    ['deflate', (body: Buffer) => deflateSync(body)],
    ['br', (body: Buffer) => brotliCompressSync(body)],
  ])('%s 压缩响应按 Content-Encoding 解压后 text() 得到原文', async (encoding, compress) => {
    const payload = '<h1>甲</h1>'
    const fixture = await start((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': encoding })
      res.end(compress(Buffer.from(payload, 'utf8')))
    })
    const response = await pinnedRequest(new URL(fixture.url), { method: 'GET', headers: {} })
    expect(await response.text()).toBe(payload)
  })

  it('压缩的 SSE 流：stream 逐块产出解压后的文本', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"甲"}}]}\n\ndata: [DONE]\n\n'
    const fixture = await start((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Content-Encoding': 'gzip' })
      res.end(gzipSync(Buffer.from(sse, 'utf8')))
    })
    const response = await pinnedRequest(new URL(fixture.url), { method: 'GET', headers: {} })
    expect(response.stream).not.toBeNull()
    let text = ''
    for await (const chunk of response.stream!) text += chunk.toString('utf8')
    expect(text).toBe(sse)
  })

  it('压缩的非成功响应：text() 仍能读出错误体', async () => {
    const fixture = await start((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
      res.end(gzipSync(Buffer.from('{"error":"boom"}', 'utf8')))
    })
    const response = await pinnedRequest(new URL(fixture.url), { method: 'GET', headers: {} })
    expect(response.ok).toBe(false)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('{"error":"boom"}')
  })

  it('未支持的 Content-Encoding：显式拒绝，不把压缩字节当正文', async () => {
    const fixture = await start((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'zstd' })
      res.end('opaque')
    })
    await expect(pinnedRequest(new URL(fixture.url), { method: 'GET', headers: {} })).rejects.toThrow(
      /未支持的 Content-Encoding/,
    )
  })
})

describe('pinnedRequest · 响应体阶段取消的错误分类（T2）', () => {
  it('压缩的 SSE 等待下一帧时取消：及时拒绝并保留 AbortError', async () => {
    let closed: Promise<void> | undefined
    const fixture = await start((_req, res) => {
      closed = new Promise<void>((resolve) => res.on('close', resolve))
      res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Type': 'text/event-stream' })
      const gzip = createGzip()
      gzip.pipe(res)
      gzip.write('data: one\n\n')
      gzip.flush(constants.Z_SYNC_FLUSH)
      res.on('close', () => gzip.destroy())
    })
    const controller = new AbortController()
    const response = await pinnedRequest(new URL(fixture.url), { method: 'GET', headers: {}, signal: controller.signal })
    const iterator = response.stream![Symbol.asyncIterator]()
    expect((await iterator.next()).done).toBe(false)
    const pending = iterator.next()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await closed
  })

  it('压缩文本首个解压字节前取消：读取不会悬挂', async () => {
    const fixture = await start((_req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' })
      res.write(Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 3]))
    })
    const controller = new AbortController()
    const response = await pinnedRequest(new URL(fixture.url), { method: 'GET', headers: {}, signal: controller.signal })
    const text = response.text()
    controller.abort()
    await expect(text).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('压缩响应远端在完整结束前断开：上抛网络错误且不冒充用户取消', async () => {
    let disconnect: (() => void) | undefined
    const fixture = await start((_req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' })
      const gzip = createGzip()
      gzip.pipe(res)
      gzip.write('one')
      gzip.flush(constants.Z_SYNC_FLUSH)
      disconnect = () => res.socket?.destroy()
      res.on('close', () => gzip.destroy())
    })
    const controller = new AbortController()
    const response = await pinnedRequest(new URL(fixture.url), { method: 'GET', headers: {}, signal: controller.signal })
    const iterator = response.stream![Symbol.asyncIterator]()
    expect((await iterator.next()).done).toBe(false)
    const pending = iterator.next()
    disconnect!()
    await expect(pending).rejects.toMatchObject({ code: 'ECONNRESET' })
    expect(controller.signal.aborted).toBe(false)
  })

  it('消费者提前停止压缩流：无显式 signal 时也释放连接', async () => {
    let closed: Promise<void> | undefined
    const fixture = await start((_req, res) => {
      closed = new Promise<void>((resolve) => res.on('close', resolve))
      res.writeHead(200, { 'Content-Encoding': 'gzip' })
      const gzip = createGzip()
      gzip.pipe(res)
      gzip.write('one')
      gzip.flush(constants.Z_SYNC_FLUSH)
      res.on('close', () => gzip.destroy())
    })
    const response = await pinnedRequest(new URL(fixture.url), { method: 'GET', headers: {} })
    for await (const chunk of response.stream!) {
      expect(chunk.toString()).toBe('one')
      break
    }
    await closed
  })

  it('主动取消：错误保留 AbortError 分类', async () => {
    const fixture = await start((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: one\n\n')
      // 保持连接不结束，等客户端取消
    })
    const controller = new AbortController()
    const response = await pinnedRequest(new URL(fixture.url), {
      method: 'GET',
      headers: {},
      signal: controller.signal,
    })
    const error = await readUntilError(response.stream!, () => controller.abort())
    expect((error as Error).name).toBe('AbortError')
  })

  it('远端断开（客户端未取消）：仍是网络错误，不误报为取消', async () => {
    const fixture = await start((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: one\n\n')
      setTimeout(() => res.socket?.destroy(), 20)
    })
    const controller = new AbortController()
    const response = await pinnedRequest(new URL(fixture.url), {
      method: 'GET',
      headers: {},
      signal: controller.signal,
    })
    const error = await readUntilError(response.stream!)
    expect(error).not.toBeNull()
    expect((error as Error).name).not.toBe('AbortError')
    expect(controller.signal.aborted).toBe(false)
  })
})
