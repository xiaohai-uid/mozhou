import { describe, expect, it } from 'vitest'
import {
  buildCompactedFactRow,
  buildVolumeSummaryPrompt,
  planVolumeCompaction,
  summarizeVolumeFacts,
  validateVolumeSummary,
  VolumeCompactionInputError,
  VolumeSummaryValidationError,
} from './compaction.js'
import type {
  BookId,
  FactId,
  KnowledgeState,
  KnowledgeStateId,
  TemporalFact,
  TimelineEvent,
  TimelineEventId,
  VolumeNodeId,
} from './kernel-schema.js'
import type { NarrativeStateSnapshot } from './narrative-state.js'
import { ProtectedContentViolationError } from './protection.js'

function makeFact(overrides: Partial<TemporalFact> = {}): TemporalFact {
  return {
    id: 'fact_01JTEST00000000000000000001' as FactId,
    bookId: 'book_test' as BookId,
    revision: 0,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    subject: 'char:lin-xuan',
    predicate: 'realm',
    value: '筑基中期',
    validFrom: 1,
    validUntil: 5,
    importance: 'notable',
    riskClass: 'low',
    source: { kind: 'chapter', chapterIndex: 1 },
    status: 'confirmed',
    compactedIntoVolumeId: null,
    provenance: { origin: 'ai', protectedUserContent: false },
    ...overrides,
  }
}

function makeSnapshot(options: {
  facts?: TemporalFact[]
  knowledgeStates?: KnowledgeState[]
  timelineEvents?: TimelineEvent[]
}): NarrativeStateSnapshot {
  const facts = new Map<FactId, TemporalFact>()
  for (const f of options.facts ?? []) {
    facts.set(f.id, f)
  }
  const knowledgeStates = new Map<KnowledgeStateId, KnowledgeState>()
  for (const ks of options.knowledgeStates ?? []) {
    knowledgeStates.set(ks.id, ks)
  }
  const timelineEvents = new Map<TimelineEventId, TimelineEvent>()
  for (const te of options.timelineEvents ?? []) {
    timelineEvents.set(te.id, te)
  }
  return {
    facts,
    knowledgeStates,
    relationships: new Map(),
    timelineEvents,
  }
}

