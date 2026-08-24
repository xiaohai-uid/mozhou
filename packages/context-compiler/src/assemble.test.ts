/**
 * 两阶段 Reserved 预算装配测试（实现票 #23 / T7）。
 *
 * 验收对照（issue #23）：
 *   - 设定洪泛场景下正文配额守得住（超载用例断言 quota，INV-3）；
 *   - 同输入两次装配结果完全一致（可复算纪律，INV-1）；
 *   - 每个淘汰条目携带合法 ExclusionReason（六值枚举）；
 *   - 前缀完备性 / 拒绝 skip-ahead（INV-2）、原子免截断不免淘汰（INV-4）、
 *     收敛有界且绝不静默截正文（INV-5）、双原因码互斥判定、
 *     配置错误 fail loudly、真召回输出直通装配（T8a 上游契约）。
 * 全部 hermetic：确定性假 tokenizer + 确定性夹具，零 IO 零 LLM 零时钟。
 */
import { describe, expect, it } from 'vitest'
import type {
  ActivationEvidence,
  AssemblyChannel,
  BookId,
  ContextReceiptId,
  EntityRef,
  ExclusionReason,
  FactId,
  FactImportance,
  FactValue,
  NarrativeStateSnapshot,
  RelationshipState,
  RelationshipStateId,
  TemporalFact,
  TimelineEvent,
  TimelineEventId,
} from '@mozhou/kernel'
import {
  CompileConfigError,
  TokenizerUnavailable,
  assembleBudgetedContext,
  type AssembleInput,
  type ExactTokenizer,
  type ReceiptIdentity,
} from './assemble.js'
import { recallCandidates, type RecallEntityCard, type RecallResult, type RecallTier } from './recall.js'

/* ----------------------------------------------------------------------------
 * 确定性夹具
 * -------------------------------------------------------------------------- */

/** 字长计量器（UTF-16 长度；分隔符 '\n' 计 1）。加性计数器下收敛循环不触发。 */
const charTok: ExactTokenizer = { version: 'fake-char-v1', count: (text) => text.length }

/**
 * 跨界漂移计量器：拼接缝 '\nB' 序列额外计 9 token——模拟真实 BPE 的跨界合并
 * 漂移（Σ分段 ≠ 整包），专用于触发 Phase 2 收敛循环。
 */
const driftTok: ExactTokenizer = {
  version: 'fake-drift-v1',
  count(text) {
    let total = text.length
    let at = text.indexOf('\nB')
    while (at !== -1) {
      total += 9
      at = text.indexOf('\nB', at + 2)
    }
    return total
  },
}

const BOOK_ID = 'book_01JFIXTUREBOOK00000000MOZHOU' as unknown as BookId
const RECEIPT_ID = 'rcpt_01JFIXEDRCPT000000000MOZHOU' as unknown as ContextReceiptId
const IDENTITY: ReceiptIdentity = {
  receiptId: RECEIPT_ID,
  bookId: BOOK_ID,
  createdAtIso: '2026-08-24T00:00:00.000Z',
}

/** 基准窗口核算（charTok）：W=4096 ⇒ R_out=1024 ⇒ B_total=4096−1024−64=3008；
 *  结构层两段各渲染 50 ⇒ B_struct=100；S_floor(chapter_writing)=⌈0.4×3008⌉=1204；
 *  B_pool=3008−100−1204=1704。 */
const WINDOW = 4096
const STRUCTURAL_100 = {
  sections: [
    { section: 'author_intent', content: 'A'.repeat(49) },
    { section: 'task_frame', content: 'B'.repeat(49) },
  ],
}

let seq = 0
function cand(
  tier: RecallTier,
  score: number,
  contentChars: number,
  opts: {
    id?: string
    pinned?: boolean
    atomicOverride?: boolean
    channel?: AssemblyChannel
    activation?: ActivationEvidence
    content?: string
  } = {},
) {
  seq += 1
  const id = opts.id ?? `fact_${String(seq).padStart(4, '0')}`
  return {
    id,
    tier,
    channel: opts.channel ?? 'graph_khop',
    relevanceScore: score,
    ...(opts.pinned === undefined ? {} : { pinned: opts.pinned }),
    ...(opts.atomicOverride === undefined ? {} : { atomicOverride: opts.atomicOverride }),
    ...(opts.activation === undefined ? {} : { activation: opts.activation }),
    content: opts.content ?? 'e'.repeat(contentChars),
  }
}

