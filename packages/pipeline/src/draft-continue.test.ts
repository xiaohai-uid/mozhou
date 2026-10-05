/**
 * W4-2c-3 『续写』作为新 operationId 的显式新操作测试。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDataPlane, createBook, readProseChapter, proseChapterPath, readTaskRecord } from '@mozhou/data-plane'
import {
  appendCandidateDelta,
  createCandidateId,
  createDraftCandidate,
  finishCandidate,
  prepareDraftContinue,
  estimateContinueCost,
  ContinueOperationError,
  proseFileSha256,
} from './index.js'

describe('W4-2c-3 『续写』新操作契约', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mozhou-continue-test-'))
    createBook({ dir: root, title: '续写契约验收' })
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

  it('续写新 operationId：严禁复用 candidateId 与 generationId', () => {
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
    appendCandidateDelta(root, candidateId, '一段需要被续写的文字')
    finishCandidate(root, candidateId, 'partial')

    // 试图复用 candidateId
    expect(() =>
      prepareDraftContinue({
        bookRoot: root,
        sourceCandidateId: candidateId,
        operationId: candidateId,
      }),
    ).toThrow(ContinueOperationError)

    // 试图复用 generationId
    expect(() =>
      prepareDraftContinue({
        bookRoot: root,
        sourceCandidateId: candidateId,
        operationId: 'op_web_' + candidateId,
      }),
    ).toThrow(ContinueOperationError)
  })

  it('续写生成 taskKind="draft.continue"，并分配全新 attemptId（禁止重放原 attemptId）', () => {
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
    appendCandidateDelta(root, candidateId, '第一幕落下了帷幕。')
    finishCandidate(root, candidateId, 'partial')

    const res1 = prepareDraftContinue({
      bookRoot: root,
      sourceCandidateId: candidateId,
      operationId: 'op_continue_unique_1',
      taskId: 'task_cont_chapter1',
    })

    expect(res1.operationId).toBe('op_continue_unique_1')
    expect(res1.attemptId).toMatch(/^att_cont_/)
    expect(res1.taskRecord.taskKind).toBe('draft.continue')
    expect(res1.taskRecord.operationIds).toContain('op_continue_unique_1')
    expect(res1.taskRecord.attempts).toHaveLength(1)
    expect(res1.taskRecord.attempts[0]?.attemptId).toBe(res1.attemptId)

    // 第二次调用续写：严禁重放原 attemptId，每次生成新 attemptId
    const res2 = prepareDraftContinue({
      bookRoot: root,
      sourceCandidateId: candidateId,
      operationId: 'op_continue_unique_2',
      taskId: 'task_cont_chapter1',
    })

    expect(res2.attemptId).not.toBe(res1.attemptId)
    const recordOnDisk = readTaskRecord(root, 'task_cont_chapter1')
    expect(recordOnDisk?.attempts).toHaveLength(2)
    expect(recordOnDisk?.attempts.map((a) => a.attemptId)).toEqual([res1.attemptId, res2.attemptId])
  })

  it('成本发起前可见：estimateContinueCost 正确输出基底字数与预估 tokens 提示', () => {
    const chapter = readProseChapter(root, proseChapterPath(1))
    const baseHash = proseFileSha256(root, 1)

    const candidateId = createCandidateId()
    const candidate = createDraftCandidate(root, {
      id: candidateId,
      generationId: 'op_web_' + candidateId,
      bookId: 'book-local',
      chapterIndex: 1,
      base: { revision: chapter.revision, sha256: baseHash },
      mode: 'replace',
    })
    const candidateWithText = appendCandidateDelta(root, candidateId, '雨夜的街道空无一人。'.repeat(10))

    const cost = estimateContinueCost(candidateWithText, 'deepseek')
    expect(cost.baseChars).toBe(100)
    expect(cost.estimatedInputTokens).toBeGreaterThan(cost.baseChars / 2)
    expect(cost.estimatedOutputTokens).toBeGreaterThan(0)
    expect(cost.costNotice).toContain('续写基底 100 字')
    expect(cost.costNotice).toContain('tokens')
  })
})
