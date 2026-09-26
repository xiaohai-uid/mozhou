// @vitest-environment node
/**
 * 本地建书的默认落位回归（数据根包含性）。
 *
 * 回归防护：POST /api/book 在本地模式缺 dir 时曾默认 '/tmp/mozhou-book-<ts>'——
 * Windows 上落到 C:\tmp，书脱离数据根：不在书架扫描范围、不随数据根备份、
 * 无法随数据卷迁移（SPEC「作品在用户选定目录」的本地默认应受数据根约束）。
 * 故断言：未传 dir 时书落在 <dataRoot>/books/ 下；显式 dir 仍被尊重。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'

let servers: ReturnType<typeof createServer>[] = []
const tempDirs: string[] = []
const ORIGINAL_DATA_ROOT = process.env['MOZHOU_DATA_ROOT']

beforeEach(() => {
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const server of servers) server.close()
  servers = []
  if (ORIGINAL_DATA_ROOT === undefined) {
    delete process.env['MOZHOU_DATA_ROOT']
  } else {
    process.env['MOZHOU_DATA_ROOT'] = ORIGINAL_DATA_ROOT
  }
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
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

async function createBook(base: string, body: Record<string, unknown>): Promise<{ root: string; bookId: string }> {
  const res = await fetch(`${base}/api/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(res.status).toBe(200)
  const data = (await res.json()) as { ok: boolean; root: string; bookId: string }
  expect(data.ok).toBe(true)
  return data
}

describe('POST /api/book · 本地建书默认落位', () => {
  it('未传 dir 时书落在 <dataRoot>/books/ 下，而不是系统临时目录', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-bookplace-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)

    const base = await listen()
    const created = await createBook(base, { title: '落位测试书' })

    const expectedParent = resolve(dataRoot, 'books')
    expect(created.root.startsWith(expectedParent + sep)).toBe(true)
    // 旧默认 '/tmp/mozhou-book-<ts>' 的回归标记：目录名不得再使用该模式
    expect(created.root).not.toContain('mozhou-book-')
    expect(existsSync(join(created.root, 'book.json'))).toBe(true)

    // 书已注册进书架读面（能被打开）
    const state = await fetch(`${base}/api/book.state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: created.root }),
    })
    expect(state.status).toBe(200)
  })

  it('显式 dir 仍被尊重（用户选定目录场景）', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-bookplace-explicit-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)
    const customDir = join(dataRoot, '我的书目录')

    const base = await listen()
    const created = await createBook(base, { title: '指定目录书', dir: customDir })

    expect(created.root).toBe(resolve(customDir))
    expect(existsSync(join(created.root, 'book.json'))).toBe(true)
  })
})
