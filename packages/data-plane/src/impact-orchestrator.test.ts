/**
 * 变更影响编排钩子测试（Phase 5 接线；D20/D26 完整性）。
 * 端到端：对账落定（onSettled）→ createImpactOrchestrator → runTraversal →
 * impact 投影 + TraversalStarted/Finished 成对事件；proposalId 幂等去重。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBook } from './create-book.js'
import { createImpactOrchestrator } from './impact-orchestrator.js'
import { IMPACT_DIR_RELPATH } from './impact.js'
import type { ReconciliationSettledPayload } from './reconciliation.js'
import type { DependencyManifestEntry } from '@mozhou/kernel'

let roots: string[] = []
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

function hermeticRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-orch-'))
  roots.push(root)
  createBook({ dir: root, title: 'T编排' })
  return root
}

function seedPins(root: string): void {
  mkdirSync(join(root, '.mozhou'), { recursive: true })
  const rows = [
    { type: 'ChapterCommitted', seq: 1, chapterIndex: 1, commitId: 'c1', dependencyManifest: { entries: [{ kind: 'temporalFact', id: 'fact_a', revision: 1 }] } },
    { type: 'ChapterCommitted', seq: 2, chapterIndex: 3, commitId: 'c3', dependencyManifest: { entries: [{ kind: 'temporalFact', id: 'fact_a', revision: 1 }, { kind: 'outlineNode', id: 'node_o', revision: 2 }] } },
  ]
  writeFileSync(join(root, '.mozhou', 'events.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

function settled(proposalId: string, resolution = 'applied' as const, relPath = 'prose/ch1.md'): ReconciliationSettledPayload {
  return { proposalId, relPath, resolution, acceptedItemCount: 1 }
}

function eventTypes(root: string): readonly string[] {
  const p = join(root, '.mozhou', 'events.jsonl')
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => {
      const raw = JSON.parse(l) as { event?: { type?: string }; type?: string }
      return raw.event?.type ?? raw.type ?? ''
    })
}

const entry = (kind: 'temporalFact' | 'outlineNode', id: string, revision: number): DependencyManifestEntry => ({ kind, id, revision })

describe('impact-orchestrator · 统计接线', () => {
  it('对账落定 → 编排 → 遍历：impact 投影 + 成对事件', () => {
    const root = hermeticRoot()
    seedPins(root)
    const orchestrator = createImpactOrchestrator({
      root,
      resolveUpstreamChanges: () => [entry('temporalFact', 'fact_a', 2)],
      nowIso: () => '2026-08-27T00:00:00.000Z',
    })

    const outcome = orchestrator.onSettled(settled('rcln_1'))
    expect(outcome).not.toBeNull()
    expect(outcome?.affectedChapters).toEqual([1, 3]) // 依赖 fact_a 的 ch1/ch3
    // 打底 ChapterCommitted 之外，恰好新增成对遍历事件（顺序正确）
    const types = eventTypes(root).filter((t) => t !== 'ChapterCommitted')
    expect(types).toEqual(['TraversalStarted', 'TraversalFinished'])
    expect(existsSync(join(root, IMPACT_DIR_RELPATH, 'impact_trv_rcln_1.json'))).toBe(true)
  })

  it('proposalId 幂等：同提案重复回调零重复遍历', () => {
    const root = hermeticRoot()
    seedPins(root)
    const orchestrator = createImpactOrchestrator({
      root,
      resolveUpstreamChanges: () => [entry('temporalFact', 'fact_a', 2)],
      nowIso: () => '2026-08-27T00:00:00.000Z',
    })
    orchestrator.onSettled(settled('rcln_dup'))
    const second = orchestrator.onSettled(settled('rcln_dup'))
    expect(second).toBeNull() // 已见 → 跳过
    const types = eventTypes(root)
    expect(types.filter((t) => t === 'TraversalStarted')).toHaveLength(1)
  })

  it('上游变化为空 → 跳过遍历（零影响面不产噪声）', () => {
    const root = hermeticRoot()
    seedPins(root)
    const orchestrator = createImpactOrchestrator({
      root,
      resolveUpstreamChanges: () => [],
      nowIso: () => '2026-08-27T00:00:00.000Z',
    })
    const outcome = orchestrator.onSettled(settled('rcln_none'))
    expect(outcome).toBeNull()
    // 只有打底事件，无新增遍历事件
    expect(eventTypes(root)).toEqual(['ChapterCommitted', 'ChapterCommitted'])
  })
})
