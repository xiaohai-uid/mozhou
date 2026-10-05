/**
 * W4-2c-3 半稿采纳显式 revision 校验与落账审计测试。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LocalDataPlane,
  createBook,
  readOperationRecord,
  readProseChapter,
  proseChapterPath,
  ProseRevisionConflictError,
} from '@mozhou/data-plane'
import {
  acceptDraft,
  appendCandidateDelta,
  createCandidateId,
  createDraftCandidate,
  finishCandidate,
  readDraftCandidate,
  CandidateError,
  proseFileSha256,
} from './index.js'

describe('W4-2c-3 半稿采纳与落账审计', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mozhou-accept-audit-'))
    createBook({ dir: root, title: '半稿采纳审计验收' })
    const plane = LocalDataPlane.open(root)
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    plane.saveProseDraft({ chapterIndex: 1, body: '原章节初始文本。\n', expectedRevision: 0 })
    plane.close()
  })

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('半稿采纳：未确认 (confirmPartial=false) 拒绝抛 CANDIDATE_NOT_ACCEPTABLE，正文零变更', () => {
    const chapter = readProseChapter(root, proseChapterPath(1))
    const baseHash = proseFileSha256(root, 1)

    const candidateId = createCandidateId()
    // 创建一个候选并将其结束为 partial
    createDraftCandidate(root, {
      id: candidateId,
      generationId: 'op_web_' + candidateId,
      bookId: 'book-local',
      chapterIndex: 1,
      base: { revision: chapter.revision, sha256: baseHash },
      mode: 'replace',
    })
    appendCandidateDelta(root, candidateId, '尚未完成的半稿内容')
    finishCandidate(root, candidateId, 'partial')

    const candidateBefore = readDraftCandidate(root, candidateId)
    expect(candidateBefore?.contentState).toBe('partial')
    expect(candidateBefore?.taskState).toBe('succeeded')
    expect(candidateBefore?.canonState).toBe('unaccepted')

    // 未显式确认采纳
    expect(() =>
      acceptDraft({
        bookRoot: root,
        candidateId,
        base: { revision: chapter.revision, sha256: baseHash },
        idempotencyKey: 'idemp_partial_reject_1',
        confirmPartial: false,
      }),
    ).toThrow(CandidateError)

    // 盘上正文零变更
    const chapterAfter = readProseChapter(root, proseChapterPath(1))
    expect(chapterAfter.revision).toBe(chapter.revision)
    expect(chapterAfter.body).toBe(chapter.body)

    // 候选仍为 unaccepted
    const candidateAfter = readDraftCandidate(root, candidateId)
    expect(candidateAfter?.canonState).toBe('unaccepted')
  })

  it('半稿采纳：显式确认 (confirmPartial=true) 成功采纳，落地正文并在候选留 confirmPartial 审计记录', () => {
    const chapter = readProseChapter(root, proseChapterPath(1))
    const baseHash = proseFileSha256(root, 1)

    const candidateId = createCandidateId()
    createDraftCandidate(root, {
      id: candidateId,
      generationId: 'op_web_' + candidateId,
      bookId: 'book-local',
      chapterIndex: 1,
      base: { revision: chapter.revision, sha256: baseHash },
      mode: 'replace',
    })
    appendCandidateDelta(root, candidateId, '作者确认采纳的半稿正文。')
    finishCandidate(root, candidateId, 'partial')

    const result = acceptDraft({
      bookRoot: root,
      candidateId,
      base: { revision: chapter.revision, sha256: baseHash },
      idempotencyKey: 'idemp_partial_confirm_2',
      confirmPartial: true,
      operationId: 'op_accept_partial_2',
    })

    expect(result.alreadyApplied).toBe(false)
    expect(result.confirmPartial).toBe(true)
    expect(result.revision).toBe(chapter.revision + 1)

    // 盘上正文已更新
    const chapterAfter = readProseChapter(root, proseChapterPath(1))
    expect(chapterAfter.revision).toBe(chapter.revision + 1)
    expect(chapterAfter.body).toContain('作者确认采纳的半稿正文。')

    // 候选记录标记 confirmPartial: true 审计
    const candidateAfter = readDraftCandidate(root, candidateId)
    expect(candidateAfter?.canonState).toBe('accepted')
    expect(candidateAfter?.confirmPartial).toBe(true)
    expect(candidateAfter?.acceptedRevision).toBe(chapter.revision + 1)

    // W3 操作记录已落账 (draft.accept)
    const opRecord = readOperationRecord(root, 'op_accept_partial_2')
    expect(opRecord).not.toBeNull()
    expect(opRecord?.operationType).toBe('draft.accept')
    expect(opRecord?.result.appliedRevision).toBe(chapter.revision + 1)
  })

  it('最新 revision 显式校验：若磁盘 revision 领先于 expectedRevision 则抛 ProseRevisionConflictError', () => {
    const chapter = readProseChapter(root, proseChapterPath(1))
    const baseHash = proseFileSha256(root, 1)

    const candidateId = createCandidateId()
    createDraftCandidate(root, {
      id: candidateId,
      generationId: 'op_web_' + candidateId,
      bookId: 'book-local',
      chapterIndex: 1,
      base: { revision: chapter.revision, sha256: baseHash },
      mode: 'replace',
    })
    appendCandidateDelta(root, candidateId, '正文')
    finishCandidate(root, candidateId, 'ready')

    // 客户端指定 expectedRevision = 999（与盘上 revision 不一致）
    expect(() =>
      acceptDraft({
        bookRoot: root,
        candidateId,
        base: { revision: chapter.revision, sha256: baseHash },
        idempotencyKey: 'idemp_stale_rev_3',
        expectedRevision: 999,
      }),
    ).toThrow(ProseRevisionConflictError)
  })
})