function baseInput(overrides: Partial<AssembleInput>): AssembleInput {
  return {
    task: { type: 'chapter_writing', chapterIndex: 42 },
    modelProfile: { id: 'test-model', contextWindow: WINDOW },
    tokenizer: charTok,
    recall: { candidates: [], excluded: [], parseFailures: [], },
    structural: STRUCTURAL_100,
    receiptIdentity: IDENTITY,
    ...overrides,
  }
}

const ALL_EXCLUSION_REASONS: readonly ExclusionReason[] = [
  'budget_exhausted',
  'relevance_below_threshold',
  'pov_filtered',
  'interval_not_active',
  'story_text_quota_protected',
  'duplicate',
]

/* ----------------------------------------------------------------------------
 * 三层预扣与基础核算
 * -------------------------------------------------------------------------- */

describe('Phase 0 三层预扣', () => {
  it('输出预留/结构层/保底配额逐项核算，条目渲染含分隔符开销', () => {
    const { packet, receipt } = assembleBudgetedContext(
      baseInput({
        recall: { candidates: [cand('world_rule', 0.9, 30)], excluded: [], parseFailures: [], },
        storyText: [],
      }),
    )
    // S_floor = ⌈0.4 × 3008⌉ = 1204
    expect(receipt.storyTextQuota.reservedTokens).toBe(1204)
    // world_rule 渲染 31 ≤ cap 512 ⇒ 不截断，trimType 'none'
    expect(packet.settings).toHaveLength(1)
    expect(packet.settings[0]).toMatchObject({ tokens: 31, trimType: 'none' })
    expect(packet.story).toMatchObject({ tokens: 0, trimType: 'none' })
    expect(packet.totalTokens).toBe(100 + 31)
    expect(receipt.totalTokens).toBe(packet.totalTokens)
    const reserveRow = receipt.entries.find((entry) => entry.stage === 'reserve')
    expect(reserveRow).toMatchObject({ included: true, reservedTokens: 31, tokens: 31 })
  })

  it('任务配额比例表：scene_beat/fact_extraction 各按比例预扣', () => {
    const sceneBeat = assembleBudgetedContext(baseInput({ task: { type: 'scene_beat' } }))
    expect(sceneBeat.receipt.storyTextQuota.reservedTokens).toBe(Math.ceil(0.3 * 3008))
    const extraction = assembleBudgetedContext(baseInput({ task: { type: 'fact_extraction' } }))
    expect(extraction.receipt.storyTextQuota.reservedTokens).toBe(Math.ceil(0.1 * 3008))
  })

  it('无精确 tokenizer 的模型拒绝装配（TokenizerUnavailable）', () => {
    expect(() =>
      assembleBudgetedContext(baseInput({ tokenizer: undefined, modelProfile: { id: 'no-tok-model', contextWindow: 4096 } })),
    ).toThrow(TokenizerUnavailable)
  })

  it('结构层爆顶 / 竞争池挤干均 fail loudly（CompileConfigError）', () => {
    expect(() =>
      assembleBudgetedContext(baseInput({ structural: { sections: [{ section: 'intent', content: 'A'.repeat(4096) }] } })),
    ).toThrow(CompileConfigError)
    expect(() =>
      assembleBudgetedContext(
        baseInput({
          // B_struct=1401 ⇒ B_pool=3008−1401−1204=403 < 512
          structural: { sections: [{ section: 'intent', content: 'A'.repeat(1400) }] },
        }),
      ),
    ).toThrow(/pool/)
  })
})

/* ----------------------------------------------------------------------------
 * AC① 设定洪泛：正文配额守得住（INV-3）
 * -------------------------------------------------------------------------- */

