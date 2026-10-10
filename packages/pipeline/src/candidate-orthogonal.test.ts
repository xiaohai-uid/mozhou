/**
 * W4-2b：候选三字段正交化 + 有损迁移 + 取消判定点 + 迟到 chunk 门。
 * 隔离夹具（tmpdir），不读写真实书稿。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  CANDIDATE_DIR,
  CANDIDATE_SCHEMA_VERSION,
  CandidateError,
  acceptDraftCandidate,
  appendCandidateDelta,
  assertCandidateStateCombination,
  createDraftCandidate,
  deriveCandidateStatus,
  finishCandidate,
  readDraftCandidate,
  requestCandidateCancel,
  resolveCandidateCancel,
} from './draft-candidate.js'

const roots: string[] = []
let root = ''
const BASE = { revision: 0, sha256: 'a'.repeat(64) }
const REQ = { id: '11111111-1111-4111-8111-111111111111', generationId: 'g1', bookId: 'b', chapterIndex: 1, base: BASE, mode: 'replace' as const }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mozhou-orth-'))
  roots.push(root)
})

afterAll(() => {
  for (const r of roots.splice(0)) {
    rmSync(r, { recursive: true, force: true })
  }
})

function writeLegacy(id: string, status: string, text = '半稿'): string {
  mkdirSync(join(root, CANDIDATE_DIR), { recursive: true })
  const path = join(root, CANDIDATE_DIR, id + '.json')
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      id,
      operationId: 'legacy_gen',
      bookId: 'b',
      chapterIndex: 1,
      base: BASE,
      mode: 'replace',
      text,
      status,
    }),
  )
  return path
}

describe('W4-2b 三字段正交', () => {
  it('合法/非法组合表：白名单外一律拒绝（fail-closed）', () => {
    expect(() => assertCandidateStateCombination('complete', 'succeeded', 'unaccepted')).not.toThrow()
    expect(() => assertCandidateStateCombination('partial', 'succeeded', 'accepted')).not.toThrow() // confirmPartial 合法格
    expect(() => assertCandidateStateCombination('partial', 'succeeded', 'unaccepted')).not.toThrow()
    // 完成却已取消 = 矛盾态（判定点规则正是为了排除它）
    expect(() => assertCandidateStateCombination('complete', 'cancelled', 'unaccepted')).toThrow(/CANDIDATE_STATE_INVALID/)
    // 流式却已失败 / 已采纳却未完成 = 非法
    expect(() => assertCandidateStateCombination('streaming', 'failed', 'unaccepted')).toThrow(/CANDIDATE_STATE_INVALID/)
    expect(() => assertCandidateStateCombination('streaming', 'succeeded', 'accepted')).toThrow(/CANDIDATE_STATE_INVALID/)
  })

  it('新记录写 v2 三字段；status 只是派生兼容视图', () => {
    const c = createDraftCandidate(root, REQ)
    expect(c.schemaVersion).toBe(CANDIDATE_SCHEMA_VERSION)
    expect(c).toMatchObject({ contentState: 'streaming', taskState: 'running', canonState: 'unaccepted', status: 'streaming' })
    const ready = finishCandidate(root, REQ.id, 'ready')
    expect(ready).toMatchObject({ contentState: 'complete', taskState: 'succeeded', canonState: 'unaccepted', status: 'ready' })
    expect(deriveCandidateStatus('partial', 'succeeded', 'unaccepted')).toBe('partial')
    expect(deriveCandidateStatus('partial', 'cancelled', 'unaccepted')).toBe('cancelled')
  })
})

describe('W4-2b 有损迁移（旧单一 status → 三字段）', () => {
  it('旧 partial → taskState=succeeded + migratedFrom 注记；**读旧不写回**', () => {
    const path = writeLegacy('22222222-2222-4222-8222-222222222222', 'partial')
    const bytesBefore = readFileSync(path, 'utf8')
    const migrated = readDraftCandidate(root, '22222222-2222-4222-8222-222222222222')
    expect(migrated).toMatchObject({ contentState: 'partial', taskState: 'succeeded', canonState: 'unaccepted', status: 'partial' })
    expect(migrated?.migratedFrom).toMatchObject({ status: 'partial', lossy: true })
    expect(migrated?.migratedFrom?.lost).toContain('取消')
    // 读路径无写副作用：盘上仍是 v1 原字节
    expect(readFileSync(path, 'utf8')).toBe(bytesBefore)
  })

  it('其余旧值映射：streaming/ready/accepted/cancelled/failed', () => {
    const cases: [string, string, string, string][] = [
      ['33333333-3333-4333-8333-333333333331', 'streaming', 'streaming', 'running'],
      ['33333333-3333-4333-8333-333333333332', 'ready', 'complete', 'succeeded'],
      ['33333333-3333-4333-8333-333333333333', 'accepted', 'complete', 'succeeded'],
      ['33333333-3333-4333-8333-333333333334', 'cancelled', 'partial', 'cancelled'],
      ['33333333-3333-4333-8333-333333333335', 'failed', 'partial', 'failed'],
    ]
    for (const [id, legacy, contentState, taskState] of cases) {
      writeLegacy(id, legacy)
      const c = readDraftCandidate(root, id)
      expect(c?.contentState).toBe(contentState)
      expect(c?.taskState).toBe(taskState)
      expect(c?.status).toBe(legacy)
    }
  })

  it('**安全性质（用例锁定）**：迁移后 partial + unaccepted **绝不被自动采纳**', () => {
    writeLegacy('44444444-4444-4444-8444-444444444444', 'partial')
    // 迁移读出来就是 partial + unaccepted
    const migrated = readDraftCandidate(root, '44444444-4444-4444-8444-444444444444')
    expect(migrated).toMatchObject({ contentState: 'partial', canonState: 'unaccepted' })
    // 不带显式确认 ⇒ 拒绝（绝不自动采纳）
    expect(() => acceptDraftCandidate(root, '44444444-4444-4444-8444-444444444444', 3)).toThrow(/requires explicit confirmation/)
    expect(readDraftCandidate(root, '44444444-4444-4444-8444-444444444444')?.canonState).toBe('unaccepted')
    // 作者显式确认（confirmPartial）后才可采纳，且落成合法格 partial|succeeded|accepted
    const accepted = acceptDraftCandidate(root, '44444444-4444-4444-8444-444444444444', 3, true)
    expect(accepted).toMatchObject({ contentState: 'partial', taskState: 'succeeded', canonState: 'accepted', status: 'accepted' })
    expect(accepted.acceptedRevision).toBe(3)
  })

  it('未知 recordVersion：拒写而非猜测（读失败 ⇒ 写不发生），文件原样保留', () => {
    mkdirSync(join(root, CANDIDATE_DIR), { recursive: true })
    const path = join(root, CANDIDATE_DIR, '55555555-5555-4555-8555-555555555555.json')
    writeFileSync(path, JSON.stringify({ schemaVersion: 99, id: '55555555-5555-4555-8555-555555555555', text: 'x' }))
    const bytesBefore = readFileSync(path, 'utf8')
    expect(() => readDraftCandidate(root, '55555555-5555-4555-8555-555555555555')).toThrow(/CANDIDATE_RECORD_UNSUPPORTED/)
    expect(() => appendCandidateDelta(root, '55555555-5555-4555-8555-555555555555', '迟到')).toThrow(/CANDIDATE_RECORD_UNSUPPORTED/)
    expect(readFileSync(path, 'utf8')).toBe(bytesBefore)
  })
})

describe('W4-2b 取消判定点与迟到 chunk 门', () => {
  it('cancel_requested 是中间态；判定点用**上游结局**：完成先于取消生效 ⇒ succeeded', () => {
    const a = createDraftCandidate(root, { ...REQ, id: '66666666-6666-4666-8666-666666666661' })
    expect(requestCandidateCancel(root, a.id).taskState).toBe('cancel_requested')
    // 上游未完成 ⇒ cancelled
    expect(resolveCandidateCancel(root, a.id, { upstreamCompleted: false })).toMatchObject({
      taskState: 'cancelled',
      contentState: 'partial',
      status: 'cancelled',
    })

    const b = createDraftCandidate(root, { ...REQ, id: '66666666-6666-4666-8666-666666666662' })
    requestCandidateCancel(root, b.id)
    // 上游已完成（流自然结束）⇒ **succeeded**，不因期间按了停止而改判取消
    expect(resolveCandidateCancel(root, b.id, { upstreamCompleted: true })).toMatchObject({
      taskState: 'succeeded',
      contentState: 'complete',
      status: 'ready',
    })
  })

  it('迟到 chunk：旧代次/已见序号在**写盘之前**被丢弃（零盘上变更）', () => {
    const c = createDraftCandidate(root, { ...REQ, id: '77777777-7777-4777-8777-777777777777' })
    const written = appendCandidateDelta(root, c.id, '第一段', { generationEpoch: 5, sequence: 1 })
    expect(written.text).toBe('第一段')
    expect(written.lastSequence).toBe(1)

    // 旧代次（客户端已切书/切章）：丢弃，不落盘
    const staleEpoch = appendCandidateDelta(root, c.id, '旧代次的迟到块', { generationEpoch: 4, sequence: 2 })
    expect(staleEpoch.text).toBe('第一段')
    expect(staleEpoch.lastSequence).toBe(1)

    // 已见序号：丢弃
    const staleSeq = appendCandidateDelta(root, c.id, '重复序号', { generationEpoch: 5, sequence: 1 })
    expect(staleSeq.text).toBe('第一段')

    // 当前代次的新序号：正常写入
    const fresh = appendCandidateDelta(root, c.id, '第二段', { generationEpoch: 5, sequence: 2 })
    expect(fresh.text).toBe('第一段第二段')
    expect(fresh.lastSequence).toBe(2)

    // 盘上与内存一致（丢弃确实没写盘）
    expect(readDraftCandidate(root, c.id)?.text).toBe('第一段第二段')
  })

  it('终态仍拒绝追加/结束/取消（与旧语义等价）', () => {
    const c = createDraftCandidate(root, { ...REQ, id: '88888888-8888-4888-8888-888888888888' })
    appendCandidateDelta(root, c.id, 'x')
    finishCandidate(root, c.id, 'ready')
    expect(() => appendCandidateDelta(root, c.id, 'y')).toThrow(/CANDIDATE_TERMINAL/)
    expect(() => finishCandidate(root, c.id, 'ready')).toThrow(/CANDIDATE_TERMINAL/)
    expect(() => requestCandidateCancel(root, c.id)).toThrow(CandidateError)
  })
})
