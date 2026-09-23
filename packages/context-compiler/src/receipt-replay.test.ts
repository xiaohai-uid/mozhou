/**
 * Receipt 重放引擎测试（实现票 #25 / T9）。
 *
 * 验收对照（issue #25）：
 *   - replayInputs 足以在 embedding 索引漂移后重放同一 desirability 终序（AC2）——
 *     relevanceScore 随重放面归档，重放不触召回通道；
 *   - 输入漂移 fail loudly 且定位到具体条目（候选/结构层/正文切片三分面，spec §3.1）；
 *   - 版本组不一致（tokenizer/config）拒绝重放；
 *   - INV-R6：inputsDigest 锚校验前置；
 *   - converge 淘汰者的激活证据随重放面归档 ⇒ 哈希跨淘汰复现（T9 kernel 增补的闭环）。
 * 全部 hermetic：确定性假 tokenizer + 确定性夹具，零 IO 零 LLM 零时钟。
 */
import { describe, expect, it } from 'vitest'
import type { BookId, ContextReceipt, ContextReceiptId } from '@mozhou/kernel'
import {
  assembleBudgetedContext,
  DEFAULT_BUDGET_ASSEMBLY_CONFIG,
  type AssembleInput,
  type ExactTokenizer,
  type ReceiptIdentity,
} from './assemble.js'
import {
  ReplayHashMismatchError,
  ReplayInputDriftError,
  replayReceiptFromInputs,
  ReplayVersionMismatchError,
  type ReplayContentResolver,
} from './receipt-replay.js'

/* ----------------------------------------------------------------------------
 * 确定性夹具
 * -------------------------------------------------------------------------- */

const charTok: ExactTokenizer = { version: 'fake-char-v1', count: (text) => text.length }

/** 跨界漂移计量器（与 assemble.test.ts 同款）：'\nB' 缝 +9，专用于触发收敛淘汰。 */
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

const SECTION_CONTENT = 'A'.repeat(49)
const STORY_SLICES = ['第一章正文切片。'.repeat(6), '第二章正文切片。'.repeat(6)]

function candidateFixture(id: string, content: string, score: number) {
  return {
    id,
    tier: 'entity_card' as const,
    channel: 'embedding' as const,
    relevanceScore: score,
    pinned: true,
    activation: { kind: 'embedding' as const, score },
    content,
  }
}

/** 富夹具：双候选（keyword/graph 证据）+ 排除透传 + 解析失败逐条 + 双正文切片。 */
function richInput(overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    task: { type: 'chapter_writing', chapterIndex: 42 },
    modelProfile: { id: 'test-model', contextWindow: 4096 },
    tokenizer: charTok,
    recall: {
      candidates: [
        {
          id: 'char:lin-xuan',
          tier: 'entity_card',
          channel: 'keyword',
          relevanceScore: 0.95,
          pinned: true,
          atomicOverride: true,
          activation: { kind: 'keyword', keys: ['林枫'] },
          content: 'L'.repeat(120),
        },
        {
          id: 'fact_0002',
          tier: 'active_fact',
          channel: 'graph_khop',
          relevanceScore: 0.8,
          activation: { kind: 'graph_khop', sourceEntity: 'char:lin-xuan', hops: 1, score: 0.8 },
          content: 'F'.repeat(80),
        },
      ],
      excluded: [{ identifier: 'concept:mist', reason: 'relevance_below_threshold' }],
      parseFailures: [
        { source: 'char:su[aliases[0]]', detail: 'invalid regex: unmatched bracket' },
      ],
    },
    structural: { sections: [{ section: 'author_intent', content: SECTION_CONTENT }] },
    storyText: STORY_SLICES,
    receiptIdentity: IDENTITY,
    ...overrides,
  }
}

/** 从装配输入构造忠实解析器（真源未漂移的基准态）。 */
function resolverFor(input: AssembleInput): ReplayContentResolver {
  return {
    candidateContent: (id) =>
      input.recall.candidates.find((candidate) => candidate.id === id)?.content,
    structuralSectionContent: (section) =>
      input.structural.sections.find((piece) => piece.section === section)?.content,
    storyTextSlices: () => [...(input.storyText ?? [])],
  }
}

