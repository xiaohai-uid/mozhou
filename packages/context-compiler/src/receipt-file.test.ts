/**
 * Receipt 一证一文件测试（实现票 #25 / T9）。
 *
 * 验收对照（issue #25）：
 *   - 同输入产出的两份 Receipt 字节级一致（可复算/diff 硬断言，AC1）；
 *   - 不可变凭证：重复写同 id 抛错且原文件字节不动（INV-R2 / I5）；
 *   - 指针事件不内联 receipt 体，seq 单调（ADR-0021 §2）；
 *   - 崩溃一致序 INV-R1：孤儿 receipt 合法、悬空指针非法；
 *   - 稳定键序美化排版与 canonicalJson 哈希面互不影响（INV-R3）；
 *   - loadReceipt 往返无损；listReceiptIds 字典序 = 时间序（INV-R4 扫描面）。
 * 全部 hermetic：临时目录 + 确定性夹具，零网络零时钟依赖（atIso 注入）。
 */
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import type { BookId, ContextReceiptId } from '@mozhou/kernel'
import {
  assembleBudgetedContext,
  type AssembleInput,
  type ExactTokenizer,
  type ReceiptIdentity,
} from './assemble.js'
import {
  assertNoDanglingReceiptPointers,
  DanglingReceiptPointerError,
  listReceiptIds,
  loadReceipt,
  RECEIPTS_DIRNAME,
  ReceiptAlreadyExistsError,
  ReceiptNotFoundError,
  persistReceipt,
  serializeReceiptFile,
} from './receipt-file.js'

/* ----------------------------------------------------------------------------
 * 确定性夹具
 * -------------------------------------------------------------------------- */

const charTok: ExactTokenizer = { version: 'fake-char-v1', count: (text) => text.length }

const BOOK_ID = 'book_01JFIXTUREBOOK00000000MOZHOU' as unknown as BookId
const ID_A = 'rcpt_01JFIXTUREAAAA00000000MOZHOU' as unknown as ContextReceiptId
const ID_B = 'rcpt_01JFIXTUREBBBB00000000MOZHOU' as unknown as ContextReceiptId
const AT = '2026-08-24T00:00:00.000Z'

function identity(receiptId: ContextReceiptId): ReceiptIdentity {
  return { receiptId, bookId: BOOK_ID, createdAtIso: AT }
}

function baseInput(overrides: Partial<AssembleInput> = {}, receiptId: ContextReceiptId = ID_A): AssembleInput {
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
      parseFailures: [],
    },
    structural: { sections: [{ section: 'author_intent', content: 'A'.repeat(49) }] },
    storyText: ['第一章正文。'.repeat(10)],
    receiptIdentity: identity(receiptId),
    ...overrides,
  }
}

/* ----------------------------------------------------------------------------
 * 临时书目录管理
 * -------------------------------------------------------------------------- */

const tempRoots: string[] = []
afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function newBookRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-t9-'))
  tempRoots.push(root)
  return root
}

/* ----------------------------------------------------------------------------
 * AC1 字节级一致性
 * -------------------------------------------------------------------------- */

describe('AC1 同输入字节级一致 + 序列化确定性', () => {
  it('同输入同身份两次装配落盘两处 → 文件逐字节相同', () => {
    const first = assembleBudgetedContext(baseInput({}, ID_A)).receipt
    const second = assembleBudgetedContext(baseInput({}, ID_A)).receipt

    const rootA = newBookRoot()
    const rootB = newBookRoot()
    persistReceipt(rootA, first, { atIso: AT })
    persistReceipt(rootB, second, { atIso: AT })

    const bytesA = readFileSync(join(rootA, RECEIPTS_DIRNAME, `${ID_A}.json`))
    const bytesB = readFileSync(join(rootB, RECEIPTS_DIRNAME, `${ID_A}.json`))
    expect(bytesA.equals(bytesB)).toBe(true)
    // 序列化纯函数位同样幂等
    expect(serializeReceiptFile(first)).toBe(serializeReceiptFile(second))
  })

  it('同输入不同身份信封 → recomputationHash 相等（diff 按 identifier 对齐的锚不变）', () => {
    const first = assembleBudgetedContext(baseInput({}, ID_A)).receipt
    const second = assembleBudgetedContext(baseInput({}, ID_B)).receipt
    expect(second.recomputationHash).toBe(first.recomputationHash)
    expect(first.id).not.toBe(second.id)
  })

  it('文件为稳定键序美化排版（INV-R3 排版位）：顶层键按字典序出现且缩进可读', () => {
    const receipt = assembleBudgetedContext(baseInput()).receipt
    const text = serializeReceiptFile(receipt)
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "assembledBy"')
    const keys = ['assembledBy', 'bookId', 'createdAt', 'entries', 'id', 'inputsDigest', 'parseFailures', 'recomputationHash', 'replayInputs', 'revision', 'storyTextQuota', 'taskType', 'totalTokens', 'updatedAt']
    let last = -1
    for (const key of keys) {
      const at = text.indexOf(`"${key}":`)
      expect(at).toBeGreaterThan(last)
      last = at
    }
  })
})

/* ----------------------------------------------------------------------------
 * INV-R2 不可变 + 存取往返
 * -------------------------------------------------------------------------- */

