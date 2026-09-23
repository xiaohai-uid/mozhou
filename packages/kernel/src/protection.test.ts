/**
 * T6（实现票 #22）kernel 纯函数域黑盒：
 * I1 保护守卫 / 追踪流保护取代门禁 / I2 stale 构造与依赖命中计算 /
 * 依赖钉版冻结形状校验 / I3 知识状态级联失效查询。
 */
import { describe, expect, it } from 'vitest'
import {
  DependencyManifestError,
  ProtectedContentViolationError,
  assertAutomationReadOnly,
  buildStaleMarker,
  computeStaleMarker,
  matchStaleDependencies,
  parseDependencyManifest,
  parseDependencyManifestEntry,
} from './protection.js'
import { assertNoProtectedSupersession, foldNarrativeRows, invalidatedKnowledgeStates } from './narrative-state.js'
import type { AuthorProvenance, DependencyManifest, FactId, TemporalFact } from './kernel-schema.js'

const T0 = '2026-08-24T00:00:00.000Z'
const BOOK = 'book_01JB0000000000000000000000'

function ulid(prefix: string, seed: number): string {
  return `${prefix}_${'01JB'}${String(seed).padStart(22, '0')}`
}

function factRow(overrides: {
  id?: string
  status?: string
  revision?: number
  origin?: 'author' | 'ai' | 'external'
  protectedUserContent?: boolean
}): Record<string, unknown> {
  return {
    id: overrides.id ?? ulid('fact', 1),
    bookId: BOOK,
    revision: overrides.revision ?? 0,
    createdAt: T0,
    updatedAt: T0,
    subject: 'char:lin-wan',
    predicate: 'located',
    value: '墨舟',
    validFrom: 1,
    validUntil: null,
    importance: 'notable',
    riskClass: 'low',
    source: { kind: 'chapter', chapterIndex: 1 },
    status: overrides.status ?? 'confirmed',
    compactedIntoVolumeId: null,
    provenance: {
      origin: overrides.origin ?? 'ai',
      protectedUserContent: overrides.protectedUserContent ?? false,
    },
  }
}

function knstRow(id: string, factId: string, holder: string): Record<string, unknown> {
  return {
    id,
    bookId: BOOK,
    revision: 0,
    createdAt: T0,
    updatedAt: T0,
    factId,
    holder,
    knownSinceChapter: 1,
  }
}

/* ----------------------------------------------------------------------------
 * I1 工件级保护守卫
 * -------------------------------------------------------------------------- */

describe('assertAutomationReadOnly（I1）', () => {
  const ref = { kind: 'temporalFact', id: 'fact_01JB0000000000000000000001' }

  it('protectedUserContent=true 时三种来源一律抛 ProtectedContentViolationError', () => {
    for (const origin of ['author', 'ai', 'external'] as const) {
      const provenance: AuthorProvenance = { origin, protectedUserContent: true }
      expect(() => assertAutomationReadOnly(provenance, ref)).toThrow(ProtectedContentViolationError)
    }
  })

  it('错误携带 kind/id 定位信息', () => {
    try {
      assertAutomationReadOnly({ origin: 'author', protectedUserContent: true }, ref)
      expect.unreachable()
    } catch (error) {
      expect((error as ProtectedContentViolationError).kind).toBe('temporalFact')
      expect((error as ProtectedContentViolationError).id).toBe(ref.id)
    }
  })

  it('protectedUserContent=false 一律放行', () => {
    for (const origin of ['author', 'ai', 'external'] as const) {
      expect(() =>
        assertAutomationReadOnly({ origin, protectedUserContent: false }, ref),
      ).not.toThrow()
    }
  })
})

/* ----------------------------------------------------------------------------
 * I1 追踪流保护取代门禁
 * -------------------------------------------------------------------------- */

