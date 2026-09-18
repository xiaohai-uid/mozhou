// @vitest-environment node
/**
 * 作品备份与恢复路由测试 (T10 · 真实 HTTP 级端到端测试)。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { createBook, LocalDataPlane, renderProseChapter, proseChapterPath } from '@mozhou/data-plane'
import { defaultBookAccessManager } from '../bookAccess.js'
import { defaultSessionManager, InMemoryAuthProvider } from '../auth/session.js'

let servers: ReturnType<typeof createServer>[] = []
let tempDirs: string[] = []

beforeEach(() => {
  defaultSessionManager.clear()
  defaultSessionManager.setProvider(new InMemoryAuthProvider())
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  tempDirs = []
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

describe('作品归档备份与恢复路由 (T10)', () => {
  it('生成备份 → 下载 → 恢复为新作品全流程验证', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-backup-suite-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)

    const base = await listen()
    const srcDir = join(dataRoot, 'original-book')
    const created = createBook({ dir: srcDir, title: '测试作品原稿' })
    const plane = LocalDataPlane.open(srcDir)
    plane.createChapterDraft({ chapterIndex: 1, title: '第1章' })
    const text = renderProseChapter({
      mozhouId: created.book.id,
      revision: 1,
      chapterIndex: 1,
      phase: 'draft',
      body: '江南春雨，润物无声。',
    })
    writeFileSync(join(srcDir, proseChapterPath(1)), text, 'utf8')
    plane.close()

    // 1. 生成备份
    const resBackup = await fetch(`${base}/api/backups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: srcDir }),
    })
    expect(resBackup.status).toBe(200)
    const dataBackup = (await resBackup.json()) as { ok: boolean; backupId: string; bytes: number; sha256: string }
    expect(dataBackup.ok).toBe(true)
    expect(typeof dataBackup.backupId).toBe('string')
    expect(dataBackup.bytes).toBeGreaterThan(0)
    expect(dataBackup.sha256.length).toBe(64)

    // 2. 下载备份
    const resDownload = await fetch(`${base}/api/backups/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupId: dataBackup.backupId }),
    })
    expect(resDownload.status).toBe(200)
    expect(resDownload.headers.get('Content-Type')).toBe('application/zip')
    const zipBytes = await resDownload.arrayBuffer()
    expect(zipBytes.byteLength).toBe(dataBackup.bytes)

    // 3. 从备份恢复为新作品
    const resRestore = await fetch(`${base}/api/backups/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupId: dataBackup.backupId }),
    })
    expect(resRestore.status).toBe(200)
    const dataRestore = (await resRestore.json()) as {
      ok: boolean
      bookId: string
      title: string
      root: string
      restoredFiles: number
    }
    expect(dataRestore.ok).toBe(true)
    expect(dataRestore.title).toBe('测试作品原稿')
    expect(dataRestore.restoredFiles).toBeGreaterThanOrEqual(2)

    // 4. 打开恢复后的新作品验证
    const restoredPlane = LocalDataPlane.open(dataRestore.root)
    const restoredChapter = restoredPlane.getProseChapter(1)
    expect(restoredChapter.body).toContain('江南春雨')
    restoredPlane.close()
  })

  it('恢复时拦截自定义 destination 路径注入', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-backup-dest-inject-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)

    const base = await listen()
    const res = await fetch(`${base}/api/backups/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backupId: 'bup_test_mock',
        destination: '/etc/arbitrary/path',
      }),
    })
    expect(res.status).toBe(400)
    const data = (await res.json()) as { ok: boolean; code: string }
    expect(data.ok).toBe(false)
    expect(data.code).toBe('INVALID_INPUT')
  })
})
