/**
 * T4（实现票 #19）行为黑盒：全部经 LocalDataPlane 接缝打——
 * 提交期语义门禁（宁败不脏：坏增量零盘上副作用）/
 * POV 秘密零泄漏（验收①：与「秘密不存在」不可区分）/
 * knownSinceChapter 生效（验收②）/ M2 时间线序数单调拦截（验收③）。
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TimelineOrderViolationError,
  TrackingRowError,
  newFactId,
  newKnowledgeStateId,
  newRelationshipStateId,
  newTimelineEventId,
  queryActiveFacts,
  queryKnowledgePerspective,
} from '@mozhou/kernel'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createBook } from './create-book.js'
import { RUNTIME_EVENTS_PATH, TRACKING_STREAMS, proseChapterPath } from './layout.js'
import { readNarrativeSnapshot } from './narrative-state.js'
import { LocalDataPlane } from './local-data-plane.js'

const tmpRoots: string[] = []
let bookRoot = ''
let currentBookId = ''

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-t4-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
})

afterAll(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const T0 = '2026-08-24T00:00:00.000Z'

/** 确定性 ULID（零泄漏对照书要求两书内容逐字段可比，随机 id 会破坏等价断言）。 */
function fixedUlid(seed: number): string {
  return `01JB${String(seed).padStart(22, '0')}`
}

interface RowBuilderOptions {
  readonly id?: string
  readonly subject?: string
  readonly predicate?: string
  readonly value?: string | number | boolean
  readonly validFrom?: number
  readonly validUntil?: number | null
  readonly status?: string
  readonly riskClass?: string
}

function factRow(options: RowBuilderOptions = {}): Record<string, unknown> {
  return {
    id: options.id ?? newFactId(),
    bookId: currentBookId,
    revision: 0,
    createdAt: T0,
    updatedAt: T0,
    subject: options.subject ?? 'char:lin-wan',
    predicate: options.predicate ?? 'located',
    value: options.value ?? '墨舟',
    validFrom: options.validFrom ?? 1,
    validUntil: options.validUntil ?? null,
    importance: 'notable',
    riskClass: options.riskClass ?? 'low',
    source: { kind: 'chapter', chapterIndex: 1 },
    status: options.status ?? 'confirmed',
    compactedIntoVolumeId: null,
    provenance: { origin: 'ai', protectedUserContent: false },
  }
}

function knstRow(
  factId: string,
  options: { id?: string; holder?: string; knownSinceChapter?: number; level?: string; distortion?: string } = {},
): Record<string, unknown> {
  return {
    id: options.id ?? newKnowledgeStateId(),
    bookId: currentBookId,
    revision: 0,
    createdAt: T0,
    updatedAt: T0,
    factId,
    holder: options.holder ?? 'protagonist',
    knownSinceChapter: options.knownSinceChapter ?? 1,
    ...(options.level === undefined ? {} : { level: options.level }),
    ...(options.distortion === undefined ? {} : { distortion: options.distortion }),
  }
}

function relRow(options: { affinityScore?: number; entityA?: string; entityB?: string } = {}): Record<string, unknown> {
  return {
    id: newRelationshipStateId(),
    bookId: currentBookId,
    revision: 0,
    createdAt: T0,
    updatedAt: T0,
    entityA: options.entityA ?? 'char:lin-wan',
    entityB: options.entityB ?? 'char:xiao-he',
    relationshipType: '盟友',
    affinityScore: options.affinityScore ?? 30,
    validFrom: 1,
    validUntil: null,
    sourceChapterIndex: 1,
  }
}

function timelineRow(worldTimeOrder: number, options: { id?: string; impactFactIds?: string[] } = {}): Record<string, unknown> {
  return {
    id: options.id ?? newTimelineEventId(),
    bookId: currentBookId,
    revision: 0,
    createdAt: T0,
    updatedAt: T0,
    worldTimeLabel: '开篇',
    worldTimeOrder,
    chapterIndex: 1,
    participants: [],
    summary: '开篇事件',
    impactFactIds: options.impactFactIds ?? [],
  }
}

function newBook(): LocalDataPlane {
  createBook({ dir: bookRoot, title: '墨舟测试书' })
  const plane = LocalDataPlane.open(bookRoot)
  currentBookId = plane.book.id
  return plane
}

