/**
 * E01 应用时重查、逐项幂等与可恢复提交（迁移合同 §3.1）。
 * 判定：npx pnpm --filter @mozhou/web exec vitest run src/migration/applyImport.recheck.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APPLIED_REGISTRY_KEY,
  JOURNAL_PREFIX,
  QUARANTINE_PREFIX,
  applyImport,
  readApplyJournal,
  readAppliedKeys,
  restoreFromJournal,
} from './applyImport'
import { buildImportPlan, idempotencyKeyFor } from './importPlan'
import type { ImportPlan, LocalChapterSnapshot, ServerChapterSnapshot } from './importPlan'
import { MIGRATION_FORMAT_VERSION, computePackageDigest } from './packageFormat'
import type { BookIdentity, MigrationCandidate, MigrationChapterEntry, MigrationPackageV1 } from './packageFormat'
import {
  candidateDraftKey,
  chapterDraftKey,
  loadCandidateCache,
  loadDraftCache,
  loadEditorProjection,
  saveCandidateCache,
  saveEditorProjection,
} from '../shell/workbenchStorage'
import type { EditorBlock } from '../workbench/editor/customNodes'
import { syncSha256Hex } from '../workbench/lib/sha256'

const A: BookIdentity = { bookId: 'bk_a', root: 'C:\\tmp\\a', title: '甲书' }
const FRESH: ServerChapterSnapshot = { reachable: true, exists: false, revision: null, phase: null, bodySha256: null }

function chapter(overrides: Partial<MigrationChapterEntry> = {}): MigrationChapterEntry {
  return {
    chapterIndex: 1,
    chapterKey: 'ch_bk_a_1',
    draft: { text: '迁移包正文', baselineSha256: null },
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

function planFor(p: MigrationPackageV1, server: ServerChapterSnapshot = FRESH): ImportPlan {
  return buildImportPlan({
    pkg: p,
    targetIdentity: A,
    local: () => null,
    server: () => server,
    appliedKeys: [],
  })
}

/** 与 MigrationPanel 的 localSnapshot 同构：应用时重查用的本地读取器。 */
function localSnapshotFor(identity: BookIdentity, chapterIndex: number): LocalChapterSnapshot | null {
  const key = chapterDraftKey(identity, chapterIndex)
  const candKey = candidateDraftKey(identity, chapterIndex)
  if (key === null || candKey === null) return null
  const draft = loadDraftCache(key)
  const candidate = loadCandidateCache(candKey)
  return {
    draftText: draft === '' ? null : draft,
    baselineSha256: window.localStorage.getItem(`mozhou.draft.baseline.${key}`),
    candidate:
      candidate === null
        ? null
        : {
            candidateId: candidate.candidateId,
            base: candidate.base,
            mode: candidate.mode,
            draftText: candidate.draftText,
            phase: candidate.phase,
            partial: candidate.partial === true,
          },
    editorProjection: loadEditorProjection(key),
  }
}

const LOCAL_CANDIDATE: MigrationCandidate = {
  candidateId: 'cand_local',
  base: { revision: 9, sha256: 'cc'.repeat(32) },
  mode: 'replace',
  draftText: '本地候选',
  phase: 'draft_done',
  partial: false,
}

