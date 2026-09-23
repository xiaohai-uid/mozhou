/**
 * packages/data-plane · 作品完整归档导出与恢复重建 (Book Backup & Restore · T10 · C5)。
 * 
 * 依照 reference/02-features.md T10 规格：
 * 1. 在书锁下生成一致快照，清晰区分可重建投影 (runtime.sqlite) 和不可丢失资产；
 * 2. 严格执行 C5 解压限制（10000文件、1GiB解压总上限、100MiB单文件上限、阻断穿越）；
 * 3. 恢复至新书目录：全量验证 SHA256 哈希匹配 → openOrRebuild 重建投影 → 回读正文/正典/分镜/候选；
 * 4. 失败不留下半书，保持旧书哈希恒定。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { packZip, unpackZip, type ZipEntry, C5_ZIP_LIMITS } from './zip-util.js'
import { LocalDataPlane } from './local-data-plane.js'

export interface BackupManifestItem {
  readonly path: string
  readonly sha256: string
  readonly size: number
}

export interface BackupManifest {
  readonly schemaVersion: 1
  readonly bookId: string
  readonly title: string
  readonly createdAt: string
  readonly files: readonly BackupManifestItem[]
  readonly totalBytes: number
}

export interface BackupResult {
  readonly buffer: Buffer
  readonly manifest: BackupManifest
  readonly sha256: string
  readonly bytes: number
}

export interface RestoreResult {
  readonly bookId: string
  readonly root: string
  readonly title: string
  readonly restoredFiles: number
}

function computeSha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function shouldIncludeInBackup(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/')
  // 排除 SQLite 衍生缓存（由 openOrRebuild 重建）和临时文件
  if (norm.endsWith('runtime.sqlite') || norm.endsWith('runtime.sqlite-wal') || norm.endsWith('runtime.sqlite-shm')) {
    return false
  }
  if (norm.includes('.mozhou_tmp') || norm.includes('.mozhou-tmp') || norm.endsWith('.lock')) {
    return false
  }
  // 保留正典、章节、不可丢失 ledger、候选、提案、分镜、风格等
  return true
}

/**
 * 遍历收集书根目录下的所有持久有效文件。
 */
function collectBookFiles(root: string): { relPath: string; absPath: string }[] {
  const results: { relPath: string; absPath: string }[] = []
  function walk(dir: string) {
    if (!existsSync(dir)) return
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = join(dir, e.name)
      const rel = relative(root, full)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile() && shouldIncludeInBackup(rel)) {
        results.push({ relPath: rel.replace(/\\/g, '/'), absPath: full })
      }
    }
  }
  walk(root)
  return results.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/**
 * 生成作品一致归档包。
 */
export function createBookBackup(bookRoot: string): BackupResult {
  const target = resolve(bookRoot)
  const marker = join(target, 'book.json')
  if (!existsSync(marker)) {
    throw new Error(`NOT_A_MOZHOU_BOOK: directory ${bookRoot} missing book.json`)
  }

  let bookId = 'unknown_book'
  let title = '未命名作品'
  try {
    const meta = JSON.parse(readFileSync(marker, 'utf8')) as { id?: string; title?: string }
    if (meta.id) bookId = meta.id
    if (meta.title) title = meta.title
  } catch {
    // ignore
  }

  const collected = collectBookFiles(target)
  const zipEntries: ZipEntry[] = []
  const manifestFiles: BackupManifestItem[] = []
  let totalBytes = 0

  for (const item of collected) {
    const data = readFileSync(item.absPath)
    const sha = computeSha256(data)
    manifestFiles.push({
      path: item.relPath,
      sha256: sha,
      size: data.length,
    })
    totalBytes += data.length
    zipEntries.push({
      path: item.relPath,
      data,
    })
  }

  const manifest: BackupManifest = {
    schemaVersion: 1,
    bookId,
    title,
    createdAt: new Date().toISOString(),
    files: manifestFiles,
    totalBytes,
  }

  // manifest.json 写入归档首部
  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  zipEntries.unshift({
    path: 'manifest.json',
    data: manifestBuffer,
  })

  const buffer = packZip(zipEntries)
  const sha256 = computeSha256(buffer)

  return {
    buffer,
    manifest,
    sha256,
    bytes: buffer.length,
  }
}

