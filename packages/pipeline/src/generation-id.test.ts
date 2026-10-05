/**
 * W4-2a：候选侧 operationId → generationId 重命名。
 * 锁定三件事：①写端只写新名；②读端兼容旧名且**读旧不写回**；③任何判定都不依赖 op_web_ 前缀。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  CANDIDATE_DIR,
  CandidateError,
  createDraftCandidate,
  readDraftCandidate,
  resolveCandidateGenerationId,
} from './draft-candidate.js'

const roots: string[] = []
afterAll(() => {
  for (const r of roots.splice(0)) {
    rmSync(r, { recursive: true, force: true })
  }
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-gen-'))
  roots.push(root)
  return root
}

const BASE = { revision: 0, sha256: 'a'.repeat(64) }

describe('W4-2a 候选生成标识重命名', () => {
  it('写端只写新名：传 deprecated 旧名 operationId 时，落盘记录里只有 generationId', () => {
    const root = makeRoot()
    const id = '11111111-1111-4111-8111-111111111111'
    const created = createDraftCandidate(root, {
      id,
      // 旧名（deprecated 输入别名）——7 个既有测试文件正是这样传的
      operationId: 'op_web_legacy',
      bookId: 'b',
      chapterIndex: 1,
      base: BASE,
      mode: 'replace',
    })
    expect(created.generationId).toBe('op_web_legacy')
    expect((created as unknown as Record<string, unknown>)['operationId']).toBeUndefined()
    const onDisk = JSON.parse(readFileSync(join(root, CANDIDATE_DIR, id + '.json'), 'utf8')) as Record<string, unknown>
    expect(onDisk['generationId']).toBe('op_web_legacy')
    expect(onDisk['operationId']).toBeUndefined()
  })

  it('读端兼容旧名（读旧不写回）：旧记录读出来带 generationId，且文件字节不变', () => {
    const root = makeRoot()
    const id = '22222222-2222-4222-8222-222222222222'
    const path = join(root, CANDIDATE_DIR, id + '.json')
    mkdirSync(join(root, CANDIDATE_DIR), { recursive: true })
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        id,
        operationId: 'op_web_old_record',
        bookId: 'b',
        chapterIndex: 1,
        base: BASE,
        mode: 'replace',
        text: '',
        status: 'streaming',
      }),
    )
    const bytesBefore = readFileSync(path, 'utf8')
    const read = readDraftCandidate(root, id)
    expect(read?.generationId).toBe('op_web_old_record')
    // 读旧**不写回**：读路径不产生写副作用
    expect(readFileSync(path, 'utf8')).toBe(bytesBefore)
  })

  it('任何判定都不依赖 op_web_ 前缀：非前缀值与前缀值行为一致', () => {
    const root = makeRoot()
    const a = createDraftCandidate(root, {
      id: '33333333-3333-4333-8333-333333333333',
      generationId: 'op_web_aaaaaaaa',
      bookId: 'b',
      chapterIndex: 1,
      base: BASE,
      mode: 'replace',
    })
    const b = createDraftCandidate(root, {
      id: '44444444-4444-4444-8444-444444444444',
      generationId: 'plain-no-prefix',
      bookId: 'b',
      chapterIndex: 1,
      base: BASE,
      mode: 'replace',
    })
    expect(a.generationId).toBe('op_web_aaaaaaaa')
    expect(b.generationId).toBe('plain-no-prefix')
    expect(readDraftCandidate(root, b.id)?.generationId).toBe('plain-no-prefix')
  })

  it('新名优先；两者皆缺即拒绝（绝不静默造值）', () => {
    expect(resolveCandidateGenerationId({ generationId: 'new', operationId: 'old' })).toBe('new')
    expect(resolveCandidateGenerationId({ operationId: 'old' })).toBe('old')
    expect(() => resolveCandidateGenerationId({})).toThrow(CandidateError)
    expect(() => resolveCandidateGenerationId({ generationId: '' })).toThrow(/INVALID_GENERATION_ID/)
  })
})
