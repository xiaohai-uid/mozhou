/**
 * 章后回顾面板测试（#119 ②③）：交互镜像既有提案队列 confirm / reject / edit 模式。
 * 断言外部行为：待决候选持续可见、三动作贯通 /api/facts.decide（编辑确认携带载荷）、
 * 未配置模型显示明确失败与重试入口、提取失败显示原因并可重试、幂等重放与现场作废
 * 按服务端语义如实呈现、提交成功广播（mozhou:prose-adopted）触发回查。
 * fetch 按 URL 路由打桩（okJson），不做网络。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChapterReviewPanel } from './ChapterReviewPanel'
import { okJson } from '../test/http'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

interface DecidedBody {
  factCandidateId: string
  decision: 'confirmed' | 'rejected'
  payload?: Record<string, unknown>
}

const CANDIDATE_EVENT = {
  candidateId: 'fc_event_1',
  kind: 'event',
  payload: { summary: '萧炎在坊市与萧宁当街冲突' },
  evidence: '萧炎走进坊市，与萧宁当街冲突。',
  chapterIndex: 1,
  proseHash: 'a'.repeat(64),
}
const CANDIDATE_PSYCH = {
  candidateId: 'fc_psych_1',
  kind: 'psychological_state',
  payload: { summary: '萧炎：平静 → 戒备', character: '萧炎', before: '平静', after: '戒备' },
  evidence: '两人不欢而散，各自记恨。',
  chapterIndex: 1,
  proseHash: 'a'.repeat(64),
}

interface Harness {
  readonly fetchMock: ReturnType<typeof vi.fn>
  readonly decideBodies: DecidedBody[]
  let_extractRequested: () => number
}

function mount(options: {
  status?: Record<string, unknown>
  candidates?: readonly Record<string, unknown>[]
  decideResponse?: Record<string, unknown>
  decideStatus?: number
  decideBody?: Record<string, unknown>
  extractResponse?: Record<string, unknown>
} = {}): Harness {
  let status = options.status ?? {
    ok: true,
    extraction: { type: 'FactExtractionFinished', at: '2026-10-24T08:00:00.000Z', runId: 'fx_1', trigger: 'auto_commit', inserted: 2, voided: 0 },
    pendingCount: 2,
    provider: { available: true },
  }
  let candidates = options.candidates ?? [CANDIDATE_EVENT, CANDIDATE_PSYCH]
  const decideBodies: DecidedBody[] = []
  let extractRequested = 0
  const route = (input: RequestInfo | URL, init?: RequestInit): Response => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const rawBody = init?.body
    const body = typeof rawBody === 'string' ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
    if (url.includes('/api/facts.status')) return okJson(status)
    if (url.includes('/api/facts.candidates')) return okJson({ ok: true, candidates })
    if (url.includes('/api/facts.decide')) {
      decideBodies.push(body as unknown as DecidedBody)
      const response = options.decideResponse ?? { ok: true, replayed: false, record: {} }
      if (options.decideStatus === 409) {
        // 409 也要可解析：post() 先 res.json() 再判 ok
        return new Response(JSON.stringify({ ok: false, code: 'FACT_CANDIDATE_VOIDED', error: 'voided' }), { status: 409 })
      }
      if (response.ok === true) {
        // 决断成功后刷新：模拟服务端真实账本状态（候选项离开待决列表）
        candidates = candidates.filter((c) => c.candidateId !== body['factCandidateId'])
        status = { ...status, pendingCount: candidates.length }
      }
      return okJson(response)
    }
    if (url.includes('/api/facts.extract')) {
      extractRequested += 1
      return okJson(options.extractResponse ?? { ok: true, runId: 'fx_2', inserted: 1, voided: 0, candidates: [] })
    }
    throw new Error('unexpected fetch: ' + url)
  }
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => Promise.resolve(route(input, init)))
  vi.stubGlobal('fetch', fetchMock)
  render(<ChapterReviewPanel root="C:/tmp/book" chapterIndex={1} />)
  return {
    fetchMock,
    decideBodies,
    let_extractRequested: () => extractRequested,
  }
}

describe('章后回顾面板 (#119 ②③)', () => {
  /** 首张候选卡（CANDIDATE_EVENT）；逐卡查询避免多候选卡的重复按钮歧义。 */
  function firstCard(): HTMLElement {
    return screen.getAllByTestId('fact-candidate')[0]!
  }

  it('待决候选持续可见：两类候选逐项呈现（摘要 + 依据 + 三动作）', async () => {
    mount()
    expect(await screen.findByText('章节事件')).toBeInTheDocument()
    expect(screen.getByText('人物心理状态')).toBeInTheDocument()
    expect(screen.getByText('萧炎在坊市与萧宁当街冲突')).toBeInTheDocument()
    expect(screen.getByText(/依据：萧炎走进坊市/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '确认' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '编辑' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '拒绝' })).toHaveLength(2)
    expect(screen.getByTestId('chapter-review-last-finished').textContent).toContain('新增 2 条候选')
  })

  it('确认贯通决断面：POST facts.decide(confirmed)，刷新后离开待决列表', async () => {
    const user = userEvent.setup()
    const harness = mount()
    await screen.findByText('章节事件')
    await user.click(within(firstCard()).getByRole('button', { name: '确认' }))

    await waitFor(() => expect(harness.decideBodies.length).toBe(1))
    expect(harness.decideBodies[0]).toMatchObject({ factCandidateId: 'fc_event_1', decision: 'confirmed' })
    await waitFor(() => expect(screen.queryByText('章节事件')).not.toBeInTheDocument())
    expect(screen.getByTestId('chapter-review-panel').textContent).toContain('待决 1')
  })

  it('编辑（事件）：改摘要后「编辑后确认」携带编辑载荷', async () => {
    const user = userEvent.setup()
    const harness = mount()
    await screen.findByText('章节事件')
    await user.click(within(firstCard()).getByRole('button', { name: '编辑' }))
    const input = screen.getByTestId('fact-edit-summary')
    await user.clear(input)
    await user.type(input, '萧炎与萧宁当街冲突，不欢而散')
    await user.click(screen.getByRole('button', { name: '编辑后确认' }))

    await waitFor(() => expect(harness.decideBodies.length).toBe(1))
    expect(harness.decideBodies[0]).toMatchObject({
      factCandidateId: 'fc_event_1',
      decision: 'confirmed',
      payload: { summary: '萧炎与萧宁当街冲突，不欢而散' },
    })
  })

  it('编辑（心理状态）：三字段结构化载荷（character/before/after）', async () => {
    const user = userEvent.setup()
    const harness = mount()
    await screen.findByText('人物心理状态')
    const cards = screen.getAllByTestId('fact-candidate')
    await user.click(within(cards[1]!).getByRole('button', { name: '编辑' }))
    // 编辑草稿预填原值：先清空再输入，断言的是编辑后的新值
    await user.clear(screen.getByLabelText('人物'))
    await user.type(screen.getByLabelText('人物'), '萧炎')
    await user.clear(screen.getByLabelText('之前心理状态'))
    await user.type(screen.getByLabelText('之前心理状态'), '轻蔑')
    await user.clear(screen.getByLabelText('之后心理状态'))
    await user.type(screen.getByLabelText('之后心理状态'), '忌惮')
    await user.click(screen.getByRole('button', { name: '编辑后确认' }))

    await waitFor(() => expect(harness.decideBodies.length).toBe(1))
    expect(harness.decideBodies[0]).toMatchObject({
      factCandidateId: 'fc_psych_1',
      decision: 'confirmed',
      payload: { character: '萧炎', before: '轻蔑', after: '忌惮' },
    })
  })

  it('拒绝贯通决断面：decision=rejected，离开待决列表', async () => {
    const user = userEvent.setup()
    const harness = mount()
    await screen.findByText('章节事件')
    await user.click(within(firstCard()).getByRole('button', { name: '拒绝' }))

    await waitFor(() => expect(harness.decideBodies.length).toBe(1))
    expect(harness.decideBodies[0]).toMatchObject({ factCandidateId: 'fc_event_1', decision: 'rejected' })
    await waitFor(() => expect(screen.queryByText('章节事件')).not.toBeInTheDocument())
  })

  it('幂等重放：replayed=true 显式告知「账本未变化」', async () => {
    const user = userEvent.setup()
    mount({ decideResponse: { ok: true, replayed: true, record: {} } })
    await screen.findByText('章节事件')
    await user.click(within(firstCard()).getByRole('button', { name: '确认' }))

    await waitFor(() => expect(screen.getByTestId('chapter-review-notice').textContent).toContain('幂等重放'))
  })

  it('现场作废（409 FACT_CANDIDATE_VOIDED）：显式告知并刷新列表', async () => {
    const user = userEvent.setup()
    mount({ decideStatus: 409 })
    await screen.findByText('章节事件')
    await user.click(within(firstCard()).getByRole('button', { name: '确认' }))

    await waitFor(() => expect(screen.getByTestId('chapter-review-notice').textContent).toContain('作废'))
  })

  it('未配置模型：明确失败横幅 + 重试入口；重试遇 PROVIDER_UNAVAILABLE 保持明确失败', async () => {
    const user = userEvent.setup()
    const harness = mount({
      status: {
        ok: true,
        extraction: null,
        pendingCount: 0,
        provider: { available: false, reason: 'no_provider_configured', detail: '未配置真实 LLM Key' },
      },
      candidates: [],
      extractResponse: { ok: false, code: 'PROVIDER_UNAVAILABLE', error: 'provider unavailable: no draft provider configured' },
    })
    const banner = await screen.findByTestId('chapter-review-unconfigured')
    expect(banner.textContent).toContain('未配置模型')
    await user.click(screen.getByRole('button', { name: '重试提取' }))

    await waitFor(() => expect(harness.let_extractRequested()).toBe(1))
    await waitFor(() => expect(screen.getByTestId('chapter-review-error').textContent).toContain('未配置模型'))
  })

  it('提取失败：显示原因 + 重试入口；重试成功后展示新增计数', async () => {
    const user = userEvent.setup()
    const harness = mount({
      status: {
        ok: true,
        extraction: { type: 'FactExtractionFailed', at: '2026-10-24T08:00:00.000Z', runId: 'fx_x', trigger: 'auto_commit', reason: 'FACT_EXTRACTION_PARSE_FAILED: events array missing' },
        pendingCount: 0,
        provider: { available: true },
      },
      candidates: [],
    })
    const failed = await screen.findByTestId('chapter-review-failed')
    expect(failed.textContent).toContain('FACT_EXTRACTION_PARSE_FAILED')
    await user.click(screen.getByRole('button', { name: '重试提取' }))

    await waitFor(() => expect(harness.let_extractRequested()).toBe(1))
    await waitFor(() => expect(screen.getByTestId('chapter-review-notice').textContent).toContain('提取完成'))
  })

  it('提交成功广播（mozhou:prose-adopted）：触发状态回查（退避轮询首拍）', async () => {
    const harness = mount()
    await screen.findByText('章节事件')
    const callsBefore = harness.fetchMock.mock.calls.length
    window.dispatchEvent(new CustomEvent('mozhou:prose-adopted', { detail: { chapterIndex: 1 } }))

    await waitFor(() => expect(harness.fetchMock.mock.calls.length).toBeGreaterThan(callsBefore))
  })

  it('他章的提交广播不触发本章回查', async () => {
    const harness = mount()
    await screen.findByText('章节事件')
    const callsBefore = harness.fetchMock.mock.calls.length
    window.dispatchEvent(new CustomEvent('mozhou:prose-adopted', { detail: { chapterIndex: 9 } }))
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(harness.fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it('空待决 + 无提取记录：显式空态，不伪装数据', async () => {
    mount({
      status: { ok: true, extraction: null, pendingCount: 0, provider: { available: true } },
      candidates: [],
    })
    expect(await screen.findByTestId('chapter-review-empty').then((el) => el.textContent)).toContain('没有待决候选事实')
    expect(screen.getByText(/本章暂无提取记录/)).toBeInTheDocument()
  })
})
