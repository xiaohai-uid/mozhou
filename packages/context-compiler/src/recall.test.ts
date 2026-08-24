/**
 * 关键词 + k-hop 双通道召回测试（实现票 #21 / T8a）。
 *
 * 验收对照（issue #21）：
 *   - INV-K1~K6（khop-graph-recall-spec §10）逐条有对应用例；
 *   - 扩边有效性：keyword 未命中但图邻域相关的实体入候选；
 *   - identifier 撞车去重且胜出通道证据入结果。
 * 全部 hermetic：内存快照 + 确定性 ULID，零 IO 零 LLM。
 */
import { describe, expect, it } from 'vitest'
import {
  foldNarrativeRows,
  type FactId,
  type KnowledgeHolder,
  type KnowledgeStateId,
  type NarrativeStateSnapshot,
  type PovEntity,
  type RelationshipStateId,
  type TimelineEventId,
  type VolumeNodeId,
} from '@mozhou/kernel'
import type { EntityRef } from '@mozhou/kernel'
import {
  DEFAULT_KHOP_RECALL_CONFIG,
  detectKeywordTriggers,
  khopGraphRecall,
  mergeRecallChannels,
  recallKeywordAndGraph,
  type RecallEntityCard,
} from './recall.js'

/* ----------------------------------------------------------------------------
 * 确定性夹具
 * -------------------------------------------------------------------------- */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 确定性 26 位 Crockford Base32（种子序 = 字典序，便于 ULID ASC 断言）。 */
function ulid(seed: number): string {
  let out = ''
  let value = seed
  for (let i = 0; i < 26; i += 1) {
    out = CROCKFORD[value % 32]! + out
    value = Math.floor(value / 32)
  }
  return out
}

const BOOK_ID = `book_${ulid(1)}`
let seq = 100
const nextFactId = (): FactId => `fact_${ulid(seq++)}` as FactId
const factAt = (n: number): FactId => `fact_${ulid(n)}` as FactId
const knstAt = (n: number): KnowledgeStateId => `knst_${ulid(n)}` as KnowledgeStateId
const relsAt = (n: number): RelationshipStateId => `rels_${ulid(n)}` as RelationshipStateId
const tleAt = (n: number): TimelineEventId => `tle_${ulid(n)}` as TimelineEventId
const volumeAt = (n: number): VolumeNodeId => `volume_${ulid(n)}` as VolumeNodeId

type FactSeed = Partial<{
  id: FactId
  predicate: string
  value: string | number | boolean
  status: 'planned' | 'candidate' | 'confirmed' | 'rejected'
  validFrom: number
  validUntil: number | null
  importance: 'trivial' | 'notable' | 'critical'
  compactedIntoVolumeId: VolumeNodeId | null
}>

function mkFact(subject: EntityRef, seed: FactSeed = {}) {
  const predicate = seed.predicate ?? '状态'
  return {
    id: seed.id ?? nextFactId(),
    bookId: BOOK_ID,
    revision: 0,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    subject,
    predicate,
    value: seed.value ?? '安好',
    validFrom: seed.validFrom ?? 1,
    validUntil: seed.validUntil ?? null,
    importance: seed.importance ?? ('notable' as const),
    riskClass: predicate.startsWith('secret.') ? ('high' as const) : ('low' as const),
    source: { kind: 'chapter' as const, chapterIndex: 1 },
    status: seed.status ?? ('confirmed' as const),
    compactedIntoVolumeId: seed.compactedIntoVolumeId ?? null,
    provenance: { origin: 'author' as const, protectedUserContent: false },
  }
}

function mkKnowledge(factId: FactId, holder: KnowledgeHolder, knownSinceChapter: number) {
  return {
    id: knstAt(seq++),
    bookId: BOOK_ID,
    revision: 0,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    factId,
    holder,
    knownSinceChapter,
  }
}

function mkRel(entityA: EntityRef, entityB: EntityRef, affinityScore: number, validUntil: number | null = null) {
  return {
    id: relsAt(seq++),
    bookId: BOOK_ID,
    revision: 0,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    entityA,
    entityB,
    relationshipType: '盟友',
    affinityScore,
    validFrom: 1,
    validUntil,
    sourceChapterIndex: 1,
  }
}