function disk(rel: string): string {
  return readFileSync(join(bookRoot, rel), 'utf8')
}

/** 断言一次失败的提交在盘上零痕迹：相位未动、五族流与事件账本全空、无残留日志。 */
function expectDiskUntouchedByFailedCommit(plane: LocalDataPlane): void {
  const proseRaw = disk(proseChapterPath(1))
  expect(proseRaw).toContain('phase: draft')
  for (const stream of TRACKING_STREAMS) {
    expect(disk(stream.path)).toBe('')
  }
  expect(disk(RUNTIME_EVENTS_PATH)).toBe('')
  expect(existsSync(join(bookRoot, '.mozhou/pending-commit.json'))).toBe(false)
  expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
}

describe('提交期语义门禁：坏增量在动第一字节前被拦截（宁败不脏）', () => {
  it('合法四族混合增量正常落流', () => {
    const plane = newBook()
    try {
      const fact = factRow()
      const event = timelineRow(1, { impactFactIds: [fact['id'] as string] })
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      const result = plane.commitChapter({
        chapterIndex: 1,
        summary: '开篇',
        appends: {
          temporalFact: [fact],
          knowledgeState: [knstRow(fact['id'] as string)],
          relationshipState: [relRow()],
          timelineEvent: [event],
        },
      })
      expect(result.appendedCounts).toEqual({
        temporalFact: 1,
        knowledgeState: 1,
        relationshipState: 1,
        timelineEvent: 1,
      })
      for (const kind of ['事实', '认知', '关系', '时间线'] as const) {
        expect(disk(`追踪/${kind}.jsonl`).split('\n')).toHaveLength(2) // 一行载荷 + 末尾换行
      }
    } finally {
      plane.close()
    }
  })

  it('形状非法的事实行 ⇒ 拒绝且盘上零痕迹', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      expect(() =>
        plane.commitChapter({
          chapterIndex: 1,
          summary: 'x',
          appends: { temporalFact: [{ id: 'nope', subject: 'char:a' }] },
        }),
      ).toThrow(TrackingRowError)
      expectDiskUntouchedByFailedCommit(plane)
    } finally {
      plane.close()
    }
  })

  it('secret.* 谓词必须同现 riskClass high（Q7 同现律）', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      expect(() =>
        plane.commitChapter({
          chapterIndex: 1,
          summary: 'x',
          appends: { temporalFact: [factRow({ predicate: 'secret.bloodline', riskClass: 'medium' })] },
        }),
      ).toThrow(/riskClass/)
    } finally {
      plane.close()
    }
  })

  it('认知行引用悬空事实 ⇒ 拒绝（跨批断链宁败不脏）', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      expect(() =>
        plane.commitChapter({
          chapterIndex: 1,
          summary: 'x',
          appends: { knowledgeState: [knstRow(`fact_${fixedUlid(999)}`)] },
        }),
      ).toThrow(/resolves to no live or batch fact/)
      expectDiskUntouchedByFailedCommit(plane)
    } finally {
      plane.close()
    }
  })

  it('认知行引用同批事实放行；时间线 impactFactIds 悬空 ⇒ 拒绝', () => {
    const plane = newBook()
    try {
      const secret = factRow({ predicate: 'secret.bloodline', riskClass: 'high', validFrom: 2 })
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      const result = plane.commitChapter({
        chapterIndex: 1,
        summary: 'x',
        appends: {
          temporalFact: [secret],
          knowledgeState: [knstRow(secret['id'] as string)],
          timelineEvent: [timelineRow(1)],
        },
      })
      expect(result.appendedCounts).toEqual({ temporalFact: 1, knowledgeState: 1, timelineEvent: 1 })

      plane.createChapterDraft({ chapterIndex: 2, title: '二章' })
      expect(() =>
        plane.commitChapter({
          chapterIndex: 2,
          summary: 'y',
          appends: { timelineEvent: [timelineRow(2, { impactFactIds: [`fact_${fixedUlid(888)}`] })] },
        }),
      ).toThrow(/impactFactIds/)
    } finally {
      plane.close()
    }
  })

  it('关系亲和分越界与自环 ⇒ 拒绝；[-100,+100] 边界放行', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })

      expect(() =>
        plane.commitChapter({ chapterIndex: 1, summary: 'x', appends: { relationshipState: [relRow({ affinityScore: 101 })] } }),
      ).toThrow(/\[-100, 100\]/)
      expect(() =>
        plane.commitChapter({ chapterIndex: 1, summary: 'x', appends: { relationshipState: [relRow({ entityA: 'char:a', entityB: 'char:a' })] } }),
      ).toThrow(/must differ from entityA/)

      const result = plane.commitChapter({
        chapterIndex: 1,
        summary: '边界',
        appends: { relationshipState: [relRow({ affinityScore: -100 }), relRow({ affinityScore: 100 })] },
      })
      expect(result.appendedCounts).toEqual({ relationshipState: 2 })
    } finally {
      plane.close()
    }
  })
})