describe('planVolumeCompaction (纯函数筛选)', () => {
  const volId = 'vol_01JTEST0000000000000000VOL1' as VolumeNodeId

  it('有效终态微事实被正确筛选为 candidates', () => {
    const f1 = makeFact({ id: 'fact_01JTEST00000000000000000001' as FactId, validUntil: 5 })
    const snapshot = makeSnapshot({ facts: [f1] })

    const plan = planVolumeCompaction({
      volumeNodeId: volId,
      volumeEndChapter: 10,
      snapshot,
    })

    expect(plan.candidates).toHaveLength(1)
    expect(plan.candidates[0]!.id).toBe(f1.id)
    expect(plan.exclusions).toHaveLength(0)
  })

  it('排除各项条件：已折叠、未确认、未过期或无界、critical、受保护、活跃认知与时间线引用', () => {
    const fCompacted = makeFact({
      id: 'fact_01JTEST00000000000000000001' as FactId,
      compactedIntoVolumeId: 'vol_other' as VolumeNodeId,
    })
    const fCandidate = makeFact({
      id: 'fact_01JTEST00000000000000000002' as FactId,
      status: 'candidate',
    })
    const fActive = makeFact({
      id: 'fact_01JTEST00000000000000000003' as FactId,
      validUntil: 15, // > volumeEndChapter 10
    })
    const fUnbounded = makeFact({
      id: 'fact_01JTEST00000000000000000004' as FactId,
      validUntil: null,
    })
    const fCritical = makeFact({
      id: 'fact_01JTEST00000000000000000005' as FactId,
      importance: 'critical',
    })
    const fProtected = makeFact({
      id: 'fact_01JTEST00000000000000000006' as FactId,
      provenance: { origin: 'author', protectedUserContent: true },
    })
    const fKnowledgeRef = makeFact({
      id: 'fact_01JTEST00000000000000000007' as FactId,
    })
    const fTimelineRef = makeFact({
      id: 'fact_01JTEST00000000000000000008' as FactId,
    })
    const fValid = makeFact({
      id: 'fact_01JTEST00000000000000000009' as FactId,
      validUntil: 10,
    })

    const ks: KnowledgeState = {
      id: 'knst_01JTEST00000000000000000001' as KnowledgeStateId,
      bookId: 'book_test' as BookId,
      revision: 0,
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
      factId: fKnowledgeRef.id,
      holder: 'protagonist',
      level: 'knows',
      knownSinceChapter: 1,
    }

    const te: TimelineEvent = {
      id: 'tle_01JTEST00000000000000000001' as TimelineEventId,
      bookId: 'book_test' as BookId,
      revision: 0,
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
      worldTimeLabel: 'Day 1',
      worldTimeOrder: 1,
      chapterIndex: 1,
      participants: ['char:lin-xuan'],
      summary: 'Event',
      impactFactIds: [fTimelineRef.id],
    }

    const snapshot = makeSnapshot({
      facts: [
        fCompacted,
        fCandidate,
        fActive,
        fUnbounded,
        fCritical,
        fProtected,
        fKnowledgeRef,
        fTimelineRef,
        fValid,
      ],
      knowledgeStates: [ks],
      timelineEvents: [te],
    })

    const plan = planVolumeCompaction({
      volumeNodeId: volId,
      volumeEndChapter: 10,
      snapshot,
    })

    expect(plan.candidates).toHaveLength(1)
    expect(plan.candidates[0]!.id).toBe(fValid.id)

    const exclusionReasons = new Map(plan.exclusions.map((e) => [e.factId, e.reason]))
    expect(exclusionReasons.get(fCompacted.id)).toBe('already_compacted')
    expect(exclusionReasons.get(fCandidate.id)).toBe('not_confirmed')
    expect(exclusionReasons.get(fActive.id)).toBe('interval_still_active_or_unbounded')
    expect(exclusionReasons.get(fUnbounded.id)).toBe('interval_still_active_or_unbounded')
    expect(exclusionReasons.get(fCritical.id)).toBe('importance_critical')
    expect(exclusionReasons.get(fProtected.id)).toBe('protected_user_content')
    expect(exclusionReasons.get(fKnowledgeRef.id)).toBe('active_knowledge_reference')
    expect(exclusionReasons.get(fTimelineRef.id)).toBe('active_timeline_reference')
  })

  it('参数非法时抛出 VolumeCompactionInputError', () => {
    const snapshot = makeSnapshot({})
    expect(() =>
      planVolumeCompaction({
        volumeNodeId: volId,
        volumeEndChapter: 0,
        snapshot,
      }),
    ).toThrow(VolumeCompactionInputError)
  })
})

describe('validateVolumeSummary & buildVolumeSummaryPrompt', () => {
  it('正确检测空摘要、超长与未覆盖 subject 实体', () => {
    expect(validateVolumeSummary('', ['char:lin-xuan'])).toEqual([
      { code: 'empty_summary', detail: 'summary is empty after trim' },
    ])

    const overflow = validateVolumeSummary('a'.repeat(20), ['char:lin-xuan'], 10)
    expect(overflow.some((f) => f.code === 'length_overflow')).toBe(true)

    const missingSubject = validateVolumeSummary('这是一段关于其他人的摘要', ['char:lin-xuan'])
    expect(missingSubject).toEqual([
      { code: 'subject_not_covered', detail: "subject ref 'char:lin-xuan' absent from summary" },
    ])

    const passed = validateVolumeSummary('在第一卷中，char:lin-xuan 突破至筑基中期。', ['char:lin-xuan'])
    expect(passed).toHaveLength(0)
  })

  it('buildVolumeSummaryPrompt 生成包含 subject 的提示词', () => {
    const f1 = makeFact({ subject: 'char:lin-xuan' })
    const prompt = buildVolumeSummaryPrompt({
      volumeNodeId: 'vol_1' as VolumeNodeId,
      volumeEndChapter: 10,
      facts: [f1],
    })
    expect(prompt).toContain('char:lin-xuan')
    expect(prompt).toContain('vol_1')
    expect(prompt).toContain('第 10 章完结')
  })
})

