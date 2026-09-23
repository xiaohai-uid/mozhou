/**
 * 编译器全链路集成测试（实现票 #26 / T10a）。
 *
 * 验收对照（issue #26）：
 *   - AC② Always/Never 档在全链路中优先于检测逻辑（always 结构层常驻注入；
 *     never 先于检测出局，草稿提及亦不激活；detectedOff 跳过别名检测但图通道可达）；
 *   - AC① compile → 合法 Receipt 全字段：一证一文件落盘、指针事件追加、
 *     loadReceipt 往返无损、inputsDigest 锚定、同输入字节级复现；
 *   - AC③ 失败路径确定性错误面：召回空 ⇒ EmptyRecallError、预算溢出 ⇒
 *     ConvergenceError、Research 区卡 ⇒ CompileConfigError，绝不静默降级。
 * 全部 hermetic：临时目录 + 确定性夹具 + 注入时钟/凭证 id，零网络零 LLM。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  BookId,
  ContextReceiptId,
  EntityRef,
  ExclusionReason,
  FactId,
  NarrativeStateSnapshot,
} from '@mozhou/kernel'
import { foldNarrativeRows } from '@mozhou/kernel'
import {
  CompileConfigError,
  ConvergenceError,
  TokenizerUnavailable,
  canonicalJson,
  sha256Hex,
  type ExactTokenizer,
} from './assemble.js'
import { activateCards, compile, EmptyRecallError, type CompileCard } from './compile.js'
import { loadReceipt, serializeReceiptFile } from './receipt-file.js'

/* ----------------------------------------------------------------------------
 * 确定性夹具
 * -------------------------------------------------------------------------- */

/** 字长计量器（UTF-16 长度；分隔符 '\n' 计 1）。加性计数器下收敛循环不触发。 */
const charTok: ExactTokenizer = { version: 'fake-char-v1', count: (text) => text.length }

/**
 * 接缝惩罚计量器：拼接缝 '\nB' 每处额外计 10000——模拟极端跨界合并漂移，
 * 使收敛循环在 maxConvergeIter 内无法追平（专用于 ConvergenceError 用例）。
 */
const seamPenaltyTok: ExactTokenizer = {
  version: 'fake-seam-v1',
  count(text) {
    let total = text.length
    let at = text.indexOf('\nB')
    while (at !== -1) {
      total += 10000
      at = text.indexOf('\nB', at + 2)
    }
    return total
  },
}

const BOOK_ID = (() => {
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  let out = ''
  let value = 1
  for (let i = 0; i < 26; i += 1) {
    out = CROCKFORD[value % 32]! + out
    value = Math.floor(value / 32)
  }
  return `book_${out}` as unknown as BookId
})()
const RECEIPT_ID = `rcpt_${BOOK_ID.slice(5)}` as unknown as ContextReceiptId
const NOW = '2026-08-24T12:00:00.000Z'
const SCOPE = { chapterIndex: 5, pov: 'protagonist' as const }

let seq = 100
const factAt = (n: number): FactId => `fact_${String(n).padStart(26, '0')}` as FactId

function mkFact(
  subject: EntityRef,
  seed: Partial<{
    id: FactId
    predicate: string
    value: string | number | boolean
    importance: 'trivial' | 'notable' | 'critical'
  }> = {},
) {
  return {
    id: seed.id ?? factAt(seq++),
    bookId: BOOK_ID,
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    subject,
    predicate: seed.predicate ?? '状态',
    value: seed.value ?? '安好',
    validFrom: 1,
    validUntil: null,
    importance: seed.importance ?? ('critical' as const),
    riskClass: (seed.predicate ?? '状态').startsWith('secret.') ? ('high' as const) : ('low' as const),
    source: { kind: 'chapter' as const, chapterIndex: 1 },
    status: 'confirmed' as const,
    compactedIntoVolumeId: null,
    provenance: { origin: 'author' as const, protectedUserContent: false },
  }
}

