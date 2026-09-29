// @vitest-environment node
/**
 * 备忘录路由集成测试（OpenWrite 对标切片 · 工单 22 · 真实 HTTP + 磁盘回读）：
 * - create → list → update → delete 全链路（本地模式回退主体 local_user）；
 * - 校验失败 400 / 便签缺失 404 / 超上限 409（MEMO_LIMIT_EXCEEDED）；
 * - 损坏文件 → 500 MEMO_PERSIST_FAILED（不静默丢数据）；
 * - 存储按 userId 隔离（SHA-256 分文件，hosted 多用户语义）。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../../server/api.js'
import { defaultMemoStore, MemoStore } from '../../server/memo/memoStore.js'

let server: ReturnType<typeof createServer> | null = null
let root = ''

function startServer(): Promise<string> {
  return new Promise((resolveListen) => {
    server = createServer((req, res) => {
      apiMiddleware()(req, res, () => { res.statusCode = 404; res.end('nf') })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address() as AddressInfo
      resolveListen(`http://127.0.0.1:${addr.port}`)
    })
  })
}

function memoFileFor(userId: string): string {
  const hash = createHash('sha256').update(userId).digest('hex')
  return join(root, 'memo', `${hash}.json`)
}

async function call(base: string, body: Record<string, unknown>): Promise<{ status: number; payload: Record<string, unknown> }> {
  const res = await fetch(`${base}/api/memo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, payload: (await res.json()) as Record<string, unknown> }
}

afterEach(() => {
  if (server !== null) server.close()
  server = null
  if (root !== '') {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
  root = ''
})

describe('POST /api/memo（备忘录 · 工单 22）', () => {
  it('create → list → update → delete 全链路（本地回退主体 local_user）', async () => {
    root = mkdtempSync(join(tmpdir(), 'mozhou-memo-'))
    defaultMemoStore.setDataRoot(root)
    const base = await startServer()

    const created = await call(base, { action: 'create', title: '第三章钩子', content: '雨夜追逐后留下断簪。' })
    expect(created.status).toBe(200)
    const note = created.payload['note'] as { id: string; title: string; content: string }
    expect(note.title).toBe('第三章钩子')
    expect(typeof note.id).toBe('string')

    const listed = await call(base, { action: 'list' })
    expect(listed.status).toBe(200)
    expect((listed.payload['notes'] as unknown[]).length).toBe(1)
    expect(listed.payload['notes']).toMatchObject([{ id: note.id }])

    const updated = await call(base, { action: 'update', id: note.id, title: '改后钩子' })
    expect(updated.status).toBe(200)
    expect((updated.payload['note'] as { title: string }).title).toBe('改后钩子')
    expect((updated.payload['note'] as { content: string }).content).toBe('雨夜追逐后留下断簪。')

    const removed = await call(base, { action: 'delete', id: note.id })
    expect(removed.status).toBe(200)
    expect(removed.payload['deleted']).toBe(true)
    const afterDelete = await call(base, { action: 'delete', id: note.id })
    expect(afterDelete.status).toBe(404)
    expect(afterDelete.payload['code']).toBe('MEMO_NOTE_NOT_FOUND')
  })

  it('校验失败：空 content / 未知 action / 超长 title → 400', async () => {
    root = mkdtempSync(join(tmpdir(), 'mozhou-memo-'))
    defaultMemoStore.setDataRoot(root)
    const base = await startServer()

    const empty = await call(base, { action: 'create', title: '', content: '   ' })
    expect(empty.status).toBe(400)
    expect(empty.payload['code']).toBe('INVALID_MEMO_REQUEST')

    const unknownAction = await call(base, { action: 'purge' })
    expect(unknownAction.status).toBe(400)

    const longTitle = await call(base, { action: 'create', title: '字'.repeat(201), content: 'ok' })
    expect(longTitle.status).toBe(400)
  })

  it('update 缺少可更新字段 → 400；不存在的 id → 404', async () => {
    root = mkdtempSync(join(tmpdir(), 'mozhou-memo-'))
    defaultMemoStore.setDataRoot(root)
    const base = await startServer()

    const noFields = await call(base, { action: 'update', id: 'x' })
    expect(noFields.status).toBe(400)

    const missing = await call(base, { action: 'update', id: 'no-such', content: 'x' })
    expect(missing.status).toBe(404)
    expect(missing.payload['code']).toBe('MEMO_NOTE_NOT_FOUND')
  })

  it('超过 200 条 → 409 MEMO_LIMIT_EXCEEDED（不静默丢数据）', async () => {
    root = mkdtempSync(join(tmpdir(), 'mozhou-memo-'))
    defaultMemoStore.setDataRoot(root)
    const base = await startServer()

    for (let i = 0; i < 200; i += 1) {
      const r = await call(base, { action: 'create', title: `n${i}`, content: `c${i}` })
      expect(r.status).toBe(200)
    }
    const overflow = await call(base, { action: 'create', title: 'over', content: 'x' })
    expect(overflow.status).toBe(409)
    expect(overflow.payload['code']).toBe('MEMO_LIMIT_EXCEEDED')
  })

  it('损坏的便签文件 → list 500 MEMO_PERSIST_FAILED（诚实报错）', async () => {
    root = mkdtempSync(join(tmpdir(), 'mozhou-memo-'))
    defaultMemoStore.setDataRoot(root)
    mkdirSync(join(root, 'memo'), { recursive: true })
    writeFileSync(memoFileFor('local_user'), 'not-json{', 'utf8')
    const base = await startServer()

    const broken = await call(base, { action: 'list' })
    expect(broken.status).toBe(500)
    expect(broken.payload['code']).toBe('MEMO_PERSIST_FAILED')
  })

  it('存储按 userId 隔离：两个主体互不可见', () => {
    root = mkdtempSync(join(tmpdir(), 'mozhou-memo-'))
    const store = new MemoStore()
    store.setDataRoot(root)

    store.create('user-a', 'A 的便签', '只属于 A')
    const listB = store.list('user-b')
    expect(listB).toHaveLength(0)
    expect(store.list('user-a')).toHaveLength(1)
  })
})
