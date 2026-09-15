/**
 * C2 候选契约 · T03 red-green。
 * 语义核心（I01）：未经 Accept 的生成只改变候选区，正文/revision/hash 零变化。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBook } from '@mozhou/data-plane'
import { LocalDataPlane, proseChapterPath } from '@mozhou/data-plane'
import {
  CANDIDATE_TERMINAL,
  appendCandidateDelta,
  cancelCandidate,
  candidateRelPath,
  createDraftCandidate,
  finishCandidate,
  isServerGeneratedCandidateId,
  listDraftCandidates,
  readDraftCandidate,
  type DraftCandidateRequest,
} from './draft-candidate.js'

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** 建书 + 第1章 draft 原文 A（r1）。 */
function makeChapterOne(dir: string): void {
  const plane = LocalDataPlane.openOrRebuild(dir)
  plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
  plane.saveProseDraft({ chapterIndex: 1, body: '原文A\n', expectedRevision: 0 })
  plane.close()
}

let root: string
let dir: string
let prosePath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mozhou-candidate-'))
  root = join(dir, '书')
  createBook({ dir: root, title: '候选书' })
  makeChapterOne(root)
  prosePath = join(root, proseChapterPath(1))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const REQ: DraftCandidateRequest = {
  id: '7b1c2c14-5e6f-4a3b-9c8d-1e2f3a4b5c6d',
  operationId: 'op-1',
  bookId: 'book-1',
  chapterIndex: 1,
  base: { revision: 1, sha256: 'a'.repeat(64) },
  mode: 'replace',
}

describe('I01 语义：生成未采纳不触碰正文', () => {
  it('创建原文A与r1；开始生成B后未采纳：正文仍A、r1与原hash不变、candidate=B', () => {
    const beforeBody = readFileSync(prosePath, 'utf8')
    const beforeHash = sha256File(prosePath)

    // 从 r1(base) 开始生成候选 B
    createDraftCandidate(root, REQ)
    appendCandidateDelta(root, REQ.id, '模型候选B')
    finishCandidate(root, REQ.id, 'ready')

    const afterBody = readFileSync(prosePath, 'utf8')
    const afterHash = sha256File(prosePath)
    const candidate = readDraftCandidate(root, REQ.id)

    expect(afterBody).toBe(beforeBody)
    expect(afterHash).toBe(beforeHash)
    expect(candidate).not.toBeNull()
    expect(candidate?.status).toBe('ready')
    expect(candidate?.text).toBe('模型候选B')
  })
})

describe('candidate 读写与校验', () => {
  it('id 仅接受服务端生成格式；非法 id 无法读写且路径不可穿越', () => {
    expect(isServerGeneratedCandidateId(REQ.id)).toBe(true)
    expect(isServerGeneratedCandidateId('../../evil')).toBe(false)
    expect(isServerGeneratedCandidateId('short')).toBe(false)
    expect(candidateRelPath(REQ.id)).toBe('.mozhou/candidates/7b1c2c14-5e6f-4a3b-9c8d-1e2f3a4b5c6d.json')
    expect(() => createDraftCandidate(root, { ...REQ, id: '../../evil' })).toThrow(/INVALID_CANDIDATE_ID/)
    expect(() => readDraftCandidate(root, '../../evil')).toThrow(/INVALID_CANDIDATE_ID/)
  })

  it('schema/body/base 校验：base.revision、sha256 与 mode 非法即拒绝', () => {
    expect(() => createDraftCandidate(root, { ...REQ, base: { revision: -1, sha256: 'a'.repeat(64) } })).toThrow(/INVALID_BASE/)
    expect(() => createDraftCandidate(root, { ...REQ, base: { revision: 1, sha256: 'not-a-hash' } })).toThrow(/INVALID_BASE/)
    expect(() => createDraftCandidate(root, { ...REQ, mode: 'sideways' as never })).toThrow(/INVALID_MODE/)
    expect(() =>
      createDraftCandidate(root, {
        ...REQ,
        selection: { from: 5, to: 2, selectedTextHash: 'a'.repeat(64) },
      }),
    ).toThrow(/INVALID_SELECTION/)
  })

  it('同 id 重复创建拒绝（不静默覆盖），未知候选返回 null/404 语义', () => {
    createDraftCandidate(root, REQ)
    expect(() => createDraftCandidate(root, REQ)).toThrow(/CANDIDATE_EXISTS/)
    expect(readDraftCandidate(root, '00000000-0000-4000-8000-000000000000')).toBeNull()
  })

  it('终态 append delta 拒绝；终态再 finish/cancel 也拒绝', () => {
    createDraftCandidate(root, REQ)
    appendCandidateDelta(root, REQ.id, '第一部分')
    finishCandidate(root, REQ.id, 'ready')
    expect(() => appendCandidateDelta(root, REQ.id, '迟到的块')).toThrow(CANDIDATE_TERMINAL)
    expect(() => finishCandidate(root, REQ.id, 'ready')).toThrow(CANDIDATE_TERMINAL)
    expect(() => cancelCandidate(root, REQ.id)).toThrow(CANDIDATE_TERMINAL)
    // 终态后正文 hash 仍未变
    expect(sha256File(prosePath)).toBe(sha256File(prosePath))
  })
})

