/**
 * 质量门面板测试（实现票 T40）：ADR-0025 语义不被 UI 弱化——verdict 徽标、
 * 锚定哈希、blocking 失败（规则 id+版本+证据）、advisories、Gate 3 横幅、
 * 回炉计数 ≤2 全部可见；附契约快照（API 契约形状变化即快照爆）。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QualityPanel } from './QualityPanel'
import type { QualitySummary } from './QualityPanel'
import { okJson } from '../test/http'

afterEach(() => {
  vi.unstubAllGlobals()
})

const PASS_SUMMARY: QualitySummary = {
  ok: true,
  hasReport: true,
  verdict: 'pass',
  reportId: 'rep_1',
  draftRevision: 3,
  draftContentHash: '91e4d2f0a1b2c3d4e5f6a7b8c9d0e1f2',
  current: true,
  reworkCount: 0,
  semanticReviewer: 'unavailable',
  blockingFailures: [],
  advisories: [],
}

const BLOCKING_SUMMARY: QualitySummary = {
  ok: true,
  hasReport: true,
  verdict: 'blocking_fail',
  reportId: 'rep_2',
  draftRevision: 4,
  draftContentHash: '0123456789abcdef0123456789abcdef',
  current: true,
  reworkCount: 1,
  semanticReviewer: 'unavailable',
  blockingFailures: [
    {
      ruleId: 'PARA-001',
      ruleVersion: '1.0.0',
      verdict: 'fail',
      severity: 'blocking',
      evidence: [{ ruleId: 'PARA-001', note: '段落瀑布', excerpt: '他抬头。' }],
    },
  ],
  advisories: [
    {
      ruleId: 'DIAL-002',
      ruleVersion: '1.1.0',
      verdict: 'warn',
      severity: 'advisory',
      evidence: [{ ruleId: 'DIAL-002', note: '对白密度偏高' }],
    },
  ],
}

describe('QualityPanel（Ink Orbit 换肤后语义保全）', () => {
  it('契约快照：pass 摘要渲染结构（ADR-0025 契约形状）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(PASS_SUMMARY)))
    const { asFragment } = render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await waitFor(() => {
      expect(screen.getByText('PASS')).toBeInTheDocument()
    })
    expect(asFragment()).toMatchSnapshot()
  })

  it('blocking_fail：规则 id+版本+证据可见，rework 按钮可用且 ≤2 上限', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(BLOCKING_SUMMARY)))
    render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await waitFor(() => {
      expect(screen.getByText('NEEDS REWORK')).toBeInTheDocument()
    })
    expect(screen.getByText('BLOCKING FAILURES')).toBeInTheDocument()
    expect(screen.getByText('PARA-001（v1.0.0）')).toBeInTheDocument()
    expect(screen.getByText(/段落瀑布/)).toBeInTheDocument()
    expect(screen.getByText('ADVISORIES（建议，不阻断）')).toBeInTheDocument()
    expect(screen.getByText('Rework attempt 1/2')).toBeInTheDocument()
    const rework = screen.getByRole('button', { name: /Apply rework/ })
    expect(rework).toBeEnabled()
  })

  it('回炉已达上限（reworkCount=2）时 Apply rework 禁用', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okJson({ ...BLOCKING_SUMMARY, reworkCount: 2 })),
    )
    render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Apply rework（已达上限）/ })).toBeDisabled()
    })
  })

  it('Gate 3 横幅显式呈现（基础机检在位，语义审查未接入）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(PASS_SUMMARY)))
    render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await waitFor(() => {
      expect(screen.getByText(/已包含基础机检/)).toBeInTheDocument()
    })
  })

  it('未运行审查时显示尚未运行检查，不展示红字 stale', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ ok: true, hasReport: false, current: true })))
    render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await waitFor(() => {
      expect(screen.getByText('尚未运行检查——点击下方按钮开始基础检查')).toBeInTheDocument()
    })
    expect(screen.queryByText(/报告已 stale/)).toBeNull()
  })

  it('Run literary review 点击触发 /api/chapter.review', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(PASS_SUMMARY))
    vi.stubGlobal('fetch', fetchMock)
    render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([path]) => path === '/api/chapter.quality')).toBe(true)
    })
    await userEvent.click(screen.getByRole('button', { name: 'Run literary review' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([path]) => path === '/api/chapter.review')).toBe(true)
    })
  })

  it('运行基础检查点击触发 /api/chapter.mechanical-review 并渲染检查条目', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/chapter.quality') return okJson({ ok: true, hasReport: false })
      if (path === '/api/chapter.mechanical-review') {
        return okJson({
          ok: true,
          chapterIndex: 1,
          draftRevision: 1,
          draftContentHash: 'hash_mech',
          mechanicalGate: {
            passed: true,
            checks: [{ id: 'mech_01_words', name: '字数窗口', ok: true, detail: '符合标准' }],
            repeatedNgrams: [],
            stats: { totalChars: 3000, totalParagraphs: 15, totalHanzi: 2800 },
          },
          semanticReviewer: 'unavailable',
        })
      }
      return okJson({ ok: false })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await userEvent.click(screen.getByRole('button', { name: '运行基础检查' }))
    await waitFor(() => {
      expect(screen.getByTestId('mechanical-gate-report')).toBeInTheDocument()
    })
    expect(screen.getByTestId('mechanical-gate-report').textContent).toContain('全部通过')
    expect(screen.getByTestId('mechanical-gate-report').textContent).toContain('字数窗口')
  })

  it('纠错：原因下拉 + 附注 + 显式保存（附注原文只留本机）', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      okJson({ ok: true, recorded: 1, noteDigest: 'd' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await userEvent.selectOptions(screen.getByLabelText('纠错原因'), 'style_drift')
    await userEvent.type(screen.getByPlaceholderText('纠错附注（原文只留本机）'), '把大纲当正文写了')
    await userEvent.click(screen.getByRole('button', { name: '保存纠错' }))
    await waitFor(() => {
      expect(screen.getByText('已记录（事件+失败记忆）')).toBeInTheDocument()
    })
    const correctionsCall = fetchMock.mock.calls.find(([path]) => path === '/api/chapter.corrections')
    const [correctionPath, correctionInit] = (correctionsCall ?? []) as [string, RequestInit]
    expect(correctionPath).toBe('/api/chapter.corrections')
    const body = correctionInit.body as string
    expect(JSON.parse(body)).toEqual({
      root: 'C:/tmp/b',
      chapterIndex: 1,
      reasons: ['style_drift'],
      note: '把大纲当正文写了',
    })
  })
})