function mkEvent(participants: EntityRef[], chapterIndex: number, locationRef?: EntityRef) {
  return {
    id: tleAt(seq++),
    bookId: BOOK_ID,
    revision: 0,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    worldTimeLabel: '云历三七二年',
    worldTimeOrder: seq,
    chapterIndex,
    ...(locationRef === undefined ? {} : { locationRef }),
    participants,
    summary: '一场遭遇',
    impactFactIds: [],
  }
}

function snap(rows: {
  temporalFact?: ReturnType<typeof mkFact>[]
  knowledgeState?: ReturnType<typeof mkKnowledge>[]
  relationshipState?: ReturnType<typeof mkRel>[]
  timelineEvent?: ReturnType<typeof mkEvent>[]
}): NarrativeStateSnapshot {
  return foldNarrativeRows({
    temporalFact: rows.temporalFact ?? [],
    knowledgeState: rows.knowledgeState ?? [],
    relationshipState: rows.relationshipState ?? [],
    timelineEvent: rows.timelineEvent ?? [],
  })
}

const LIN: EntityRef = 'char:lin-xuan'
const SU: EntityRef = 'char:su-yao'

const linCard: RecallEntityCard = {
  ref: LIN,
  name: '林枫',
  aliases: [
    { text: '枫儿', kind: 'exact' },
    { text: '林(小)?枫', kind: 'regex' },
  ],
  brief: '青云宗外门弟子',
}

const SCOPE = { chapterIndex: 5, pov: 'protagonist' as PovEntity }

/* ----------------------------------------------------------------------------
 * INV-K6：建图与候选资格仅认 confirmed + 区间活跃（event 边除外）
 * -------------------------------------------------------------------------- */

describe('INV-K6 建图与候选资格生命周期门禁', () => {
  it('planned/candidate/rejected 事实零候选零建边；区间失效事实只留诊断记录', () => {
    const neighborRefs = [SU, 'char:zhao-qian', 'location:bei-mo', 'faction:xuantian'] as EntityRef[]
    const linOwn = mkFact(LIN, { importance: 'critical' })
    // 四种不合格事实各自指向一个有卡邻居——若建边即泄漏为候选
    const invalidBridges = [
      mkFact(LIN, { value: neighborRefs[0]!, status: 'planned' }),
      mkFact(LIN, { value: neighborRefs[1]!, status: 'candidate' }),
      mkFact(LIN, { value: neighborRefs[2]!, status: 'rejected' }),
      mkFact(LIN, { value: neighborRefs[3]!, validUntil: 2 }), // 区间不含第 5 章
    ]
    const neighborFacts = neighborRefs.map((ref) => mkFact(ref, { importance: 'critical' as const }))
    const snapshot = snap({
      temporalFact: [linOwn, ...invalidBridges, ...neighborFacts],
    })

    const result = recallKeywordAndGraph({
      draftText: '林枫拔剑。',
      cards: [linCard],
      snapshot,
      scope: SCOPE,
    })

    const ids = new Set(result.candidates.map((c) => c.id))
    expect(ids.has(LIN)).toBe(true)
    expect(ids.has(linOwn.id)).toBe(true) // 触发自身 confirmed 事实照常入选
    for (const fact of neighborFacts) {
      expect(ids.has(fact.id)).toBe(false)
    }
    // 记录范围裁决：仅区间滤除者留诊断（状态滤除静默；POV 见 INV-K1 组）
    expect(result.excluded).toHaveLength(1)
    expect(result.excluded[0]).toEqual({
      identifier: invalidBridges[3]!.id,
      reason: 'interval_not_active',
      channel: 'graph_khop',
    })
  })
})

/* ----------------------------------------------------------------------------
 * INV-K1：strict POV 门禁——被滤秘密零候选零建边
 * -------------------------------------------------------------------------- */

