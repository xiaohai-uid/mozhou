/**
 * canon-read 读面测试：scanLibrary（书架读面）——父目录扫描含 book.json 的
 * 子目录为书库；逐书容错（坏 book.json 跳过并计数）；章计数逐章探测。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBook } from './create-book.js'
import { scanLibrary } from './canon-read.js'
import { LocalDataPlane } from './local-data-plane.js'
import { proseChapterPath } from './layout.js'

let roots: string[] = []
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ } }
  roots = []
})

function hermeticParent(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-library-'))
  roots.push(dir)
  return dir
}

describe('scanLibrary · 书架读面', () => {
  it('父目录下多书：按书名排序，章计数正确', () => {
    const parent = hermeticParent()
    const bookA = createBook({ dir: join(parent, '甲书'), title: '甲书' })
    createBook({ dir: join(parent, '乙书'), title: '乙书' })
    // 甲书建一章草稿 → chapterCount=1；乙书无章 → 0
    const plane = LocalDataPlane.open(bookA.root)
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    } finally {
      plane.close()
    }

    const { books, skipped } = scanLibrary(parent)
    expect(skipped).toBe(0)
    expect(books).toHaveLength(2)
    // 码点序（跨平台确定，不依赖 locale）：乙(U+4E59) < 甲(U+7532) → 乙书在前
    expect(books[0]?.book.title).toBe('乙书')
    expect(books[1]?.book.title).toBe('甲书')
    expect(books[1]?.book.id).toBe(bookA.book.id)
    expect(books[1]?.root).toBe(bookA.root)
    expect(books[1]?.chapterCount).toBe(1)
    expect(books[0]?.chapterCount).toBe(0)
  })

  it('坏 book.json 的书跳过并计数（不整体失败）', () => {
    const parent = hermeticParent()
    createBook({ dir: join(parent, '好书'), title: '好书' })
    // 坏书：目录 + 非法 book.json
    const badDir = join(parent, '坏书')
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, 'book.json'), '{ not valid json', 'utf8')

    const { books, skipped } = scanLibrary(parent)
    expect(skipped).toBe(1)
    expect(books).toHaveLength(1)
    expect(books[0]?.book.title).toBe('好书')
  })

  it('父目录不存在：空书库（books=[] skipped=0）', () => {
    const { books, skipped } = scanLibrary(join(hermeticParent(), '不存在'))
    expect(books).toEqual([])
    expect(skipped).toBe(0)
  })

  it('章计数逐章探测：建多章草稿后 chapterCount 精确', () => {
    const parent = hermeticParent()
    const book = createBook({ dir: join(parent, '多章书'), title: '多章书' })
    const plane = LocalDataPlane.open(book.root)
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '一' })
      plane.createChapterDraft({ chapterIndex: 2, title: '二' })
      plane.createChapterDraft({ chapterIndex: 3, title: '三' })
    } finally {
      plane.close()
    }
    // 空文件也占位（探测序=文件存在即算）
    const { books } = scanLibrary(parent)
    expect(books[0]?.chapterCount).toBe(3)
    // 显式确认探测路径形态（章文件在 正文/第一卷/）
    expect(proseChapterPath(1)).toContain('正文')
  })
})