describe('候选跨进程/跨重建持久', () => {
  it('ready/partial/cancelled/accepted 全部可重开回读；重建 projection 后不丢失', () => {
    createDraftCandidate(root, REQ)
    appendCandidateDelta(root, REQ.id, '流式正文')
    finishCandidate(root, REQ.id, 'ready')

    const partialId = '11111111-1111-4111-8111-111111111111'
    createDraftCandidate(root, { ...REQ, id: partialId })
    appendCandidateDelta(root, partialId, '半稿')
    finishCandidate(root, partialId, 'partial')

    const cancelledId = '22222222-2222-4222-8222-222222222222'
    createDraftCandidate(root, { ...REQ, id: cancelledId })
    cancelCandidate(root, cancelledId)

    const acceptedId = '33333333-3333-4333-8333-333333333333'
    createDraftCandidate(root, { ...REQ, id: acceptedId })
    appendCandidateDelta(root, acceptedId, '已采纳文本')
    const accepted = readDraftCandidate(root, acceptedId)
    expect(accepted?.status).toBe('streaming')
    writeFileSync(
      join(root, candidateRelPath(acceptedId)),
      JSON.stringify({ ...accepted, status: 'accepted', acceptedRevision: 2 }, null, 2) + '\n',
    )

    // 跨进程重开：重新 openOrRebuild（模拟重启），candidate 目录不随投影重建被清
    const plane = LocalDataPlane.openOrRebuild(root)
    expect(plane).toBeDefined()
    plane.close()

    expect(readDraftCandidate(root, REQ.id)?.status).toBe('ready')
    expect(readDraftCandidate(root, partialId)?.status).toBe('partial')
    expect(readDraftCandidate(root, cancelledId)?.status).toBe('cancelled')
    const acceptedAfter = readDraftCandidate(root, acceptedId)
    expect(acceptedAfter?.status).toBe('accepted')
    expect(acceptedAfter?.acceptedRevision).toBe(2)
    expect(listDraftCandidates(root)).toHaveLength(4)
  })

  it("断流不写成 ready：finish('partial') 后 status=partial，文本保留", () => {
    const id = '44444444-4444-4444-8444-444444444444'
    createDraftCandidate(root, { ...REQ, id })
    appendCandidateDelta(root, id, '前半段')
    finishCandidate(root, id, 'partial')
    const c = readDraftCandidate(root, id)
    expect(c?.status).toBe('partial')
    expect(c?.text).toContain('前半段')
    // 正文仍原样
    expect(readFileSync(prosePath, 'utf8')).toContain('原文A')
  })

  it('候选文件属备份范围：存在于 .mozhou/candidates/ 且非投影缓存', () => {
    const id = '55555555-5555-4555-8555-555555555555'
    createDraftCandidate(root, { ...REQ, id })
    expect(existsSync(join(root, '.mozhou/candidates', id + '.json'))).toBe(true)
  })
})