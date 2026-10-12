/**
 * 导入决策纯函数测试（P1-import-plan）。
 * 判定：npx pnpm --filter @mozhou/web exec vitest run src/migration/importPlan.test.ts
 */
import { describe, expect, it } from 'vitest'
import { buildImportPlan, idempotencyKeyFor, identityKeyOf } from './importPlan'
import type { ImportPlanInput, LocalChapterSnapshot, ServerChapterSnapshot } from './importPlan'
import { MIGRATION_FORMAT_VERSION, computePackageDigest } from './packageFormat'
import type { BookIdentity, MigrationCandidate, MigrationChapterEntry, MigrationPackageV1 } from './packageFormat'

const A: BookIdentity = { bookId: 'bk_a', root: 'C:\\tmp\\a', title: '甲书' }
const B: BookIdentity = { bookId: 'bk_b', root: 'C:\\tmp\\b', title: '乙书' }

function entry(chapterIndex: number, overrides: Partial<MigrationChapterEntry> = {}): MigrationChapterEntry {
  return {
    chapterIndex,
    chapterKey: `ch_bk_a_${chapterIndex}`,
    draft: { text: `第${chapterIndex}章草稿`, baselineSha256: 'aa'.repeat(32) },
    candidate: null,
    editorProjection: null,
    ...overrides,
  }
}

function pkg(books: readonly { identity: BookIdentity; chapters: MigrationChapterEntry[] }[]): MigrationPackageV1 {
  const payload = {
    formatVersion: MIGRATION_FORMAT_VERSION,
    origin: { origin: 'http://localhost:43000', userAgent: 'ua', exportedAt: '2026-10-12T00:00:00.000Z' },
    books,
    unclaimed: [],
    preferences: {},
  }
  return { ...payload, digest: computePackageDigest(payload) }
}

const REACHABLE_FRESH: ServerChapterSnapshot = { reachable: true, exists: false, revision: null, phase: null, bodySha256: null }

function planInput(overrides: Partial<ImportPlanInput> = {}): ImportPlanInput {
  return {
    pkg: pkg([{ identity: A, chapters: [entry(1)] }]),
    targetIdentity: A,
    local: () => null,
    server: () => REACHABLE_FRESH,
    appliedKeys: [],
    ...overrides,
  }
}

