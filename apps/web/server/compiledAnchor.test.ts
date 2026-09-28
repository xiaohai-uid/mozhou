/**
 * @vitest-environment node
 *
 * Context Receipt 锚点解析（D10）。
 *
 * 这里钉的是三条曾经被违反的纪律：
 * 1. 没有编译凭证就是 null——绝不返回占位 id；
 * 2. 后到者胜（行序即权威时序）；
 * 3. 形状不合的行宁可当「无凭证」跳过，不盲 cast。
 */
import { describe, expect, it } from 'vitest'
import { latestCompiledReceiptIdForChapter, resolveCompiledAnchor } from './compiledAnchor.js'
import type { PipelineLedgerRow } from '@mozhou/pipeline'
import type { DomainEvent } from '@mozhou/kernel'

let seq = 0

function compiledRow(chapterIndex: number, receiptId: unknown): PipelineLedgerRow {
  seq += 1
  return {
    position: seq,
    kind: 'domain',
    row: {
      type: 'ContextCompiled',
      taskType: 'CHAPTER_DRAFTING',
      chapterIndex,
      receiptId,
    },
  }
}

function taskRow(): PipelineLedgerRow {
  seq += 1
  return {
    position: seq,
    kind: 'task',
    seq,
    event: { type: 'TaskStarted', taskRef: 'tsk_probe' } satisfies DomainEvent,
  }
}

describe('latestCompiledReceiptIdForChapter', () => {
  it('空账本 → null（绝不编造）', () => {
    expect(latestCompiledReceiptIdForChapter([], 1)).toBeNull()
  })

  it('取该章的平铺 ContextCompiled 指针', () => {
    const rows = [compiledRow(1, 'rcpt_a'), compiledRow(2, 'rcpt_b')]
    expect(latestCompiledReceiptIdForChapter(rows, 2)).toBe('rcpt_b')
  })

  it('后到者胜：同章多次编译取最后一枚', () => {
    const rows = [compiledRow(1, 'rcpt_old'), compiledRow(1, 'rcpt_new')]
    expect(latestCompiledReceiptIdForChapter(rows, 1)).toBe('rcpt_new')
  })

  it('形状不合的 receiptId 当作无凭证跳过，不盲 cast', () => {
    const rows = [compiledRow(1, 'rcpt_ok'), compiledRow(1, 42)]
    expect(latestCompiledReceiptIdForChapter(rows, 1)).toBe('rcpt_ok')

    const bad = [compiledRow(1, 'not-a-receipt-id')]
    expect(latestCompiledReceiptIdForChapter(bad, 1)).toBeNull()
  })

  it('非 CHAPTER_DRAFTING / 非 domain 行 / 异章号一律不认', () => {
    seq += 1
    const otherTask: PipelineLedgerRow = {
      position: seq,
      kind: 'domain',
      row: { type: 'ContextCompiled', taskType: 'CHAPTER_REVIEW', chapterIndex: 1, receiptId: 'rcpt_x' },
    }
    expect(latestCompiledReceiptIdForChapter([taskRow(), otherTask, compiledRow(2, 'rcpt_y')], 1)).toBeNull()
    expect(latestCompiledReceiptIdForChapter([otherTask], 1)).toBeNull()
  })
})

describe('resolveCompiledAnchor', () => {
  it('未编译过的书根 → null，调用方据此拒答', () => {
    expect(resolveCompiledAnchor('C:/definitely-not-a-mozhou-book-xyz', 1)).toBeNull()
  })
})