describe('assertNoProtectedSupersession（I1 追踪流半边）', () => {
  const protectedId = ulid('fact', 10)
  const plainId = ulid('fact', 11)

  function liveFacts(rows: Record<string, unknown>[]): ReadonlyMap<FactId, TemporalFact> {
    return foldNarrativeRows({ temporalFact: rows }).facts
  }

  it('ai 来源同 id 取代保护位作者事实 → 抛错并指明来源通道', () => {
    const live = liveFacts([factRow({ id: protectedId, origin: 'author', protectedUserContent: true })])
    expect(() =>
      assertNoProtectedSupersession(live, [
        factRow({ id: protectedId, revision: 1, origin: 'ai' }) as unknown as TemporalFact,
      ]),
    ).toThrow(ProtectedContentViolationError)
  })

  it('external 来源同样被拒', () => {
    const live = liveFacts([factRow({ id: protectedId, origin: 'author', protectedUserContent: true })])
    expect(() =>
      assertNoProtectedSupersession(live, [
        factRow({ id: protectedId, revision: 1, origin: 'external' }) as unknown as TemporalFact,
      ]),
    ).toThrow(ProtectedContentViolationError)
  })

  it('作者修订自己的保护位断言（author→author）合法', () => {
    const live = liveFacts([factRow({ id: protectedId, origin: 'author', protectedUserContent: true })])
    expect(() =>
      assertNoProtectedSupersession(live, [
        factRow({ id: protectedId, revision: 1, origin: 'author', protectedUserContent: true }) as unknown as TemporalFact,
      ]),
    ).not.toThrow()
  })

  it('未受保护行可被任意来源取代；全新 id 自由创建', () => {
    const live = liveFacts([
      factRow({ id: plainId, origin: 'ai', protectedUserContent: false }),
    ])
    expect(() =>
      assertNoProtectedSupersession(live, [
        factRow({ id: plainId, revision: 1, origin: 'external' }) as unknown as TemporalFact,
        factRow({ id: ulid('fact', 12), origin: 'ai' }) as unknown as TemporalFact,
      ]),
    ).not.toThrow()
  })
})

/* ----------------------------------------------------------------------------
 * I2 StaleMarker 构造与命中计算
 * -------------------------------------------------------------------------- */

describe('buildStaleMarker / matchStaleDependencies / computeStaleMarker（I2）', () => {
  const factA = { kind: 'temporalFact' as const, id: ulid('fact', 20), revision: 2 }
  const outlineB = { kind: 'outlineNode' as const, id: ulid('chapter', 21), revision: 5 }

  it('构造冻结形状；空引用与坏时间戳拒绝', () => {
    expect(buildStaleMarker({ reason: 'upstream_canon_changed', upstreamRefs: [factA], markedAt: T0 })).toEqual({
      reason: 'upstream_canon_changed',
      upstreamRefs: [factA],
      markedAt: T0,
    })
    expect(() => buildStaleMarker({ reason: 'upstream_canon_changed', upstreamRefs: [], markedAt: T0 })).toThrow(
      DependencyManifestError,
    )
    expect(() =>
      buildStaleMarker({ reason: 'upstream_canon_changed', upstreamRefs: [factA], markedAt: 'not-a-time' }),
    ).toThrow(DependencyManifestError)
  })

  it('命中：revision 漂移的 (kind,id) 对齐条目', () => {
    const manifest: DependencyManifest = {
      entries: [
        { kind: 'temporalFact', id: factA.id, revision: 0 },
        { kind: 'outlineNode', id: outlineB.id, revision: 5 },
      ],
    }
    expect(matchStaleDependencies(manifest, [factA])).toEqual([factA])
  })

  it('版本未变 / 未依赖的上游变更不传播', () => {
    const manifest: DependencyManifest = { entries: [{ kind: 'temporalFact', id: factA.id, revision: 2 }] }
    expect(matchStaleDependencies(manifest, [factA])).toEqual([])
    expect(matchStaleDependencies(manifest, [{ ...factA, id: ulid('fact', 99) }])).toEqual([])
  })

  it('同 id 不同 kind 视为不同上游，不误伤', () => {
    const manifest: DependencyManifest = { entries: [{ kind: 'temporalFact', id: factA.id, revision: 0 }] }
    expect(
      matchStaleDependencies(manifest, [{ kind: 'knowledgeState', id: factA.id, revision: 9 }]),
    ).toEqual([])
  })

  it('computeStaleMarker：命中非空 ⇒ 带原因/引用/时间；否则 null', () => {
    const manifest: DependencyManifest = { entries: [{ kind: 'temporalFact', id: factA.id, revision: 0 }] }
    expect(
      computeStaleMarker({ manifest, upstreamChanges: [factA, outlineB], reason: 'upstream_canon_changed', markedAt: T0 }),
    ).toEqual({ reason: 'upstream_canon_changed', upstreamRefs: [factA], markedAt: T0 })
    expect(
      computeStaleMarker({
        manifest: { entries: [] },
        upstreamChanges: [factA],
        reason: 'dependency_manifest_mismatch',
        markedAt: T0,
      }),
    ).toBeNull()
  })
})

