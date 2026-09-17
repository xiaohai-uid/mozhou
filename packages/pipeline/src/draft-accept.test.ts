import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LocalDataPlane, createBook, proseChapterPath } from '@mozhou/data-plane'
import {
  createDraftCandidate,
  finishCandidate,
  cancelCandidate,
  readDraftCandidate,
  CandidateError,
} from './draft-candidate.js'
import {
  acceptDraft,
  AcceptConflictError,
  proseFileSha256,
} from './draft-accept.js'

describe('draft-accept (C2 / R01): 写前校验与终态保护', () => {
  let root: string
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mozhou-draft-accept-test-'))
    root = join(tempDir, '测试书')
    createBook({ dir: root, title: '测试书' })
    const plane = LocalDataPlane.open(root)
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    plane.saveProseDraft({ chapterIndex: 1, body: '作者正文原文。\n', expectedRevision: 0 })
    plane.close()
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Windows lock tolerance
    }
  })

  function createFixtureCandidate(mode: 'replace' | 'continue' = 'replace') {
    const plane = LocalDataPlane.open(root)
    const scan = plane.getProseChapter(1)
    plane.close()
    const base = { revision: scan.revision, sha256: proseFileSha256(root, 1) }
    const id = randomUUID()
    const bookRecord = JSON.parse(readFileSync(join(root, 'book.json'), 'utf8')) as { id: string }
    const candidate = createDraftCandidate(root, {
      id,
      operationId: randomUUID(),
      bookId: bookRecord.id,
      chapterIndex: 1,
      base,
      mode,
      ...(mode === 'continue' ? { seedText: '续写内容。\n' } : {}),
    })
    return { id, base, bookId: bookRecord.id, candidate }
  }

  it('cancelled 状态候选首次 accept 必须失败，正文/版本/候选/intent 零变更，重放仍拒绝', () => {
    const { id, base, bookId } = createFixtureCandidate()
    cancelCandidate(root, id)

    const beforeRaw = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    const beforeHash = proseFileSha256(root, 1)

    // 首次采纳拒绝
    expect(() =>
      acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'test_key_cancelled_123',
        bookId,
        chapterIndex: 1,
      }),
    ).toThrow(CandidateError)

    // 磁盘断言：正文未变、版本未变、候选仍为 cancelled、没有 done intent
    const afterRaw = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    expect(afterRaw).toBe(beforeRaw)
    expect(proseFileSha256(root, 1)).toBe(beforeHash)
    expect(readDraftCandidate(root, id)?.status).toBe('cancelled')

    const intentDir = join(root, '.mozhou/accept-intents')
    if (existsSync(intentDir)) {
      const intents = readdirSync(intentDir).filter((f) => f.includes(id))
      expect(intents.length).toBe(0)
    }

    // 重放仍拒绝，仍不写入
    expect(() =>
      acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'test_key_cancelled_123',
      }),
    ).toThrow(CandidateError)
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(beforeRaw)
  })

  it('failed 状态候选首次 accept 必须失败，正文零变更', () => {
    const { id, base } = createFixtureCandidate()
    finishCandidate(root, id, 'failed')

    const beforeRaw = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    expect(() =>
      acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'test_key_failed_12345',
      }),
    ).toThrow(CandidateError)

    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(beforeRaw)
    expect(readDraftCandidate(root, id)?.status).toBe('failed')
  })

  it('streaming 状态候选首次 accept 必须失败，正文零变更', () => {
    const { id, base } = createFixtureCandidate()
    // 保持 streaming 状态未 finish

    const beforeRaw = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    expect(() =>
      acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'test_key_streaming_123',
      }),
    ).toThrow(CandidateError)

    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(beforeRaw)
    expect(readDraftCandidate(root, id)?.status).toBe('streaming')
  })

  it('partial 状态未确认拒绝采纳；显式确认方可采纳', () => {
    const { id, base } = createFixtureCandidate()
    finishCandidate(root, id, 'partial')

    const beforeRaw = readFileSync(join(root, proseChapterPath(1)), 'utf8')

    // 1. 未确认采纳 -> 失败
    expect(() =>
      acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'test_key_partial_unconf',
        allowPartial: false,
      }),
    ).toThrow(CandidateError)
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(beforeRaw)
    expect(readDraftCandidate(root, id)?.status).toBe('partial')

    // 2. 显式确认采纳 -> 成功
    const result = acceptDraft({
      bookRoot: root,
      candidateId: id,
      base,
      idempotencyKey: 'test_key_partial_confirmed',
      allowPartial: true,
    })
    expect(result.alreadyApplied).toBe(false)
    expect(result.revision).toBe(2)
    expect(readDraftCandidate(root, id)?.status).toBe('accepted')
    expect(readDraftCandidate(root, id)?.acceptedRevision).toBe(2)
  })

  it('ready 状态正常采纳与幂等重放', () => {
    const { id, base } = createFixtureCandidate()
    finishCandidate(root, id, 'ready')

    const result1 = acceptDraft({
      bookRoot: root,
      candidateId: id,
      base,
      idempotencyKey: 'test_key_ready_1234567',
    })
    expect(result1.alreadyApplied).toBe(false)
    expect(result1.revision).toBe(2)
    expect(readDraftCandidate(root, id)?.status).toBe('accepted')

    // 幂等重放
    const result2 = acceptDraft({
      bookRoot: root,
      candidateId: id,
      base,
      idempotencyKey: 'test_key_ready_1234567',
    })
    expect(result2.alreadyApplied).toBe(true)
    expect(result2.revision).toBe(2)
  })

  describe('参数校验与身份负例', () => {
    it('参数缺少或非法抛出 CandidateError', () => {
      const { id, base } = createFixtureCandidate()
      expect(() =>
        acceptDraft({
          bookRoot: '',
          candidateId: id,
          base,
          idempotencyKey: 'test_key_valid_1234',
        }),
      ).toThrow(CandidateError)

      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: '',
          base,
          idempotencyKey: 'test_key_valid_1234',
        }),
      ).toThrow(CandidateError)
    })

    it('idempotencyKey 为空、含非 ASCII 或超长抛出异常', () => {
      const { id, base } = createFixtureCandidate()
      finishCandidate(root, id, 'ready')
      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: '',
        }),
      ).toThrow(AcceptConflictError)

      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: '含有非ASCII字符的idempotencyKey',
        }),
      ).toThrow(AcceptConflictError)

      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: 'x'.repeat(300),
        }),
      ).toThrow(AcceptConflictError)
    })

    it('bookId / chapterIndex 不匹配负例', () => {
      const { id, base, bookId } = createFixtureCandidate()
      finishCandidate(root, id, 'ready')

      // bookId 不匹配
      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: 'test_key_id_mismatch_1',
          bookId: 'other-book-id',
        }),
      ).toThrow(CandidateError)

      // chapterIndex 不匹配
      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: 'test_key_id_mismatch_2',
          bookId,
          chapterIndex: 999,
        }),
      ).toThrow(CandidateError)
    })

    it('base stale 拒绝', () => {
      const { id, base } = createFixtureCandidate()
      finishCandidate(root, id, 'ready')

      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base: { revision: base.revision + 10, sha256: base.sha256 },
          idempotencyKey: 'test_key_stale_base_1',
        }),
      ).toThrow(AcceptConflictError)
    })
  })
})
