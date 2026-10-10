// @vitest-environment node
/**
 * 作品备份与恢复路由测试 (T10 · 真实 HTTP 级端到端测试)。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { createBook, LocalDataPlane, packZip, renderProseChapter, proseChapterPath } from '@mozhou/data-plane'
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

  // 只读请求不得因经过本 handler 而产生目录副作用：查询不存在的 backupId 走纯读分支。
  it('只读请求不建备份目录：查询不存在的 backupId 返回 404 且不创建 backups 目录', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-backup-nosideeffect-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)

    const base = await listen()
    const backupsDir = join(dataRoot, 'backups')
    // 前置断言：请求前该目录确实不存在（否则本用例不能证明副作用来自请求）。
    expect(existsSync(backupsDir)).toBe(false)

    const res = await fetch(`${base}/api/backups/download?backupId=bup_missing0000000000000000`)
    expect(res.status).toBe(404)
    const data = (await res.json()) as { ok: boolean; code: string }
    expect(data.ok).toBe(false)
    expect(data.code).toBe('BACKUP_NOT_FOUND')

    expect(existsSync(backupsDir)).toBe(false)
  })

  // 历史遗留：POST 分支原子写 + 回读校验只防「新写坏」；盘上可能已有半份/截断 zip。
  it('损坏/截断的既有备份：下载与恢复都不再当有效备份（409 而非 200）', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-backup-corrupt-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)

    const base = await listen()
    const backupsDir = join(dataRoot, 'backups')
    mkdirSync(backupsDir, { recursive: true })
    // 用真实 packZip 生成合法归档后截掉尾部 EOCD，模拟半份落盘
    const valid = packZip([{ path: 'manifest.json', data: '{}' }])
    const truncated = valid.subarray(0, valid.length - 8)
    const backupId = 'bup_truncated000000000000'
    writeFileSync(join(backupsDir, `${backupId}.zip`), truncated)

    // 下载：不再 200 原样发出，返回明确错误码
    const resDownload = await fetch(`${base}/api/backups/download?backupId=${backupId}`)
    expect(resDownload.status).toBe(409)
    const dl = (await resDownload.json()) as { ok: boolean; code: string }
    expect(dl.ok).toBe(false)
    expect(dl.code).toBe('BACKUP_CORRUPT')

    // 恢复：同样拒绝进入恢复流程
    const resRestore = await fetch(`${base}/api/backups/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupId }),
    })
    expect(resRestore.status).toBe(409)
    const rs = (await resRestore.json()) as { ok: boolean; code: string }
    expect(rs.code).toBe('BACKUP_CORRUPT')
  })

  // 跨主体能力型 IDOR：96bit 随机 backupId 不是授权凭据。
  it('hosted 模式：备份按主体隔离，主体 B 无法下载/恢复主体 A 的备份', async () => {
    defaultBookAccessManager.setHostedMode(true)
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-backup-tenant-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)

    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user: userA } = await provider.signUp('a@backup.com', 'passA123')
    const { user: userB } = await provider.signUp('b@backup.com', 'passB123')
    const { cookie: cookieA } = defaultSessionManager.createSession({ userId: userA.id, email: userA.email })
    const { cookie: cookieB } = defaultSessionManager.createSession({ userId: userB.id, email: userB.email })

    // 主体 A 的真实书 + 真实备份
    const srcDir = join(dataRoot, 'users', userA.id, 'books', 'bk_a')
    createBook({ dir: srcDir, title: 'A 的作品' })
    const resBackupA = await fetch(`${base}/api/backups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ bookId: 'bk_a' }),
    })
    expect(resBackupA.status).toBe(200)
    const backupA = (await resBackupA.json()) as { ok: boolean; backupId: string }
    expect(backupA.ok).toBe(true)

    // A 落在自己的私有备份目录
    expect(readdirSync(join(dataRoot, 'users', userA.id, 'backups'))).toContain(`${backupA.backupId}.zip`)

    // 主体 A 本人可下载
    const resDownloadA = await fetch(`${base}/api/backups/download?backupId=${backupA.backupId}`, {
      headers: { Cookie: cookieA },
    })
    expect(resDownloadA.status).toBe(200)

    // 主体 B 拿到同一个 backupId：下载/恢复均 404（B 的目录里没有它）
    const resDownloadB = await fetch(`${base}/api/backups/download?backupId=${backupA.backupId}`, {
      headers: { Cookie: cookieB },
    })
    expect(resDownloadB.status).toBe(404)
    const dlB = (await resDownloadB.json()) as { ok: boolean; code: string }
    expect(dlB.code).toBe('BACKUP_NOT_FOUND')

    const resRestoreB = await fetch(`${base}/api/backups/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({ backupId: backupA.backupId }),
    })
    expect(resRestoreB.status).toBe(404)
  })
})