const PKG_CANDIDATE: MigrationCandidate = {
  candidateId: 'cand_pkg',
  base: { revision: 1, sha256: 'dd'.repeat(32) },
  mode: 'replace',
  draftText: '包内候选',
  phase: 'draft_done',
  partial: false,
}

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('E01 应用时重查', () => {
  it('预览后作者改了草稿 → 该章改落隔离槽，新稿不被覆盖', () => {
    const chKey = chapterDraftKey(A, 1)!
    const p = pkg([chapter({ draft: { text: '迁移包正文', baselineSha256: null } })])
    const plan = planFor(p)
    expect(plan.items[0]?.verdict).toBe('matched')

    // 预览之后作者继续写作：壳内草稿变了
    window.localStorage.setItem(`mozhou.draft.cache.${chKey}`, '作者预览后新写的正文')

    const result = applyImport(plan, { recheck: { local: localSnapshotFor, server: () => FRESH } })

    expect(window.localStorage.getItem(`mozhou.draft.cache.${chKey}`)).toBe('作者预览后新写的正文')
    expect(result.written).toHaveLength(0)
    expect(result.quarantined).toHaveLength(1)
    expect(result.outcomes[0]?.action).toBe('recheck-quarantined')
    // 包内版本保留在隔离槽（双份），可人工认领
    expect(window.localStorage.getItem(`${QUARANTINE_PREFIX}${p.digest}.matched.bk_a.1`)).not.toBeNull()
  })

  it('对照组：不给 recheck 时按旧 verdict 落地（证明差异来自重查本身）', () => {
    const chKey = chapterDraftKey(A, 1)!
    const p = pkg([chapter({ draft: { text: '迁移包正文', baselineSha256: null } })])
    const plan = planFor(p)
    window.localStorage.setItem(`mozhou.draft.cache.${chKey}`, '作者预览后新写的正文')

    const result = applyImport(plan)

    expect(result.written).toHaveLength(1)
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chKey}`)).toBe('迁移包正文')
  })

  it('服务端在预览后出现内容 → 改落隔离槽', () => {
    const p = pkg([chapter({ draft: { text: '迁移包正文', baselineSha256: null } })])
    const plan = planFor(p)
    const server: ServerChapterSnapshot = {
      reachable: true,
      exists: true,
      revision: 3,
      phase: 'committed',
      bodySha256: syncSha256Hex('服务端已定稿正文'),
    }

    const result = applyImport(plan, { recheck: { local: localSnapshotFor, server: () => server } })

    expect(result.written).toHaveLength(0)
    expect(result.quarantined).toHaveLength(1)
    expect(result.outcomes[0]?.reason).toContain('apply-time-recheck')
  })

  it('现场未变 → 仍正常写入（不误判）', () => {
    const chKey = chapterDraftKey(A, 1)!
    const p = pkg([chapter({ draft: { text: '迁移包正文', baselineSha256: null } })])
    const plan = planFor(p)
    const result = applyImport(plan, { recheck: { local: localSnapshotFor, server: () => FRESH } })
    expect(result.written).toHaveLength(1)
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chKey}`)).toBe('迁移包正文')
  })

  it('逐项幂等：写入前重读登记表，中途已登记的键被跳过', () => {
    const p = pkg([chapter(), chapter({ chapterIndex: 2, chapterKey: 'ch_bk_a_2', draft: { text: '第二章正文', baselineSha256: null } })])
    const plan = planFor(p)
    expect(plan.items.map((i) => i.verdict)).toEqual(['matched', 'matched'])

    // 计划生成之后、应用之前，另一个应用登记了第 2 章
    const key2 = idempotencyKeyFor(p.digest, A, 2)
    window.localStorage.setItem(APPLIED_REGISTRY_KEY, JSON.stringify({ [p.digest]: { appliedAt: '2026-10-12T00:00:00.000Z', keys: [key2] } }))

    const result = applyImport(plan)

    expect(result.written).toEqual([idempotencyKeyFor(p.digest, A, 1)])
    expect(result.skipped).toEqual([key2])
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chapterDraftKey(A, 2)!}`)).toBeNull()
  })

  it('包内同一目标槽两条不同内容 → 首条写入、后条隔离，两个版本都在', () => {
    const chKey = chapterDraftKey(A, 1)!
    const p = pkg([
      chapter({ draft: { text: '包内第一份正文', baselineSha256: null } }),
      chapter({ draft: { text: '包内第二份正文', baselineSha256: null } }),
    ])
    const result = applyImport(planFor(p))

    expect(result.written).toHaveLength(1)
    expect(result.quarantined).toHaveLength(1)
    // 前项落槽，后项未覆盖前项
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chKey}`)).toBe('包内第一份正文')
    const quarantine = JSON.parse(
      window.localStorage.getItem(`${QUARANTINE_PREFIX}${p.digest}.conflict.bk_a.1`)!,
    ) as { entry: { draft: { text: string } } }
    expect(quarantine.entry.draft.text).toBe('包内第二份正文')
  })
})

