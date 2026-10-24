// @vitest-environment node
/**
 * 候选事实账本（Candidate Fact Ledger）数据面行为测试 · 第一切片（#117）。
 *
 * 规格依据：.scratch/chapter-fact-ledger/spec.md
 * 存储先例：tasks.ts 一候选一记录（bookRoot/.mozhou/ 运行时区，不参与对账）。
 * 断言外部行为：插入 → 待决列表 → 决断（幂等）→ 历史；不作内部实现断言。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { newUlid } from '@mozhou/kernel'
import { createBook } from './create-book.js'
import { proseChapterPath } from './layout.js'
import { readProseChapter, renderProseChapter } from './chapter.js'
import { sha256Hex } from './sha256.js'
import {
  decideFactCandidate,
  FactBatchChapterMismatchError,
  FactCandidateNotFoundError,
  FactCandidateVoidedError,
  insertFactCandidates,
  listFactLedgerHistory,
  listPendingFactCandidates,
  type NewFactCandidate,
} from './fact-ledger.js'

const tmpRoots: string[] = []
let bookRoot = ''
/** 当前第 1 章正文的版本身份（以解析回读值为准，与路由提取口径一致）。 */
let chapterProseHash = ''

const PROSE_BODY = '萧炎走进坊市，与萧宁当街冲突。两人不欢而散，各自记恨。'

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-fact-ledger-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
  createBook({ dir: bookRoot, title: '墨舟试炼' })
  writeChapterProse(PROSE_BODY)
})

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

/** 写第 1 章正文并刷新其版本身份（候选的 proseHash 绑定与决断校验共用）。 */
function writeChapterProse(body: string): void {
  writeFileSync(
    join(bookRoot, proseChapterPath(1)),
    renderProseChapter({ mozhouId: `prose_${newUlid()}`, revision: 1, chapterIndex: 1, phase: 'draft', body }),
    'utf8',
  )
  chapterProseHash = sha256Hex(readProseChapter(bookRoot, proseChapterPath(1)).body)
}

function eventCandidate(overrides?: Partial<NewFactCandidate>): NewFactCandidate {
  return {
    kind: 'event',
    payload: { summary: '萧炎在坊市与萧宁发生冲突' },
    evidence: '第0001章原文摘句',
    chapterIndex: 1,
    proseHash: chapterProseHash,
    extractionRunId: 'run_0001',
    ...overrides,
  }
}

describe('候选事实账本 · 插入与待决列表', () => {
  it('插入事件候选：pending 落账，字段完整可读，同章待决列表确定性排序', () => {
    const { inserted } = insertFactCandidates(
      bookRoot,
      1,
      [
        eventCandidate({ payload: { summary: '事件乙' } }),
        eventCandidate({ payload: { summary: '事件甲' } }),
      ],
      '2026-10-24T00:00:00.000Z',
    )
    expect(inserted.length).toBe(2)
    const first = inserted[0]!
    const second = inserted[1]!

    expect(first.status).toBe('pending')
    expect(first.candidateId).toMatch(/^fc_/)
    expect(first.kind).toBe('event')
    expect(first.payload.summary).toBe('事件乙')
    expect(first.evidence).toBe('第0001章原文摘句')
    expect(first.chapterIndex).toBe(1)
    expect(first.proseHash).toBe(chapterProseHash)
    expect(first.createdAt).toBe('2026-10-24T00:00:00.000Z')
    expect(second.decidedAt).toBeUndefined()

    const pending = listPendingFactCandidates(bookRoot)
    expect(pending.map((r) => r.payload.summary)).toEqual(['事件乙', '事件甲'])
  })

  it('空提取批次同样定义新现场：同章旧 pending 全部作废（空提取不漏隔离）', () => {
    const first = insertFactCandidates(bookRoot, 1, [eventCandidate()], '2026-10-24T00:00:00.000Z')
    expect(first.inserted.length).toBe(1)

    const empty = insertFactCandidates(bookRoot, 1, [], '2026-10-24T01:00:00.000Z')
    expect(empty.inserted).toEqual([])
    expect(empty.voided.length).toBe(1)
    expect(listPendingFactCandidates(bookRoot, 1)).toEqual([])
  })

  it('整批单一章号：候选章号与现场章号不一致整批拒绝，不产生半现场', () => {
    expect(() =>
      insertFactCandidates(
        bookRoot,
        1,
        [eventCandidate(), eventCandidate({ chapterIndex: 2 })],
        '2026-10-24T00:00:00.000Z',
      ),
    ).toThrow(FactBatchChapterMismatchError)
    expect(listFactLedgerHistory(bookRoot)).toEqual([])
  })
})