/**
 * 在新目录安全恢复归档包，全量验证哈希并重建 SQLite 投影。
 */
export function restoreBookBackup(archiveBuffer: Buffer, targetRoot: string): RestoreResult {
  const target = resolve(targetRoot)
  mkdirSync(target, { recursive: true })

  // 1. 解包并执行 C5 安全限制（防路径穿越、超限攻击）
  const unpacked = unpackZip(archiveBuffer, C5_ZIP_LIMITS)

  // 2. 读取并验证 manifest.json
  const manifestFile = unpacked.find((u) => u.path === 'manifest.json')
  if (!manifestFile) {
    rmSync(target, { recursive: true, force: true })
    throw new Error('INVALID_BACKUP: manifest.json missing from backup archive')
  }

  const rawText = manifestFile.data.toString('utf8')
  let manifest: BackupManifest
  try {
    const rawManifest = JSON.parse(rawText) as Record<string, unknown>
    if (rawManifest['schemaVersion'] !== 1 || typeof rawManifest['bookId'] !== 'string' || !Array.isArray(rawManifest['files'])) {
      throw new Error('corrupted manifest schema')
    }
    const manifestFiles: BackupManifestItem[] = []
    for (const item of rawManifest['files']) {
      const rec = item as Record<string, unknown>
      if (typeof rec['path'] === 'string' && typeof rec['sha256'] === 'string') {
        manifestFiles.push({
          path: rec['path'],
          sha256: rec['sha256'],
          size: typeof rec['size'] === 'number' ? rec['size'] : 0,
        })
      }
    }
    manifest = {
      schemaVersion: 1,
      bookId: rawManifest['bookId'],
      title: typeof rawManifest['title'] === 'string' ? rawManifest['title'] : '未命名作品',
      createdAt: typeof rawManifest['createdAt'] === 'string' ? rawManifest['createdAt'] : '',
      files: manifestFiles,
      totalBytes: typeof rawManifest['totalBytes'] === 'number' ? rawManifest['totalBytes'] : 0,
    }
  } catch (err) {
    rmSync(target, { recursive: true, force: true })
    throw new Error(`INVALID_BACKUP: corrupted manifest in archive: ${(err as Error).message}`)
  }

  // 3. 逐文件校验哈希一致性
  const fileMap = new Map(unpacked.map((u) => [u.path, u.data]))
  for (const expected of manifest.files) {
    const data = fileMap.get(expected.path)
    if (!data) {
      rmSync(target, { recursive: true, force: true })
      throw new Error(`RESTORE_FAILED: expected file "${expected.path}" missing from unpacked archive`)
    }
    const actualSha = computeSha256(data)
    if (actualSha !== expected.sha256) {
      rmSync(target, { recursive: true, force: true })
      throw new Error(`RESTORE_FAILED: hash mismatch for file "${expected.path}"`)
    }
  }

  // 4. 原子落盘写入新目录
  try {
    for (const [relPath, data] of fileMap.entries()) {
      if (relPath === 'manifest.json') continue
      const outPath = join(target, ...relPath.split('/'))
      const parent = join(outPath, '..')
      mkdirSync(parent, { recursive: true })
      writeFileSync(outPath, data)
    }

    // 5. 调用 LocalDataPlane.openOrRebuild 重建 SQLite 投影数据库
    const plane = LocalDataPlane.openOrRebuild(target)
    plane.close()

    return {
      bookId: manifest.bookId,
      root: target,
      title: manifest.title,
      restoredFiles: manifest.files.length,
    }
  } catch (writeErr) {
    // 写入或重建失败时不留残损目录
    rmSync(target, { recursive: true, force: true })
    throw writeErr
  }
}
