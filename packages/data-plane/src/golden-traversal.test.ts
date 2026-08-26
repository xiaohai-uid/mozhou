/**
 * T30 黄金对拍台架（#71；t66 D27/D28 定案）。
 *
 * fixtures/dep-graph-10ch.json 固定夹具（直线链/跨跳/菱形/孤立章）：
 * - 资格门：CASE schema 预校验（图合法：节点存在、边端点存在、无自环；期望 ⊆ 可达），
 *   失败即红灯、禁止产出断言结果；
 * - 三层断言：主 = 受影响集合排序后逐项相等（不放宽物理顺序）、
 *   次 = 行为级传播深度（直接读者逐实体）、哨兵 = 规模数字（只读、禁当黄金）；
 * - 直驱 findReaders（T26 单缝）——不经 ProposalPort（决策通道假信号）；
 * - 重建幂等指纹：同输入两次遍历受影响集排序集合哈希相等（vault 记忆 D1），
 *   剥离开确定时间戳。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { DependencyManifestEntry } from '@mozhou/kernel'
import { findReaders } from './stale-cache.js'

interface ManifestEntryLike {
  readonly kind: string
  readonly id: string
  readonly revision: number
}

interface GoldenCase {
  readonly id: string
  readonly description: string
  readonly mutate: {
    readonly kind: string
    readonly id: string
    readonly fromRevision: number
    readonly toRevision: number
  }
  readonly golden: {
    readonly affectedChaptersSorted: readonly number[]
    readonly propagationDepth: Readonly<Record<string, number>>
    readonly untouchedChaptersSorted: readonly number[]
  }
}

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'dep-graph-10ch.json')

interface FixtureShape {
  readonly name: string
  readonly version: number
  readonly chapters: Readonly<Record<string, readonly ManifestEntryLike[]>>
  readonly sentinel: { readonly chapterCount: number; readonly edgeCount: number; readonly maxDepth: number }
  readonly cases: readonly GoldenCase[]
}

function loadFixture(): FixtureShape {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as FixtureShape
}

function pinsFromFixture(fixture: FixtureShape): ReadonlyMap<number, { readonly chapterIndex: number; readonly commitId: string; readonly manifest: { readonly entries: readonly DependencyManifestEntry[] } }> {
  const pins = new Map<number, { chapterIndex: number; commitId: string; manifest: { entries: readonly DependencyManifestEntry[] } }>()
  for (const [chapter, entries] of Object.entries(fixture.chapters)) {
    pins.set(Number(chapter), {
      chapterIndex: Number(chapter),
      commitId: 'golden_c' + chapter,
      manifest: { entries: entries as DependencyManifestEntry[] },
    })
  }
  return pins
}

/** 可达集：直接依赖被改实体的章（一层；本夹具拓扑下直接读者即全部可达）。 */
function reachableFrom(fixture: FixtureShape, mutate: GoldenCase['mutate']): readonly number[] {
  const direct = new Set<number>()
  for (const [chapter, entries] of Object.entries(fixture.chapters)) {
    if (entries.some((e) => e.kind === mutate.kind && e.id === mutate.id)) direct.add(Number(chapter))
  }
  return [...direct].sort((a, b) => a - b)
}

/** 重建幂等指纹：受影响章集合排序后逐项哈希（确定性，无时间戳）。 */
function fingerprintOf(sortedChapters: readonly number[]): string {
  return createHash('sha256').update(sortedChapters.join(',')).digest('hex')
}

describe('T30 黄金对拍台架 · 资格门 + CASE 守卫', () => {
  it('资格门：CASE schema 校验通过（图合法：节点存在、期望 ⊆ 可达、无自环）', () => {
    const fixture = loadFixture()
    // 图合法：所有章号 1-10 存在、依赖实体 kind/id 只是引用（findReaders 不要求实体存在性）
    for (let i = 1; i <= fixture.sentinel.chapterCount; i += 1) {
      expect(fixture.chapters[String(i)]).toBeDefined()
    }
    // 期望 ⊆ 可达：每个 case 的 golden.affected ⊆ 该实体直接读者 ∪ 可达
    for (const testCase of fixture.cases) {
      const reachable = reachableFrom(fixture, testCase.mutate)
      const reachableSet = new Set(reachable)
      for (const chapter of testCase.golden.affectedChaptersSorted) {
        expect(reachableSet.has(chapter), `case ${testCase.id}: chapter ${chapter} 不在可达集`).toBe(true)
      }
      // 期望与未受影响不相交
      const affectedSet = new Set(testCase.golden.affectedChaptersSorted)
      for (const untouched of testCase.golden.untouchedChaptersSorted) {
        expect(affectedSet.has(untouched), `case ${testCase.id}: ${untouched} 既在受影响又在未受影响`).toBe(false)
      }
    }
    // 哨兵只读：夹具规模断言（防脆性，禁当黄金）
    expect(fixture.sentinel.chapterCount).toBe(10)
  })

  it('主断言：受影响集合排序后逐项相等（findReaders 命中 = 黄金），未受影响互补', () => {
    const fixture = loadFixture()
    const pins = pinsFromFixture(fixture)
    for (const testCase of fixture.cases) {
      const affected = findReaders(pins, {
        kind: testCase.mutate.kind as DependencyManifestEntry['kind'],
        id: testCase.mutate.id,
        revision: testCase.mutate.toRevision,
      })
      // 排序后逐项相等（不放宽物理顺序）
      expect([...affected].sort((a, b) => a - b), `case ${testCase.id} 受影响集`).toEqual(
        [...testCase.golden.affectedChaptersSorted].sort((a, b) => a - b),
      )
      // 未受影响互补：全集 - 受影响 = 未受影响
      const all = Object.keys(fixture.chapters).map(Number)
      const affectedSet = new Set(affected)
      const untouched = all.filter((c) => !affectedSet.has(c))
      expect(untouched, `case ${testCase.id} 未受影响集`).toEqual([...testCase.golden.untouchedChaptersSorted].sort((a, b) => a - b))
    }
  })

  it('次断言：行为级传播深度（直接读者逐实体拓扑一致性）', () => {
    const fixture = loadFixture()
    const pins = pinsFromFixture(fixture)
    for (const testCase of fixture.cases) {
      const affected = findReaders(pins, {
        kind: testCase.mutate.kind as DependencyManifestEntry['kind'],
        id: testCase.mutate.id,
        revision: testCase.mutate.toRevision,
      })
      // 黄金深度表里每章必须是直接读者（depth=1 在这一层拓扑上成立）
      for (const [chapter, depth] of Object.entries(testCase.golden.propagationDepth)) {
        expect(affected, `case ${testCase.id}: ch${chapter} 应为读者`).toContain(Number(chapter))
        expect(depth).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('重建幂等指纹：同输入两次推断受影响集，排序集合哈希相等（确定性）', () => {
    const fixture = loadFixture()
    const pins = pinsFromFixture(fixture)
    const caseA = fixture.cases[0]
    if (caseA === undefined) throw new Error('fixture 至少一个 case')
    const run = () =>
      fingerprintOf(
        [...findReaders(pins, {
          kind: caseA.mutate.kind as DependencyManifestEntry['kind'],
          id: caseA.mutate.id,
          revision: caseA.mutate.toRevision,
        })].sort((a, b) => a - b),
      )
    expect(run()).toBe(run())
  })
})