describe('AC① 设定洪泛场景正文配额守恒', () => {
  /** 12 张实体卡 × 渲染 200 token：前缀装得下 8 张（1600 ≤ B_pool 1704）。 */
  function floodRecall(): RecallResult {
    return {
      candidates: Array.from({ length: 12 }, (_, index) => cand('entity_card', 0.99 - index * 0.01, 199)),
      excluded: [],
      parseFailures: [],
    }
  }

  it('竞争池硬顶生效：设定总量 ≤ B_pool，正文保尾后仍 ≥ S_floor', () => {
    const { packet, receipt } = assembleBudgetedContext(
      baseInput({ recall: floodRecall(), storyText: ['S'.repeat(5000)] }),
    )

    // 前缀完备：恰好 8 张入选
    expect(packet.settings).toHaveLength(8)
    const settingTokens = packet.settings.reduce((sum, entry) => sum + entry.tokens, 0)
    expect(settingTokens).toBe(1600)
    expect(settingTokens).toBeLessThanOrEqual(1704) // INV-3 上半句

    // 正文保尾：丢最旧留最新，实际占用 1308 ≥ S_floor 1204（INV-3 下半句）
    expect(packet.story.trimType).toBe('truncated')
    expect(packet.story.tokens).toBe(3008 - 100 - 1600)
    expect(packet.story.tokens).toBeGreaterThanOrEqual(receipt.storyTextQuota.reservedTokens)
    expect(receipt.storyTextQuota.actualTokens).toBe(packet.story.tokens)
    expect(packet.text.endsWith(packet.story.text)).toBe(true)
  })

  it('序贯止步的首个落选者携带 story_text_quota_protected（判定点唯一）', () => {
    const recall = floodRecall()
    const ninthId = recall.candidates[8]!.id
    const { receipt } = assembleBudgetedContext(baseInput({ recall }))
    const stopper = receipt.entries.find((entry) => entry.identifier === ninthId)
    expect(stopper).toMatchObject({
      stage: 'reserve',
      included: false,
      exclusionReason: 'story_text_quota_protected',
      trimType: 'none',
    })
  })

  it('拒绝 skip-ahead：止步位之后的更小候选不得复活（INV-2）', () => {
    // a(50) b(50) 入选；c 为 1800 token 原子事实卡住池（remNoQuota 尚容得下 ⇒ 配额保护）；
    // d(50) 在止步位之后，纵然装得下也绝不入包。
    // 注意：a/b 用 entity_card 与 c 同 rank1 且分数更高，确保预订序为 a→b→c。
    const { packet, receipt } = assembleBudgetedContext(
      baseInput({
        recall: {
          candidates: [
            cand('entity_card', 0.95, 49, { id: 'fact_a' }),
            cand('entity_card', 0.9, 49, { id: 'fact_b' }),
            cand('active_fact', 0.85, 1799, { id: 'fact_c' }),
            cand('world_rule', 0.6, 49, { id: 'fact_d' }),
          ],
          excluded: [],
          parseFailures: [],
        },
      }),
    )
    expect(packet.settings.map((entry) => entry.identifier)).toEqual(['fact_a', 'fact_b'])
    expect(receipt.entries.some((entry) => entry.identifier === 'fact_d')).toBe(false)
    const stopper = receipt.entries.find((entry) => entry.identifier === 'fact_c')
    expect(stopper).toMatchObject({ included: false, exclusionReason: 'story_text_quota_protected' })
  })

  it('连配额免除预算都装不下 ⇒ budget_exhausted（双原因码互斥）', () => {
    // 单张 3001 token 原子卡：> remNoQuota 2908 ⇒ 只能是 budget_exhausted
    const { receipt } = assembleBudgetedContext(
      baseInput({ recall: { candidates: [cand('entity_card', 1, 3000)], excluded: [], parseFailures: [], } }),
    )
    const stopper = receipt.entries.find((entry) => entry.stage === 'reserve' && !entry.included)
    expect(stopper?.exclusionReason).toBe('budget_exhausted')
  })
})

/* ----------------------------------------------------------------------------
 * AC② 可复算纪律（INV-1）
 * -------------------------------------------------------------------------- */

