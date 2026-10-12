/**
 * E01 导入计划绑定、目标槽唯一与候选基线语义（迁移合同 §3.1）。
 * 判定：npx pnpm --filter @mozhou/web exec vitest run src/migration/importPlan.binding.test.ts
 */
import { describe, expect, it } from 'vitest'
import { buildImportPlan, planBindingMatches } from './importPlan'
import type { ImportPlanInput, ServerChapterSnapshot } from './importPlan'
import { MIGRATION_FORMAT_VERSION, computePackageDigest } from './packageFormat'
import type { BookIdentity, MigrationCandidate, MigrationChapterEntry, MigrationPackageV1 } from './packageFormat'
import { syncSha256Hex } from '../workbench/lib/sha256'

const A: BookIdentity = { bookId: 'bk_a', root: 'C:\\tmp\\a', title: '甲书' }
const B: BookIdentity = { bookId: 'bk_b', root: 'C:\\tmp\\b', title: '乙书' }

function chapter(chapterIndex: number, overrides: Partial<MigrationChapterEntry> = {}): MigrationChapterEntry {
  return {
    chapterIndex,
    chapterKey: `ch_bk_a_${chapterIndex}`,
    draft: { text: `第${chapterIndex}章草稿`, baselineSha256: null },
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

const FRESH: ServerChapterSnapshot = { reachable: true, exists: false, revision: null, phase: null, bodySha256: null }

function planInput(overrides: Partial<ImportPlanInput> = {}): ImportPlanInput {
  return {
    pkg: pkg([{ identity: A, chapters: [chapter(1)] }]),
    targetIdentity: A,
    local: () => null,
    server: () => FRESH,
    appliedKeys: [],
    ...overrides,
  }
}

describe('计划绑定（E01）', () => {
  it('计划记录包摘要 / 目标身份 / origin / 视图代次', () => {
    const p = pkg([{ identity: A, chapters: [chapter(1)] }])
    const plan = buildImportPlan(planInput({ pkg: p, viewGeneration: 7 }))
    expect(plan.binding).toEqual({
      packageDigest: p.digest,
      targetIdentitySuffix: 'bk_a',
      targetRoot: 'C:\\tmp\\a',
      origin: 'http://localhost:43000',
      viewGeneration: 7,
    })
  })

  it('planBindingMatches：一致为真；包 / 目标 / 代次任一变化即为假', () => {
    const plan = buildImportPlan(planInput({ viewGeneration: 3 }))
    const base = {
      packageDigest: plan.digest,
      targetIdentitySuffix: 'bk_a',
      targetRoot: 'C:\\tmp\\a',
      viewGeneration: 3,
    }
    expect(planBindingMatches(plan, base)).toBe(true)
    expect(planBindingMatches(plan, { ...base, viewGeneration: 4 })).toBe(false)
    expect(planBindingMatches(plan, { ...base, packageDigest: 'another-digest' })).toBe(false)
    expect(planBindingMatches(plan, { ...base, targetIdentitySuffix: 'bk_b' })).toBe(false)
    expect(planBindingMatches(plan, { ...base, targetRoot: 'C:\\tmp\\z' })).toBe(false)
  })

  it('目标作品未确定 → 绑定的目标字段为空', () => {
    const plan = buildImportPlan(planInput({ targetIdentity: null }))
    expect(plan.binding.targetIdentitySuffix).toBeNull()
    expect(plan.binding.targetRoot).toBeNull()
  })

  it('纯函数：同一输入（含代次）两次结果完全一致', () => {
    const input = planInput({ viewGeneration: 5 })
    expect(buildImportPlan(input)).toEqual(buildImportPlan(input))
  })
})

describe('目标槽唯一（E01）', () => {
  it('包内同一 (身份, 章号) 两条不同内容 → 首条照常、后条 conflict 且槽位标识唯一', () => {
    const plan = buildImportPlan(
      planInput({
        pkg: pkg([
          {
            identity: A,
            chapters: [
              chapter(1, { draft: { text: '包内第一份正文', baselineSha256: null } }),
              chapter(1, { draft: { text: '包内第二份正文', baselineSha256: null } }),
            ],
          },
        ]),
      }),
    )
    expect(plan.items).toHaveLength(2)
    expect(plan.items[0]?.verdict).toBe('matched')
    expect(plan.items[1]?.verdict).toBe('conflict')
    expect(plan.items[1]?.reason).toContain('target-slot-collision')
    // 两条槽位标识不同：后项的隔离副本不会覆盖前项的
    expect(plan.items[0]?.slotTag).toBe('matched.bk_a.1')
    expect(plan.items[1]?.slotTag).toBe('conflict.bk_a.1')
    expect(plan.items[0]?.slotTag).not.toBe(plan.items[1]?.slotTag)
  })

  it('包内同一 (身份, 章号) 两条相同内容 → 后条 duplicate（幂等跳过，不重复写）', () => {
    const same = chapter(1, { draft: { text: '同一份正文', baselineSha256: null } })
    const plan = buildImportPlan(planInput({ pkg: pkg([{ identity: A, chapters: [same, { ...same }] }]) }))
    expect(plan.items[0]?.verdict).toBe('matched')
    expect(plan.items[1]?.verdict).toBe('duplicate')
    expect(plan.items[1]?.reason).toContain('intra-package-duplicate')
  })

  it('同章号两书不算同一目标槽（不误判）', () => {
    const plan = buildImportPlan(
      planInput({ pkg: pkg([{ identity: A, chapters: [chapter(1)] }, { identity: B, chapters: [chapter(1)] }]) }),
    )
    expect(plan.counts.matched).toBe(1)
    expect(plan.counts.unclaimed).toBe(1)
    expect(plan.counts.conflict).toBe(0)
  })
})

describe('候选基线语义与采纳契约一致（E01）', () => {
  const body = '服务端现值正文'
  const serverWithBody: ServerChapterSnapshot = {
    reachable: true,
    exists: true,
    revision: 4,
    phase: 'draft',
    bodySha256: syncSha256Hex(body),
  }

  function candidate(sha256: string): MigrationCandidate {
    return {
      candidateId: 'c1',
      base: { revision: 4, sha256 },
      mode: 'replace',
      draftText: '候选正文',
      phase: 'draft_done',
      partial: false,
    }
  }

  it('base.sha256 与服务端正文不一致 → conflict（不再只看 revision）', () => {
    const plan = buildImportPlan(
      planInput({
        pkg: pkg([{ identity: A, chapters: [chapter(1, { draft: null, candidate: candidate('11'.repeat(32)) })] }]),
        server: () => serverWithBody,
      }),
    )
    expect(plan.items[0]?.verdict).toBe('conflict')
    expect(plan.items[0]?.reason).toContain('candidate-base-hash-mismatch')
  })

  it('base.revision 与 base.sha256 都一致 → matched（不误判）', () => {
    const plan = buildImportPlan(
      planInput({
        pkg: pkg([{ identity: A, chapters: [chapter(1, { draft: null, candidate: candidate(syncSha256Hex(body)) })] }]),
        server: () => serverWithBody,
      }),
    )
    expect(plan.items[0]?.verdict).toBe('matched')
  })
})
