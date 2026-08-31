/**
 * T27 变更影响编排测试（#68；Traversal 成对事件 + impact 投影 + 重建幂等）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBook } from './create-book.js'
import {
  IMPACT_DIR_RELPATH,
  assembleChangeMatrix,
  listImpactRecords,
  rebuildFingerprintOf,
  runTraversal,
} from './impact.js'
import { openPinsWindow } from './stale-cache.js'
import type { DependencyManifestEntry } from '@mozhou/kernel'

let roots: string[] = []
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

function hermeticRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-t27-'))
  roots.push(root)
  createBook({ dir: root, title: 'T27影响' })
  return root
}

/** 手工铺 5 章钉版 + 事件行（模拟构造成对事件前的账本基底）。 */
function seedPins(root: string): void {
  mkdirSync(join(root, '.mozhou'), { recursive: true })
  const rows = [
    { type: 'ChapterCommitted', seq: 1, chapterIndex: 1, commitId: 'c1', dependencyManifest: { entries: [{ kind: 'temporalFact', id: 'fact_a', revision: 1 }] } },
    { type: 'ChapterCommitted', seq: 2, chapterIndex: 2, commitId: 'c2', dependencyManifest: { entries: [{ kind: 'temporalFact', id: 'fact_a', revision: 1 }, { kind: 'narrativePromise', id: 'promise_p', revision: 1 }] } },
    { type: 'ChapterCommitted', seq: 3, chapterIndex: 4, commitId: 'c4', dependencyManifest: { entries: [{ kind: 'outlineNode', id: 'node_o', revision: 2 }] } },
  ]
  writeFileSync(join(root, '.mozhou', 'events.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

const entry = (kind: 'temporalFact' | 'outlineNode' | 'narrativePromise', id: string, revision: number): DependencyManifestEntry => ({ kind, id, revision })

function latestEventTypes(root: string): readonly string[] {
  const eventsPath = join(root, '.mozhou', 'events.jsonl')
  if (!existsSync(eventsPath)) return []
  return readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => (JSON.parse(l) as { type?: string }).type ?? '')
}

describe('impact · T27 遍历编排', () => {
  it('runTraversal：TraversalStarted/Finished 成对落账 + impact 投影原子落盘', () => {
    const root = hermeticRoot()
    seedPins(root)
    const before = latestEventTypes(root)
    const outcome = runTraversal({
      root,
      taskRef: 'trav_1',
      traversalId: 't_1',
      trigger: { source: 'reconciliation', ref: 'rcln_x' },
      upstreamChanges: [entry('temporalFact', 'fact_a', 2)],
      recordedAt: '2026-08-27T00:00:00.000Z',
      window: openPinsWindow(root),
    })

    // 受影响章 = 依赖 fact_a 的 ch1/ch2（ch4 依赖 node_o 不命中）
    expect(outcome.affectedChapters).toEqual([1, 2])
    // 成对事件：Started 与 Finished 各一、顺序正确
    const after = latestEventTypes(root)
    expect(after).toEqual([...before, 'TraversalStarted', 'TraversalFinished'])
    // 投影落盘
    expect(existsSync(join(root, IMPACT_DIR_RELPATH, 'impact_t_1.json'))).toBe(true)
  })

  it('指纹确定性：同输入两次遍历影响集指纹相等', () => {
    const root = hermeticRoot()
    seedPins(root)
    const window = openPinsWindow(root)
    const run = () =>
      runTraversal({
        root,
        taskRef: 'trav_x',
        traversalId: 't_x',
        trigger: { source: 'commit', ref: 'cmt_1' },
        upstreamChanges: [entry('temporalFact', 'fact_a', 2)],
        recordedAt: '2026-08-27T00:00:00.000Z',
        window,
      }).affectedFingerprint
    expect(run()).toBe(run())
  })

  it('重建幂等：多次遍历后重建指纹集合稳定（排序内容集比较）', () => {
    const root = hermeticRoot()
    seedPins(root)
    const window = openPinsWindow(root)
    runTraversal({ root, taskRef: 't1', traversalId: 'a', trigger: { source: 'reconciliation', ref: 'r1' }, upstreamChanges: [entry('temporalFact', 'fact_a', 2)], recordedAt: '2026-08-27T00:00:00.000Z', window })
    runTraversal({ root, taskRef: 't2', traversalId: 'b', trigger: { source: 'commit', ref: 'c2' }, upstreamChanges: [entry('outlineNode', 'node_o', 3)], recordedAt: '2026-08-27T00:00:01.000Z', window })

    const first = rebuildFingerprintOf(listImpactRecords(root))
    // 模拟重建：删除目录重放（内容集合相等指纹）
    const dir = join(root, IMPACT_DIR_RELPATH)
    for (const name of readdirSync(dir)) rmSync(join(dir, name), { force: true })
    runTraversal({ root, taskRef: 't1b', traversalId: 'a', trigger: { source: 'reconciliation', ref: 'r1' }, upstreamChanges: [entry('temporalFact', 'fact_a', 2)], recordedAt: '2026-08-27T00:00:00.000Z', window })
    runTraversal({ root, taskRef: 't2b', traversalId: 'b', trigger: { source: 'commit', ref: 'c2' }, upstreamChanges: [entry('outlineNode', 'node_o', 3)], recordedAt: '2026-08-27T00:00:01.000Z', window })
    expect(rebuildFingerprintOf(listImpactRecords(root))).toBe(first)
  })

  it('assembleChangeMatrix：黄金路径——上游改动 applied 后矩阵出现新红行（需重写）', () => {
    const root = hermeticRoot()
    seedPins(root) // ch1/ch2 依赖 fact_a@1，ch4 依赖 node_o@2
    const window = openPinsWindow(root)
    runTraversal({
      root,
      taskRef: 'trav_1',
      traversalId: 't_1',
      trigger: { source: 'reconciliation', ref: 'rcln_x' },
      upstreamChanges: [entry('temporalFact', 'fact_a', 2)], // fact_a 升到 2
      recordedAt: '2026-08-27T00:00:00.000Z',
      window,
    })

    const matrix = assembleChangeMatrix(root)
    expect(matrix.columns).toEqual([1, 2])
    expect(matrix.rows).toHaveLength(1)
    const row = matrix.rows[0]
    if (row === undefined) throw new Error('missing matrix row')
    expect(row.staleCount).toBe(2)
    // ch1/ch2 钉版仍引用 fact_a@1（<2）⇒ 需重写（红）
    expect(row.cells).toEqual([
      { chapterIndex: 1, state: 'needs_rework' },
      { chapterIndex: 2, state: 'needs_rework' },
    ])
  })

  it('assembleChangeMatrix：章重新提交至新版本后单元转绿（resolved）', () => {
    const root = hermeticRoot()
    seedPins(root)
    const window = openPinsWindow(root)
    runTraversal({
      root,
      taskRef: 'trav_1',
      traversalId: 't_1',
      trigger: { source: 'reconciliation', ref: 'rcln_x' },
      upstreamChanges: [entry('temporalFact', 'fact_a', 2)],
      recordedAt: '2026-08-27T00:00:00.000Z',
      window,
    })
    // ch1 重新提交：钉版依赖 fact_a@2（新版本）⇒ 消解；ch2 未重提交 ⇒ 仍红
    const eventsPath = join(root, '.mozhou', 'events.jsonl')
    const lines = readFileSync(eventsPath, 'utf8').split('\n').filter((l) => l.length > 0)
    lines.push(JSON.stringify({
      type: 'ChapterCommitted',
      seq: 4,
      chapterIndex: 1,
      commitId: 'c1b',
      dependencyManifest: { entries: [{ kind: 'temporalFact', id: 'fact_a', revision: 2 }] },
    }))
    writeFileSync(eventsPath, lines.join('\n') + '\n')

    const matrix = assembleChangeMatrix(root)
    const row = matrix.rows[0]
    if (row === undefined) throw new Error('missing matrix row')
    expect(row.staleCount).toBe(1)
    expect(row.cells).toEqual([
      { chapterIndex: 1, state: 'resolved' },
      { chapterIndex: 2, state: 'needs_rework' },
    ])
  })

  it('assembleChangeMatrix：多行矩阵 + not_affected 占位对齐列头', () => {
    const root = hermeticRoot()
    seedPins(root)
    const window = openPinsWindow(root)
    runTraversal({
      root, taskRef: 't1', traversalId: 'a',
      trigger: { source: 'reconciliation', ref: 'r1' },
      upstreamChanges: [entry('temporalFact', 'fact_a', 2)],
      recordedAt: '2026-08-27T00:00:00.000Z', window,
    })
    runTraversal({
      root, taskRef: 't2', traversalId: 'b',
      trigger: { source: 'commit', ref: 'c2' },
      upstreamChanges: [entry('outlineNode', 'node_o', 3)],
      recordedAt: '2026-08-27T00:00:01.000Z', window,
    })
    // 列头 = affectedChapters union = ch1/ch2（fact_a）+ ch4（node_o）
    const matrix = assembleChangeMatrix(root)
    expect(matrix.columns).toEqual([1, 2, 4])
    const rowA = matrix.rows.find((r) => r.traversalId === 'a')
    const rowB = matrix.rows.find((r) => r.traversalId === 'b')
    if (rowA === undefined || rowB === undefined) throw new Error('missing row')
    // A 不涉 ch4 → not_affected 占位（—）
    expect(rowA.cells.find((c) => c.chapterIndex === 4)?.state).toBe('not_affected')
    // B 影响 ch4（node_o@3 > 钉版@2）→ needs_rework
    expect(rowB.cells.find((c) => c.chapterIndex === 4)?.state).toBe('needs_rework')
    // B 不涉 ch1/ch2
    expect(rowB.cells.find((c) => c.chapterIndex === 1)?.state).toBe('not_affected')
    // 无任何 impact 记录 ⇒ 空矩阵
    const empty = assembleChangeMatrix(hermeticRoot())
    expect(empty.columns).toEqual([])
    expect(empty.rows).toEqual([])
  })
})
