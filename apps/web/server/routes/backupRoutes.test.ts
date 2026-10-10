// @vitest-environment node
/**
 * 作品备份与恢复路由测试 (T10 · 真实 HTTP 级端到端测试)。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
    // 对外宣称的 sha256 必须描述盘上/下载的真实字节，而不是内存缓冲
    expect(createHash('sha256').update(Buffer.from(zipBytes)).digest('hex')).toBe(dataBackup.sha256)
    // 原子落盘：备份目录不留任何 `.mozhou-tmp` 临时文件
    expect(readdirSync(join(dataRoot, 'backups')).filter((n) => n.includes('.mozhou-tmp'))).toEqual([])

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

  // DELTA-007（2026-10-07）：UI 下载链接走 GET /api/backups/download?backupId=...（CloudSyncView.tsx），
  // 修复前 GET 只从 body 读 backupId，恒 400。本用例覆盖 GET query 通道的真实用户路径。
  it('下载 GET query 通道：合法 id 200 ZIP / 非法 id 400 / 不存在 id 404 (DELTA-007)', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-backup-get-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)

    const base = await listen()
    const srcDir = join(dataRoot, 'original-book')
    const created = createBook({ dir: srcDir, title: 'GET 通道测试作品' })
    const plane = LocalDataPlane.open(srcDir)
    plane.createChapterDraft({ chapterIndex: 1, title: '第1章' })
    const text = renderProseChapter({
      mozhouId: created.book.id,
      revision: 1,
      chapterIndex: 1,
      phase: 'draft',
      body: '渡口灯火，照彻归人。',
    })
    writeFileSync(join(srcDir, proseChapterPath(1)), text, 'utf8')
    plane.close()

    // 先经真实 POST /api/backups 生成归档，GET 下载的是真实落盘文件
    const resBackup = await fetch(`${base}/api/backups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: srcDir }),
    })
    expect(resBackup.status).toBe(200)
    const dataBackup = (await resBackup.json()) as { ok: boolean; backupId: string; bytes: number }
    expect(dataBackup.ok).toBe(true)

    // 1. UI 真实路径形状：GET ?backupId=... → 200 ZIP
    const resGet = await fetch(`${base}/api/backups/download?backupId=${dataBackup.backupId}`)
    expect(resGet.status).toBe(200)
    expect(resGet.headers.get('Content-Type')).toBe('application/zip')
    expect(resGet.headers.get('Content-Disposition')).toBe(`attachment; filename="${dataBackup.backupId}.zip"`)
    const zipBytes = await resGet.arrayBuffer()
    expect(zipBytes.byteLength).toBe(dataBackup.bytes)

    // 2. 非法 id（路径穿越形状，query 解码后不过白名单正则）→ 400 INVALID_BACKUP_ID
    const resInvalid = await fetch(`${base}/api/backups/download?backupId=..%2F..%2Fsecret`)
    expect(resInvalid.status).toBe(400)
    const dataInvalid = (await resInvalid.json()) as { ok: boolean; code: string }
    expect(dataInvalid.ok).toBe(false)
    expect(dataInvalid.code).toBe('INVALID_BACKUP_ID')

    // 3. 合法格式但不存在的 id → 404 BACKUP_NOT_FOUND
    const resMissing = await fetch(`${base}/api/backups/download?backupId=bup_missing0000000000000000`)
    expect(resMissing.status).toBe(404)
    const dataMissing = (await resMissing.json()) as { ok: boolean; code: string }
    expect(dataMissing.ok).toBe(false)
    expect(dataMissing.code).toBe('BACKUP_NOT_FOUND')
  })
})