describe('INV-K1 POV 可见子图单一门禁点', () => {
  const secretBridge = () =>
    mkFact(LIN, { predicate: 'secret.trueIdentity', value: SU, importance: 'critical' })
  const suCritical = () => mkFact(SU, { importance: 'critical' })

  it('未授权视角：秘密桥不存在，邻域实体零候选零痕迹', () => {
    const secret = secretBridge()
    const suFact = suCritical()
    const result = recallKeywordAndGraph({
      draftText: '林枫夜行。',
      cards: [linCard],
      snapshot: snap({ temporalFact: [mkFact(LIN), secret, suFact] }),
      scope: SCOPE,
    })

    const ids = new Set(result.candidates.map((c) => c.id))
    expect(ids.has(suFact.id)).toBe(false)
    expect(ids.has(secret.id)).toBe(false)
    expect(result.excluded).toContainEqual({
      identifier: secret.id,
      reason: 'pov_filtered',
      channel: 'graph_khop',
    })
  })

  it('授权视角（认知行生效）：秘密桥恢复扩边能力', () => {
    const secret = secretBridge()
    const suFact = suCritical()
    const result = recallKeywordAndGraph({
      draftText: '林枫夜行。',
      cards: [linCard],
      snapshot: snap({
        temporalFact: [mkFact(LIN), secret, suFact],
        knowledgeState: [mkKnowledge(secret.id, 'protagonist', 3)],
      }),
      scope: SCOPE,
    })

    const pulled = result.candidates.find((c) => c.id === suFact.id)
    expect(pulled).toBeDefined()
    expect(pulled!.activation).toEqual({
      kind: 'graph_khop',
      sourceEntity: LIN,
      hops: 2,
      score: 0.7 * 1.0 * 0.5, // w_factref × w_impact(critical 桥) × h2
    })
    expect(result.excluded.find((e) => e.identifier === secret.id)).toBeUndefined()
  })
})

/* ----------------------------------------------------------------------------
 * INV-K2：触发实体卡硬必入（唯一容量豁免）；INV-K3：双硬上限确定性上界
 * -------------------------------------------------------------------------- */

describe('INV-K2/K3 容量纪律', () => {
  it('khopCap=1 时两张触发卡仍全数入场（卡豁免容量），事实被收口到上限', () => {
    const config = { ...DEFAULT_KHOP_RECALL_CONFIG, khopCap: 1 }
    const snapshot = snap({
      temporalFact: [mkFact(LIN), mkFact(SU)],
    })
    const result = recallKeywordAndGraph({
      draftText: '林枫与苏瑶对峙。',
      cards: [linCard, { ref: SU, name: '苏瑶' }],
      snapshot,
      scope: SCOPE,
      config,
    })

    const cards = result.candidates.filter((c) => c.tier === 'entity_card')
    const facts = result.candidates.filter((c) => c.tier !== 'entity_card')
    expect(cards.map((c) => c.id).sort()).toEqual([LIN, SU].sort())
    expect(cards.every((c) => c.atomicOverride === true && c.relevanceScore >= 1)).toBe(true)
    expect(facts.length).toBeLessThanOrEqual(config.khopCap)
  })

  it('枢纽不爆炸：branchCap 裁邻居宽度、khopCap 收全局、结果确定', () => {
    const config = { ...DEFAULT_KHOP_RECALL_CONFIG, branchCap: 3, khopCap: 5 }
    const hub: EntityRef = 'char:hub'
    const rels = Array.from({ length: 12 }, (_, i) =>
      mkRel(hub, (`char:n${String(i).padStart(2, '0')}` as EntityRef), 100 - i * 17),
    )
    const neighborFacts = rels.map((rel, i) =>
      mkFact(rel.entityB === hub ? rel.entityA : rel.entityB, { importance: 'notable' as const, id: factAt(500 + i) }),
    )
    const snapshot = snap({
      temporalFact: [...neighborFacts, mkFact(hub, { importance: 'critical' })],
      relationshipState: rels,
    })

    const first = khopGraphRecall(snapshot, [{ ref: hub, score: 1, keys: ['枢纽'] }], SCOPE, config)
    const second = khopGraphRecall(snapshot, [{ ref: hub, score: 1, keys: ['枢纽'] }], SCOPE, config)
    expect(first).toEqual(second)

    const factEntries = first.entries.filter((e) => e.tier !== 'entity_card')
    expect(first.entries.filter((e) => e.tier === 'entity_card')).toHaveLength(1)
    expect(factEntries.length).toBeLessThanOrEqual(config.khopCap)

    // 最强亲和邻居（|affinity|=100）必入，最弱（floor 0.3）被 branchCap 裁掉
    const sources = new Set(factEntries.map((e) => (e.activation.kind === 'graph_khop' ? e.activation.sourceEntity : '')))
    expect(sources.size).toBeLessThanOrEqual(config.branchCap)
  })
})

/* ----------------------------------------------------------------------------
 * INV-K4：决定性（同 canon 同输入 ⇒ 同候选同分同序；平局显式收口）
 * -------------------------------------------------------------------------- */