describe('M2 时间线单调硬门禁：乱序插入被序数校验拦截（验收③）', () => {
  it('新序数必须严格大于存量活跃最大值；批内严格递增', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '一章' })
      const first = plane.commitChapter({
        chapterIndex: 1,
        summary: 'a',
        appends: { timelineEvent: [timelineRow(10)] },
      })
      expect(first.appendedCounts).toEqual({ timelineEvent: 1 })

      plane.createChapterDraft({ chapterIndex: 2, title: '二章' })
      // 等于最大值 ⇒ 拦截
      expect(() =>
        plane.commitChapter({ chapterIndex: 2, summary: 'b', appends: { timelineEvent: [timelineRow(10)] } }),
      ).toThrow(TimelineOrderViolationError)
      // 小于最大值 ⇒ 拦截
      expect(() =>
        plane.commitChapter({ chapterIndex: 2, summary: 'b', appends: { timelineEvent: [timelineRow(9)] } }),
      ).toThrow(TimelineOrderViolationError)
      // 批内倒退 ⇒ 拦截
      expect(() =>
        plane.commitChapter({ chapterIndex: 2, summary: 'b', appends: { timelineEvent: [timelineRow(21), timelineRow(20)] } }),
      ).toThrow(TimelineOrderViolationError)
      // 严格递增且越过存量 ⇒ 放行
      const ok = plane.commitChapter({
        chapterIndex: 2,
        summary: 'b',
        appends: { timelineEvent: [timelineRow(11), timelineRow(12)] },
      })
      expect(ok.appendedCounts).toEqual({ timelineEvent: 2 })
    } finally {
      plane.close()
    }
  })

  it('折叠语义：同一事件 id 的更新行取代旧行后，旧序数不再约束后续插入', () => {
    const plane = newBook()
    try {
      const eventId = newTimelineEventId()
      plane.createChapterDraft({ chapterIndex: 1, title: '一章' })
      plane.commitChapter({ chapterIndex: 1, summary: 'a', appends: { timelineEvent: [timelineRow(5, { id: eventId })] } })

      plane.reopenChapter(1)
      plane.commitChapter({
        chapterIndex: 1,
        summary: '修正时间线',
        appends: { timelineEvent: [timelineRow(6, { id: eventId })] },
      })

      // 存量折叠视图的最大序数 = 6（末行胜出），7 可插入；6 不可
      plane.createChapterDraft({ chapterIndex: 2, title: '二章' })
      expect(() =>
        plane.commitChapter({ chapterIndex: 2, summary: 'b', appends: { timelineEvent: [timelineRow(6)] } }),
      ).toThrow(TimelineOrderViolationError)
      expect(
        plane.commitChapter({ chapterIndex: 2, summary: 'c', appends: { timelineEvent: [timelineRow(7)] } }).appendedCounts,
      ).toEqual({ timelineEvent: 1 })
    } finally {
      plane.close()
    }
  })
})

/* ----------------------------------------------------------------------------
 * queryActiveFacts 读路径
 * ------------------------------------------------------------------------- */

interface SeededBookIds {
  readonly locFactId: string
  readonly lateFactId: string
  readonly secretFactId: string
}

/**
 * 双书种子：内容完全一致，唯一差异 = A 书多一条秘密事实与其授权认知行。
 * 零泄漏的强断言即：不知情视角下两书的查询结果逐字段相等。
 */
