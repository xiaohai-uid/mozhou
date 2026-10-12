/**
 * 端到端集成：合成旧浏览器导出 → 导出包 → 导入计划 → 落地 → 重复导入幂等 → 冲突保留双份。
 * 判定：npx pnpm --filter @mozhou/web exec vitest run src/migration/migrationFlow.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SYNTHETIC_ALPHA_CH3_BASELINE,
  SYNTHETIC_CANDIDATE_BASE,
  SYNTHETIC_CURRENT_BOOK,
  SYNTHETIC_DRAFTS,
  SYNTHETIC_OTHER_SUFFIX,
  installSyntheticExport,
} from './__fixtures__/syntheticBrowserExport'
import { DRAFT_BASELINE_PREFIX, DRAFT_CACHE_PREFIX, exportLocalStorage } from './exportLocalStorage'
import { validateMigrationPackage } from './packageFormat'
import type { MigrationPackageV1 } from './packageFormat'
import { buildImportPlan } from './importPlan'
import type { ServerChapterSnapshot } from './importPlan'
import { QUARANTINE_PREFIX, applyImport, readAppliedKeys } from './applyImport'
import { BROWSER_EXPORT_SNIPPET, mozhouExportLocalStorage } from './browserExportSnippet'
import { candidateDraftKey, chapterDraftKey } from '../shell/workbenchStorage'
import { syncSha256Hex } from '../workbench/lib/sha256'

const FIXED_EXPORTED_AT = '2026-10-12T00:00:00.000Z'

function alphaKey(n: number): string {
  return chapterDraftKey(SYNTHETIC_CURRENT_BOOK, n)!
}

/** 目标壳的服务端现状：甲书第 1 章基线一致（matched）、第 3 章基线不一致（conflict）。 */
function serverSnapshot(chapterIndex: number): ServerChapterSnapshot {
  if (chapterIndex === 1) {
    return {
      reachable: true,
      exists: true,
      revision: SYNTHETIC_CANDIDATE_BASE.revision,
      phase: 'draft',
      // 与候选基线同源：该章已保存，服务端正文 == 已保存草稿，故三者哈希一致
      // （迁移侧现按采纳契约同时核对 base.revision 与 base.sha256）。
      bodySha256: SYNTHETIC_CANDIDATE_BASE.sha256,
    }
  }
  if (chapterIndex === 3) {
    return { reachable: true, exists: true, revision: 1, phase: 'draft', bodySha256: syncSha256Hex('甲书第三章服务端现值') }
  }
  return { reachable: true, exists: false, revision: null, phase: null, bodySha256: null }
}

function exportSynthetic(): MigrationPackageV1 {
  return exportLocalStorage(window.localStorage, {
    origin: 'http://localhost:43000',
    userAgent: 'test-ua',
    exportedAt: FIXED_EXPORTED_AT,
  })
}

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  window.localStorage.clear()
})