describe('AC② 同输入两次装配完全一致', () => {
  const sharedInput = baseInput({
    recall: {
      candidates: [
        cand('entity_card', 0.95, 120, { pinned: true }),
        cand('active_fact', 0.9, 80),
        cand('world_rule', 0.85, 700),
        cand('distant_recall', 0.5, 300),
      ],
      excluded: [
        { identifier: 'fact_ghost', reason: 'pov_filtered', channel: 'graph_khop' },
        { identifier: 'concept:mist', reason: 'relevance_below_threshold' },
      ],
      parseFailures: [],
    },
    storyText: ['第一章正文切片。', '第二章正文切片。'],
  })

  it('packet 与 receipt 逐字节相同，recomputationHash 相等', () => {
    const first = assembleBudgetedContext(sharedInput)
    const second = assembleBudgetedContext(sharedInput)
    expect(JSON.stringify(first.packet)).toBe(JSON.stringify(second.packet))
    expect(JSON.stringify(first.receipt)).toBe(JSON.stringify(second.receipt))
    expect(first.receipt.recomputationHash).toBe(second.receipt.recomputationHash)
  })

  it('身份信封在重放契约之外：不同 receiptId/createdAt 不动哈希', () => {
    const renamed = assembleBudgetedContext({
      ...sharedInput,
      receiptIdentity: {
        receiptId: 'rcpt_01JOTHERRCPT000000000MOZHOU' as unknown as ContextReceiptId,
        bookId: BOOK_ID,
        createdAtIso: '2027-01-01T00:00:00.000Z',
      },
    })
    const baseline = assembleBudgetedContext(sharedInput)
    expect(renamed.receipt.id).not.toBe(baseline.receipt.id)
    expect(renamed.receipt.recomputationHash).toBe(baseline.receipt.recomputationHash)
  })

  it('重放输入面归档 desirability 终序 + 内容摘要 + 版本组', () => {
    const { receipt } = assembleBudgetedContext(sharedInput)
    expect(receipt.inputsDigest).toBeTypeOf('string')
    expect(receipt.replayInputs.tokenizerVersion).toBe(charTok.version)
    expect(receipt.replayInputs.modelProfileId).toBe('test-model')
    expect(receipt.replayInputs.contextWindowTokens).toBe(WINDOW)
    const replayScores = receipt.replayInputs.candidates.map((candidate) => candidate.relevanceScore)
    expect([...replayScores].sort((a, b) => b - a)).toEqual(replayScores) // 终序即降序
    expect(receipt.replayInputs.candidates[0]).toMatchObject({ pinned: true, channel: 'graph_khop' })
    expect(receipt.replayInputs.structuralSections).toHaveLength(2)
    expect(receipt.replayInputs.storyTextSlices).toHaveLength(2)
    expect(receipt.assembledBy).toBe('server')
    expect(receipt.revision).toBe(0)
  })
})

/* ----------------------------------------------------------------------------
 * AC③ 淘汰原因码合法性
 * -------------------------------------------------------------------------- */

describe('AC③ 每个淘汰条目携带合法 ExclusionReason', () => {
  it('recall_filter 透传 + reserve 止步的全量淘汰面逐条校验六值枚举', () => {
    const { receipt } = assembleBudgetedContext(
      baseInput({
        recall: {
          candidates: Array.from({ length: 12 }, (_, index) => cand('entity_card', 0.99 - index * 0.01, 199)),
          excluded: [
            { identifier: 'fact_secret', reason: 'pov_filtered', channel: 'graph_khop' },
            { identifier: 'fact_expired', reason: 'interval_not_active', channel: 'graph_khop' },
            { identifier: 'concept:fog', reason: 'relevance_below_threshold' },
            { identifier: 'fact_twice', reason: 'duplicate', channel: 'keyword' },
          ],
          parseFailures: [],
        },
        storyText: ['S'.repeat(5000)],
      }),
    )
    for (const entry of receipt.entries) {
      if (entry.included) {
        expect(entry.exclusionReason ?? undefined).toBeUndefined()
      } else {
        expect(entry.exclusionReason).toBeDefined()
        expect(ALL_EXCLUSION_REASONS).toContain(entry.exclusionReason)
      }
    }
    // recall_filter 透传块殿后，四条全数在场且原因原样保留
    const passthrough = receipt.entries.filter((entry) => entry.stage === 'recall_filter')
    expect(passthrough).toHaveLength(4)
    const tailStart = receipt.entries.findIndex((entry) => entry.stage === 'recall_filter')
    expect(tailStart + passthrough.length).toBe(receipt.entries.length)
    // 序贯止步者恰一条，位于预订块末尾
    const reserveRows = receipt.entries.filter((entry) => entry.stage === 'reserve')
    expect(reserveRows.filter((row) => !row.included)).toHaveLength(1)
  })
})