describe('INV-R2 不可变凭证与存取', () => {
  it('重复写同一 bookRoot 的同 id → 抛错且原文件字节不动', () => {
    const root = newBookRoot()
    const receipt = assembleBudgetedContext(baseInput()).receipt
    persistReceipt(root, receipt, { atIso: AT })
    const before = readFileSync(join(root, RECEIPTS_DIRNAME, `${receipt.id}.json`))

    const tampered = { ...receipt, totalTokens: receipt.totalTokens + 999 }
    expect(() => persistReceipt(root, tampered, { atIso: AT })).toThrow(ReceiptAlreadyExistsError)

    const after = readFileSync(join(root, RECEIPTS_DIRNAME, `${receipt.id}.json`))
    expect(before.equals(after)).toBe(true)
  })

  it('loadReceipt 往返无损；缺失显式 ReceiptNotFoundError', () => {
    const root = newBookRoot()
    const receipt = assembleBudgetedContext(baseInput()).receipt
    persistReceipt(root, receipt, { atIso: AT })

    expect(loadReceipt(root, receipt.id)).toEqual(receipt)
    expect(() => loadReceipt(root, 'rcpt_01JMISSING000000000MOZHOU')).toThrow(ReceiptNotFoundError)
  })

  it('listReceiptIds 字典序 = 时间序（ULID 单调）；空目录返回 []', () => {
    const root = newBookRoot()
    expect(listReceiptIds(root)).toEqual([])

    const a = assembleBudgetedContext(baseInput({}, ID_A)).receipt
    const b = assembleBudgetedContext(baseInput({}, ID_B)).receipt
    persistReceipt(root, a, { atIso: AT })
    persistReceipt(root, b, { atIso: AT })
    expect(listReceiptIds(root)).toEqual([ID_A, ID_B])
  })
})

/* ----------------------------------------------------------------------------
 * ADR-0021 §2 指针事件与 INV-R1 崩溃一致序
 * -------------------------------------------------------------------------- */

describe('指针事件与 INV-R1', () => {
  it('事件只持指针摘要：字段齐全、不内联 entries/正文，seq 从 0 起单调', () => {
    const root = newBookRoot()
    const first = assembleBudgetedContext(baseInput()).receipt
    const secondInput = baseInput(
      {
        task: { type: 'review' },
        recall: { candidates: [], excluded: [], parseFailures: [] },
        storyText: undefined,
      },
      ID_B,
    )
    const second = assembleBudgetedContext(secondInput).receipt

    const r1 = persistReceipt(root, first, { atIso: AT })
    const r2 = persistReceipt(root, second, { atIso: AT })
    expect(r1.eventSeq).toBe(0)
    expect(r2.eventSeq).toBe(1)

    const lines = readFileSync(join(root, '.mozhou/events.jsonl'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    const event = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(event['type']).toBe('ContextCompiled')
    expect(event['seq']).toBe(0)
    expect(event['at']).toBe(AT)
    expect(event['receiptId']).toBe(first.id)
    expect(event['taskType']).toBe('chapter_writing')
    expect(event['chapterIndex']).toBe(42)
    expect(event['recomputationHash']).toBe(first.recomputationHash)
    expect(event['totalTokens']).toBe(first.totalTokens)
    expect(event['storyTextQuota']).toEqual(first.storyTextQuota)
    const included = first.entries.filter((entry) => entry.included).length
    expect(event['entryCount']).toEqual({ included, excluded: first.entries.length - included })
    // 体不内联：事件行不含 entries 键，也不含任何条目内容片段
    expect(lines[0]).not.toContain('"entries"')
    expect(lines[0]).not.toContain('LLLL')

    const event2 = JSON.parse(lines[1]!) as Record<string, unknown>
    expect(event2['chapterIndex']).toBeUndefined()
    expect(JSON.stringify(event2)).not.toContain('chapterIndex')
  })

  it('孤儿 receipt 合法（validator 通过）；悬空指针非法（validator 报错）', () => {
    const root = newBookRoot()
    const receipt = assembleBudgetedContext(baseInput()).receipt
    persistReceipt(root, receipt, { atIso: AT })

    // 删除 events.jsonl ⇒ 孤儿 receipt：合法
    unlinkSync(join(root, '.mozhou/events.jsonl'))
    expect(() => assertNoDanglingReceiptPointers(root)).not.toThrow()

    // 反向：事件在而文件不在 ⇒ 悬空指针非法
    const eventLine = `${JSON.stringify({
      type: 'ContextCompiled',
      seq: 0,
      at: AT,
      receiptId: 'rcpt_01JVANISH0000000000MOZHOU',
      taskType: 'chapter_writing',
      recomputationHash: 'deadbeef',
      totalTokens: 1,
      storyTextQuota: { reservedTokens: 1, actualTokens: 1 },
      entryCount: { included: 0, excluded: 0 },
    })}\n`
    writeFileSync(join(root, '.mozhou/events.jsonl'), eventLine)
    expect(() => assertNoDanglingReceiptPointers(root)).toThrow(DanglingReceiptPointerError)
    expect(existsSync(join(root, RECEIPTS_DIRNAME, `${receipt.id}.json`))).toBe(true)
  })
})