describe('buildImportPlan', () => {
  it('服务端无此章 + 本地干净 → matched', () => {
    const plan = buildImportPlan(planInput())
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]?.verdict).toBe('matched')
    expect(plan.counts.matched).toBe(1)
  })

  it('候选 base.revision 与服务端现值不一致 → conflict（保留双份）', () => {
    const candidate: MigrationCandidate = { candidateId: 'c1', base: { revision: 2, sha256: 'bb'.repeat(32) }, mode: 'replace', draftText: 'x', phase: 'draft_done', partial: false }
    const plan = buildImportPlan(
      planInput({
        pkg: pkg([{ identity: A, chapters: [entry(1, { candidate })] }]),
        server: () => ({ reachable: true, exists: true, revision: 5, phase: 'draft', bodySha256: 'aa'.repeat(32) }),
      }),
    )
    expect(plan.items[0]?.verdict).toBe('conflict')
    expect(plan.items[0]?.reason).toContain('candidate-base-revision-mismatch')
  })

  it('草稿基线哈希与服务端正文不一致 → conflict', () => {
    const plan = buildImportPlan(
      planInput({
        server: () => ({ reachable: true, exists: true, revision: 1, phase: 'draft', bodySha256: 'zz'.repeat(32) }),
      }),
    )
    expect(plan.items[0]?.verdict).toBe('conflict')
    expect(plan.items[0]?.reason).toContain('draft-baseline-mismatch')
  })

  it('服务端已定稿 → conflict（不覆盖已定稿）', () => {
    const plan = buildImportPlan(
      planInput({
        server: () => ({ reachable: true, exists: true, revision: 1, phase: 'committed', bodySha256: 'aa'.repeat(32) }),
      }),
    )
    expect(plan.items[0]?.verdict).toBe('conflict')
    expect(plan.items[0]?.reason).toContain('server-committed')
  })

  it('本地已有不同草稿 → conflict（不覆盖本地）', () => {
    const local: LocalChapterSnapshot = { draftText: '本地不同草稿', baselineSha256: null, candidate: null, editorProjection: null }
    const plan = buildImportPlan(planInput({ local: () => local }))
    expect(plan.items[0]?.verdict).toBe('conflict')
    expect(plan.items[0]?.reason).toContain('local-draft-differs')
  })

  it('回归②：本地已有不同 AI 候选 → conflict（不变量 1 保护候选）', () => {
    const pkgCandidate: MigrationCandidate = {
      candidateId: 'cand_PKG',
      base: { revision: 5, sha256: '22'.repeat(32) },
      mode: 'replace',
      draftText: '包内候选',
      phase: 'draft_done',
      partial: false,
    }
    const localCandidate: MigrationCandidate = {
      candidateId: 'cand_LOCAL',
      base: { revision: 99, sha256: '11'.repeat(32) },
      mode: 'replace',
      draftText: '本地候选',
      phase: 'draft_done',
      partial: false,
    }
    const plan = buildImportPlan(
      planInput({
        pkg: pkg([{ identity: A, chapters: [entry(1, { draft: null, candidate: pkgCandidate })] }]),
        local: () => ({ draftText: null, baselineSha256: null, candidate: localCandidate, editorProjection: null }),
      }),
    )
    expect(plan.items[0]?.verdict).toBe('conflict')
    expect(plan.items[0]?.reason).toContain('local-candidate-differs')
  })

  it('回归②：本地候选与包内候选一致 → 仍 matched（不误判冲突）', () => {
    const candidate: MigrationCandidate = {
      candidateId: 'cand_SAME',
      base: { revision: 5, sha256: '22'.repeat(32) },
      mode: 'replace',
      draftText: '同一候选',
      phase: 'draft_done',
      partial: false,
    }
    const plan = buildImportPlan(
      planInput({
        pkg: pkg([{ identity: A, chapters: [entry(1, { draft: null, candidate })] }]),
        local: () => ({ draftText: null, baselineSha256: null, candidate, editorProjection: null }),
      }),
    )
    expect(plan.items[0]?.verdict).toBe('matched')
  })

  it('回归②：本地已有不同编辑器投影 → conflict（不变量 1 保护编辑器结构）', () => {
    const plan = buildImportPlan(
      planInput({
        pkg: pkg([
          {
            identity: A,
            chapters: [
              entry(1, {
                draft: null,
                editorProjection: { savedAt: '2026-10-12T00:00:00.000Z', blocks: [{ id: 'PKG_BLOCK' }] },
              }),
            ],
          },
        ]),
        local: () => ({
          draftText: null,
          baselineSha256: null,
          candidate: null,
          editorProjection: { savedAt: '2026-01-01T00:00:00.000Z', blocks: [{ id: 'LOCAL_BLOCK' }] },
        }),
      }),
    )
    expect(plan.items[0]?.verdict).toBe('conflict')
    expect(plan.items[0]?.reason).toContain('local-projection-differs')
  })

  it('服务端不可达 → 保守判 conflict（不凭读不到就覆盖）', () => {
    const plan = buildImportPlan(
      planInput({ server: () => ({ reachable: false, exists: false, revision: null, phase: null, bodySha256: null }) }),
    )
    expect(plan.items[0]?.verdict).toBe('conflict')
    expect(plan.items[0]?.reason).toContain('server-unreachable')
  })

  it('条目身份不属于目标作品 → unclaimed（不分配给任何作品）', () => {
    const plan = buildImportPlan(
      planInput({ pkg: pkg([{ identity: B, chapters: [entry(1)] }]) }),
    )
    expect(plan.items[0]?.verdict).toBe('unclaimed')
    expect(plan.items[0]?.reason).toContain('identity-mismatch')
  })

  it('目标作品未确定 → 全部 unclaimed', () => {
    const plan = buildImportPlan(planInput({ targetIdentity: null }))
    expect(plan.items[0]?.verdict).toBe('unclaimed')
    expect(plan.counts.unclaimed).toBe(1)
  })

  it('幂等键已应用 → duplicate', () => {
    const p = pkg([{ identity: A, chapters: [entry(1)] }])
    const key = idempotencyKeyFor(p.digest, A, 1)
    const plan = buildImportPlan(planInput({ pkg: p, appliedKeys: [key] }))
    expect(plan.items[0]?.verdict).toBe('duplicate')
    expect(plan.counts.duplicate).toBe(1)
  })

  it('同章号两书：只有目标作品章判 matched，另一书 unclaimed（不串稿）', () => {
    const plan = buildImportPlan(
      planInput({ pkg: pkg([{ identity: A, chapters: [entry(1)] }, { identity: B, chapters: [entry(1)] }]) }),
    )
    expect(plan.counts.matched).toBe(1)
    expect(plan.counts.unclaimed).toBe(1)
  })

  it('回归（残余）：本地草稿文本相同但保存基线不同 → conflict（不静默翻转已保存/未保存标记）', () => {
    const plan = buildImportPlan(
      planInput({
        pkg: pkg([{ identity: A, chapters: [entry(1, { draft: { text: 'X', baselineSha256: 'bb'.repeat(32) } })] }]),
        local: () => ({ draftText: 'X', baselineSha256: 'aa'.repeat(32), candidate: null, editorProjection: null }),
      }),
    )
    expect(plan.items[0]?.verdict).toBe('conflict')
    expect(plan.items[0]?.reason).toContain('local-baseline-differs')
  })

  it('回归（残余）：本地草稿文本与基线都与包内一致 → 仍 matched（不误判冲突）', () => {
    const plan = buildImportPlan(
      planInput({
        pkg: pkg([{ identity: A, chapters: [entry(1, { draft: { text: 'X', baselineSha256: 'aa'.repeat(32) } })] }]),
        local: () => ({ draftText: 'X', baselineSha256: 'aa'.repeat(32), candidate: null, editorProjection: null }),
      }),
    )
    expect(plan.items[0]?.verdict).toBe('matched')
  })

  it('纯函数：重复调用结果一致，且不读取/修改外部状态', () => {
    const input = planInput()
    const first = buildImportPlan(input)
    const second = buildImportPlan(input)
    expect(second).toEqual(first)
    expect(identityKeyOf(A)).toBe('bk_a')
  })
})
