/**
 * apps/web 同进程 API 中间件测试（Phase 6；t76 R1 修订形态）。
 * 黑盒：真实 HTTP 起服 → POST /api/* 断言 JSON 直出。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { entityCardFileRel } from '@mozhou/data-plane'
import type { EntityRef } from '@mozhou/kernel'
import { apiMiddleware } from '../server/api'

let servers: ReturnType<typeof createServer>[] = []
let roots: string[] = []
afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const r of roots) rmSync(r, { recursive: true, force: true })
  roots = []
})

function listen(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      apiMiddleware()(req, res, () => { res.statusCode = 404; res.end('nf') })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve('http://127.0.0.1:' + addr.port)
    })
  })
}

async function post(base: string, path: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as Record<string, unknown>
  return { status: res.status, data }
}

describe('apps/web api 中间件 · T31/T32', () => {
  it('POST /api/book 建书：返回 root 与 bookId', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-api-'))
    roots.push(dir)
    const { status, data } = await post(base, '/api/book', { title: '测试之书', dir })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(typeof data.root).toBe('string')
    expect(typeof data.bookId).toBe('string')
  })

  it('POST /api/story-brain.entities：直出 scanEntityCards 的实体卡契约', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-api-'))
    roots.push(dir)
    const created = await post(base, '/api/book', { title: '实体书', dir })
    const root = created.data.root as string
    const ref = 'character:linzhou' as EntityRef
    const rel = entityCardFileRel(ref)
    const absolute = join(root, rel)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(
      absolute,
      '---\nref: character:linzhou\nname: 林舟\nbrief: 主角\n---\n# 林舟\n',
      'utf8',
    )

    const { status, data } = await post(base, '/api/story-brain.entities', { root })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.cards).toEqual([
      expect.objectContaining({
        ref: 'character:linzhou',
        cardType: 'character',
        name: '林舟',
        brief: '主角',
        aiContext: 'detected',
      }),
    ])
  })

  it('POST /api/ledger：新建书的账本为空数组（无事件）', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-api-'))
    roots.push(dir)
    const created = await post(base, '/api/book', { title: '账本书', dir })
    const root = created.data.root as string
    const { status, data } = await post(base, '/api/ledger', { root })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.events).toEqual([])
  })

  it('缺 root 的 ledger 请求返回 400 显式错误（失败显式，UVSD §14）', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/ledger', {})
    expect(status).toBe(400)
    expect(data.ok).toBe(false)
    expect(typeof data.error).toBe('string')
  })

  it('非 api 路径交给 next（404 由下游处理）', async () => {
    const base = await listen()
    const res = await fetch(base + '/index.html')
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('nf')
  })
})