/* ----------------------------------------------------------------------------
 * AC2 重放恒等
 * -------------------------------------------------------------------------- */

describe('AC2 replayInputs 重放同一 desirability 终序', () => {
  it('输入未漂移 → 重放 receipt 与原件深相等，终序与归档序一致', () => {
    const original = assembleBudgetedContext(richInput())
    const replayed = replayReceiptFromInputs(original.receipt, resolverFor(richInput()), {
      tokenizer: charTok,
    })

    expect(replayed.receipt).toEqual(original.receipt)
    expect(replayed.packet.totalTokens).toBe(original.packet.totalTokens)
    // 终序 = 归档 desirability 序（pinned DESC > tierRank > score DESC > id ASC）
    expect(replayed.receipt.replayInputs.candidates.map((candidate) => candidate.id)).toEqual(
      original.receipt.replayInputs.candidates.map((candidate) => candidate.id),
    )
    expect(replayed.receipt.recomputationHash).toBe(original.receipt.recomputationHash)
  })

  it('embedding 索引漂移后重放不受影响：分数走归档值而非现召', () => {
    const input = richInput()
    const original = assembleBudgetedContext(input)
    // 「索引已重建」的模拟：解析器只能提供当前内容；重放完全绕开召回通道，
    // relevanceScore 取 replayInputs 归档值 —— 分数是召回时点产物，非实体属性。
    const contentsOnly: ReplayContentResolver = {
      candidateContent: (id) =>
        id === 'fact_0002' ? 'F'.repeat(80) : id === 'char:lin-xuan' ? 'L'.repeat(120) : undefined,
      structuralSectionContent: () => SECTION_CONTENT,
      storyTextSlices: () => STORY_SLICES,
    }
    const replayed = replayReceiptFromInputs(original.receipt, contentsOnly, { tokenizer: charTok })
    expect(replayed.receipt).toEqual(original.receipt)
    // 条目证据取自归档（replayInputs → entries 原样重建），与任何「现召」结果无关
    const archivedActivationRow = replayed.receipt.entries.find(
      (entry) => entry.identifier === 'fact_0002' && entry.stage === 'reserve',
    )
    expect(archivedActivationRow?.activation).toEqual({ kind: 'graph_khop', sourceEntity: 'char:lin-xuan', hops: 1, score: 0.8 })
  })

  it('converge 淘汰者的激活证据随重放面归档 → 哈希跨淘汰复现', () => {
    // 三张原子卡（entity_card，不可收缩）+ 正文顶满 ⇒ 收敛循环只能原位淘汰
    // desirability 最低者；被淘汰者的 activation 在 receipt entries 中无第二载体，
    // 只随 replayInputs 归档（T9 kernel 增补位）——重放哈希必须仍然逐字节复现。
    const input = richInput({
      tokenizer: driftTok,
      recall: {
        candidates: [
          candidateFixture('card_a', 'B' + 'c'.repeat(498), 0.9),
          candidateFixture('card_b', 'B' + 'c'.repeat(498), 0.8),
          candidateFixture('card_c', 'B' + 'c'.repeat(498), 0.7),
        ],
        excluded: [],
        parseFailures: [],
      },
      storyText: ['S'.repeat(3000)],
    })
    const original = assembleBudgetedContext(input)
    const evicted = original.receipt.entries.find(
      (entry) => entry.stage === 'converge' && !entry.included,
    )
    expect(evicted?.identifier).toBe('card_c')

    const replayed = replayReceiptFromInputs(original.receipt, resolverFor(input), {
      tokenizer: driftTok,
    })
    expect(replayed.receipt).toEqual(original.receipt)
    expect(replayed.receipt.recomputationHash).toBe(original.receipt.recomputationHash)
  })
})

/* ----------------------------------------------------------------------------
 * 输入漂移与版本守卫
 * -------------------------------------------------------------------------- */