/* ----------------------------------------------------------------------------
 * Desirability 全序 · 原子语义 · 截断
 * -------------------------------------------------------------------------- */

describe('desirability 全序与终态化', () => {
  it('pin 提队首但不豁免淘汰序；tier rank 与分数依次收口', () => {
    const { receipt } = assembleBudgetedContext(
      baseInput({
        recall: {
          candidates: [
            cand('active_fact', 0.1, 20, { id: 'prom_m3', pinned: true }),
            cand('entity_card', 0.99, 20, { id: 'card_m1' }),
            cand('entity_card', 0.95, 20, { id: 'card_m2' }),
          ],
          excluded: [],
          parseFailures: [],
        },
      }),
    )
    const order = receipt.entries.filter((entry) => entry.stage === 'reserve').map((entry) => entry.identifier)
    expect(order).toEqual(['prom_m3', 'card_m1', 'card_m2'])
  })

  it('同 tier 同分平局以 id 字典序收口（零额外状态）', () => {
    const { receipt } = assembleBudgetedContext(
      baseInput({
        recall: {
          candidates: [
            cand('entity_card', 0.8, 10, { id: 'fact_b' }),
            cand('entity_card', 0.8, 10, { id: 'fact_a' }),
          ],
          excluded: [],
          parseFailures: [],
        },
      }),
    )
    const order = receipt.entries.filter((entry) => entry.stage === 'reserve').map((entry) => entry.identifier)
    expect(order).toEqual(['fact_a', 'fact_b'])
  })

  it('truncated 档留头截断到层帽；未触帽记 trimType none（INV-4 无半截原子）', () => {
    const { packet } = assembleBudgetedContext(
      baseInput({
        recall: {
          candidates: [cand('world_rule', 0.9, 600, { id: 'rule_big' }), cand('world_rule', 0.8, 100, { id: 'rule_small' })],
          excluded: [],
          parseFailures: [],
        },
      }),
    )
    const big = packet.settings.find((entry) => entry.identifier === 'rule_big')
    expect(big).toMatchObject({ tokens: 512, trimType: 'truncated' })
    expect(big?.text.startsWith('e')).toBe(true) // 留头（夹具填充字符为 'e'）
    const small = packet.settings.find((entry) => entry.identifier === 'rule_small')
    expect(small).toMatchObject({ tokens: 101, trimType: 'none' })
  })

  it('超大原子条目整体出局且不出半截（免截断不免淘汰）', () => {
    const huge = 'x'.repeat(3000)
    const { packet, receipt } = assembleBudgetedContext(
      baseInput({
        recall: { candidates: [cand('entity_card', 1, 0, { id: 'card_huge', atomicOverride: true, content: huge })], excluded: [], parseFailures: [], },
      }),
    )
    expect(packet.settings).toHaveLength(0)
    expect(packet.text.includes(huge.slice(0, 100))).toBe(false)
    const row = receipt.entries.find((entry) => entry.identifier === 'card_huge')
    expect(row).toMatchObject({ stage: 'reserve', included: false, exclusionReason: 'budget_exhausted', trimType: 'none' })
  })

  it('pin 超池照常出局：pin ≠ 豁免，且序贯止步牺牲其后一切候选', () => {
    // pinned_huge（3501）按 pinned DESC 排在预订序首位即爆池 ⇒ 序贯止步；
    // 其后的 card_small 纵然极小也从未被评估——前缀完备性的另一面。
    const { packet, receipt } = assembleBudgetedContext(
      baseInput({
        recall: {
          candidates: [
            cand('entity_card', 0.5, 20, { id: 'card_small' }),
            cand('entity_card', 1.0, 0, {
              id: 'card_pinned_huge',
              pinned: true,
              content: 'y'.repeat(3500),
            }),
          ],
          excluded: [],
          parseFailures: [],
        },
      }),
    )
    expect(packet.settings).toHaveLength(0)
    const rows = receipt.entries.filter((entry) => entry.stage === 'reserve')
    expect(rows.find((row) => row.identifier === 'card_small')).toBeUndefined()
    expect(rows.find((row) => row.identifier === 'card_pinned_huge')).toMatchObject({
      included: false,
      exclusionReason: 'budget_exhausted',
    })
    // 原子超大 pin 整体出局，packet 无半截文本（INV-4）
    expect(packet.text.includes('y'.repeat(100))).toBe(false)
  })
})