describe('候选事实账本 · 决断状态机', () => {
  it('确认：pending → confirmed，记录决断时间；重复决断幂等返回首次结果', () => {
    const { inserted } = insertFactCandidates(bookRoot, 1, [eventCandidate()], '2026-10-24T00:00:00.000Z')
    expect(inserted.length).toBe(1)
    const candidate = inserted[0]!

    const first = decideFactCandidate(bookRoot, candidate.candidateId, { decision: 'confirmed' }, '2026-10-24T01:00:00.000Z')
    expect(first.replayed).toBe(false)
    expect(first.record.status).toBe('confirmed')
    expect(first.record.decidedAt).toBe('2026-10-24T01:00:00.000Z')

    const replay = decideFactCandidate(bookRoot, candidate.candidateId, { decision: 'confirmed' }, '2026-10-24T02:00:00.000Z')
    expect(replay.replayed).toBe(true)
    expect(replay.record.decidedAt).toBe('2026-10-24T01:00:00.000Z')

    expect(listPendingFactCandidates(bookRoot)).toEqual([])
  })

  it('拒绝与编辑确认：拒绝不携带决断内容；编辑确认写 decidedPayload 且原候选 payload 不被覆写', () => {
    const { inserted } = insertFactCandidates(bookRoot, 1, [eventCandidate()], '2026-10-24T00:00:00.000Z')
    expect(inserted.length).toBe(1)
    const candidate = inserted[0]!

    const rejected = decideFactCandidate(bookRoot, candidate.candidateId, { decision: 'rejected' }, '2026-10-24T01:00:00.000Z')
    expect(rejected.record.status).toBe('rejected')
    expect(rejected.record.decidedPayload).toBeUndefined()

    const { inserted: editedBatch } = insertFactCandidates(
      bookRoot,
      1,
      [eventCandidate({ payload: { summary: '原始措辞不准的事件' } })],
      '2026-10-24T03:00:00.000Z',
    )
    expect(editedBatch.length).toBe(1)
    const edited = editedBatch[0]!
    const confirmed = decideFactCandidate(
      bookRoot,
      edited.candidateId,
      { decision: 'confirmed', payload: { summary: '作者修正后的事件' } },
      '2026-10-24T04:00:00.000Z',
    )
    expect(confirmed.record.status).toBe('confirmed')
    expect(confirmed.record.decidedPayload?.summary).toBe('作者修正后的事件')
    // 原始候选不被覆写
    expect(confirmed.record.payload.summary).toBe('原始措辞不准的事件')
  })

  it('现场隔离：同章重新提取作废全部旧 pending（含旧正文版本），确认历史不受影响', () => {
    const first = insertFactCandidates(bookRoot, 1, [eventCandidate()], '2026-10-24T00:00:00.000Z')
    const oldPending = first.inserted[0]!
    decideFactCandidate(bookRoot, oldPending.candidateId, { decision: 'confirmed' }, '2026-10-24T00:30:00.000Z')

    const second = insertFactCandidates(
      bookRoot,
      1,
      [eventCandidate({ proseHash: 'b'.repeat(64), extractionRunId: 'run_0002' })],
      '2026-10-24T01:00:00.000Z',
    )
    expect(second.voided).toEqual([])

    // 新 pending 与一笔待决残留：再次提取应把旧 pending 作废
    const third = insertFactCandidates(
      bookRoot,
      1,
      [eventCandidate({ proseHash: 'c'.repeat(64), extractionRunId: 'run_0003' })],
      '2026-10-24T02:00:00.000Z',
    )
    expect(third.voided.length).toBe(1)

    const pending = listPendingFactCandidates(bookRoot)
    expect(pending.length).toBe(1)
    expect(pending[0]?.extractionRunId).toBe('run_0003')

    const history = listFactLedgerHistory(bookRoot, { chapterIndex: 1 })
    expect(history.filter((r) => r.status === 'confirmed').length).toBe(1)
    expect(history.filter((r) => r.status === 'voided').length).toBe(1)
  })

  it('决断绑定正文版本：作者改稿未重提取的 pending 候选决断即作废拒绝（旧现场不得确认）', () => {
    writeChapterProse('第一版正文：萧炎在坊市与萧宁冲突，不欢而散。')
    const sceneOne = insertFactCandidates(bookRoot, 1, [eventCandidate()], '2026-10-24T00:00:00.000Z')
    decideFactCandidate(bookRoot, sceneOne.inserted[0]!.candidateId, { decision: 'confirmed' }, '2026-10-24T00:30:00.000Z')

    writeChapterProse('第二版正文：萧炎在坊市被萧宁拦下，两人不欢而散。')
    const sceneTwo = insertFactCandidates(bookRoot, 1, [eventCandidate()], '2026-10-24T01:00:00.000Z')
    expect(sceneTwo.voided).toEqual([]) // 第一批候选已决断，不作废
    const staleCandidate = sceneTwo.inserted[0]!

    // 作者改稿但未重提取：现场二候选成为旧现场残留，决断即作废拒绝
    writeChapterProse('第三版正文：萧炎改道绕开坊市，萧宁扑空。')
    expect(() =>
      decideFactCandidate(bookRoot, staleCandidate.candidateId, { decision: 'confirmed' }, '2026-10-24T02:00:00.000Z'),
    ).toThrow(FactCandidateVoidedError)
    expect(listPendingFactCandidates(bookRoot, 1)).toEqual([])
    const staleRecord = listFactLedgerHistory(bookRoot).find((r) => r.candidateId === staleCandidate.candidateId)
    expect(staleRecord?.status).toBe('voided')
  })

  it('对 voided 候选决断显式拒绝；未知候选 NotFound；跨章过滤互不串', () => {
    insertFactCandidates(bookRoot, 1, [eventCandidate()], '2026-10-24T00:00:00.000Z')
    insertFactCandidates(
      bookRoot,
      1,
      [eventCandidate({ proseHash: 'b'.repeat(64), extractionRunId: 'run_0002' })],
      '2026-10-24T01:00:00.000Z',
    )
    const voidedId = listFactLedgerHistory(bookRoot).find((r) => r.status === 'voided')?.candidateId ?? ''

    expect(() => decideFactCandidate(bookRoot, voidedId, { decision: 'confirmed' })).toThrow(FactCandidateVoidedError)
    expect(() => decideFactCandidate(bookRoot, 'fc_missing', { decision: 'confirmed' })).toThrow(FactCandidateNotFoundError)

    insertFactCandidates(bookRoot, 2, [eventCandidate({ chapterIndex: 2, proseHash: 'd'.repeat(64) })], '2026-10-24T02:00:00.000Z')
    expect(listPendingFactCandidates(bookRoot, 2).length).toBe(1)
    // 第 1 章仍有 run_0002 的合法待决（未被第 2 章提取波及）：跨章互不串
    const chapterOnePending = listPendingFactCandidates(bookRoot, 1)
    expect(chapterOnePending.length).toBe(1)
    expect(chapterOnePending[0]?.extractionRunId).toBe('run_0002')
  })

  it('历史 limit：正整数取最近 N 条；0 / 负数返回空数组（0 不表示全部），缺省返回全部', () => {
    const first = insertFactCandidates(bookRoot, 1, [eventCandidate()], '2026-10-24T00:00:00.000Z')
    decideFactCandidate(bookRoot, first.inserted[0]!.candidateId, { decision: 'confirmed' }, '2026-10-24T00:10:00.000Z')
    const second = insertFactCandidates(bookRoot, 1, [eventCandidate()], '2026-10-24T01:00:00.000Z')
    decideFactCandidate(bookRoot, second.inserted[0]!.candidateId, { decision: 'rejected' }, '2026-10-24T01:10:00.000Z')
    insertFactCandidates(bookRoot, 1, [eventCandidate()], '2026-10-24T02:00:00.000Z')

    expect(listFactLedgerHistory(bookRoot).length).toBe(3)
    expect(listFactLedgerHistory(bookRoot, { limit: 2 }).map((r) => r.status)).toEqual(['rejected', 'pending'])
    expect(listFactLedgerHistory(bookRoot, { limit: 0 })).toEqual([])
    expect(listFactLedgerHistory(bookRoot, { limit: -1 })).toEqual([])
  })
})