const snapOf = (...facts: ReturnType<typeof mkFact>[]): NarrativeStateSnapshot =>
  foldNarrativeRows({ temporalFact: facts })

const LIN = 'char:lin-xuan' as EntityRef // detected
const SECT = 'faction:qingyun-sect' as EntityRef // always
const FORBIDDEN = 'char:mo-jun' as EntityRef // never
const OFF = 'concept:heart-sutra' as EntityRef // detectedOff

function baseCards(): CompileCard[] {
  return [
    {
      ref: LIN,
      name: '林枫',
      aiContext: 'detected',
      aliases: [
        { text: '枫儿', kind: 'exact' },
        { text: '[', kind: 'regex' }, // 非法 regex ⇒ parseFailures 逐条透传面
      ],
      brief: '青云宗外门弟子',
      fileRel: '设定/人物/lin-xuan.md',
    },
    { ref: SECT, name: '青云宗', aiContext: 'always', brief: '正道魁首立派三百年', fileRel: '设定/势力/qingyun.md' },
    { ref: FORBIDDEN, name: '魔君', aiContext: 'never', brief: '魔道之主', fileRel: '设定/人物/mo-jun.md' },
    {
      ref: OFF,
      name: '心经',
      aiContext: 'detectedOff',
      aliases: [{ text: '心经', kind: 'exact' }],
      brief: '上古典籍残卷',
      fileRel: '设定/概念/heart-sutra.md',
    },
  ]
}

function baseInput(overrides: Partial<Parameters<typeof compile>[0]> = {}): Parameters<typeof compile>[0] {
  return {
    task: { type: 'chapter_writing', chapterIndex: 5 },
    bookRoot: '/nonexistent-root-for-guard-tests',
    bookId: BOOK_ID,
    draftText: '林枫夜行，枫儿低语，魔君之名掠过心头，心经残页浮现。',
    cards: baseCards(),
    snapshot: snapOf(mkFact(LIN), mkFact(LIN, { predicate: '功法', value: OFF, importance: 'notable' })),
    scope: SCOPE,
    structural: {
      sections: [
        { section: 'author_intent', content: 'A'.repeat(49) },
        { section: 'task_frame', content: 'B'.repeat(49) },
      ],
    },
    storyText: ['S'.repeat(100)],
    modelProfile: { id: 'test-model', contextWindow: 4096 },
    tokenizer: charTok,
    receiptId: RECEIPT_ID,
    nowIso: NOW,
    ...overrides,
  }
}

/* ----------------------------------------------------------------------------
 * 四档激活分流（activateCards 纯函数面）
 * -------------------------------------------------------------------------- */

describe('四档激活：分流与 ref 升序稳定排版', () => {
  it('always 进结构层且 ref 升序（入参序无关）；never 全出局；keywordFace 只收 detected', () => {
    const activation = activateCards([
      baseCards()[2]!, // never
      baseCards()[1]!, // always SECT
      { ref: 'char:aaa-first', name: '甲一', aiContext: 'always', brief: '甲一常驻面' }, // always 更小 ref
      baseCards()[3]!, // detectedOff
      baseCards()[0]!, // detected LIN
    ])
    expect(activation.alwaysSections.map((section) => section.section)).toEqual([
      'entity:char:aaa-first',
      'entity:faction:qingyun-sect',
    ])
    expect(activation.recallFace.map((card) => card.ref)).toEqual([OFF, LIN])
    expect([...activation.keywordScanFace]).toEqual([LIN])
  })
})

/* ----------------------------------------------------------------------------
 * AC②：Always/Never 档在全链路中优先于检测逻辑
 * -------------------------------------------------------------------------- */

