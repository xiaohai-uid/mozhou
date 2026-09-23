/**
 * 壳层遥测推导测试：管线六态只能来自真实数据面证据——
 * 无书=unavailable、已定稿=全 done、draft 相位=draft done、
 * receipt=compile done、quality current=review done、refused=review blocked；
 * 无证据的阶段不标记（不伪造完成）。摘要轨无来源 = '—'。
 */
import { describe, expect, it } from 'vitest'
import { deriveStageStates, deriveSummary } from './shellTelemetry'
import type { WorksChapterSummary, ReceiptListItem } from '../../server/api'

const chapter = (index: number, phase: 'committed' | 'draft'): WorksChapterSummary => ({
  chapterIndex: index,
  title: `第${index}章 暗潮`,
  phase,
  wordCount: 1000 + index,
  revision: 2,
})

const receipt = (chapterIndex: number, hashMatch = true): ReceiptListItem => ({
  receiptId: `r_${chapterIndex}`,
  chapterIndex,
  totalTokens: 1800,
  hashMatch,
})

const BOOK_ARGS = { bookExists: true, chapterIndex: 12 }

describe('deriveStageStates（六态真实绑定）', () => {
  it('无书：全部 unavailable（不伪造任何完成）', () => {
    const states = deriveStageStates({ ...BOOK_ARGS, bookExists: false, works: null, receipts: [], quality: null })
    expect(states).toEqual({
      prepare: 'unavailable', compile: 'unavailable', draft: 'unavailable', review: 'unavailable',
      extract: 'unavailable', continuity: 'unavailable', proposal: 'unavailable', commit: 'unavailable',
    })
  })

  it('已定稿章节：八阶段全部 done', () => {
    const states = deriveStageStates({
      ...BOOK_ARGS,
      works: { chapters: [chapter(12, 'committed')] },
      receipts: [receipt(12)],
      quality: { status: 'current', current: true, report: { verdict: 'pass' } },
    })
    expect(states.commit).toBe('done')
    expect(states.prepare).toBe('done')
    expect(Object.values(states).every((v) => v === 'done')).toBe(true)
  })

  it('草稿章节：prepare/compile/draft 有证据 done；review current → done；后段不标记', () => {
    const states = deriveStageStates({
      ...BOOK_ARGS,
      works: { chapters: [chapter(12, 'draft')] },
      receipts: [receipt(12)],
      quality: { status: 'current', current: true, report: { verdict: 'pass' } },
    })
    expect(states.prepare).toBe('done')
    expect(states.compile).toBe('done')
    expect(states.draft).toBe('done')
    expect(states.review).toBe('done')
    expect(states.extract).toBeUndefined()
    expect(states.continuity).toBeUndefined()
    expect(states.proposal).toBeUndefined()
    expect(states.commit).toBeUndefined()
  })

  it('无 receipt / 无审查：compile 与 review 不标记（诚实待定）', () => {
    const states = deriveStageStates({
      ...BOOK_ARGS,
      works: { chapters: [chapter(12, 'draft')] },
      receipts: [],
      quality: { status: 'no_review', current: false, report: null },
    })
    expect(states.compile).toBeUndefined()
    expect(states.review).toBeUndefined()
    expect(states.draft).toBe('done')
  })

  it('refused：review = blocked（语义前提缺失），不伪装失败或完成', () => {
    const states = deriveStageStates({
      ...BOOK_ARGS,
      works: { chapters: [chapter(12, 'draft')] },
      receipts: [receipt(12)],
      quality: { status: 'current', current: true, report: { verdict: 'refused' } },
    })
    expect(states.review).toBe('blocked')
  })
})

describe('deriveSummary（摘要轨：无来源 = —）', () => {
  it('无书：全部 —', () => {
    const summary = deriveSummary({ bookExists: false, chapterIndex: 1, works: null, receipts: [], quality: null, matrixRows: null })
    expect(summary).toEqual({ chapter: '—', quality: '—', canon: '—', context: '—', changeImpact: '—', tokens: '—' })
  })

  it('有真实数据：章标题/verdict/hash/tokens/stale 合计', () => {
    const summary = deriveSummary({
      bookExists: true,
      chapterIndex: 12,
      works: { chapters: [chapter(12, 'draft')] },
      receipts: [receipt(12)],
      quality: { status: 'current', current: true, report: { verdict: 'pass' } },
      matrixRows: [{ staleCount: 1 }, { staleCount: 0 }],
    })
    expect(summary.chapter).toBe('12 · 第12章 暗潮')
    expect(summary.quality).toBe('PASS')
    expect(summary.context).toBe('HASH MATCH')
    expect(summary.tokens).toBe('1,800')
    expect(summary.changeImpact).toBe('1')
    expect(summary.canon).toBe('—') // 无 canon 时效读面——诚实
  })

  it('stale 审查：QUALITY 显式 STALE；hash 失配：显式 MISMATCH', () => {
    const summary = deriveSummary({
      bookExists: true,
      chapterIndex: 12,
      works: { chapters: [chapter(12, 'draft')] },
      receipts: [receipt(12, false)],
      quality: { status: 'stale', current: false, report: { verdict: 'pass' } },
      matrixRows: null,
    })
    expect(summary.quality).toBe('STALE')
    expect(summary.context).toBe('MISMATCH')
    expect(summary.changeImpact).toBe('—')
  })
})
