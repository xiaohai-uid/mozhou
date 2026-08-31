/**
 * 装配看板组件测试（T42）：
 * - 契约快照：输入形状 = server/api 导出类型（ReceiptListResponse /
 *   ReceiptDetailResponse），包类型漂移即 typecheck + 快照双报警；
 * - 列表 → 点选详情 → 额度条 / 逐条分解 / Replay Inputs / 续跑判态；
 * - hash mismatch 显式呈现（不静默）；空态 / 失败显式报错。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookId, ContextReceipt, ContextReceiptId, ExclusionReason, ReceiptEntry } from '@mozhou/kernel'
import type { ReceiptListResponse, ReceiptDetailResponse } from '../../server/api'
import { okJson } from '../test/http'
import { ReceiptPanel } from './ReceiptPanel'

afterEach(() => {
  vi.unstubAllGlobals()
})

const LIST: ReceiptListResponse['receipts'] = [
  { receiptId: 'rcpt_t4201', chapterIndex: 1, totalTokens: 5120, hashMatch: true },
  { receiptId: 'rcpt_t4202', chapterIndex: 2, totalTokens: 3000, hashMatch: false },
]

interface SeedEntry {
  stage: string
  identifier: string
  included: boolean
  tokens?: number
  exclusionReason?: ExclusionReason
}

function seedReceipt(fields: {
  receiptId: string
  chapterIndex: number | null
  contextWindow: number
  entries: SeedEntry[]
  resume?: ReceiptDetailResponse['resume']
}): ReceiptDetailResponse {
  const entries = fields.entries.map((entry, order): ReceiptEntry => ({
    stage: entry.stage,
    order,
    identifier: entry.identifier,
    included: entry.included,
    ...(entry.exclusionReason === undefined ? {} : { exclusionReason: entry.exclusionReason }),
    ...(entry.tokens === undefined ? {} : { tokens: entry.tokens }),
  }))
  const totalTokens = fields.entries.reduce((sum, e) => sum + (e.tokens ?? 0), 0)
  const receipt: ContextReceipt = {
    id: fields.receiptId as ContextReceiptId,
    bookId: 'book_01JB00000000000000000000' as BookId,
    revision: 0,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    taskType: 'CHAPTER_DRAFTING',
    ...(fields.chapterIndex === null ? {} : { chapterIndex: fields.chapterIndex }),
    entries,
    parseFailures: [],
    storyTextQuota: { reservedTokens: 1024, actualTokens: 2048 },
    totalTokens,
    assembledBy: 'server',
    replayInputs: {
      configVersion: 'budget-assembly/abc123',
      tokenizerVersion: 'fake-char-v1',
      modelProfileId: 'local-qwen',
      contextWindowTokens: fields.contextWindow,
      candidates: [
        { id: 'char:lin-wan', tier: 'entity_card', channel: 'keyword', relevanceScore: 9, contentDigest: 'd1' },
      ],
      structuralSections: [{ section: 'author_intent', contentDigest: 's1' }],
      storyTextSlices: [{ digest: 'slice1', tokens: 100 }],
    },
    inputsDigest: 'c820a91f',
    recomputationHash: 'h',
  }
  return {
    ok: true,
    receiptId: fields.receiptId,
    chapterIndex: fields.chapterIndex,
    totalTokens,
    hashMatch: true,
    receipt,
    resume: fields.resume ?? {
      sessionOpen: false,
      currentStep: null,
      committed: false,
      finished: false,
      lastReceiptId: null,
    },
  }
}

const DETAIL = seedReceipt({
  receiptId: 'rcpt_t4201',
  chapterIndex: 1,
  contextWindow: 8192,
  entries: [
    { stage: 'structural', identifier: 'author_intent', included: true, tokens: 412 },
    { stage: 'reserve', identifier: 'char:lin-wan', included: true, tokens: 688 },
    { stage: 'reserve', identifier: 'promise:tide-clock-13', included: true, tokens: 521 },
    { stage: 'story_text', identifier: 'story_text', included: true, tokens: 1204 },
    { stage: 'converge', identifier: 'world_rule:clock', included: true, tokens: 256 },
    { stage: 'recall_filter', identifier: 'char:ghost', included: false, tokens: 42, exclusionReason: 'budget_exhausted' },
  ],
})

function stubReceiptFetch(list: ReceiptListResponse['receipts'] = LIST): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (path: string) => {
      if (path === '/api/receipts') return okJson({ ok: true, receipts: list })
      if (path === '/api/receipt') return okJson(DETAIL)
      return okJson({ ok: false, error: 'unexpected path: ' + path })
    }),
  )
}

describe('ReceiptPanel（T42）', () => {
  it('列表渲染：id/章/tok/hash match 徽标（含 mismatch 显式）；契约快照', async () => {
    stubReceiptFetch()
    const { container } = render(<ReceiptPanel root="C:\\tmp\\book-a" />)
    await waitFor(() => {
      expect(screen.getByTestId('receipt-list').textContent).toContain('rcpt_t4201')
    })
    expect(screen.getByTestId('receipt-list').textContent).toContain('ch1')
    expect(screen.getByTestId('receipt-list').textContent).toContain('5120 tok')
    expect(screen.getByTestId('receipt-list').textContent).toContain('hash match')
    expect(screen.getByTestId('receipt-list').textContent).toContain('hash mismatch')
    const rows = [...screen.getByTestId('receipt-list').querySelectorAll('[data-receipt-id]')]
    expect(rows).toHaveLength(2)
    expect(container.querySelector('[aria-label="receipt-panel"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="receipt-panel"]')).toMatchSnapshot()
  })

  it('点选列表项 → 详情：额度条四段 + 逐条分解 + Replay Inputs + 续跑判态', async () => {
    stubReceiptFetch()
    render(<ReceiptPanel root="C:\\tmp\\book-a" />)
    await waitFor(() => {
      expect(screen.getByTestId('receipt-list').textContent).toContain('rcpt_t4201')
    })
    await userEvent.click(document.querySelector('[data-receipt-id="rcpt_t4201"]') as HTMLElement)
    await waitFor(() => {
      expect(screen.getByTestId('receipt-budget-text')).toBeInTheDocument()
    })
    // 额度条文本：reserved = reserve688+521 + converge256 = 1465；story = 1204；fixed = 412；slack = 8192-3081 = 5111
    const budgetText = screen.getByTestId('receipt-budget-text').textContent
    expect(budgetText).toContain('reserved 1,465')
    expect(budgetText).toContain('story 1,204')
    expect(budgetText).toContain('fixed 412')
    expect(budgetText).toContain('slack 5,111')
    // cap 呈现在额度分配卡标题
    const budgetTitle = document.querySelector('.card-title .mono')
    expect(budgetTitle?.textContent).toContain('cap 8,192')
    // 逐条分解含 excluded 标注
    const entries = screen.getByTestId('receipt-entries').textContent
    expect(entries).toContain('char:lin-wan')
    expect(entries).toContain('promise:tide-clock-13')
    expect(entries).toContain('excluded · budget_exhausted')
    // Replay Inputs 四格
    const replay = screen.getByTestId('receipt-replay').textContent
    expect(replay).toContain('fake-char-v1')
    expect(replay).toContain('budget-asse')
    expect(replay).toContain('1 ordered')
    expect(replay).toContain('c820…a91f')
    // 续跑判态：无会话 → 显式「无开放生产会话」
    expect(screen.getByTestId('receipt-resume').textContent).toContain('无开放生产会话')
  })

  it('会话投影可恢复时续跑入口显式指向工作台（sessionOpen 判定）', async () => {
    const openResume = seedReceipt({
      receiptId: 'rcpt_t4201',
      chapterIndex: 1,
      contextWindow: 8192,
      entries: [{ stage: 'structural', identifier: 'author_intent', included: true, tokens: 412 }],
      resume: {
        sessionOpen: true,
        currentStep: 'draft',
        committed: false,
        finished: false,
        lastReceiptId: 'rcpt_t4201',
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (path: string) => {
        if (path === '/api/receipts') {
          return okJson({ ok: true, receipts: [{ receiptId: 'rcpt_t4201', chapterIndex: 1, totalTokens: 5120, hashMatch: true }] })
        }
        if (path === '/api/receipt') return okJson(openResume)
        return okJson({ ok: false, error: 'unexpected path: ' + path })
      }),
    )
    const onResume = vi.fn()
    render(<ReceiptPanel root="C:\\tmp\\book-a" onResume={onResume} />)
    await waitFor(() => {
      expect(screen.getByTestId('receipt-list').textContent).toContain('rcpt_t4201')
    })
    await userEvent.click(document.querySelector('[data-receipt-id="rcpt_t4201"]') as HTMLElement)
    await waitFor(() => {
      expect(screen.getByTestId('receipt-resume').textContent).toContain('可恢复')
    })
    expect(screen.getByTestId('receipt-resume').textContent).toContain('draft')
    expect(screen.getByTestId('receipt-resume').textContent).toContain('继续写作将在工作台续接本轮')
    // 续跑入口：可恢复时「回到工作台继续」可点并触发 onResume
    await userEvent.click(screen.getByRole('button', { name: '回到工作台继续' }))
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it('空态：无 Receipt 时显式提示先完成装配', async () => {
    stubReceiptFetch([])
    render(<ReceiptPanel root="C:\\tmp\\book-a" />)
    await waitFor(() => {
      expect(screen.getByTestId('receipts-empty').textContent).toContain('暂无 Context Receipt')
    })
  })

  it('读取失败显式报错（role=alert），不静默', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (path: string) => {
        if (path === '/api/receipts') {
          return new Response(JSON.stringify({ ok: false, error: 'receipts 读取失败' }), { status: 500 })
        }
        return okJson({ ok: false, error: 'unexpected path: ' + path })
      }),
    )
    render(<ReceiptPanel root="C:\\tmp\\book-a" />)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('receipts 读取失败')
    })
  })
})