describe('AC② 四档全链路优先级', () => {
  it('always 卡未提及也常驻结构层；never 卡被提及也不激活；双档不重复吃候选池预算', async () => {
    const root = makeTempRoot()
    try {
      const { packet, receipt } = await compile(baseInput({ bookRoot: root }))

      // always：草稿从未提及「青云宗」，仍以 entity: 段常驻结构层
      const sectPiece = packet.structural.find((piece) => piece.section === `entity:${SECT}`)
      expect(sectPiece).toBeDefined()
      expect(sectPiece?.text).toContain('正道魁首立派三百年')
      // always 不进候选池（结构层+候选池双吃 = 重复计费）
      expect(packet.settings.map((entry) => entry.identifier)).not.toContain(SECT)

      // never：草稿两次提及「魔君」仍零激活——优先于检测逻辑
      expect(packet.settings.map((entry) => entry.identifier)).not.toContain(FORBIDDEN)
      expect(packet.structural.map((piece) => piece.section)).not.toContain(`entity:${FORBIDDEN}`)
      expect(packet.text).not.toContain('魔道之主')
      expect(receipt.entries.map((entry) => entry.identifier)).not.toContain(FORBIDDEN)

      // detected：keyword 通道激活证据随 Receipt 发射
      const linEntry = receipt.entries.find((entry) => entry.identifier === LIN)
      expect(linEntry?.assemblySource).toBe('keyword')
      expect(linEntry?.activation).toMatchObject({ kind: 'keyword' })
      expect(packet.text).toContain('青云宗外门弟子')

      // detectedOff：别名检测被裁剪——卡面零激活（无 embedding 兜底时）
      expect(packet.settings.map((entry) => entry.identifier)).not.toContain(OFF)
      // ……但其主体事实经图通道可达：「关检测」≠「永不出现」
      const offFactEntry = receipt.entries.find(
        (entry) => entry.included && entry.activation?.kind === 'graph_khop' && entry.identifier.startsWith('fact_'),
      )
      expect(offFactEntry).toBeDefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/* ----------------------------------------------------------------------------
 * AC①：compile → 合法 Receipt 全字段（落盘往返 + 确定性）
 * -------------------------------------------------------------------------- */

const SIX_REASONS: readonly ExclusionReason[] = [
  'budget_exhausted',
  'relevance_below_threshold',
  'pov_filtered',
  'interval_not_active',
  'story_text_quota_protected',
  'duplicate',
]

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mozhou-t10a-'))
}

describe('AC① 端到端 Receipt 全字段', () => {
  it('一证一文件落盘 + ContextCompiled 指针事件 + loadReceipt 往返无损 + inputsDigest 锚定', async () => {
    const root = makeTempRoot()
    try {
      const { packet, receipt, location } = await compile(baseInput({ bookRoot: root }))

      // 服务端身份与任务语义
      expect(receipt.assembledBy).toBe('server')
      expect(receipt.taskType).toBe('chapter_writing')
      expect(receipt.chapterIndex).toBe(5)
      expect(receipt.id).toBe(RECEIPT_ID)

      // 一证一文件 + INV-R1 先证后指针
      expect(location.receiptPath).toBe(join(root, '.mozhou', 'receipts', `${RECEIPT_ID}.json`))
      expect(existsSync(location.receiptPath)).toBe(true)
      const eventsRaw = readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
      const lines = eventsRaw.split('\n').filter((line) => line.length > 0)
      const pointer = JSON.parse(lines.at(-1)!) as Record<string, unknown>
      expect(pointer).toMatchObject({
        type: 'ContextCompiled',
        seq: location.eventSeq,
        at: NOW,
        receiptId: RECEIPT_ID,
        recomputationHash: receipt.recomputationHash,
        totalTokens: receipt.totalTokens,
      })

      // loadReceipt 往返无损
      expect(loadReceipt(root, RECEIPT_ID)).toEqual(receipt)

      // 字段组完整性：entries / parseFailures / storyTextQuota / replayInputs / 双哈希
      expect(receipt.entries.length).toBeGreaterThanOrEqual(3)
      for (const entry of receipt.entries) {
        if (!entry.included) {
          expect(SIX_REASONS).toContain(entry.exclusionReason)
        }
      }
      expect(receipt.parseFailures.length).toBeGreaterThanOrEqual(1) // 非法 regex 别名透传
      const failure = receipt.parseFailures[0]!
      expect(failure.source).toContain('aliases[')
      expect(failure.detail).toContain('invalid regex')
      expect(receipt.storyTextQuota.reservedTokens).toBeGreaterThan(0)
      expect(receipt.totalTokens).toBe(packet.totalTokens)
      expect(receipt.inputsDigest).toBe(sha256Hex(canonicalJson(receipt.replayInputs)))
      expect(receipt.replayInputs.tokenizerVersion).toBe('fake-char-v1')
      expect(receipt.replayInputs.modelProfileId).toBe('test-model')
      expect(receipt.replayInputs.candidates.length).toBeGreaterThan(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('同输入两次编译（异根同证）Receipt 字节级一致——IO 层不污染装配纯函数纪律', async () => {
    const rootA = makeTempRoot()
    const rootB = makeTempRoot()
    try {
      // 同一输入对象跑两次（仅 bookRoot 不同）——fact id 等夹具必须逐字节同源
      const sharedInput = baseInput()
      const first = await compile({ ...sharedInput, bookRoot: rootA })
      const second = await compile({ ...sharedInput, bookRoot: rootB })
      expect(serializeReceiptFile(second.receipt)).toBe(serializeReceiptFile(first.receipt))
      expect(first.packet).toEqual(second.packet)
    } finally {
      rmSync(rootA, { recursive: true, force: true })
      rmSync(rootB, { recursive: true, force: true })
    }
  })
})

/* ----------------------------------------------------------------------------
 * AC③：失败路径确定性错误面（禁止静默降级）
 * -------------------------------------------------------------------------- */

describe('AC③ 失败路径', () => {
  it('召回空（仅 never 卡 + 空快照）⇒ EmptyRecallError 而非零设定生成', async () => {
    const root = makeTempRoot()
    try {
      await expect(
        compile(
          baseInput({
            bookRoot: root,
            cards: [baseCards()[2]!], // 只有 never 卡
            snapshot: snapOf(),
          }),
        ),
      ).rejects.toThrow(EmptyRecallError)
      // 失败路径不落任何凭证
      expect(existsSync(join(root, '.mozhou'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('预算溢出（接缝惩罚 tokenizer 下收敛超限）⇒ ConvergenceError 原样穿透', async () => {
    const root = makeTempRoot()
    try {
      // 12 张原子卡全部 keyword 触发；接缝惩罚使整包远超预算，
      // 收敛每轮至多淘汰一条 ⇒ 8 轮上限内无法追平
      const floodCards: CompileCard[] = Array.from({ length: 12 }, (_, index) => ({
        ref: `char:flood-${String(index).padStart(2, '0')}` as EntityRef,
        name: `洪泛${index}`,
        aiContext: 'detected',
        aliases: [{ text: `洪泛${index}`, kind: 'exact' }],
        brief: `B${'c'.repeat(48)}`,
      }))
      await expect(
        compile(
          baseInput({
            bookRoot: root,
            tokenizer: seamPenaltyTok,
            draftText: floodCards.map((card) => card.name).join(''),
            cards: floodCards,
            snapshot: snapOf(),
            storyText: undefined,
          }),
        ),
      ).rejects.toThrow(ConvergenceError)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('Research 区卡进入编译入口 ⇒ CompileConfigError（US17 硬隔离的确定性错误面）', async () => {
    await expect(
      compile(baseInput({ cards: [{ ...baseCards()[0]!, fileRel: '市场/market-brief.md' }] })),
    ).rejects.toThrow(CompileConfigError)
    await expect(
      compile(baseInput({ cards: [{ ...baseCards()[0]!, fileRel: '市场/sub/dir/card.md' }] })),
    ).rejects.toThrow(/research zone isolation/)
  })

  it('缺精确 tokenizer ⇒ TokenizerUnavailable（拒绝装配即拒绝降级估算）', async () => {
    const root = makeTempRoot()
    try {
      await expect(
        compile(baseInput({ bookRoot: root, tokenizer: undefined })),
      ).rejects.toThrow(TokenizerUnavailable)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
