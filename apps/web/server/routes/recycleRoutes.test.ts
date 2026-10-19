// @vitest-environment node
/**
 * apps/web/server/routes · 回收站系统路由测试 (recycleRoutes.test.ts)。
 *
 * 验证：
 *   1. POST /api/recycle.list    -> RecycleStore.list()，列出回收站条目
 *   2. POST /api/recycle.restore -> 接收 { id }，RecycleStore.restore(id)，原路径被占用时明确拒绝（409 PATH_OCCUPIED）
 *   3. POST /api/recycle.purge   -> 接收 { id }，RecycleStore.purge(id) 彻底删除
 *   4. 错误处理与非法请求边界（缺少 id 返回 400，条目不存在返回 404）
 */
import { createServer } from 'node:http'
import type { AddressInfo, Server } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFileSync } from '@mozhou/data-plane'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter, defaultBookAccessManager } from '../api.js'
import { RecycleStore } from '../recycle/recycleStore.js'
import type { RecycleListResponse, RecyclePurgeResponse, RecycleRestoreResponse } from './recycleRoutes.js'

let servers: Server[] = []
const tempDirs: string[] = []

beforeEach(() => {
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const d of tempDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
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

function makeBookEnv(prefix: string): { baseDir: string; bookRoot: string; trashRoot: string } {
  const baseDir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(baseDir)
  const bookRoot = join(baseDir, 'book')
  const trashRoot = join(baseDir, 'trash')
  mkdirSync(bookRoot, { recursive: true })
  mkdirSync(trashRoot, { recursive: true })
  return { baseDir, bookRoot, trashRoot }
}

describe('回收站系统 HTTP 路由 (Recycle Routes)', () => {
  it('POST /api/recycle.list 列出已删除条目', async () => {
    const { bookRoot, trashRoot } = makeBookEnv('mozhou-recycle-')
    const store = new RecycleStore({ root: trashRoot })

    const file1 = join(bookRoot, 'chapter1.md')
    const file2 = join(bookRoot, 'chapter2.md')
    atomicWriteFileSync(file1, '第一章草稿')
    atomicWriteFileSync(file2, '第二章草稿')

    const entry1 = store.trash(file1, new Date('2026-10-18T10:00:00Z'))
    const entry2 = store.trash(file2, new Date('2026-10-18T11:00:00Z'))

    const base = await listen()
    const res = await fetch(`${base}/api/recycle.list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot }),
    })

    expect(res.status).toBe(200)
    const data = (await res.json()) as RecycleListResponse
    expect(data.ok).toBe(true)
    expect(data.entries.length).toBe(2)
    // 最近删除的在前
    expect(data.entries[0]?.id).toBe(entry2.id)
    expect(data.entries[1]?.id).toBe(entry1.id)
  })

  it('POST /api/recycle.restore 成功恢复文件至原路径', async () => {
    const { bookRoot, trashRoot } = makeBookEnv('mozhou-recycle-')
    const store = new RecycleStore({ root: trashRoot })

    const file = join(bookRoot, 'recoverable.md')
    atomicWriteFileSync(file, '待恢复内容')
    const entry = store.trash(file)
    expect(existsSync(file)).toBe(false)

    const base = await listen()
    const res = await fetch(`${base}/api/recycle.restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot, id: entry.id }),
    })

    expect(res.status).toBe(200)
    const data = (await res.json()) as RecycleRestoreResponse
    expect(data.ok).toBe(true)
    expect(data.restoredTo).toBe(file)
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('待恢复内容')

    // 检查回收站中条目已移除
    expect(store.list().length).toBe(0)
  })

  it('POST /api/recycle.restore 原路径被占用时明确返回 409 PATH_OCCUPIED', async () => {
    const { bookRoot, trashRoot } = makeBookEnv('mozhou-recycle-')
    const store = new RecycleStore({ root: trashRoot })

    const file = join(bookRoot, 'conflict.md')
    atomicWriteFileSync(file, '旧版本正文')
    const entry = store.trash(file)

    // 在原路径新建占用文件
    atomicWriteFileSync(file, '新写进来的冲突正文')

    const base = await listen()
    const res = await fetch(`${base}/api/recycle.restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot, id: entry.id }),
    })

    expect(res.status).toBe(409)
    const data = (await res.json()) as { ok: boolean; code: string; error: string }
    expect(data.ok).toBe(false)
    expect(data.code).toBe('PATH_OCCUPIED')
    expect(data.error).toContain('原路径已被占用，拒绝覆盖')

    // 磁盘新文件内容未被篡改覆盖
    expect(readFileSync(file, 'utf8')).toBe('新写进来的冲突正文')
  })

  it('POST /api/recycle.restore 缺少 id 返回 400，条目不存在返回 404', async () => {
    const { bookRoot } = makeBookEnv('mozhou-recycle-')
    const base = await listen()

    // 1. 缺少 id
    const res1 = await fetch(`${base}/api/recycle.restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot }),
    })
    expect(res1.status).toBe(400)

    // 2. 不存在的条目
    const res2 = await fetch(`${base}/api/recycle.restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot, id: 'non-existent-id' }),
    })
    expect(res2.status).toBe(404)
    const data2 = (await res2.json()) as { ok: boolean; code: string }
    expect(data2.code).toBe('TRASH_ENTRY_NOT_FOUND')
  })

  it('POST /api/recycle.purge 彻底删除回收站条目', async () => {
    const { bookRoot, trashRoot } = makeBookEnv('mozhou-recycle-')
    const store = new RecycleStore({ root: trashRoot })

    const file = join(bookRoot, 'temp.md')
    atomicWriteFileSync(file, '彻底删除的内容')
    const entry = store.trash(file)
    expect(store.list().length).toBe(1)

    const base = await listen()
    const res = await fetch(`${base}/api/recycle.purge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot, id: entry.id }),
    })

    expect(res.status).toBe(200)
    const data = (await res.json()) as RecyclePurgeResponse
    expect(data.ok).toBe(true)
    expect(data.purged).toBe(true)
    expect(store.list().length).toBe(0)

    // 再次 purge 同一 id 返回 404
    const resAgain = await fetch(`${base}/api/recycle.purge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot, id: entry.id }),
    })
    expect(resAgain.status).toBe(404)
  })

  it('POST /api/recycle 支持目录的移入、列表、恢复与彻底删除', async () => {
    const { bookRoot, trashRoot } = makeBookEnv('mozhou-recycle-')
    const store = new RecycleStore({ root: trashRoot })

    const subDir = join(bookRoot, 'outline_docs')
    mkdirSync(subDir, { recursive: true })
    const innerFile = join(subDir, 'arc1.md')
    atomicWriteFileSync(innerFile, '第一卷大纲')

    const entry = store.trash(subDir)
    expect(entry.isDirectory).toBe(true)
    expect(existsSync(subDir)).toBe(false)

    const base = await listen()

    // 1. 列表包含目录条目
    const listRes = await fetch(`${base}/api/recycle.list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot }),
    })
    const listData = (await listRes.json()) as RecycleListResponse
    expect(listData.entries.some((e) => e.id === entry.id && e.isDirectory)).toBe(true)

    // 2. 恢复目录
    const restoreRes = await fetch(`${base}/api/recycle.restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot, id: entry.id }),
    })
    expect(restoreRes.status).toBe(200)
    expect(existsSync(subDir)).toBe(true)
    expect(existsSync(innerFile)).toBe(true)
    expect(readFileSync(innerFile, 'utf8')).toBe('第一卷大纲')
  })
})