/* ----------------------------------------------------------------------------
 * Phase 2 收敛循环（跨界漂移兜底，INV-5）
 * -------------------------------------------------------------------------- */

describe('放置收敛：跨界合并漂移由收敛循环兜底', () => {
  it('可收缩 victim 减半收缩，正文段绝不动刀', () => {
    // driftTok 下整包 = 3008 + 3 处 '\nB' 缝 × 9 = 3035 > B_total ⇒ 触发收敛；
    // victim = desirability 最低的 rule_c（truncated 类可再截）301 → 150。
    const { packet, receipt } = assembleBudgetedContext(
      baseInput({
        tokenizer: driftTok,
        structural: { sections: [{ section: 'author_intent', content: 'A'.repeat(29) }] },
        recall: {
          candidates: [
            cand('world_rule', 0.9, 0, { id: 'rule_a', content: 'B' + 'c'.repeat(299) }),
            cand('world_rule', 0.8, 0, { id: 'rule_b', content: 'B' + 'c'.repeat(299) }),
            cand('world_rule', 0.7, 0, { id: 'rule_c', content: 'B' + 'c'.repeat(299) }),
          ],
          excluded: [],
          parseFailures: [],
        },
        storyText: ['S'.repeat(3000)],
      }),
    )
    expect(packet.totalTokens).toBeLessThanOrEqual(3008)
    expect(packet.totalTokens).toBe(receipt.totalTokens)
    const convergedRow = receipt.entries.find((entry) => entry.stage === 'converge' && entry.identifier === 'rule_c')
    expect(convergedRow).toMatchObject({ included: true, trimType: 'truncated' })
    expect(convergedRow?.tokens).toBeLessThan(301)
    // 收敛只动设定条目：正文占用保持预收敛值
    expect(packet.story.tokens).toBe(2075)
    // 其余条目仍在 reserve 段原样发射
    expect(receipt.entries.filter((entry) => entry.stage === 'reserve' && entry.included)).toHaveLength(2)
  })

  it('全原子无可收缩时按 desirability 升序淘汰（converge 段记 budget_exhausted）', () => {
    const { packet, receipt } = assembleBudgetedContext(
      baseInput({
        tokenizer: driftTok,
        structural: { sections: [{ section: 'author_intent', content: 'A'.repeat(29) }] },
        recall: {
          candidates: [
            cand('entity_card', 0.9, 0, { id: 'card_a', content: 'B' + 'c'.repeat(498) }),
            cand('entity_card', 0.8, 0, { id: 'card_b', content: 'B' + 'c'.repeat(498) }),
            cand('entity_card', 0.7, 0, { id: 'card_c', content: 'B' + 'c'.repeat(498) }),
          ],
          excluded: [],
          parseFailures: [],
        },
        storyText: ['S'.repeat(1477)],
      }),
    )
    expect(packet.totalTokens).toBeLessThanOrEqual(3008)
    expect(packet.settings.map((entry) => entry.identifier)).toEqual(['card_a', 'card_b'])
    const evicted = receipt.entries.find((entry) => entry.stage === 'converge' && entry.identifier === 'card_c')
    expect(evicted).toMatchObject({ included: false, exclusionReason: 'budget_exhausted', trimType: 'none' })
    expect(packet.story.tokens).toBe(1478) // 正文毫发无损
  })
})

/* ----------------------------------------------------------------------------
 * Receipt 条目序与物理格式约束
 * -------------------------------------------------------------------------- */