describe('E01 可恢复提交', () => {
  it('候选步骤失败 → partial + recoverable，槽位改动可回滚到写入前', () => {
    const chKey = chapterDraftKey(A, 1)!
    const candKey = candidateDraftKey(A, 1)!
    window.localStorage.setItem(`mozhou.draft.cache.${chKey}`, '壳内原稿')
    window.localStorage.setItem(`mozhou.draft.baseline.${chKey}`, 'bb'.repeat(32))
    saveCandidateCache(LOCAL_CANDIDATE, candKey)

    // 候选槽写入被吞 → 回读不一致 → 该章失败
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith('mozhou.candidate.cache.')) return
      originalSetItem(key, value)
    })

    const p = pkg([chapter({ draft: { text: '迁移包正文', baselineSha256: null }, candidate: PKG_CANDIDATE })])
    const result = applyImport(planFor(p))

    expect(result.ok).toBe(false)
    expect(result.failed).toHaveLength(1)
    expect(result.recoverable).toHaveLength(1)
    // 草稿已经被改动：报告不得只说「写入 0」，必须标出部分写入
    expect(result.written).toHaveLength(0)
    expect(result.partial).toBe(true)
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chKey}`)).toBe('迁移包正文')

    // 回滚：各槽回到写入前
    expect(restoreFromJournal(result.recoverable[0]!)).toBe(true)
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chKey}`)).toBe('壳内原稿')
    expect(window.localStorage.getItem(`mozhou.draft.baseline.${chKey}`)).toBe('bb'.repeat(32))
    expect(loadCandidateCache(candKey)?.candidateId).toBe('cand_local')
    expect(readApplyJournal(p.digest)).toHaveLength(0)
  })

  it('恢复日志写不下时不改动任何槽位（保护原件优先）', () => {
    const chKey = chapterDraftKey(A, 1)!
    window.localStorage.setItem(`mozhou.draft.cache.${chKey}`, '壳内原稿')

    const originalSetItem = window.localStorage.setItem.bind(window.localStorage)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith(JOURNAL_PREFIX)) throw new Error('QuotaExceeded')
      originalSetItem(key, value)
    })

    const p = pkg([chapter({ draft: { text: '迁移包正文', baselineSha256: null } })])
    const result = applyImport(planFor(p))

    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.error).toContain('恢复日志写入失败')
    expect(result.written).toHaveLength(0)
    expect(result.partial).toBe(false)
    // 一个槽位都没动
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chKey}`)).toBe('壳内原稿')
  })

  it('恢复日志保护草稿/基线/候选/投影四个槽位；回滚后经访问器回读一致（前缀漂移检查）', () => {
    const chKey = chapterDraftKey(A, 1)!
    const candKey = candidateDraftKey(A, 1)!
    const localBlocks = [{ id: 'LOCAL_BLOCK', type: 'paragraph', content: '本地投影' }]
    window.localStorage.setItem(`mozhou.draft.cache.${chKey}`, '壳内原稿')
    window.localStorage.setItem(`mozhou.draft.baseline.${chKey}`, 'bb'.repeat(32))
    saveCandidateCache(LOCAL_CANDIDATE, candKey)
    saveEditorProjection(localBlocks as unknown as readonly EditorBlock[], chKey)

    const originalSetItem = window.localStorage.setItem.bind(window.localStorage)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith('mozhou.candidate.cache.')) return
      originalSetItem(key, value)
    })

    const p = pkg([chapter({ draft: { text: '迁移包正文', baselineSha256: null }, candidate: PKG_CANDIDATE })])
    const result = applyImport(planFor(p))
    const journal = result.recoverable[0]!

    // 四个槽位的原值都被记下（前缀若漂移，这里会是 null）
    expect(Object.values(journal.prior).filter((value) => value !== null)).toHaveLength(4)

    vi.restoreAllMocks()
    expect(restoreFromJournal(journal)).toBe(true)
    // 经既有访问器回读：前缀写错的话这里读不回原件
    expect(loadDraftCache(chKey)).toBe('壳内原稿')
    expect(window.localStorage.getItem(`mozhou.draft.baseline.${chKey}`)).toBe('bb'.repeat(32))
    expect(loadCandidateCache(candKey)?.candidateId).toBe('cand_local')
    expect(loadEditorProjection(chKey)?.blocks).toHaveLength(1)
  })

  it('失败条目不登记幂等键 → 故障排除后可重试写入', () => {
    const candKey = candidateDraftKey(A, 1)!
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage)
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith('mozhou.candidate.cache.')) return
      originalSetItem(key, value)
    })

    const p = pkg([chapter({ draft: { text: '迁移包正文', baselineSha256: null }, candidate: PKG_CANDIDATE })])
    const plan = planFor(p)
    const first = applyImport(plan)

    expect(first.ok).toBe(false)
    expect(readAppliedKeys()).not.toContain(idempotencyKeyFor(p.digest, A, 1))

    spy.mockRestore()
    const retry = applyImport(plan)

    expect(retry.ok).toBe(true)
    expect(retry.written).toEqual([idempotencyKeyFor(p.digest, A, 1)])
    expect(loadCandidateCache(candKey)?.candidateId).toBe('cand_pkg')
  })
})
