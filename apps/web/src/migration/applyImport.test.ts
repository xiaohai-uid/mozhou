/**
 * 导入落地测试（P1-apply）。
 * 判定：npx pnpm --filter @mozhou/web exec vitest run src/migration/applyImport.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APPLIED_REGISTRY_KEY,
  QUARANTINE_PREFIX,
  applyImport,
  readAppliedKeys,
  readAppliedRegistry,
} from './applyImport'
import { buildImportPlan, idempotencyKeyFor } from './importPlan'
import type { ImportPlan, LocalChapterSnapshot, ServerChapterSnapshot } from './importPlan'
import { MIGRATION_FORMAT_VERSION, computePackageDigest } from './packageFormat'
import type { BookIdentity, MigrationCandidate, MigrationChapterEntry, MigrationPackageV1 } from './packageFormat'
import { candidateDraftKey, chapterDraftKey, loadCandidateCache, saveCandidateCache } from '../shell/workbenchStorage'
import { syncSha256Hex } from '../workbench/lib/sha256'

const A: BookIdentity = { bookId: 'bk_a', root: 'C:\\tmp\\a', title: '甲书' }

function chapter(overrides: Partial<MigrationChapterEntry> = {}): MigrationChapterEntry {
  return {
    chapterIndex: 1,
    chapterKey: 'ch_bk_a_1',
    draft: { text: '第一章草稿', baselineSha256: null },
    candidate: null,
    editorProjection: null,
    ...overrides,
  }
}

function pkg(chapters: MigrationChapterEntry[]): MigrationPackageV1 {
  const payload = {
    formatVersion: MIGRATION_FORMAT_VERSION,
    origin: { origin: 'http://localhost:43000', userAgent: 'ua', exportedAt: '2026-10-12T00:00:00.000Z' },
    books: [{ identity: A, chapters }],
    unclaimed: [],
    preferences: {},
  }
  return { ...payload, digest: computePackageDigest(payload) }
}

const FRESH_SERVER: ServerChapterSnapshot = { reachable: true, exists: false, revision: null, phase: null, bodySha256: null }

function planFor(
  p: MigrationPackageV1,
  opts: { appliedKeys?: string[]; server?: ServerChapterSnapshot; local?: () => LocalChapterSnapshot | null } = {},
): ImportPlan {
  return buildImportPlan({
    pkg: p,
    targetIdentity: A,
    local: opts.local ?? (() => null),
    server: () => opts.server ?? FRESH_SERVER,
    appliedKeys: opts.appliedKeys ?? [],
  })
}

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('applyImport', () => {
  it('matched → 写回既有槽位（草稿/基线/候选/投影）并回读确认', () => {
    const candidate: MigrationCandidate = {
      candidateId: 'cand_1',
      base: { revision: 3, sha256: 'bb'.repeat(32) },
      mode: 'replace',
      draftText: '候选文本',
      phase: 'draft_done',
      partial: false,
    }
    const p = pkg([
      chapter({
        draft: { text: '第一章草稿', baselineSha256: syncSha256Hex('第一章草稿') },
        candidate,
        editorProjection: { savedAt: '2026-10-12T00:00:00.000Z', blocks: [{ id: 'b1', type: 'paragraph', content: 'x' }] },
      }),
    ])
    const plan = planFor(p)
    const result = applyImport(plan)

    expect(result.ok).toBe(true)
    expect(result.written).toHaveLength(1)
    expect(result.markedMigrated).toBe(true)

    const chKey = chapterDraftKey(A, 1)!
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chKey}`)).toBe('第一章草稿')
    expect(window.localStorage.getItem(`mozhou.draft.baseline.${chKey}`)).toBe(syncSha256Hex('第一章草稿'))
    const stored = JSON.parse(window.localStorage.getItem(`mozhou.candidate.cache.${candidateDraftKey(A, 1)!}`)!) as typeof candidate
    expect(stored.base).toEqual({ revision: 3, sha256: 'bb'.repeat(32) })
    const projection = JSON.parse(window.localStorage.getItem(`mozhou.editor.projection.${chKey}`)!) as { blocks: unknown[] }
    expect(projection.blocks).toHaveLength(1)
  })

  it('冲突 → 写入隔离槽，不覆盖原槽；原槽保持原样', () => {
    // 目标槽已有服务端基线内容
    const chKey = chapterDraftKey(A, 1)!
    window.localStorage.setItem(`mozhou.draft.cache.${chKey}`, '服务端既有草稿')
    window.localStorage.setItem(`mozhou.draft.baseline.${chKey}`, syncSha256Hex('服务端既有草稿'))

    const p = pkg([chapter({ draft: { text: '迁移包草稿', baselineSha256: 'zz'.repeat(32) } })])
    const plan = planFor(p, {
      server: { reachable: true, exists: true, revision: 1, phase: 'draft', bodySha256: 'yy'.repeat(32) },
    })
    expect(plan.items[0]?.verdict).toBe('conflict')
    const result = applyImport(plan)

    expect(result.quarantined).toHaveLength(1)
    // 原槽未被覆盖
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chKey}`)).toBe('服务端既有草稿')
    // 双份都在隔离槽
    const qKey = `${QUARANTINE_PREFIX}${p.digest}.conflict.bk_a.1`
    const record = JSON.parse(window.localStorage.getItem(qKey)!) as { entry: { draft: { text: string } } }
    expect(record.entry.draft.text).toBe('迁移包草稿')
  })

  it('待认领（身份不匹配）→ 隔离槽，不写任何作品槽位', () => {
    const other = pkg([chapter()])
    // 目标身份设为另一个作品，使条目 unclaimed
    const plan = buildImportPlan({
      pkg: other,
      targetIdentity: { bookId: 'bk_other', root: 'C:\\tmp\\other', title: '别书' },
      local: () => null,
      server: () => FRESH_SERVER,
      appliedKeys: [],
    })
    const result = applyImport(plan)
    expect(result.quarantined).toHaveLength(1)
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chapterDraftKey(A, 1)!}`)).toBeNull()
    expect(window.localStorage.getItem(`${QUARANTINE_PREFIX}${other.digest}.unclaimed.bk_a.1`)).not.toBeNull()
  })

  it('重复导入幂等：已应用的幂等键 → skipped，无新写入', () => {
    const p = pkg([chapter()])
    const key = idempotencyKeyFor(p.digest, A, 1)
    const plan = planFor(p, { appliedKeys: [key] })
    const result = applyImport(plan)
    expect(result.skipped).toEqual([key])
    expect(result.written).toHaveLength(0)
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chapterDraftKey(A, 1)!}`)).toBeNull()
  })

  it('两次连续导入同一包：第二次全部 duplicate（幂等，无副作用）', () => {
    const p = pkg([chapter()])
    const first = applyImport(planFor(p))
    expect(first.written).toHaveLength(1)
    const applied = readAppliedKeys()
    expect(applied).toContain(idempotencyKeyFor(p.digest, A, 1))

    const before = window.localStorage.length
    const second = applyImport(planFor(p, { appliedKeys: applied }))
    expect(second.skipped).toHaveLength(1)
    expect(second.written).toHaveLength(0)
    expect(window.localStorage.length).toBe(before)
  })

  it('基线保真：草稿与基线不一致（未保存编辑）时原样保留基线，不重算', () => {
    const p = pkg([chapter({ draft: { text: '改了但没保存', baselineSha256: 'ab'.repeat(32) } })])
    applyImport(planFor(p))
    const chKey = chapterDraftKey(A, 1)!
    expect(window.localStorage.getItem(`mozhou.draft.baseline.${chKey}`)).toBe('ab'.repeat(32))
    expect(window.localStorage.getItem(`mozhou.draft.baseline.${chKey}`)).not.toBe(syncSha256Hex('改了但没保存'))
  })

  it('失败不清空源端：隔离槽写入失败时报告 failed，且既有键原样保留', () => {
    const chKey = chapterDraftKey(A, 1)!
    window.localStorage.setItem('mozhou.wizard.done', 'done')
    window.localStorage.setItem(`mozhou.draft.cache.${chKey}`, '服务端既有草稿')

    const originalSetItem = window.localStorage.setItem.bind(window.localStorage)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith(QUARANTINE_PREFIX)) throw new Error('QuotaExceeded')
      originalSetItem(key, value)
    })

    const p = pkg([chapter({ draft: { text: '迁移包草稿', baselineSha256: 'zz'.repeat(32) } })])
    const plan = planFor(p, {
      server: { reachable: true, exists: true, revision: 1, phase: 'draft', bodySha256: 'yy'.repeat(32) },
    })
    const result = applyImport(plan)

    expect(result.ok).toBe(false)
    expect(result.failed).toHaveLength(1)
    expect(result.markedMigrated).toBe(false)
    // 源端与既有键原样保留
    expect(window.localStorage.getItem('mozhou.wizard.done')).toBe('done')
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chKey}`)).toBe('服务端既有草稿')
    // 未登记的失败条目不进幂等表 → 可重试
    expect(readAppliedRegistry()[p.digest]).toBeUndefined()
  })

  it('登记表按包摘要记录已确认的幂等键', () => {
    const p = pkg([chapter()])
    applyImport(planFor(p))
    const registry = readAppliedRegistry()
    expect(registry[p.digest]?.keys).toEqual([idempotencyKeyFor(p.digest, A, 1)])
    expect(window.localStorage.getItem(APPLIED_REGISTRY_KEY)).not.toBeNull()
  })

  // --- 回归：独立复核员证伪的 5 条 ---

  it('回归①：跨包同槽隔离——不同摘要的包对同一章冲突 → 两个隔离键并存，先到的副本不被覆盖', () => {
    const server: ServerChapterSnapshot = { reachable: true, exists: true, revision: 1, phase: 'draft', bodySha256: 'yy'.repeat(32) }
    const pkgA = pkg([chapter({ draft: { text: 'A包的冲突稿', baselineSha256: 'zz'.repeat(32) } })])
    const pkgB = pkg([chapter({ draft: { text: 'B包的冲突稿', baselineSha256: 'zz'.repeat(32) } })])
    expect(pkgA.digest).not.toBe(pkgB.digest)

    expect(applyImport(planFor(pkgA, { server })).quarantined).toHaveLength(1)
    expect(applyImport(planFor(pkgB, { server })).quarantined).toHaveLength(1)

    const quarantinedText = (digest: string): string | null => {
      const raw = window.localStorage.getItem(`${QUARANTINE_PREFIX}${digest}.conflict.bk_a.1`)
      if (raw === null) return null
      return (JSON.parse(raw) as { entry: { draft: { text: string } } }).entry.draft.text
    }
    // 两包各自的隔离副本都在（键含 digest，互不覆盖）
    expect(quarantinedText(pkgA.digest)).toBe('A包的冲突稿')
    expect(quarantinedText(pkgB.digest)).toBe('B包的冲突稿')

    // 重导 A：duplicate 跳过，但 A 的隔离副本仍可恢复
    const replay = applyImport(planFor(pkgA, { server, appliedKeys: readAppliedKeys() }))
    expect(replay.skipped).toHaveLength(1)
    expect(quarantinedText(pkgA.digest)).toBe('A包的冲突稿')
  })

  it('回归②：本地已有不同 AI 候选 → conflict，不覆盖本地候选', () => {
    const candKey = candidateDraftKey(A, 1)!
    const localCandidate: MigrationCandidate = {
      candidateId: 'cand_LOCAL',
      base: { revision: 99, sha256: '11'.repeat(32) },
      mode: 'replace',
      draftText: '本地候选',
      phase: 'draft_done',
      partial: false,
    }
    saveCandidateCache(localCandidate, candKey)

    const pkgCandidate: MigrationCandidate = {
      candidateId: 'cand_PKG',
      base: { revision: 5, sha256: '22'.repeat(32) },
      mode: 'replace',
      draftText: '包内候选',
      phase: 'draft_done',
      partial: false,
    }
    const p = pkg([chapter({ draft: null, candidate: pkgCandidate })])
    const plan = planFor(p, {
      local: () => ({ draftText: null, baselineSha256: null, candidate: localCandidate, editorProjection: null }),
    })
    expect(plan.items[0]?.verdict).toBe('conflict')
    expect(plan.items[0]?.reason).toContain('local-candidate-differs')

    const result = applyImport(plan)
    expect(result.quarantined).toHaveLength(1)
    // 本地候选未被覆盖
    expect(loadCandidateCache(candKey)?.candidateId).toBe('cand_LOCAL')
  })

  it('回归②：本地已有不同编辑器投影 → conflict，不覆盖本地投影', () => {
    const chKey = chapterDraftKey(A, 1)!
    window.localStorage.setItem(
      `mozhou.editor.projection.${chKey}`,
      JSON.stringify({ savedAt: '2026-01-01T00:00:00.000Z', blocks: [{ id: 'LOCAL_BLOCK', type: 'paragraph', content: '本地投影' }] }),
    )
    const p = pkg([
      chapter({
        draft: null,
        editorProjection: { savedAt: '2026-10-12T00:00:00.000Z', blocks: [{ id: 'PKG_BLOCK', type: 'paragraph', content: '包内投影' }] },
      }),
    ])
    const plan = planFor(p, {
      local: () => ({
        draftText: null,
        baselineSha256: null,
        candidate: null,
        editorProjection: { savedAt: '2026-01-01T00:00:00.000Z', blocks: [{ id: 'LOCAL_BLOCK', type: 'paragraph', content: '本地投影' }] },
      }),
    })
    expect(plan.items[0]?.verdict).toBe('conflict')
    expect(plan.items[0]?.reason).toContain('local-projection-differs')

    applyImport(plan)
    const stored = JSON.parse(window.localStorage.getItem(`mozhou.editor.projection.${chKey}`)!) as { blocks: Array<{ id: string }> }
    expect(stored.blocks[0]?.id).toBe('LOCAL_BLOCK')
  })

  it('回归④：空草稿文本不删除目标槽（saveDraftCache("") 会 removeItem）', () => {
    const chKey = chapterDraftKey(A, 1)!
    window.localStorage.setItem(`mozhou.draft.cache.${chKey}`, '壳内既有草稿')

    // 包内该章只有基线、无草稿文本（text === ''）
    const p = pkg([chapter({ draft: { text: '', baselineSha256: 'ab'.repeat(32) } })])
    const result = applyImport(planFor(p))

    expect(result.written).toHaveLength(1)
    // 目标槽的既有草稿未被删除；基线照常保真写入
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chKey}`)).toBe('壳内既有草稿')
    expect(window.localStorage.getItem(`mozhou.draft.baseline.${chKey}`)).toBe('ab'.repeat(32))
  })

  it('回归⑤：重复导入（全部 duplicate）不产生副作用——不写 workbench 状态', () => {
    const p = pkg([chapter()])
    applyImport(planFor(p))
    const applied = readAppliedKeys()

    window.localStorage.removeItem('mozhou.workbench.v1')
    const before = window.localStorage.length
    const replay = applyImport(planFor(p, { appliedKeys: applied }))

    expect(replay.skipped).toHaveLength(1)
    expect(window.localStorage.getItem('mozhou.workbench.v1')).toBeNull()
    expect(window.localStorage.length).toBe(before)
  })

  it('回归（残余）：本地保存基线不同 → conflict，本地基线与草稿均不被改写', () => {
    const chKey = chapterDraftKey(A, 1)!
    window.localStorage.setItem(`mozhou.draft.cache.${chKey}`, 'X')
    window.localStorage.setItem(`mozhou.draft.baseline.${chKey}`, 'aa'.repeat(32))

    const p = pkg([chapter({ draft: { text: 'X', baselineSha256: 'bb'.repeat(32) } })])
    const plan = planFor(p, {
      local: () => ({ draftText: 'X', baselineSha256: 'aa'.repeat(32), candidate: null, editorProjection: null }),
    })
    expect(plan.items[0]?.verdict).toBe('conflict')
    expect(plan.items[0]?.reason).toContain('local-baseline-differs')

    const result = applyImport(plan)
    expect(result.quarantined).toHaveLength(1)
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chKey}`)).toBe('X')
    expect(window.localStorage.getItem(`mozhou.draft.baseline.${chKey}`)).toBe('aa'.repeat(32))
  })

  it('回归（残余）：matched 但无内容可写（draft={text:"",baseline:null} 且无候选/投影）→ noop，不声称已写入', () => {
    const chKey = chapterDraftKey(A, 1)!
    const p = pkg([chapter({ draft: { text: '', baselineSha256: null }, candidate: null, editorProjection: null })])
    const result = applyImport(planFor(p))

    expect(result.written).toHaveLength(0)
    expect(result.noop).toHaveLength(1)
    expect(result.ok).toBe(true)
    // 确实没有写入该章任何槽位
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chKey}`)).toBeNull()
    expect(window.localStorage.getItem(`mozhou.draft.baseline.${chKey}`)).toBeNull()
    // 未登记幂等键（未应用任何东西）
    expect(readAppliedRegistry()[p.digest]).toBeUndefined()
  })
})