describe('INV-K4 决定性与平局收口', () => {
  it('同输入重跑深相等；打乱行构造序不改变输出；同分按 ULID ASC', () => {
    const build = (reverse: boolean) => {
      const f1 = mkFact(LIN, { importance: 'notable', id: factAt(700) })
      const f2 = mkFact(LIN, { importance: 'notable', id: factAt(701) })
      const facts = reverse ? [f2, f1] : [f1, f2]
      return recallKeywordAndGraph({
        draftText: '林枫前行。',
        cards: [linCard],
        snapshot: snap({ temporalFact: facts }),
        scope: SCOPE,
      })
    }
    const forward = build(false)
    const shuffled = build(true)
    expect(shuffled).toEqual(forward)

    const tiedOwn = forward.candidates.filter((c) => c.activation?.kind === 'graph_khop' && c.activation.hops === 1)
    expect(tiedOwn.map((c) => c.id)).toEqual([...tiedOwn.map((c) => c.id)].sort())
  })
})

/* ----------------------------------------------------------------------------
 * INV-K5：duplicate ≡ identifier 撞车，正常路径恒 0 次
 * -------------------------------------------------------------------------- */

describe('INV-K5 duplicate 判定线', () => {
  it('正常端到端路径零 duplicate 记录', () => {
    const result = recallKeywordAndGraph({
      draftText: '林枫与枫儿是同一人。',
      cards: [linCard],
      snapshot: snap({ temporalFact: [mkFact(LIN)] }),
      scope: SCOPE,
    })
    expect(result.excluded.filter((e) => e.reason === 'duplicate')).toEqual([])
  })

  it('单通道重复提交同 id：防御性记 duplicate 且收敛为一个候选', () => {
    const entry = (score: number) => ({
      id: factAt(900),
      tier: 'active_fact' as const,
      relevanceScore: score,
      content: 'x',
    })
    const result = mergeRecallChannels([{ channel: 'graph_khop', entries: [entry(0.5), entry(0.9)] }])
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]!.relevanceScore).toBe(0.9)
    expect(result.excluded).toEqual([{ identifier: factAt(900), reason: 'duplicate', channel: 'graph_khop' }])
  })
})

/* ----------------------------------------------------------------------------
 * AC②扩边有效性 + 阈值口径 + event 边永久性
 * -------------------------------------------------------------------------- */

describe('AC② keyword 未命中时图邻域补位', () => {
  it('强关系敌对边把未提及实体的关键事实拉入候选', () => {
    const suCritical = mkFact(SU, { importance: 'critical' })
    const result = recallKeywordAndGraph({
      draftText: '林枫握紧了剑。', // 苏瑶未被提及
      cards: [linCard, { ref: SU, name: '苏瑶' }],
      snapshot: snap({ temporalFact: [mkFact(LIN), suCritical], relationshipState: [mkRel(LIN, SU, -80)] }),
      scope: SCOPE,
    })

    expect(result.candidates.find((c) => c.id === SU)).toBeUndefined() // 未提及的卡不入
    const pulled = result.candidates.find((c) => c.id === suCritical.id)
    expect(pulled).toBeDefined()
    expect(pulled!.channel).toBe('graph_khop')
    expect(pulled!.tier).toBe('active_fact')
    expect(pulled!.relevanceScore).toBeCloseTo(0.9 * (80 / 100) * 0.5, 10)
    expect(pulled!.activation).toMatchObject({ kind: 'graph_khop', sourceEntity: LIN, hops: 2 })
  })

  it('弱关系路径低于 threshGraph：淘汰记录带通道归属', () => {
    const weakFact = mkFact(SU, { importance: 'critical', id: factAt(950) })
    const result = recallKeywordAndGraph({
      draftText: '林枫独行。',
      cards: [linCard, { ref: SU, name: '苏瑶' }],
      snapshot: snap({ temporalFact: [mkFact(LIN), weakFact], relationshipState: [mkRel(LIN, SU, 10)] }),
      scope: SCOPE,
    })
    // 路径边权积 = 0.9 × max(0.3, 0.1) = 0.27 < 0.30 ⇒ 淘汰（阈值作用于 pre-hop 边权积）
    expect(result.candidates.find((c) => c.id === weakFact.id)).toBeUndefined()
    expect(result.excluded).toContainEqual({
      identifier: weakFact.id,
      reason: 'relevance_below_threshold',
      channel: 'graph_khop',
    })
  })

  it('event 边永久有效（历史恒真），参与者与地点共现均扩边', () => {
    const loc: EntityRef = 'location:yunlai-inn'
    const suFact = mkFact(SU, { importance: 'critical', id: factAt(960) })
    const locFact = mkFact(loc, { importance: 'critical', id: factAt(961) })
    const result = recallKeywordAndGraph({
      draftText: '林枫想起旧事。',
      cards: [linCard],
      snapshot: snap({
        temporalFact: [mkFact(LIN), suFact, locFact],
        timelineEvent: [mkEvent([LIN, SU], 2, loc)], // 事件发生在第 2 章
      }),
      scope: { chapterIndex: 9, pov: 'protagonist' }, // 查询时点远晚于事件
    })
    // event 路径边权恒 0.5 ≥ threshGraph；终分 = 0.5 × h2 = 0.25（不看 importance）
    for (const fact of [suFact, locFact]) {
      const pulled = result.candidates.find((c) => c.id === fact.id)
      expect(pulled).toBeDefined()
      expect(pulled!.relevanceScore).toBeCloseTo(0.25, 10)
      expect(pulled!.activation).toMatchObject({ kind: 'graph_khop', sourceEntity: LIN, hops: 2 })
    }
  })
})