describe('漂移定位与版本守卫', () => {
  const base = () => assembleBudgetedContext(richInput()).receipt

  it('候选内容变异 → ReplayInputDriftError 指名该 id', () => {
    const receipt = base()
    const drifted: ReplayContentResolver = {
      ...resolverFor(richInput()),
      candidateContent: (id) => (id === 'fact_0002' ? 'F'.repeat(80) + '（外部追加）' : 'L'.repeat(120)),
    }
    try {
      replayReceiptFromInputs(receipt, drifted, { tokenizer: charTok })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayInputDriftError)
      expect((error as ReplayInputDriftError).surface).toBe('candidate')
      expect((error as ReplayInputDriftError).ref).toBe('fact_0002')
    }
  })

  it('候选退役（真源缺失）→ 显式漂移失败，绝不静默跳过', () => {
    const receipt = base()
    const retired: ReplayContentResolver = {
      ...resolverFor(richInput()),
      candidateContent: (id) => (id === 'char:lin-xuan' ? undefined : 'F'.repeat(80)),
    }
    try {
      replayReceiptFromInputs(receipt, retired, { tokenizer: charTok })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayInputDriftError)
      expect((error as ReplayInputDriftError).ref).toBe('char:lin-xuan')
    }
  })

  it('结构层 section 变异 / 正文切片数不符 → 各自指名漂移面', () => {
    const receipt = base()
    const badSection: ReplayContentResolver = {
      ...resolverFor(richInput()),
      structuralSectionContent: () => 'A'.repeat(48),
    }
    expect(() => replayReceiptFromInputs(receipt, badSection, { tokenizer: charTok })).toThrow(
      ReplayInputDriftError,
    )

    const badSlices: ReplayContentResolver = {
      ...resolverFor(richInput()),
      storyTextSlices: () => STORY_SLICES.slice(0, 1),
    }
    try {
      replayReceiptFromInputs(receipt, badSlices, { tokenizer: charTok })
      expect.unreachable()
    } catch (error) {
      expect((error as ReplayInputDriftError).surface).toBe('story_text_slice')
    }
  })

  it('tokenizer 版本不符 → ReplayVersionMismatchError(tokenizer)', () => {
    const receipt = base()
    const wrongTokenizer: ExactTokenizer = { version: 'fake-char-v2', count: (text) => charTok.count(text) }
    expect(() => replayReceiptFromInputs(receipt, resolverFor(richInput()), { tokenizer: wrongTokenizer })).toThrow(
      ReplayVersionMismatchError,
    )
  })

  it('config 与归档 configVersion 不符 → ReplayVersionMismatchError(config)', () => {
    const receipt = base()
    const divergedConfig = { ...structuredClone(DEFAULT_BUDGET_ASSEMBLY_CONFIG), marginTokens: DEFAULT_BUDGET_ASSEMBLY_CONFIG.marginTokens + 1 }
    expect(() =>
      replayReceiptFromInputs(receipt, resolverFor(richInput()), { tokenizer: charTok, config: divergedConfig }),
    ).toThrow(ReplayVersionMismatchError)
  })

  it('INV-R6：replayInputs 被篡改 → inputsDigest 锚前置失败', () => {
    const receipt = base()
    const tampered: ContextReceipt = {
      ...receipt,
      replayInputs: {
        ...receipt.replayInputs,
        contextWindowTokens: receipt.replayInputs.contextWindowTokens + 1,
      },
    }
    expect(() => replayReceiptFromInputs(tampered, resolverFor(richInput()), { tokenizer: charTok })).toThrow(
      /inputsDigest/,
    )
  })

  it('兜底硬断言位存在：哈希分歧抛 ReplayHashMismatchError（实现分歧不可静默）', () => {
    // 直接构造哈希错位的凭证触发兜底分支（正常确定性下不可达）
    const receipt = base()
    const corrupted: ContextReceipt = { ...receipt, recomputationHash: '0'.repeat(64), inputsDigest: receipt.inputsDigest }
    // inputsDigest 锚先过（未被篡改），随后内容全过、装配复现原件哈希 ≠ 被改写的期望值
    expect(() =>
      replayReceiptFromInputs(corrupted, resolverFor(richInput()), { tokenizer: charTok }),
    ).toThrow(ReplayHashMismatchError)
  })
})
