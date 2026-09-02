/**
 * T26 传播面测试（#67；D01-c/D03/D04）。
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBook } from './create-book.js'
import {
  BUDGET_PIN_COUNT,
  StaleBudgetError,
  assertWithinBudget,
  findReaders,
  openPinsWindow,
  refreshPinsWindow,
  staleMarkerEquivalent,
} from './stale-cache.js'
import { readChapterDependencyPins } from './stale.js'
import type { DependencyManifestEntry } from '@mozhou/kernel'

let roots: string[] = []
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch {} }
  roots = []
})

function hermeticRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-t26-'))
  roots.push(root)
  createBook({ dir: root, title: 'T26传播' })
  return root
}

const entry = (kind: 'temporalFact' | 'outlineNode' | 'narrativePromise', id: string, revision: number): DependencyManifestEntry => ({
  kind,
  id,
  revision,
})

function seedEvents(root: string, rows: unknown[]): void {
  mkdirSync(join(root, '.mozhou'), { recursive: true })
  writeFileSync(join(root, '.mozhou', 'events.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

describe('stale-cache · T26', () => {
  it('findReaders 单缝：返回依赖 (kind,id) 实体的全部读者章（升序）', () => {
    const root = hermeticRoot()
    seedEvents(root, [
      { type: 'ChapterCommitted', seq: 1, chapterIndex: 1, commitId: 'c1', dependencyManifest: { entries: [entry('temporalFact', 'a', 1)] } },
      { type: 'ChapterCommitted', seq: 2, chapterIndex: 3, commitId: 'c2', dependencyManifest: { entries: [entry('temporalFact', 'a', 1), entry('temporalFact', 'b', 2)] } },
    ])
    const pins = readChapterDependencyPins(root)
    expect(findReaders(pins, entry('temporalFact', 'a', 1))).toEqual([1, 3])
    expect(findReaders(pins, entry('temporalFact', 'b', 2))).toEqual([3])
    expect(findReaders(pins, entry('temporalFact', 'zzz', 1))).toEqual([])
  })

  it('窗内缓存：openPinsWindow 全扫 + refreshPinsWindow 增量续读同结果', () => {
    const root = hermeticRoot()
    seedEvents(root, [
      { type: 'ChapterCommitted', seq: 1, chapterIndex: 1, commitId: 'c1', dependencyManifest: { entries: [entry('temporalFact', 'a', 1)] } },
    ])
    const window = openPinsWindow(root)
    expect(window.pins.size).toBe(1)
    expect(window.ledgerLinesRead).toBe(1)

    appendFileSync(
      join(root, '.mozhou', 'events.jsonl'),
      JSON.stringify({ type: 'ChapterCommitted', seq: 2, chapterIndex: 2, commitId: 'c2', dependencyManifest: { entries: [entry('outlineNode', 'v1', 5)] } }) + '\n',
    )
    const refreshed = refreshPinsWindow(root, window)
    expect(refreshed.pins.size).toBe(2)
    expect(refreshed.ledgerLinesRead).toBe(2)
  })

  it('幂等等价判据：逐字段全等=true，任一分量差=false', () => {
    const a = { reason: 'upstream_canon_changed', markedAt: '2026-08-27T00:00:00Z', upstreamRefs: [entry('temporalFact', 'a', 3)] }
    expect(staleMarkerEquivalent(a, { ...a })).toBe(true)
    expect(staleMarkerEquivalent(a, { ...a, upstreamRefs: [entry('temporalFact', 'a', 4)] })).toBe(false)
    expect(staleMarkerEquivalent(a, { ...a, markedAt: '2026-08-27T00:01:00Z' })).toBe(false)
  })

  it('预算护栏：pin 数超限抛出 StaleBudgetError（失败显式）', () => {
    const root = hermeticRoot()
    const big = new Map<number, { chapterIndex: number; commitId: string; manifest: { entries: unknown[] } }>()
    for (let i = 1; i <= BUDGET_PIN_COUNT + 1; i += 1) {
      big.set(i, { chapterIndex: i, commitId: 'c' + i, manifest: { entries: [] } })
    }
    expect(() => assertWithinBudget(root, big as Parameters<typeof assertWithinBudget>[1])).toThrow(StaleBudgetError)
  })
})