/* ----------------------------------------------------------------------------
 * tier 指派（统一规则，通道无关）
 * -------------------------------------------------------------------------- */

describe('tier 指派', () => {
  it('compacted→distant_recall 压过 world_rule；concept 活跃→world_rule；其余→active_fact', () => {
    const compactedConcept = mkFact('concept:spirit-root', {
      compactedIntoVolumeId: volumeAt(31),
      id: factAt(970),
    })
    const worldRule = mkFact('concept:no-resurrection', { id: factAt(971) })
    const plain = mkFact(LIN, { id: factAt(972) })
    // 三个主体各自作为触发（G1 自身事实层），逐条核对 tier 指派
    const graph = khopGraphRecall(
      snap({ temporalFact: [compactedConcept, worldRule, plain] }),
      [
        { ref: 'concept:spirit-root', score: 1, keys: ['灵根'] },
        { ref: 'concept:no-resurrection', score: 1, keys: ['复活'] },
        { ref: LIN, score: 0.9, keys: ['林枫'] },
      ],
      SCOPE,
      DEFAULT_KHOP_RECALL_CONFIG,
    )
    const tierOf = new Map(graph.entries.map((e) => [e.id, e.tier]))
    expect(tierOf.get(compactedConcept.id)).toBe('distant_recall')
    expect(tierOf.get(worldRule.id)).toBe('world_rule')
    expect(tierOf.get(plain.id)).toBe('active_fact')
  })
})

/* ----------------------------------------------------------------------------
 * keyword 快通道打分与检测语义
 * -------------------------------------------------------------------------- */

describe('keyword 别名/正则快通道', () => {
  const cfg = DEFAULT_KHOP_RECALL_CONFIG

  it('主名 1.0 / 别名 0.85 / 提及加分封顶', () => {
    const primary = detectKeywordTriggers([linCard], '林枫登场', cfg)
    expect(primary.triggers[0]).toMatchObject({ ref: LIN, score: 1.0, keys: ['林枫'] })

    const alias = detectKeywordTriggers([linCard], '枫儿出手', cfg)
    expect(alias.triggers[0]).toMatchObject({ ref: LIN, score: 0.85, keys: ['枫儿'] })

    const boosted = detectKeywordTriggers([linCard], '枫儿出手，枫儿再出手', cfg)
    expect(boosted.triggers[0]!.score).toBeCloseTo(0.9, 10)

    const capped = detectKeywordTriggers([linCard], '枫儿甲枫儿乙枫儿丙枫儿丁枫儿戊', cfg)
    expect(capped.triggers[0]!.score).toBe(1.0) // 0.85 + min(cap 0.15, step×4) 后 clamp
  })

  it('regex 兜底变体命中；非法 regex 记 parseFailures 不炸通道', () => {
    const variant = detectKeywordTriggers(
      [{ ref: SU, name: '苏瑶', aliases: [{ text: '苏(小)?瑶', kind: 'regex' }] }],
      '苏小瑶来了',
      cfg,
    )
    expect(variant.triggers[0]).toMatchObject({ ref: SU, score: 0.85 })

    const broken = detectKeywordTriggers(
      [{ ref: SU, name: '苏瑶', aliases: [{ text: '([', kind: 'regex' }] }],
      '苏瑶来了',
      cfg,
    )
    expect(broken.triggers[0]).toMatchObject({ ref: SU, score: 1.0 }) // 回落主名
    expect(broken.parseFailures).toHaveLength(1)
    expect(broken.parseFailures[0]!.source).toContain('aliases[')
  })

  it('卡级排除词压制：重叠出现不触发，其余位置照常', () => {
    const card: RecallEntityCard = { ref: LIN, name: '老王', excludedPhrases: ['老王村'] }
    const suppressedOnly = detectKeywordTriggers([card], '老王村的传说', cfg)
    expect(suppressedOnly.triggers).toEqual([])

    const mixed = detectKeywordTriggers([card], '老王村口站着老王', cfg)
    expect(mixed.triggers[0]).toMatchObject({ ref: LIN, score: 1.0 })
  })

  it('caseSensitive 默认 false 仅影响拉丁字母，可按规则覆盖', () => {
    const aiCard: RecallEntityCard = {
      ref: 'concept:ai-core',
      name: 'AI 核心',
      aliases: [{ text: 'AI', kind: 'exact' }], // 默认大小写不敏感
    }
    const hit = detectKeywordTriggers([aiCard], '他把 ai 当工具', cfg)
    expect(hit.triggers).toHaveLength(1)
    expect(hit.triggers[0]).toMatchObject({ ref: 'concept:ai-core', score: 0.85, keys: ['AI'] })

    const strict: RecallEntityCard = {
      ref: 'concept:ai-core',
      name: '内核',
      aliases: [{ text: 'Core', kind: 'exact', caseSensitive: true }],
    }
    expect(detectKeywordTriggers([strict], 'core 崩了', cfg).triggers).toHaveLength(0)
    expect(detectKeywordTriggers([strict], 'Core 崩了', cfg).triggers).toHaveLength(1)
  })
})