function seedStory(plane: LocalDataPlane, withSecret: boolean): SeededBookIds {
  const locFactId = `fact_${fixedUlid(1)}`
  const lateFactId = `fact_${fixedUlid(2)}`
  const secretFactId = `fact_${fixedUlid(3)}`

  plane.createChapterDraft({ chapterIndex: 1, title: '一章' })
  plane.commitChapter({
    chapterIndex: 1,
    summary: 'a',
    appends: {
      temporalFact: [
        factRow({ id: locFactId, subject: 'char:lin-wan', predicate: 'located', value: '墨舟', validFrom: 1 }),
        factRow({ id: `fact_${fixedUlid(4)}`, subject: 'char:lin-wan', predicate: 'weapon', value: '铁剑', validFrom: 1, validUntil: 2 }),
        factRow({ id: `fact_${fixedUlid(5)}`, status: 'rejected', validFrom: 1 }),
      ],
      timelineEvent: [timelineRow(1)],
    },
  })

  const secretAppends: Partial<Record<'temporalFact' | 'knowledgeState' | 'timelineEvent', readonly unknown[]>> = {
    temporalFact: [
      ...(withSecret
        ? [factRow({ id: secretFactId, predicate: 'secret.bloodline', riskClass: 'high', value: '青云血脉', validFrom: 2 })]
        : []),
      factRow({ id: lateFactId, subject: 'char:xiao-he', predicate: 'located', value: '后山', validFrom: 4 }),
    ],
    ...(withSecret
      ? {
          knowledgeState: [
            knstRow(secretFactId, { holder: 'char:wang', knownSinceChapter: 6 }),
            knstRow(secretFactId, { holder: 'protagonist', knownSinceChapter: 3 }),
          ],
        }
      : {}),
    timelineEvent: [timelineRow(2)],
  }

  plane.createChapterDraft({ chapterIndex: 2, title: '二章' })
  plane.commitChapter({ chapterIndex: 2, summary: 'b', appends: secretAppends })

  return { locFactId, lateFactId, secretFactId }
}

describe('queryActiveFacts 读路径', () => {
  it('验收②：knownSinceChapter 之前的章查询不返回该知识（protagonist 第 3 章起知情）', () => {
    const plane = newBook()
    try {
      const ids = seedStory(plane, true)

      const before = plane.queryActiveFacts({ chapter: 2, pov: 'protagonist' })
      expect(before.map((row) => row.id)).not.toContain(ids.secretFactId)

      const since = plane.queryActiveFacts({ chapter: 3, pov: 'protagonist' })
      expect(since.map((row) => row.id)).toContain(ids.secretFactId)

      const later = plane.queryActiveFacts({ chapter: 9, pov: 'protagonist' })
      expect(later.map((row) => row.id)).toContain(ids.secretFactId)
    } finally {
      plane.close()
    }
  })

  it('验收①：不知情视角零泄漏——与「秘密从未存在」的对照书结果逐字段不可区分', () => {
    // 双书对照：同流程建两本，唯一差异 = A 书多一条秘密事实与其授权认知行。
    // 不知情视角下查询结果逐字段相等 ⇒ 被滤秘密与「不存在」不可区分。
    function buildStoryRoot(name: string, withSecret: boolean): { readonly predicates: readonly string[] } {
      const root = join(bookRoot, name)
      mkdirSync(root, { recursive: true })
      createBook({ dir: root, title: '墨舟测试书' })
      const plane = LocalDataPlane.open(root)
      try {
        currentBookId = plane.book.id
        seedStory(plane, withSecret)
        const result = plane.queryActiveFacts({ chapter: 9, pov: 'char:zhao' })
        return { predicates: result.map((row) => row.predicate) }
      } finally {
        plane.close()
      }
    }

    const withSecret = buildStoryRoot('with-secret', true)
    const control = buildStoryRoot('control', false)

    expect(control.predicates).toEqual(['located', 'located'])
    expect(withSecret).toEqual(control)
  })

  it('授权视角按 knownSinceChapter 边界开启可见；非秘密事实不要求认知行', () => {
    const plane = newBook()
    try {
      const ids = seedStory(plane, true)

      // char:wang 第 6 章起知情：<6 不可见，≥6 可见
      expect(plane.queryActiveFacts({ chapter: 5, pov: 'char:wang' }).map((r) => r.id)).not.toContain(ids.secretFactId)
      expect(plane.queryActiveFacts({ chapter: 6, pov: 'char:wang' }).map((r) => r.id)).toContain(ids.secretFactId)
      // 无任何认知行的 char:zhao 永远不可见
      expect(plane.queryActiveFacts({ chapter: 99, pov: 'char:zhao' }).map((r) => r.id)).not.toContain(ids.secretFactId)
      // 世界客观真（非秘密）：无认知行也照常可见
      expect(plane.queryActiveFacts({ chapter: 1, pov: 'char:zhao' }).map((r) => r.id)).toContain(ids.locFactId)
    } finally {
      plane.close()
    }
  })

  it('区间含端点生效、rejected 出局、entityIds 过滤、(validFrom,id) 确定序', () => {
    const plane = newBook()
    try {
      const ids = seedStory(plane, true)

      // 第 1 章：武器事实（validFrom 1, validUntil 2）在场；第 3 章过期
      const chapter1 = plane.queryActiveFacts({ chapter: 1, pov: 'protagonist', entityIds: ['char:lin-wan'] })
      expect(chapter1.map((r) => r.id)).toEqual([ids.locFactId, `fact_${fixedUlid(4)}`])
      // 第 3 章：武器事实过期退场；秘密对 protagonist 恰在第 3 章开启（knownSince 3）
      const chapter3 = plane.queryActiveFacts({ chapter: 3, pov: 'protagonist', entityIds: ['char:lin-wan'] })
      expect(chapter3.map((r) => r.id)).toEqual([ids.locFactId, ids.secretFactId])

      // rejected 恒出局；entityIds 圈定主体；(validFrom, id) 升序稳定
      const all = plane.queryActiveFacts({ chapter: 9, pov: 'protagonist' })
      expect(all.map((r) => r.id)).toEqual([ids.locFactId, ids.secretFactId, ids.lateFactId])
      const xiaoHeOnly = plane.queryActiveFacts({ chapter: 9, pov: 'protagonist', entityIds: ['char:xiao-he'] })
      expect(xiaoHeOnly.map((r) => r.id)).toEqual([ids.lateFactId])
    } finally {
      plane.close()
    }
  })

  it('查询入参守卫：reader 不是可查询视角；章号必须为正整数', () => {
    const plane = newBook()
    try {
      expect(() => plane.queryActiveFacts({ chapter: 1, pov: 'reader' as never })).toThrow(TrackingRowError)
      expect(() => plane.queryActiveFacts({ chapter: 0, pov: 'protagonist' })).toThrow(TrackingRowError)
    } finally {
      plane.close()
    }
  })
})

