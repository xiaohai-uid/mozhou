/**
 * 旧浏览器 localStorage 导出器测试（P1-export）。
 * 判定：npx pnpm --filter @mozhou/web exec vitest run src/migration/exportLocalStorage.test.ts
 */
import { describe, expect, it } from 'vitest'
import {
  APP_PREFERENCE_KEYS,
  DRAFT_BASELINE_PREFIX,
  DRAFT_CACHE_PREFIX,
  EDITOR_PROJECTION_PREFIX,
  WORKBENCH_STATE_KEY,
  enumerateWhitelistKeys,
  exportLocalStorage,
  parseChapterSuffix,
} from './exportLocalStorage'
import type { StorageReader } from './exportLocalStorage'
import { validateMigrationPackage } from './packageFormat'

/** 由键值对构造只读存储替身（key(i) 顺序即插入顺序，用于证明按枚举而非 getter 取值）。 */
function fakeStorage(entries: readonly (readonly [string, string])[]): StorageReader {
  const keys = entries.map(([key]) => key)
  const map = new Map(entries)
  return {
    get length() {
      return keys.length
    },
    key(index: number) {
      return keys[index] ?? null
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) ?? null) : null
    },
  }
}

const BOOK = { root: 'C:\\tmp\\a', bookId: 'bk_1', title: '甲书' }
const CANDIDATE = JSON.stringify({
  candidateId: 'cand_1',
  base: { revision: 7, sha256: 'cd'.repeat(32) },
  mode: 'replace',
  draftText: '候选正文',
  phase: 'draft_done',
})

function fullStorage(): StorageReader {
  return fakeStorage([
    [WORKBENCH_STATE_KEY, JSON.stringify({ book: BOOK, view: 'workbench' })],
    [`${DRAFT_CACHE_PREFIX}ch_bk_1_1`, '第一章草稿'],
    [`${DRAFT_BASELINE_PREFIX}ch_bk_1_1`, 'aa'.repeat(32)],
    [`${DRAFT_CACHE_PREFIX}ch_bk_1_2`, '第二章无基线草稿'],
    [`mozhou.candidate.cache.cand_bk_1_1`, CANDIDATE],
    [`${EDITOR_PROJECTION_PREFIX}ch_bk_1_1`, JSON.stringify({ savedAt: '2026-10-12T00:00:00.000Z', blocks: [{ id: 'b1', type: 'paragraph', content: 'x' }] })],
    // 同章号、另一作品：不得串到甲书
    [`${DRAFT_CACHE_PREFIX}ch_bk_2_1`, '乙书第一章草稿'],
    // 旧版无归属键：永不匹配、不进包
    [`${DRAFT_CACHE_PREFIX}ch_3`, '旧版无归属草稿'],
    [`${DRAFT_BASELINE_PREFIX}ch_3`, 'ee'.repeat(32)],
    // 白名单外键：不进包
    ['some.unrelated.key', 'nope'],
    ['mozhou.membership.tier', 'pro'],
    ...APP_PREFERENCE_KEYS.map((key) => [key, `pref-${key}`] as const),
  ])
}

describe('parseChapterSuffix', () => {
  it('ch_<identity>_<N> 按最后一个下划线切分；ch_<N> 返回 null', () => {
    expect(parseChapterSuffix('ch_bk_1_3', 'ch')).toEqual({ identitySuffix: 'bk_1', chapterIndex: 3 })
    expect(parseChapterSuffix('ch_C:\\tmp\\a_b_12', 'ch')).toEqual({ identitySuffix: 'C:\\tmp\\a_b', chapterIndex: 12 })
    expect(parseChapterSuffix('ch_5', 'ch')).toBeNull()
    expect(parseChapterSuffix('ch_', 'ch')).toBeNull()
    expect(parseChapterSuffix('ch_bk_1_0', 'ch')).toBeNull()
    expect(parseChapterSuffix('ch_bk_1_x', 'ch')).toBeNull()
    expect(parseChapterSuffix('cand_bk_1_2', 'cand')).toEqual({ identitySuffix: 'bk_1', chapterIndex: 2 })
  })
})

describe('enumerateWhitelistKeys', () => {
  it('只返回白名单键（含工作台与偏好），排除无关键', () => {
    const keys = enumerateWhitelistKeys(fullStorage())
    expect(keys).toContain(WORKBENCH_STATE_KEY)
    expect(keys).toContain(`${DRAFT_CACHE_PREFIX}ch_bk_1_1`)
    expect(keys).not.toContain('some.unrelated.key')
    expect(keys).not.toContain('mozhou.membership.tier')
  })
})