/* ----------------------------------------------------------------------------
 * 合并：raw 分 max + 胜出证据 + 跨通道救援抑制
 * -------------------------------------------------------------------------- */

describe('AC③ raw 分 max 合并记胜出证据', () => {
  const dual = (draftText: string) =>
    recallKeywordAndGraph({
      draftText,
      cards: [linCard],
      snapshot: snap({ temporalFact: [mkFact(LIN)] }),
      scope: SCOPE,
    })

  it('精确平局走 merge.priority：主名 1.0 平图卡 1.0 ⇒ keyword 证据胜出', () => {
    const result = dual('林枫出场。')
    const card = result.candidates.filter((c) => c.id === LIN)
    expect(card).toHaveLength(1)
    expect(card[0]!.channel).toBe('keyword')
    expect(card[0]!.activation).toEqual({ kind: 'keyword', keys: ['林枫'] })
  })

  it('别名 0.85 低于图卡 1.0 ⇒ graph_khop 证据胜出且分数取 max', () => {
    const result = dual('枫儿出场。')
    const card = result.candidates.filter((c) => c.id === LIN)
    expect(card).toHaveLength(1)
    expect(card[0]!.channel).toBe('graph_khop')
    expect(card[0]!.relevanceScore).toBe(1.0)
    expect(card[0]!.activation).toMatchObject({ kind: 'graph_khop', sourceEntity: LIN })
  })

  it('跨通道救援：被图阈值淘汰的事实被他通道救回后撤销淘汰记录', () => {
    const rescuedId = factAt(980)
    const result = mergeRecallChannels([
      { channel: 'graph_khop', entries: [], exclusions: [{ identifier: rescuedId, reason: 'relevance_below_threshold', channel: 'graph_khop' }] },
      {
        channel: 'embedding',
        entries: [
          {
            id: rescuedId,
            tier: 'active_fact',
            relevanceScore: 0.92,
            content: 'x',
            activation: { kind: 'embedding', score: 0.92 },
          },
        ],
      },
    ])
    expect(result.candidates.map((c) => c.id)).toEqual([rescuedId])
    expect(result.candidates[0]!.channel).toBe('embedding')
    expect(result.excluded).toEqual([])
  })
})

/* ----------------------------------------------------------------------------
 * 错误模式：空触发集静默返回空
 * -------------------------------------------------------------------------- */

describe('空触发静默', () => {
  it('无命中文本 ⇒ 空候选空淘汰', () => {
    const result = recallKeywordAndGraph({
      draftText: '风起了。',
      cards: [linCard],
      snapshot: snap({ temporalFact: [mkFact(LIN)] }),
      scope: SCOPE,
    })
    expect(result.candidates).toEqual([])
    expect(result.excluded).toEqual([])
  })
})
