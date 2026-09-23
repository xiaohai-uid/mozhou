/**
 * T00 跨书草稿缓存隔离回归：
 * - 同章号两本书各自读写互不串稿；
 * - 同一本书不同章节互不串稿；
 * - 旧版无归属键（ch_<N>）永不自动分配给任何书（保留可手动导出）；
 * - 无书身份（bookId/root 皆空）不读不写任何缓存槽；
 * - bookId 缺失时以 root 兜底仍隔离；
 * - 刷新（重新读同一 localStorage）后缓存仍在。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { chapterDraftKey, loadDraftCache, saveDraftCache } from './workbenchStorage'
import type { BookInfo } from './workbenchStorage'

const BOOK_A: BookInfo = { root: 'C:/tmp/book-a', bookId: 'bk_aaaa', title: '雾港失真' }
const BOOK_B: BookInfo = { root: 'C:/tmp/book-b', bookId: 'bk_bbbb', title: '深巷回声' }

afterEach(() => {
  window.localStorage.clear()
})

describe('chapterDraftKey（T00 书身份绑定）', () => {
  it('同章号的两本书键不同', () => {
    const a = chapterDraftKey(BOOK_A, 1)
    const b = chapterDraftKey(BOOK_B, 1)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a).not.toBe(b)
    expect(a).toContain('bk_aaaa')
  })

  it('同一本书不同章键不同', () => {
    expect(chapterDraftKey(BOOK_A, 1)).not.toBe(chapterDraftKey(BOOK_A, 2))
  })

  it('bookId 缺失时以 root 兜底，root 不同的书仍隔离', () => {
    const a = chapterDraftKey({ root: 'C:/tmp/book-a', bookId: '' }, 1)
    const b = chapterDraftKey({ root: 'C:/tmp/book-b', bookId: '' }, 1)
    expect(a).not.toBe(b)
    expect(a).toContain('book-a')
  })

  it('bookId 与 root 皆空返回 null（无身份不绑定缓存）', () => {
    expect(chapterDraftKey({ root: '', bookId: '' }, 1)).toBeNull()
  })
})

describe('草稿缓存读写（T00 隔离语义）', () => {
  it('两本书同章号分别输入 A/B，互不串稿（切换场景）', () => {
    const keyA = chapterDraftKey(BOOK_A, 1)
    const keyB = chapterDraftKey(BOOK_B, 1)
    saveDraftCache('甲书第一章正文', keyA)
    // 切到乙书同章号：读到的是乙书自己的槽（空），不是甲书内容
    expect(loadDraftCache(keyB)).toBe('')
    saveDraftCache('乙书第一章正文', keyB)
    // 切回甲书：甲书内容原样保留
    expect(loadDraftCache(keyA)).toBe('甲书第一章正文')
    expect(loadDraftCache(keyB)).toBe('乙书第一章正文')
  })

  it('未绑书（null 键）不读不写：旧内容不会被误认领', () => {
    const keyA = chapterDraftKey(BOOK_A, 1)
    saveDraftCache('甲书内容', keyA)
    expect(loadDraftCache(null)).toBe('')
    saveDraftCache('无主文本', null)
    expect(loadDraftCache(keyA)).toBe('甲书内容')
  })

  it('旧版无归属键 ch_1 的存量缓存不自动分配给任何书', () => {
    window.localStorage.setItem('mozhou.draft.cache.ch_1', '旧版无归属草稿')
    for (const book of [BOOK_A, BOOK_B]) {
      expect(loadDraftCache(chapterDraftKey(book, 1))).toBe('')
    }
    // 旧数据仍在原位，可手动导出（不静默销毁作者文本）
    expect(window.localStorage.getItem('mozhou.draft.cache.ch_1')).toBe('旧版无归属草稿')
  })

  it('空文本保存清除该槽，且不影响其他书', () => {
    const keyA = chapterDraftKey(BOOK_A, 1)
    const keyB = chapterDraftKey(BOOK_B, 1)
    saveDraftCache('甲书内容', keyA)
    saveDraftCache('乙书内容', keyB)
    saveDraftCache('', keyA)
    expect(loadDraftCache(keyA)).toBe('')
    expect(loadDraftCache(keyB)).toBe('乙书内容')
  })

  it('刷新语义：同一 localStorage 重新读取，内容不丢', () => {
    const keyA = chapterDraftKey(BOOK_A, 3)
    saveDraftCache('刷新前写入', keyA)
    // jsdom localStorage 与真实浏览器一致地跨"刷新"存在；重读即刷新后行为
    expect(loadDraftCache(chapterDraftKey(BOOK_A, 3))).toBe('刷新前写入')
  })
})
