/**
 * 迁移包 v1 格式与校验器测试（P1-format）。
 * 判定：npx pnpm --filter @mozhou/web exec vitest run src/migration/packageFormat.test.ts
 */
import { describe, expect, it } from 'vitest'
import {
  MIGRATION_FORMAT_VERSION,
  canonicalStringify,
  computePackageDigest,
  validateMigrationPackage,
} from './packageFormat'
import type { MigrationPackagePayload } from './packageFormat'

type DeepMutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T[K] extends object
    ? DeepMutable<T[K]>
    : T[K] }

function mutablePayload(): DeepMutable<MigrationPackagePayload> {
  return {
    formatVersion: MIGRATION_FORMAT_VERSION,
    origin: { origin: 'http://localhost:43000', userAgent: 'test-ua', exportedAt: '2026-10-12T00:00:00.000Z' },
    books: [
      {
        identity: { bookId: 'bk_1', root: 'C:\\tmp\\a', title: '甲书' },
        chapters: [
          {
            chapterIndex: 1,
            chapterKey: 'ch_bk_1_1',
            draft: { text: '第一章草稿', baselineSha256: 'aa'.repeat(32) },
            candidate: {
              candidateId: 'cand_1',
              base: { revision: 3, sha256: 'bb'.repeat(32) },
              mode: 'replace',
              draftText: '候选文本',
              phase: 'draft_done',
              partial: false,
            },
            editorProjection: {
              savedAt: '2026-10-12T00:00:00.000Z',
              blocks: [{ id: 'b1', type: 'paragraph', content: '第一章草稿' }],
            },
          },
        ],
      },
    ],
    unclaimed: [
      {
        key: 'mozhou.draft.cache.ch_bk_9_2',
        identitySuffix: 'bk_9',
        chapterIndex: 2,
        kind: 'draft',
        reason: 'identity-not-current-book',
        raw: '别书的草稿',
      },
    ],
    preferences: { 'mozhou.wizard.done': 'done' },
  }
}

function signed(payload: MigrationPackagePayload): Record<string, unknown> {
  return { ...payload, digest: computePackageDigest(payload) }
}

describe('canonicalStringify', () => {
  it('对象键顺序不影响结果；数组顺序保留', () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe(canonicalStringify({ a: 2, b: 1 }))
    expect(canonicalStringify([1, 2])).not.toBe(canonicalStringify([2, 1]))
    expect(canonicalStringify({ a: [1, { y: 1, x: 2 }] })).toBe('{"a":[1,{"x":2,"y":1}]}')
  })
})

describe('validateMigrationPackage', () => {
  it('合法包通过，并回填规范化字段', () => {
    const result = validateMigrationPackage(signed(mutablePayload()))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.formatVersion).toBe(1)
    expect(result.value.books[0]?.chapters[0]?.candidate?.base).toEqual({ revision: 3, sha256: 'bb'.repeat(32) })
    expect(result.value.unclaimed).toHaveLength(1)
  })

  it('formatVersion 非本版本 → FORMAT_VERSION_UNSUPPORTED（显式拒绝）', () => {
    const payload = mutablePayload()
    payload.formatVersion = 2
    const result = validateMigrationPackage(signed(payload))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('FORMAT_VERSION_UNSUPPORTED')
    expect(result.path).toBe('formatVersion')
  })

  it('缺 formatVersion → MISSING_FIELD', () => {
    const result = validateMigrationPackage({ books: [], unclaimed: [], preferences: {}, origin: {}, digest: 'x' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('MISSING_FIELD')
    expect(result.path).toBe('formatVersion')
  })

  it('作品身份缺字段（bookId/root 同时为空）→ MISSING_FIELD 且路径指向 identity', () => {
    const payload = mutablePayload()
    payload.books = [{ identity: { bookId: '', root: '', title: '无身份' }, chapters: [] }]
    const result = validateMigrationPackage(signed(payload))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('MISSING_FIELD')
    expect(result.path).toBe('books[0].identity')
  })

  it('章节候选缺 base.revision → MISSING_FIELD 且路径精确', () => {
    const payload = mutablePayload()
    const chapter = payload.books[0]!.chapters[0]!
    payload.books = [
      {
        identity: payload.books[0]!.identity,
        chapters: [
          {
            ...chapter,
            candidate: {
              candidateId: 'cand_1',
              base: { sha256: 'bb' } as never,
              mode: 'replace',
              draftText: 'x',
              phase: 'draft_done',
              partial: false,
            },
          },
        ],
      },
    ]
    const result = validateMigrationPackage(signed(payload))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('MISSING_FIELD')
    expect(result.path).toBe('books[0].chapters[0].candidate.base.revision')
  })

  it('摘要不匹配 → DIGEST_MISMATCH（内容被改动）', () => {
    const tampered = signed(mutablePayload())
    const books = tampered['books'] as Array<Record<string, unknown>>
    books[0] = { ...books[0], identity: { bookId: 'bk_1', root: 'C:\\tmp\\a', title: '被篡改' } }
    const result = validateMigrationPackage(tampered)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DIGEST_MISMATCH')
    expect(result.path).toBe('digest')
  })

  it('非对象输入 → NOT_OBJECT；不抛异常', () => {
    for (const bad of [null, 42, 'x', [], undefined]) {
      const result = validateMigrationPackage(bad)
      expect(result.ok).toBe(false)
    }
  })

  it('摘要只证完整性，不证来源：任何自洽（自算摘要）的包都会通过', () => {
    // 一个「攻击者自造」的包同样能通过校验——本模块不做来源认证，这是合同边界。
    const forged = mutablePayload()
    forged.books[0]!.identity.title = '伪造书名'
    const result = validateMigrationPackage(signed(forged))
    expect(result.ok).toBe(true)
  })
})