describe('端到端迁移流（合成样本）', () => {
  it('导出 → 校验 → 归属正确（多作品 / 同章号两书 / 缺身份 / 无归属键）', () => {
    installSyntheticExport(window.localStorage)
    const pkg = exportSynthetic()

    expect(validateMigrationPackage(pkg).ok).toBe(true)
    expect(pkg.books).toHaveLength(1)
    expect(pkg.books[0]?.identity).toEqual(SYNTHETIC_CURRENT_BOOK)
    expect(pkg.books[0]?.chapters.map((c) => c.chapterIndex)).toEqual([1, 2, 3])

    const ch1 = pkg.books[0]!.chapters.find((c) => c.chapterIndex === 1)!
    expect(ch1.candidate?.base).toEqual({
      revision: SYNTHETIC_CANDIDATE_BASE.revision,
      sha256: SYNTHETIC_CANDIDATE_BASE.sha256,
    })
    const ch2 = pkg.books[0]!.chapters.find((c) => c.chapterIndex === 2)!
    expect(ch2.draft?.baselineSha256).toBeNull() // 无基线旧缓存

    // 同章号两书：乙书第 1 章进待认领区，不串入甲书
    expect(pkg.unclaimed.some((u) => u.identitySuffix === SYNTHETIC_OTHER_SUFFIX && u.chapterIndex === 1)).toBe(true)
    // 旧版无归属键 ch_9 不进包（不在章节也不在待认领）
    expect(JSON.stringify(pkg)).not.toContain(SYNTHETIC_DRAFTS.legacyNoIdentity)
  })

  it('控制台片段与 exportLocalStorage 产出同一迁移包（自成一体、不依赖构建）', () => {
    installSyntheticExport(window.localStorage)
    const snippetPkg = mozhouExportLocalStorage({ download: false, assignGlobal: false }) as MigrationPackageV1
    expect(validateMigrationPackage(snippetPkg).ok).toBe(true)

    const exported = exportLocalStorage(window.localStorage, {
      origin: window.location.origin,
      userAgent: navigator.userAgent,
      exportedAt: FIXED_EXPORTED_AT,
    })
    expect(JSON.stringify(snippetPkg.books)).toBe(JSON.stringify(exported.books))
    expect(JSON.stringify(snippetPkg.unclaimed)).toBe(JSON.stringify(exported.unclaimed))
    expect(JSON.stringify(snippetPkg.preferences)).toBe(JSON.stringify(exported.preferences))

    // 可粘贴片段：函数源码包裹为 IIFE，且不引入模块语法
    expect(BROWSER_EXPORT_SNIPPET.startsWith('(function')).toBe(true)
    expect(BROWSER_EXPORT_SNIPPET).toContain('mozhou.workbench.v1')
    expect(BROWSER_EXPORT_SNIPPET).not.toMatch(/\bimport\b|\bexport\b/)
  })

  it('导入 → 冲突保留双份 → 重复导入幂等 → 旧缓存保留', () => {
    installSyntheticExport(window.localStorage)
    const pkg = exportSynthetic()

    // 目标壳内第 3 章已有内容（服务端既有），导入不得覆盖
    window.localStorage.setItem(`${DRAFT_CACHE_PREFIX}${alphaKey(3)}`, '服务端既有第三章')

    const plan = buildImportPlan({
      pkg,
      targetIdentity: SYNTHETIC_CURRENT_BOOK,
      local: () => null,
      server: (_identity, chapterIndex) => serverSnapshot(chapterIndex),
      appliedKeys: readAppliedKeys(),
    })
    expect(plan.counts.matched).toBe(2) // ch1、ch2
    expect(plan.counts.conflict).toBe(1) // ch3
    expect(plan.counts.unclaimed).toBe(0) // 乙书章在导出时已归入包级 unclaimed（见下）
    expect(plan.unclaimed.some((u) => u.identitySuffix === SYNTHETIC_OTHER_SUFFIX)).toBe(true)

    const result = applyImport(plan)
    expect(result.ok).toBe(true)
    expect(result.written).toHaveLength(2)
    expect(result.quarantined).toHaveLength(2) // 冲突 ch3 + 待认领 乙书 ch1
    expect(result.markedMigrated).toBe(true)

    // matched：写回既有槽位
    expect(window.localStorage.getItem(`${DRAFT_CACHE_PREFIX}${alphaKey(1)}`)).toBe(SYNTHETIC_DRAFTS.alphaCh1)
    expect(window.localStorage.getItem(`${DRAFT_BASELINE_PREFIX}${alphaKey(1)}`)).toBe(syncSha256Hex(SYNTHETIC_DRAFTS.alphaCh1))
    const storedCandidate = JSON.parse(
      window.localStorage.getItem(`mozhou.candidate.cache.${candidateDraftKey(SYNTHETIC_CURRENT_BOOK, 1)!}`)!,
    ) as { base: { revision: number; sha256: string } }
    expect(storedCandidate.base).toEqual({
      revision: SYNTHETIC_CANDIDATE_BASE.revision,
      sha256: SYNTHETIC_CANDIDATE_BASE.sha256,
    })
    expect(window.localStorage.getItem(`${DRAFT_CACHE_PREFIX}${alphaKey(2)}`)).toBe(SYNTHETIC_DRAFTS.alphaCh2)
    expect(window.localStorage.getItem(`${DRAFT_BASELINE_PREFIX}${alphaKey(2)}`)).toBeNull() // 无基线旧缓存不臆造基线

    // conflict：原槽未覆盖，双份在隔离槽
    expect(window.localStorage.getItem(`${DRAFT_CACHE_PREFIX}${alphaKey(3)}`)).toBe('服务端既有第三章')
    const quarantined = JSON.parse(window.localStorage.getItem(`${QUARANTINE_PREFIX}${pkg.digest}.conflict.bk_alpha.3`)!) as {
      entry: { draft: { text: string; baselineSha256: string | null } }
    }
    expect(quarantined.entry.draft.text).toBe(SYNTHETIC_DRAFTS.alphaCh3)
    expect(quarantined.entry.draft.baselineSha256).toBe(SYNTHETIC_ALPHA_CH3_BASELINE)

    // unclaimed：乙书章进隔离槽，不写任何作品槽位（原键保留）
    expect(window.localStorage.getItem(`${QUARANTINE_PREFIX}${pkg.digest}.unclaimed.${SYNTHETIC_OTHER_SUFFIX}.1.draft`)).not.toBeNull()
    expect(window.localStorage.getItem(`${DRAFT_CACHE_PREFIX}ch_${SYNTHETIC_OTHER_SUFFIX}_1`)).toBe(SYNTHETIC_DRAFTS.betaCh1)

    // 旧缓存 / 无关键保留（失败不清空源端）
    expect(window.localStorage.getItem(`${DRAFT_CACHE_PREFIX}ch_9`)).toBe(SYNTHETIC_DRAFTS.legacyNoIdentity)
    expect(window.localStorage.getItem('mozhou.membership.tier')).toBe('pro')

    // 重复导入：全部 duplicate，无新写入、无副作用
    const before = window.localStorage.length
    const replan = buildImportPlan({
      pkg,
      targetIdentity: SYNTHETIC_CURRENT_BOOK,
      local: () => null,
      server: (_identity, chapterIndex) => serverSnapshot(chapterIndex),
      appliedKeys: readAppliedKeys(),
    })
    expect(replan.counts.duplicate).toBe(3)
    const reapply = applyImport(replan)
    expect(reapply.written).toHaveLength(0)
    expect(reapply.quarantined).toHaveLength(0)
    expect(reapply.skipped).toHaveLength(4) // 3 章 + 1 待认领
    expect(window.localStorage.length).toBe(before)
  })
})
