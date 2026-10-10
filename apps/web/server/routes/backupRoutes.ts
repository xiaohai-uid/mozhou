/**
 * apps/web · 作品归档备份、下载与恢复路由控制器 (Backup Routes · T10 · C5)。
 * 
 * 依照 reference/02-features.md T10 规格：
 * - POST /api/backups {bookId} → {backupId, bytes, sha256}；
 * - GET /api/backups/download?backupId=...（UI 下载链接，CloudSyncView）| POST /api/backups/download {backupId}
 *   → 重新鉴权并下载 ZIP 归档（DELTA-007：GET query + POST body 双通道）；
 * - POST /api/backups/restore {backupId} → 在当前用户沙箱下安全恢复为新作品，禁止任意目标路径注入；
 * - 严格执行 C5 资源限制与防穿越门。
 */
import type { RouteHandler } from '../router.js'
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { atomicWriteFileSync, assertZipStructureIntact, createBookBackup, restoreBookBackup } from '@mozhou/data-plane'
import { defaultBookAccessManager, withBookWriteLock } from '../bookAccess.js'
import { RequestBoundaryError } from '../security.js'

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export const backupRoutes: RouteHandler = async (req, res, { path, body, json, principal, bookRoot }) => {
  const dataRoot = defaultBookAccessManager.getDataRoot()
  // 备份归档按归属隔离：hosted 模式下落到当前主体的私有目录，下载/恢复只在该主体
  // 目录内按 backupId 查找——96bit 随机 ID 是能力凭据，不能跨主体复用。
  // local 单机模式维持全局 dataRoot/backups（单用户数据根，行为与既有备份可见性不变）。
  // 兼容说明：本次改动前 hosted 模式写在全局 dataRoot/backups 的存量归档，不再对本
  // 主体可见（fail-closed，避免跨主体读取）；local 模式不受影响。
  const backupOwnerId = principal?.userId ?? 'local_user'
  const backupsDir = defaultBookAccessManager.isHostedMode()
    ? resolve(dataRoot, 'users', backupOwnerId, 'backups')
    : resolve(dataRoot, 'backups')
  mkdirSync(backupsDir, { recursive: true })

  /* ---- 1. 生成作品备份归档 ---- */
  if (path === '/api/backups' && req.method === 'POST') {
    const root = bookRoot ?? null
    if (!root || !existsSync(root)) {
      json(404, { ok: false, code: 'BOOK_NOT_FOUND', error: 'book root not found' })
      return true
    }

    try {
      // W2-3：备份是「一致性快照」，必须与书稿写入互斥——同一书稿锁内取快照。
      const result = await withBookWriteLock(root, () => createBookBackup(root), { timeoutMs: 60_000 })
      const backupId = 'bup_' + randomBytes(12).toString('hex')
      const backupFilePath = resolve(backupsDir, `${backupId}.zip`)
      // 原子落盘（唯一名 + fsync + rename）：崩溃/中断只可能「没有备份」，不会留下半份 zip。
      atomicWriteFileSync(backupFilePath, result.buffer)

      // 对外宣称的 sha256 必须描述盘上真实字节，而不是内存里的 result.buffer。
      // 回读校验；不一致说明落盘异常，删除这份备份并报错，绝不发布一个哈希对不上的归档。
      const onDisk = readFileSync(backupFilePath)
      if (sha256Hex(onDisk) !== result.sha256) {
        unlinkSync(backupFilePath)
        throw new Error('backup archive failed on-disk sha256 verification')
      }

      json(200, {
        ok: true,
        backupId,
        bytes: result.bytes,
        sha256: result.sha256,
        bookId: result.manifest.bookId,
        title: result.manifest.title,
      })
    } catch (err) {
      json(500, { ok: false, code: 'BACKUP_FAILED', error: (err as Error).message })
    }
    return true
  }

  /* ---- 2. 下载备份文件 ---- */
  // DELTA-007（2026-10-07）：UI 下载链接是 GET /api/backups/download?backupId=...（CloudSyncView.tsx），
  // 修复前 GET 的 backupId 只从 body 读、恒为空 → 误报 400 INVALID_BACKUP_ID。
  // 双通道：GET 从 URL query 取 backupId，POST 维持 JSON body 通道；正则与长度校验两通道一致。
  if (path === '/api/backups/download' && (req.method === 'POST' || req.method === 'GET')) {
    let backupId: string | null = null
    if (req.method === 'GET') {
      const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '')
      const raw = query.get('backupId')
      backupId = typeof raw === 'string' ? raw.trim() : null
    } else {
      backupId = typeof body['backupId'] === 'string' ? body['backupId'].trim() : null
    }
    if (!backupId || !/^[a-zA-Z0-9_-]{1,64}$/.test(backupId)) {
      json(400, { ok: false, code: 'INVALID_BACKUP_ID', error: 'valid backupId required' })
      return true
    }

    const backupFilePath = resolve(backupsDir, `${backupId}.zip`)
    if (!existsSync(backupFilePath)) {
      json(404, { ok: false, code: 'BACKUP_NOT_FOUND', error: 'backup archive not found' })
      return true
    }

    const data = readFileSync(backupFilePath)
    // 完整性门：POST 分支已保证新写归档原子且哈希自洽，但历史上可能已存在半份/截断
    // 的 zip。下载前做轻量结构检查（不解压），损坏文件返回明确错误码而不是 200 原样发出。
    try {
      assertZipStructureIntact(data)
    } catch {
      json(409, { ok: false, code: 'BACKUP_CORRUPT', error: 'backup archive is truncated or structurally corrupt' })
      return true
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${backupId}.zip"`)
    res.setHeader('Content-Length', String(data.length))
    res.end(data)
    return true
  }

  /* ---- 3. 从备份恢复为新作品 ---- */
  if (path === '/api/backups/restore' && req.method === 'POST') {
    // 严禁客户端指定 destination 路径穿越，目标路径统一由服务器安全生成
    if (typeof body['destination'] === 'string' || typeof body['dir'] === 'string' || typeof body['targetRoot'] === 'string') {
      json(400, { ok: false, code: 'INVALID_INPUT', error: 'custom destination directories are forbidden' })
      return true
    }

    const backupId = typeof body['backupId'] === 'string' ? body['backupId'].trim() : null
    let archiveBuffer: Buffer | null = null

    if (backupId) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(backupId)) {
        json(400, { ok: false, code: 'INVALID_BACKUP_ID', error: 'invalid backupId format' })
        return true
      }
      const backupFilePath = resolve(backupsDir, `${backupId}.zip`)
      if (!existsSync(backupFilePath)) {
        json(404, { ok: false, code: 'BACKUP_NOT_FOUND', error: `backup archive not found: ${backupId}` })
        return true
      }
      const onDisk = readFileSync(backupFilePath)
      // 与下载分支同一条完整性门：截断/结构损坏的既有归档不得进入恢复流程。
      try {
        assertZipStructureIntact(onDisk)
      } catch {
        json(409, { ok: false, code: 'BACKUP_CORRUPT', error: `backup archive is truncated or structurally corrupt: ${backupId}` })
        return true
      }
      archiveBuffer = onDisk
    } else if (typeof body['archiveBase64'] === 'string') {
      try {
        archiveBuffer = Buffer.from(body['archiveBase64'], 'base64')
      } catch {
        json(400, { ok: false, code: 'INVALID_PAYLOAD', error: 'malformed archiveBase64 payload' })
        return true
      }
    } else {
      json(400, { ok: false, code: 'BACKUP_SOURCE_REQUIRED', error: 'backupId or archiveBase64 required' })
      return true
    }

    const userId = principal?.userId ?? 'local_user'
    const newBookId = 'bk_' + randomBytes(12).toString('hex')
    let targetDir: string

    if (defaultBookAccessManager.isHostedMode()) {
      targetDir = resolve(dataRoot, 'users', userId, 'books', newBookId)
    } else {
      targetDir = resolve(dataRoot, 'books', newBookId)
    }

    // W2-3：恢复会写出一整本新书。目标书根此刻不存在（无法 canonicalBookKey），
    // 故以**数据根**为锁键串行化恢复；同书并发写由目标书创建后的书稿锁接管。
    try {
      const restored = await withBookWriteLock(resolve(dataRoot), () => {
        const written = restoreBookBackup(archiveBuffer, targetDir)
        if (!defaultBookAccessManager.isHostedMode()) {
          defaultBookAccessManager.registerLocalBook(targetDir, newBookId)
        }
        return written
      }, { timeoutMs: 120_000 })
      json(200, {
        ok: true,
        bookId: newBookId,
        originalBookId: restored.bookId,
        title: restored.title,
        root: targetDir,
        restoredFiles: restored.restoredFiles,
      })
    } catch (err) {
      if (err instanceof RequestBoundaryError) {
        json(err.status, { ok: false, code: err.code, error: err.message })
      } else {
        json(400, { ok: false, code: 'RESTORE_FAILED', error: (err as Error).message })
      }
    }
    return true
  }

  return false
}
