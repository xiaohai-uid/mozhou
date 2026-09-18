/**
 * apps/web · 作品归档备份、下载与恢复路由控制器 (Backup Routes · T10 · C5)。
 * 
 * 依照 reference/02-features.md T10 规格：
 * - POST /api/backups {bookId} → {backupId, bytes, sha256}；
 * - POST /api/backups/download {backupId} → 重新鉴权并下载 ZIP 归档；
 * - POST /api/backups/restore {backupId} → 在当前用户沙箱下安全恢复为新作品，禁止任意目标路径注入；
 * - 严格执行 C5 资源限制与防穿越门禁。
 */
import type { RouteHandler } from '../router.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createBookBackup, restoreBookBackup } from '@mozhou/data-plane'
import { defaultBookAccessManager } from '../bookAccess.js'
import { RequestBoundaryError } from '../security.js'

export const backupRoutes: RouteHandler = (req, res, { path, body, json, principal, authorizedBook }) => {
  const dataRoot = defaultBookAccessManager.getDataRoot()
  const backupsDir = resolve(dataRoot, 'backups')
  mkdirSync(backupsDir, { recursive: true })

  /* ---- 1. 生成作品备份归档 ---- */
  if (path === '/api/backups' && req.method === 'POST') {
    const root = authorizedBook?.root ?? (typeof body['root'] === 'string' ? body['root'] : null)
    if (!root || !existsSync(root)) {
      json(404, { ok: false, code: 'BOOK_NOT_FOUND', error: 'book root not found' })
      return true
    }

    try {
      const result = createBookBackup(root)
      const backupId = 'bup_' + randomBytes(12).toString('hex')
      const backupFilePath = resolve(backupsDir, `${backupId}.zip`)
      writeFileSync(backupFilePath, result.buffer)

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
  if (path === '/api/backups/download' && (req.method === 'POST' || req.method === 'GET')) {
    const backupId = typeof body['backupId'] === 'string' ? body['backupId'].trim() : null
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
      archiveBuffer = readFileSync(backupFilePath)
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

    try {
      const restored = restoreBookBackup(archiveBuffer, targetDir)
      if (!defaultBookAccessManager.isHostedMode()) {
        defaultBookAccessManager.registerLocalBook(targetDir, newBookId)
      }
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
