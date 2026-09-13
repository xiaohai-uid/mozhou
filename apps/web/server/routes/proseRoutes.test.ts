// @vitest-environment node
/**
 * 章节正文存取路由集成测试（Ink Realm 主权链 P1 · 黑盒真实 HTTP）：
 * - POST /api/chapter.prose.save：新书无章 → 建章草稿 + 作者文本落盘（revision≥1，
 *   phase 恒 draft，无 commitId）；已有草稿 → revision+1 原子覆写；空 body 400。
 * - POST /api/chapter.quality：无章新书 → 200 no_review（诚实守卫），而非 500。
 * Commit 语义不受影响：本路由绝不翻转相位。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../../server/api.js'
import { createBook, proseChapterPath } from '@mozhou/data-plane'

let servers: ReturnType<typeof createServer>[] = []
let roots: string[] = []
let bases: string[] = []
afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
  roots = []
  bases = []
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

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-prose-'))
  roots.push(dir)
  return dir
}

describe('POST /api/chapter.prose.save（Accept → Active Draft 主权链）', () => {
  it('新书无章：自动建章草稿并落作者文本（phase 恒 draft，无 commitId）', async () => {
    const base = await listen()
    const root = makeRoot()
    await post(base, '/api/book', { title: '主权链测试书', dir: root })

    const { status, data } = await post(base, '/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: '　　雨夜码头，黑船靠岸。',
      title: '主权链测试书',
    })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.phase).toBe('draft')
    expect(data.created).toBe(true)
    expect(Number(data.revision)).toBeGreaterThanOrEqual(1)

    const raw = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    expect(raw).toContain('phase: draft')
    expect(raw).toContain('黑船靠岸')
    expect(raw).not.toContain('commitId')
  })

  it('已有草稿章：revision 递增原子覆写，作者文本替换', async () => {
    const base = await listen()
    const root = makeRoot()
    await post(base, '/api/book', { title: '主权链测试书', dir: root })
    const first = await post(base, '/api/chapter.prose.save', { root, chapterIndex: 2, body: '第一版文本。', title: '主权链测试书' })
    const second = await post(base, '/api/chapter.prose.save', { root, chapterIndex: 2, body: '第二版文本，作者在写作层改过。', title: '主权链测试书' })

    expect(second.status).toBe(200)
    expect(Number(second.data.revision)).toBe(Number(first.data.revision) + 1)
    const raw = readFileSync(join(root, proseChapterPath(2)), 'utf8')
    expect(raw).toContain('第二版文本')
    expect(raw).not.toContain('第一版文本')
  })

  it('空 body：400 显式拒绝', async () => {
    const base = await listen()
    const root = makeRoot()
    await post(base, '/api/book', { title: '主权链测试书', dir: root })
    const { status, data } = await post(base, '/api/chapter.prose.save', { root, chapterIndex: 1, body: '   ' })
    expect(status).toBe(400)
    expect(String(data.error)).toContain('non-empty body')
  })

  it('POST /api/chapter.quality 无章新书：200 no_review（诚实守卫，非 500）', async () => {
    const base = await listen()
    const root = makeRoot()
    await post(base, '/api/book', { title: '主权链测试书', dir: root })
    const { status, data } = await post(base, '/api/chapter.quality', { root, chapterIndex: 1 })
    expect(status).toBe(200)
    expect(data.status).toBe('no_review')
    expect(data.report).toBeNull()
  })
})