describe('receipt 确定性条目序', () => {
  it('structural → reserve（含原位落选者）→ converge → story_text → recall_filter', () => {
    // driftTok 下三张原子卡 + 正文顶满 B_total ⇒ 收敛淘汰 desirability 最低的 card_c
    const { receipt } = assembleBudgetedContext(
      baseInput({
        tokenizer: driftTok,
        structural: { sections: [{ section: 'author_intent', content: 'A'.repeat(29) }] },
        recall: {
          candidates: [
            cand('entity_card', 0.9, 0, { id: 'card_a', content: 'B' + 'c'.repeat(498) }),
            cand('entity_card', 0.8, 0, { id: 'card_b', content: 'B' + 'c'.repeat(498) }),
            cand('entity_card', 0.7, 0, { id: 'card_c', content: 'B' + 'c'.repeat(498) }),
          ],
          excluded: [{ identifier: 'fact_ghost', reason: 'pov_filtered' }],
          parseFailures: [],
        },
        storyText: ['S'.repeat(1477)],
      }),
    )
    expect(receipt.entries.map((entry) => entry.stage)).toEqual([
      'structural',
      'reserve',
      'reserve',
      'converge',
      'story_text',
      'recall_filter',
    ])
    expect(receipt.entries.map((entry) => entry.order)).toEqual([0, 1, 2, 3, 4, 5])
    expect(receipt.parseFailures).toEqual([])
  })
})

/* ----------------------------------------------------------------------------
 * 吃真实召回候选（T8a 双通道上游契约）
 * -------------------------------------------------------------------------- */

const T0 = '2026-08-24T00:00:00.000Z'
const HEAD = { bookId: BOOK_ID, revision: 0, createdAt: T0, updatedAt: T0 }

function factFixture(
  id: string,
  subject: EntityRef,
  predicate: string,
  value: FactValue,
  importance: FactImportance = 'critical',
): TemporalFact {
  return {
    id: id as FactId,
    ...HEAD,
    subject,
    predicate,
    value,
    validFrom: 1,
    validUntil: null,
    importance,
    riskClass: importance === 'critical' ? 'high' : 'low',
    source: { kind: 'chapter', chapterIndex: 3 },
    status: 'confirmed',
    compactedIntoVolumeId: null,
    provenance: { origin: 'author', protectedUserContent: false },
  }
}

function integrationSnapshot(): NarrativeStateSnapshot {
  const f1 = factFixture('fact_f1', 'char:lin-xuan', '持有', 'item:qingyun-jian')
  const f2 = factFixture('fact_f2', 'char:yin-que', '身份', '青云殿首席', 'notable')
  const rel: RelationshipState = {
    id: 'rels_01' as RelationshipStateId,
    ...HEAD,
    entityA: 'char:lin-xuan',
    entityB: 'char:yin-que',
    relationshipType: '盟友',
    affinityScore: 80,
    validFrom: 1,
    validUntil: null,
    sourceChapterIndex: 3,
  }
  const evt: TimelineEvent = {
    id: 'tle_01' as TimelineEventId,
    ...HEAD,
    worldTimeLabel: '第三章·夜袭',
    worldTimeOrder: 3,
    chapterIndex: 3,
    locationRef: 'location:tianyan-city',
    participants: ['char:lin-xuan', 'char:yin-que'],
    summary: '夜袭天眼城',
    impactFactIds: [f1.id],
  }
  return {
    facts: new Map<FactId, TemporalFact>([
      [f1.id, f1],
      [f2.id, f2],
    ]),
    knowledgeStates: new Map(),
    relationships: new Map<RelationshipStateId, RelationshipState>([[rel.id, rel]]),
    timelineEvents: new Map<TimelineEventId, TimelineEvent>([[evt.id, evt]]),
  }
}

