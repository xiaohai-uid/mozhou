/**
 * 质量门面板测试（ADR-0025 语义不被 UI 弱化 + 2026-09 初载契约修复）：
 * 初载按真实 {status, report, current} 三态消费——no_review 不得伪装 stale；
 * current 直接由落盘报告渲染 verdict/锚定/失败清单；stale 显式提示。
 * verdict 徽标、锚定哈希、blocking 失败（规则 id+版本+证据）、advisories、
 * Gate 3 横幅、回炉计数 ≤2 全部可见；附契约快照（API 契约形状变化即快照爆）。
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

/** 初载契约：POST /api/chapter.quality 的真实形状（与 ReviewResponse 不同构）。 */
const NO_REVIEW_STATUS = { ok: true, status: 'no_review', report: null, current: false }

function currentReportStatus(verdict: 'pass' | 'blocking_fail', overrides?: { current?: boolean }) {
  return {
    ok: true,
    status: overrides?.current === false ? 'stale' : 'current',
    current: overrides?.current ?? true,
    report: {
      reportId: 'rep_disk_1',
      verdict,
      anchor: { draftRevision: 3, draftContentHash: '91e4d2f0a1b2c3d4e5f6a7b8c9d0e1f2' },
      evaluations:
        verdict === 'blocking_fail'
          ? [
              {
                ruleId: 'PARA-001',
                ruleVersion: '1.0.0',
                verdict: 'fail',
                severity: 'blocking',
                evidence: [{ ruleId: 'PARA-001', note: '段落瀑布', excerpt: '他抬头。' }],
              },
              {
                ruleId: 'DIAL-002',
                ruleVersion: '1.1.0',
                verdict: 'warn',
                severity: 'advisory',
                evidence: [{ ruleId: 'DIAL-002', note: '对白密度偏高' }],
              },
            ]
          : [],
    },
  }
}

/** 按路径分发：初载走 status 契约，审查走 ReviewResponse。 */
function stubFetchByPath(quality: unknown, review: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((path: string) => {
    if (path === '/api/chapter.quality') return Promise.resolve(okJson(quality))
    return Promise.resolve(okJson(review))
  })
}

describe('QualityPanel（初载契约修复后语义保全）', () => {
  it('初载 no_review：显示「尚未审查」，不得伪装 stale', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(NO_REVIEW_STATUS)))
    render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await waitFor(() => {
      expect(screen.getByText(/本章尚未审查/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/报告已 stale/)).not.toBeInTheDocument()
    expect(screen.queryByText('PASS')).not.toBeInTheDocument()
  })

  it('初载 current 报告：直接由落盘报告渲染 verdict/锚定/失败清单', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(currentReportStatus('blocking_fail'))))
    render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await waitFor(() => {
      expect(screen.getByText('NEEDS REWORK')).toBeInTheDocument()
    })
    expect(screen.getByText('BLOCKING FAILURES')).toBeInTheDocument()
    expect(screen.getByText('PARA-001（v1.0.0）')).toBeInTheDocument()
    expect(screen.getByText(/Exact draft: revision 3/)).toBeInTheDocument()
    expect(screen.queryByText(/报告已 stale/)).not.toBeInTheDocument()
  })

  it('初载 stale：显式提示「报告已 stale」，verdict 仍可见', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(currentReportStatus('pass', { current: false }))))
    render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await waitFor(() => {
      expect(screen.getByText(/报告已 stale——正文在审查后变化/)).toBeInTheDocument()
    })
    expect(screen.getByText('PASS')).toBeInTheDocument()
  })

  it('契约快照：初载 current 报告渲染结构', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(currentReportStatus('pass'))))
    const { asFragment } = render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await waitFor(() => {
      expect(screen.getByText('PASS')).toBeInTheDocument()
    })
    expect(asFragment()).toMatchSnapshot()
  })

  it('blocking_fail：规则 id+版本+证据可见，rework 按钮可用且 ≤2 上限（经 Run review）', async () => {
    const fetchMock = stubFetchByPath(NO_REVIEW_STATUS, BLOCKING_SUMMARY)
    vi.stubGlobal('fetch', fetchMock)
    render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await waitFor(() => {
      expect(screen.getByText(/本章尚未审查/)).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button', { name: 'Run literary review' }))
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
    const fetchMock = stubFetchByPath(NO_REVIEW_STATUS, { ...BLOCKING_SUMMARY, reworkCount: 2 })
    vi.stubGlobal('fetch', fetchMock)
    render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await userEvent.click(screen.getByRole('button', { name: 'Run literary review' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Apply rework（已达上限）/ })).toBeDisabled()
    })
  })

  it('Gate 3 横幅显式呈现（语义审查提供方 unavailable，来自审查响应）', async () => {
    const fetchMock = stubFetchByPath(NO_REVIEW_STATUS, PASS_SUMMARY)
    vi.stubGlobal('fetch', fetchMock)
    render(<QualityPanel root="C:/tmp/b" chapterIndex={1} />)
    await userEvent.click(screen.getByRole('button', { name: 'Run literary review' }))
    await waitFor(() => {
      expect(screen.getByText(/语义审查提供方未接入（Gate 3）/)).toBeInTheDocument()
    })
  })

  it('Run literary review 点击触发 /api/chapter.review', async () => {
    const fetchMock = stubFetchByPath(NO_REVIEW_STATUS, PASS_SUMMARY)
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

  it('纠错：原因下拉 + 附注 + 显式保存（附注原文只留本机）', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/chapter.quality') return Promise.resolve(okJson(NO_REVIEW_STATUS))
      return Promise.resolve(okJson({ ok: true, recorded: 1, noteDigest: 'd' }))
    })
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