describe('summarizeVolumeFacts (注入式 LLM 摘要生成)', () => {
  const volId = 'vol_01JTEST0000000000000000VOL1' as VolumeNodeId

  it('候选为空时短路返回空摘要且不调用 LLM', async () => {
    let called = false
    const result = await summarizeVolumeFacts({
      plan: {
        volumeNodeId: volId,
        volumeEndChapter: 10,
        candidates: [],
        exclusions: [],
      },
      llm: () => {
        called = true
        return Promise.resolve('summary')
      },
    })
    expect(called).toBe(false)
    expect(result.summary).toBe('')
    expect(result.factsCompacted).toHaveLength(0)
  })

  it('LLM 生成合法摘要且通过校验', async () => {
    const f1 = makeFact({ subject: 'char:lin-xuan' })
    const plan = {
      volumeNodeId: volId,
      volumeEndChapter: 10,
      candidates: [f1],
      exclusions: [],
    }

    const result = await summarizeVolumeFacts({
      plan,
      llm: (prompt) => {
        expect(prompt).toContain('char:lin-xuan')
        return Promise.resolve('本卷中，char:lin-xuan 成功掌握雷法，旧修为失效。')
      },
    })

    expect(result.summary).toBe('本卷中，char:lin-xuan 成功掌握雷法，旧修为失效。')
    expect(result.factsCompacted).toHaveLength(1)
  })

  it('LLM 摘要未覆盖 subject 时抛出 VolumeSummaryValidationError', async () => {
    const f1 = makeFact({ subject: 'char:lin-xuan' })
    const plan = {
      volumeNodeId: volId,
      volumeEndChapter: 10,
      candidates: [f1],
      exclusions: [],
    }

    await expect(
      summarizeVolumeFacts({
        plan,
        llm: () => Promise.resolve('这是一篇完全没有提主角字面的摘要。'),
      }),
    ).rejects.toThrow(VolumeSummaryValidationError)
  })
})

describe('buildCompactedFactRow (构造压缩标记行)', () => {
  const volId = 'vol_01JTEST0000000000000000VOL1' as VolumeNodeId

  it('为普通事实递增 revision 并赋 compactedIntoVolumeId', () => {
    const f1 = makeFact({ revision: 2 })
    const updated = buildCompactedFactRow({
      fact: f1,
      volumeNodeId: volId,
      updatedAtIso: '2026-10-06T12:00:00.000Z',
    })

    expect(updated.revision).toBe(3)
    expect(updated.compactedIntoVolumeId).toBe(volId)
    expect(updated.updatedAt).toBe('2026-10-06T12:00:00.000Z')
    expect(updated.value).toBe(f1.value)
  })

  it('已折叠事实再次构造抛出 VolumeCompactionInputError', () => {
    const f1 = makeFact({ compactedIntoVolumeId: 'vol_old' as VolumeNodeId })
    expect(() =>
      buildCompactedFactRow({
        fact: f1,
        volumeNodeId: volId,
        updatedAtIso: '2026-10-06T12:00:00.000Z',
      }),
    ).toThrow(VolumeCompactionInputError)
  })

  it('protectedUserContent 事实抛出 ProtectedContentViolationError', () => {
    const f1 = makeFact({ provenance: { origin: 'author', protectedUserContent: true } })
    expect(() =>
      buildCompactedFactRow({
        fact: f1,
        volumeNodeId: volId,
        updatedAtIso: '2026-10-06T12:00:00.000Z',
      }),
    ).toThrow(ProtectedContentViolationError)
  })
})