/* ----------------------------------------------------------------------------
 * DependencyManifest 冻结形状校验
 * -------------------------------------------------------------------------- */

describe('parseDependencyManifest / parseDependencyManifestEntry', () => {
  it('合法清单原样往返', () => {
    const entries = [
      { kind: 'temporalFact', id: ulid('fact', 30), revision: 0 },
      { kind: 'scene', id: ulid('scene', 31), revision: 3 },
    ]
    expect(parseDependencyManifest(entries)).toEqual({ entries })
  })

  it('非数组 / 非对象条目 / 非法 kind / 负 revision / 空 id 全部宁败', () => {
    expect(() => parseDependencyManifest('nope')).toThrow(DependencyManifestError)
    expect(() => parseDependencyManifestEntry(null, 0)).toThrow(DependencyManifestError)
    expect(() => parseDependencyManifestEntry({ kind: 'bogus', id: 'x', revision: 0 }, 0)).toThrow(
      DependencyManifestError,
    )
    expect(() => parseDependencyManifestEntry({ kind: 'temporalFact', id: 'x', revision: -1 }, 0)).toThrow(
      DependencyManifestError,
    )
    expect(() => parseDependencyManifestEntry({ kind: 'temporalFact', id: '', revision: 0 }, 0)).toThrow(
      DependencyManifestError,
    )
  })
})

/* ----------------------------------------------------------------------------
 * I3 知识状态级联失效查询
 * -------------------------------------------------------------------------- */

describe('invalidatedKnowledgeStates（I3）', () => {
  it('引用 rejected 事实的认知行即失效面；其余认知行不受牵连', () => {
    const healthy = ulid('fact', 40)
    const doomed = ulid('fact', 41)
    const k1 = ulid('knst', 50)
    const k2 = ulid('knst', 51)
    const k3 = ulid('knst', 52)
    const state = foldNarrativeRows({
      temporalFact: [
        factRow({ id: healthy, status: 'confirmed' }),
        factRow({ id: doomed, status: 'rejected' }),
      ],
      knowledgeState: [
        knstRow(k1, healthy, 'protagonist'),
        knstRow(k2, doomed, 'reader'),
        knstRow(k3, doomed, 'char:xiao-he'),
      ],
    })

    expect(invalidatedKnowledgeStates(state).map((ks) => ks.id)).toEqual([k2, k3])
  })

  it('无 rejected 事实时失效面为空', () => {
    const state = foldNarrativeRows({
      temporalFact: [factRow({ status: 'planned' })],
      knowledgeState: [knstRow(ulid('knst', 60), ulid('fact', 41), 'reader')],
    })
    expect(invalidatedKnowledgeStates(state)).toEqual([])
  })

  it('折叠语义：被 updated 行救回的事实不再牵连认知行', () => {
    const factId = ulid('fact', 70)
    const ksId = ulid('knst', 71)
    const state = foldNarrativeRows({
      // 同 id 两行：先 rejected 后 confirmed——末行胜出
      temporalFact: [factRow({ id: factId, status: 'rejected' }), factRow({ id: factId, revision: 1, status: 'confirmed' })],
      knowledgeState: [knstRow(ksId, factId, 'protagonist')],
    })
    expect(invalidatedKnowledgeStates(state)).toEqual([])
  })
})