describe('exportLocalStorage', () => {
  it('按身份后缀归属当前作品章节；产出可校验的迁移包', () => {
    const pkg = exportLocalStorage(fullStorage(), { origin: 'http://localhost:43000', userAgent: 'ua', exportedAt: '2026-10-12T00:00:00.000Z' })
    const result = validateMigrationPackage(pkg)
    expect(result.ok).toBe(true)
    expect(pkg.books).toHaveLength(1)
    expect(pkg.books[0]?.identity).toEqual(BOOK)
    const chapters = pkg.books[0]!.chapters
    expect(chapters.map((c) => c.chapterIndex)).toEqual([1, 2])
  })

  it('候选 base.revision/base.sha256 原样保留', () => {
    const pkg = exportLocalStorage(fullStorage())
    const ch1 = pkg.books[0]!.chapters.find((c) => c.chapterIndex === 1)!
    expect(ch1.candidate?.base).toEqual({ revision: 7, sha256: 'cd'.repeat(32) })
    expect(ch1.draft?.baselineSha256).toBe('aa'.repeat(32))
    expect(ch1.editorProjection?.blocks).toHaveLength(1)
  })

  it('无基线旧缓存：draft 在场、baselineSha256 为 null', () => {
    const pkg = exportLocalStorage(fullStorage())
    const ch2 = pkg.books[0]!.chapters.find((c) => c.chapterIndex === 2)!
    expect(ch2.draft).toEqual({ text: '第二章无基线草稿', baselineSha256: null })
    expect(ch2.candidate).toBeNull()
  })

  it('同章号另一作品 → 待认领区，不串入当前作品', () => {
    const pkg = exportLocalStorage(fullStorage())
    const unclaimed = pkg.unclaimed.filter((u) => u.identitySuffix === 'bk_2')
    expect(unclaimed).toHaveLength(1)
    expect(unclaimed[0]?.reason).toBe('identity-not-current-book')
    expect(pkg.books[0]!.chapters.some((c) => c.draft?.text === '乙书第一章草稿')).toBe(false)
  })

  it('旧版无归属键 ch_<N> 一律不进包（既不在章节也不在待认领）', () => {
    const pkg = exportLocalStorage(fullStorage())
    const allRaw = [
      ...pkg.books.flatMap((b) => b.chapters.map((c) => c.draft?.text ?? '')),
      ...pkg.unclaimed.map((u) => u.raw),
    ]
    expect(allRaw).not.toContain('旧版无归属草稿')
    expect(pkg.unclaimed.some((u) => u.key === `${DRAFT_CACHE_PREFIX}ch_3`)).toBe(false)
  })

  it('白名单外键不进包；偏好键进 preferences', () => {
    const pkg = exportLocalStorage(fullStorage())
    expect(pkg.preferences['mozhou.wizard.done']).toBe('pref-mozhou.wizard.done')
    expect(JSON.stringify(pkg)).not.toContain('mozhou.membership.tier')
    expect(JSON.stringify(pkg)).not.toContain('some.unrelated.key')
  })

  it('缺工作台作品身份 → 章键全部进待认领区（no-workbench-book），books 为空', () => {
    const storage = fakeStorage([
      [`${DRAFT_CACHE_PREFIX}ch_bk_1_1`, '草稿'],
      [`${DRAFT_BASELINE_PREFIX}ch_bk_1_1`, 'aa'.repeat(32)],
    ])
    const pkg = exportLocalStorage(storage)
    expect(pkg.books).toEqual([])
    expect(pkg.unclaimed).toHaveLength(2)
    expect(pkg.unclaimed.every((u) => u.reason === 'no-workbench-book')).toBe(true)
  })

  it('候选 JSON 损坏 → 进待认领区（unparseable-candidate），不中断导出', () => {
    const storage = fakeStorage([
      [WORKBENCH_STATE_KEY, JSON.stringify({ book: BOOK, view: 'workbench' })],
      [`${DRAFT_CACHE_PREFIX}ch_bk_1_1`, '草稿'],
      ['mozhou.candidate.cache.cand_bk_1_1', '{ 不是 JSON'],
    ])
    const pkg = exportLocalStorage(storage)
    expect(pkg.books[0]!.chapters[0]?.candidate).toBeNull()
    expect(pkg.unclaimed.some((u) => u.reason === 'unparseable-candidate')).toBe(true)
  })

  it('导出不改动源端（纯读）', () => {
    const storage = fullStorage()
    const before = enumerateWhitelistKeys(storage).length
    exportLocalStorage(storage)
    expect(enumerateWhitelistKeys(storage).length).toBe(before)
  })
})
