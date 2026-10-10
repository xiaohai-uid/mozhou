// @vitest-environment node
/**
 * 作品归档备份与恢复重建测试 (T10 · C5 门验证)。
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBook } from './create-book.js'
import { LocalDataPlane } from './local-data-plane.js'
import { renderProseChapter } from './chapter.js'
import { proseChapterPath } from './layout.js'
import { createBookBackup, restoreBookBackup } from './book-backup.js'
import { packZip, unpackZip } from './zip-util.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  tempDirs.length = 0
})

describe('Book Backup & Restore (T10 / C5)', () => {
  it('完整备份并在新目录恢复：哈希匹配、重建投影与正文回读', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'mozhou-backup-src-'))
    const dstDir = mkdtempSync(join(tmpdir(), 'mozhou-backup-dst-'))
    tempDirs.push(srcDir, dstDir)

    // 1. 创建源书并写入章节与卡片
    const created = createBook({ dir: srcDir, title: '备份小说测试' })
    const plane = LocalDataPlane.open(srcDir)
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章 破庙' })
    const chapterContent = renderProseChapter({
      mozhouId: created.book.id,
      revision: 1,
      chapterIndex: 1,
      phase: 'draft',
      body: '山雨欲来风满楼，黑云压城城欲摧。',
    })
    writeFileSync(join(srcDir, proseChapterPath(1)), chapterContent, 'utf8')
    plane.close()

    // 2. 导出备份
    const backup = createBookBackup(srcDir)
    expect(backup.bytes).toBeGreaterThan(0)
    expect(backup.sha256.length).toBe(64)
    expect(backup.manifest.bookId).toBe(created.book.id)
    expect(backup.manifest.title).toBe('备份小说测试')
    expect(backup.manifest.files.some((f) => f.path === proseChapterPath(1).replace(/\\/g, '/'))).toBe(true)
    expect(backup.manifest.files.some((f) => f.path === 'book.json')).toBe(true)

    // 3. 在目标目录恢复
    const restored = restoreBookBackup(backup.buffer, dstDir)
    expect(restored.bookId).toBe(created.book.id)
    expect(restored.title).toBe('备份小说测试')
    expect(restored.restoredFiles).toBeGreaterThanOrEqual(2)

    // 4. 打开恢复后的书，验证 SQLite 投影已自动重建、正文可回读
    const restoredPlane = LocalDataPlane.open(dstDir)
    const chapter = restoredPlane.getProseChapter(1)
    expect(chapter.body).toContain('山雨欲来风满楼')
    expect(chapter.chapterIndex).toBe(1)
    restoredPlane.close()
  })

  it('恢复逐文件原子落盘：内容完整且目标目录不留 `.mozhou-tmp` 残留', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'mozhou-backup-atomic-src-'))
    const dstDir = mkdtempSync(join(tmpdir(), 'mozhou-backup-atomic-dst-'))
    tempDirs.push(srcDir, dstDir)

    const created = createBook({ dir: srcDir, title: '原子恢复测试' })
    const plane = LocalDataPlane.open(srcDir)
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    const chapterContent = renderProseChapter({
      mozhouId: created.book.id,
      revision: 1,
      chapterIndex: 1,
      phase: 'draft',
      body: '落霞与孤鹜齐飞，秋水共长天一色。',
    })
    writeFileSync(join(srcDir, proseChapterPath(1)), chapterContent, 'utf8')
    plane.close()

    const backup = createBookBackup(srcDir)
    restoreBookBackup(backup.buffer, dstDir)

    // 落盘正文与源文件逐字节相同（写全、无截断）
    expect(readFileSync(join(dstDir, proseChapterPath(1)), 'utf8')).toBe(chapterContent)

    // 递归扫描：恢复目录内不得出现任何原子写临时文件残留
    const leftovers: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.includes('.mozhou-tmp')) leftovers.push(join(dir, entry.name))
        if (entry.isDirectory()) walk(join(dir, entry.name))
      }
    }
    walk(dstDir)
    expect(leftovers).toEqual([])
  })

  it('C5 门：拦截路径穿越 (Path Traversal) 归档包', () => {
    const dstDir = mkdtempSync(join(tmpdir(), 'mozhou-backup-sec-'))
    tempDirs.push(dstDir)

    const maliciousZip = packZip([
      { path: 'manifest.json', data: '{}' },
      { path: '../evil.txt', data: 'malicious payload' },
    ])

    expect(() => {
      restoreBookBackup(maliciousZip, dstDir)
    }).toThrow(/SECURITY_ERROR/)
  })

  it('C5 门：拦截单文件超限归档包', () => {
    const dstDir = mkdtempSync(join(tmpdir(), 'mozhou-backup-limit-'))
    tempDirs.push(dstDir)

    const largeZip = packZip([
      { path: 'manifest.json', data: '{}' },
      { path: 'big.bin', data: Buffer.alloc(10) },
    ])

    expect(() => {
      unpackZip(largeZip, { maxFiles: 10, maxTotalBytes: 50, maxSingleFileBytes: 5 })
    }).toThrow(/C5_LIMIT_EXCEEDED/)
  })
})