/* -------------------------------------------------------------------------
 * ADR-0026（认知层级）：迁移缺省 / 词表严格 / 认知视角查询
 * ------------------------------------------------------------------------- */

describe('ADR-0026 认知层级', () => {
  it('存量行（无 level）解析时一次性迁移为 knows（迁移规则）', () => {
    const plane = newBook()
    try {
      const ids = seedStory(plane, true)
      const snapshot = readNarrativeSnapshot(bookRoot)
      const row = [...snapshot.knowledgeStates.values()].find((ks) => ks.factId === ids.secretFactId)
      expect(row?.level).toBe('knows')
    } finally {
      plane.close()
    }
  })

  it('level 非法值宁败不猜（TrackingRowError）', () => {
    const plane = newBook()
    try {
      const secretFactId = `fact_${fixedUlid(9)}`
      plane.createChapterDraft({ chapterIndex: 9, title: '九章' })
      expect(() =>
        plane.commitChapter({
          chapterIndex: 9,
          summary: 'x',
          appends: {
            temporalFact: [factRow({ id: secretFactId, predicate: 'secret.x', riskClass: 'high', value: 'v', validFrom: 9 })],
            knowledgeState: [knstRow(secretFactId, { holder: 'protagonist', knownSinceChapter: 9, level: 'bogus' })],
          },
        }),
      ).toThrowError(TrackingRowError)
    } finally {
      plane.close()
    }
  })

  it('suspects 行不授权确定性秘密；perspective 查询给出限定呈现', () => {
    const plane = newBook()
    try {
      const secretFactId = `fact_${fixedUlid(11)}`
      plane.createChapterDraft({ chapterIndex: 11, title: '十一章' })
      plane.commitChapter({
        chapterIndex: 11,
        summary: 'suspect seed',
        appends: {
          temporalFact: [factRow({ id: secretFactId, predicate: 'secret.origin', riskClass: 'high', value: '真正血脉', validFrom: 11 })],
          knowledgeState: [knstRow(secretFactId, { holder: 'char:zhao', knownSinceChapter: 11, level: 'suspects' })],
        },
      })

      // queryActiveFacts：suspects 不授权 → 秘密不出现在权威事实集
      const snapshot = readNarrativeSnapshot(bookRoot)
      const authoritative = queryActiveFacts(snapshot, { chapter: 12, pov: 'char:zhao' })
      expect(authoritative.map((f) => f.id)).not.toContain(secretFactId)

      // 认知视角：suspects 呈现带限定后缀；秘密值不得出现（ADR-0026 修订：防真相泄漏）
      const perspective = queryKnowledgePerspective(snapshot, { chapter: 12, pov: 'char:zhao' })
      expect(perspective).toHaveLength(1)
      expect(perspective[0]!.level).toBe('suspects')
      expect(perspective[0]!.presentation).toContain('CHARACTER SUSPECTS:')
      expect(perspective[0]!.presentation).toContain('do not narrate or act as confirmed knowledge')
      expect(perspective[0]!.presentation).not.toContain('真正血脉')
    } finally {
      plane.close()
    }
  })

  it('believes 行有畸变时呈现畸变而非真相（秘密事实的正典值不得出现）', () => {
    const plane = newBook()
    try {
      const factId = `fact_${fixedUlid(13)}`
      const ksId = newKnowledgeStateId()
      plane.createChapterDraft({ chapterIndex: 13, title: '十三章' })
      plane.commitChapter({
        chapterIndex: 13,
        summary: 'belief seed',
        appends: {
          temporalFact: [factRow({ id: factId, predicate: 'secret.origin', riskClass: 'high', value: '真正血脉', validFrom: 13 })],
          knowledgeState: [knstRow(factId, { id: ksId, holder: 'protagonist', knownSinceChapter: 13, level: 'believes' })],
        },
      })
      const snapshot = readNarrativeSnapshot(bookRoot)
      const perspective = queryKnowledgePerspective(snapshot, { chapter: 13, pov: 'protagonist' })
      expect(perspective).toHaveLength(1)
      expect(perspective[0]!.level).toBe('believes')
      // 无畸变：秘密事实呈现占位，正典值不得出现
      expect(perspective[0]!.presentation).not.toContain('真正血脉')
      expect(perspective[0]!.presentation).toContain('拒绝呈现正典命题')

      // 作者补写 distortion（信念中的假版本）→ 呈现畸变，仍不含正典值
      plane.createChapterDraft({ chapterIndex: 14, title: '十四章' })
      plane.commitChapter({
        chapterIndex: 14,
        summary: 'distortion seed',
        appends: {
          knowledgeState: [knstRow(factId, { id: ksId, holder: 'protagonist', knownSinceChapter: 13, level: 'believes', distortion: '自己只是普通渔家女' })],
        },
      })
      const after = queryKnowledgePerspective(readNarrativeSnapshot(bookRoot), { chapter: 14, pov: 'protagonist' })
      expect(after).toHaveLength(1)
      expect(after[0]!.presentation).toContain('CHARACTER BELIEVES: 自己只是普通渔家女')
      expect(after[0]!.presentation).not.toContain('真正血脉')
    } finally {
      plane.close()
    }
  })

  it('believes 无畸变 + 非秘密事实 → 照常呈现命题（边界对照）', () => {
    const plane = newBook()
    try {
      const factId = `fact_${fixedUlid(15)}`
      plane.createChapterDraft({ chapterIndex: 15, title: '十五章' })
      plane.commitChapter({
        chapterIndex: 15,
        summary: 'non-secret belief',
        appends: {
          temporalFact: [factRow({ id: factId, predicate: 'origin', value: '青云宗', validFrom: 15 })],
          knowledgeState: [knstRow(factId, { holder: 'protagonist', knownSinceChapter: 15, level: 'believes' })],
        },
      })
      const perspective = queryKnowledgePerspective(readNarrativeSnapshot(bookRoot), { chapter: 15, pov: 'protagonist' })
      expect(perspective).toHaveLength(1)
      expect(perspective[0]!.presentation).toContain('origin:青云宗')
    } finally {
      plane.close()
    }
  })
})