describe('真召回直通装配（上游 = 双通道召回输出）', () => {
  const cards: RecallEntityCard[] = [
    { ref: 'char:lin-xuan', name: '林晚', aliases: [{ text: '晚姐', kind: 'exact' }], brief: '青云剑主，主角。' },
  ]

  function runIntegration(): Promise<ReturnType<typeof assembleBudgetedContext>> {
    return recallCandidates({
      draftText: '林晚握紧手中剑。晚姐从不后退。',
      cards,
      snapshot: integrationSnapshot(),
      scope: { chapterIndex: 5, pov: 'protagonist' },
    }).then((recall) => {
      expect(recall.candidates.length).toBeGreaterThan(0)
      return assembleBudgetedContext(
        baseInput({
          modelProfile: { id: 'local-32k', contextWindow: 32768 },
          recall,
          structural: { sections: [{ section: 'author_intent', content: '主线：夺回青云剑。' }] },
          storyText: ['林晚跃上天眼城墙。'],
        }),
      )
    })
  }

  it('召回候选进包，通道证据随条目入 Receipt，复算哈希稳定', async () => {
    const first = await runIntegration()
    expect(first.packet.settings.some((entry) => entry.identifier === 'char:lin-xuan')).toBe(true)

    const channels = new Set(first.receipt.entries.flatMap((entry) => (entry.assemblySource ? [entry.assemblySource] : [])))
    expect(channels.size).toBeGreaterThan(0)
    for (const channel of channels) {
      expect(['structural', 'keyword', 'graph_khop', 'embedding', 'manual_pin']).toContain(channel)
    }
    for (const entry of first.receipt.entries) {
      if (entry.stage === 'reserve' && entry.included) {
        expect(entry.reservedTokens).toBe(entry.tokens)
      }
      if (!entry.included) {
        expect(ALL_EXCLUSION_REASONS).toContain(entry.exclusionReason)
      }
    }

    const second = await runIntegration()
    expect(second.receipt.recomputationHash).toBe(first.receipt.recomputationHash)
    expect(JSON.stringify(second.packet)).toBe(JSON.stringify(first.packet))
  })

  it('激活证据类型化随行：keyword/graph_khop 形状合法', async () => {
    const { receipt } = await runIntegration()
    const activations = receipt.entries.flatMap((entry) => (entry.activation ? [entry.activation] : []))
    expect(activations.length).toBeGreaterThan(0)
    for (const activation of activations) {
      if (activation.kind === 'keyword') {
        expect(activation.keys.length).toBeGreaterThan(0)
      } else if (activation.kind === 'graph_khop') {
        expect(activation.hops).toBeGreaterThan(0)
      }
    }
  })
})

/* ----------------------------------------------------------------------------
 * T9 #25：解析失败逐条入 Receipt + replayInputs 归档激活证据
 * -------------------------------------------------------------------------- */

describe('T9 解析失败逐条与重放面增补', () => {
  it('recall.parseFailures 原样透传：每个失败引用一条独立记录，不聚合不计数', () => {
    const parseFailures = [
      { source: 'char:su[aliases[0]]', detail: 'invalid regex: unmatched bracket' },
      { source: 'faction:yun[aliases[2]]', detail: 'invalid regex: dangling quantifier' },
    ]
    const { receipt } = assembleBudgetedContext(
      baseInput({
        recall: { candidates: [], excluded: [], parseFailures },
      }),
    )
    expect(receipt.parseFailures).toEqual(parseFailures)
    expect(receipt.parseFailures).toHaveLength(2)
    for (const failure of receipt.parseFailures) {
      expect(failure.source).toBeTruthy()
      expect(failure.detail).toBeTruthy()
    }
  })

  it('replayInputs.candidates 归档激活证据（converge 淘汰者的证据唯一载体）', () => {
    const { receipt } = assembleBudgetedContext(
      baseInput({
        recall: {
          candidates: [
            cand('entity_card', 1, 30, { id: 'card_x', channel: 'keyword', activation: { kind: 'keyword', keys: ['林枫'] } }),
            cand('world_rule', 0.9, 30, { id: 'rule_y', channel: 'embedding', activation: { kind: 'embedding', score: 0.9 } }),
          ],
          excluded: [],
          parseFailures: [],
        },
      }),
    )
    const archived = new Map(receipt.replayInputs.candidates.map((candidate) => [candidate.id, candidate]))
    expect(archived.get('card_x')?.activation).toEqual({ kind: 'keyword', keys: ['林枫'] })
    expect(archived.get('rule_y')?.activation).toEqual({ kind: 'embedding', score: 0.9 })
  })
})
