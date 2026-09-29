/**
 * 中栏写作对话流组件测试（T44）：
 * - 契约快照：输入形状 = server/api 导出类型（CapabilitiesResponse /
 *   DraftQuestionResponse）+ NDJSON 帧形状，包类型漂移即 typecheck + 快照双报警；
 * - 墨舟先问 choice 快捷回答 → 回答进 composer；
 * - 发送 → draft.stream NDJSON start/delta/done 渐进拼接（技能选中集随请求注入）；
 * - provider 未配：unavailable 横幅 + composer/技能胶囊禁用 + 发送动作拦截；
 * - 风格单选 V1 显式空态；失败显式报错。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapabilitiesResponse, DraftQuestionResponse } from '../../server/api'
import { okJson } from '../test/http'
import { DialogueStream } from './DialogueStream'
import type { BookInfo } from '../shell/workbenchStorage'

afterEach(() => {
  vi.unstubAllGlobals()
})

const BOOK: BookInfo = { root: 'C:/tmp/book-a', bookId: 'bk_1', title: '雾港失真' }

const CAPS: CapabilitiesResponse = {
  ok: true,
  providerAvailable: true,
  capabilities: [
    { id: 'continuation', label: '续写' },
    { id: 'suspense', label: '悬念调度' },
  ],
}

const QUESTION: DraftQuestionResponse = {
  ok: true,
  question: '这一章，你更想让读者害怕「钟声」，还是害怕钟声之后的沉默？',
  hint: '墨舟先问 · 关联承诺（V1 mock）',
  choices: ['害怕钟声', '害怕沉默', '两者递进'],
}

function ndjsonResponse(frames: readonly Record<string, unknown>[]): Response {
  return new Response(frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n', {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  })
}

function stubDialogueFetch(options: {
  providerAvailable?: boolean
  /**
   * 病因分类 / 被拒主机（P2）。不传时服务端字段缺省 ⇒ 组件按 no_provider_configured
   * 处理，既有「provider 未配」用例的断言因此保持不变。
   */
  providerUnavailableReason?: string | null
  providerBlockedHost?: string | null
  providerDetail?: string
  stream?: readonly Record<string, unknown>[]
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation((path: string) => {
    if (path === '/api/capabilities') {
      return okJson({
        ...CAPS,
        providerAvailable: options.providerAvailable ?? true,
        providerUnavailableReason: options.providerUnavailableReason ?? null,
        providerBlockedHost: options.providerBlockedHost ?? null,
        providerDetail: options.providerDetail ?? '',
      })
    }
    if (path === '/api/draft.question') return okJson(QUESTION)
    if (path === '/api/draft.stream') return ndjsonResponse(options.stream ?? [])
    return okJson({ ok: false, error: 'unexpected path: ' + path })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('DialogueStream（T44）', () => {
  it('墨舟先问渲染 + choice 快捷回答填入 composer；双胶囊轨技能多选；契约快照', async () => {
    stubDialogueFetch({})
    const { container } = render(<DialogueStream book={BOOK} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '两者递进' })).toBeInTheDocument()
    })
    expect(screen.getByTestId('rails').textContent).toContain('续写')
    expect(screen.getByTestId('rails').textContent).toContain('未接入（V1 空态）')

    await userEvent.click(screen.getByRole('button', { name: '两者递进' }))
    expect(screen.getByLabelText('写作指令')).toHaveValue('两者递进')

    await userEvent.click(screen.getByRole('button', { name: '续写' }))
    expect(screen.getByRole('button', { name: '续写' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('已注入 1 项技能 · 风格未接入 · 质量门常驻')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="rails"]')).toMatchSnapshot()
  })

  it('发送 → draft.stream NDJSON 渐进拼接（技能选中集随请求注入 + done 收口）', async () => {
    const fetchMock = stubDialogueFetch({
      stream: [
        { ok: true, event: 'start', chapterIndex: 1, receiptId: null },
        { ok: true, event: 'delta', text: '第十三声没有落下来。' },
        { ok: true, event: 'delta', text: '它像一滴悬在港口上空的墨。' },
        { ok: true, event: 'done', outcome: 'succeeded', partial: false, chars: 21 },
      ],
    })
    render(<DialogueStream book={BOOK} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '两者递进' })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button', { name: '两者递进' }))
    await userEvent.click(screen.getByRole('button', { name: '续写' }))
    await userEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => {
      expect(screen.getByTestId('draft-text').textContent).toBe('第十三声没有落下来。它像一滴悬在港口上空的墨。')
    })
    expect(screen.getByTestId('draft-slice').textContent).toContain('完成')
    const draftCall = fetchMock.mock.calls.find((call) => call[0] === '/api/draft.stream')
    if (draftCall === undefined) throw new Error('missing draft.stream call')
    const init = draftCall[1] as { body?: string }
    expect(JSON.parse(init.body ?? '{}')).toEqual({
      root: BOOK.root,
      chapterIndex: 1,
      prompt: '两者递进',
      activeSkills: ['continuation'],
    })
  })

  it('provider 未配：unavailable 横幅 + composer/发送/技能胶囊禁用；发送动作被拦截', async () => {
    const fetchMock = stubDialogueFetch({ providerAvailable: false })
    render(<DialogueStream book={BOOK} />)
    await waitFor(() => {
      expect(screen.getByTestId('provider-unavailable').textContent).toContain('模型设置')
    })
    expect(screen.getByLabelText('写作指令')).toBeDisabled()
    expect(screen.getByLabelText('发送')).toBeDisabled()
    expect(screen.getByRole('button', { name: '续写' })).toBeDisabled()
    await userEvent.click(screen.getByLabelText('发送'))
    expect(fetchMock.mock.calls.some((call) => call[0] === '/api/draft.stream')).toBe(false)
  })

  it('draft.stream 返回 JSON unavailable（防御路径）：显式报错并置 unavailable', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/capabilities') return okJson({ ...CAPS, providerAvailable: true })
      if (path === '/api/draft.question') return okJson(QUESTION)
      if (path === '/api/draft.stream') {
        return new Response(
          JSON.stringify({ ok: false, code: 'PROVIDER_UNAVAILABLE', error: '尚未配置草稿生成 provider' }),
          { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
        )
      }
      return okJson({ ok: false, error: 'unexpected path: ' + path })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<DialogueStream book={BOOK} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '两者递进' })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button', { name: '两者递进' }))
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => {
      expect(screen.getByTestId('provider-unavailable').textContent).toContain('模型设置')
    })
    expect(screen.getByLabelText('发送')).toBeDisabled()
  })

  /* --------------------------------------------------------------------------
   * P2 缺陷「本机模型接入指引误导」的组件级回归。
   *
   * 现象：本机部署（MOZHOU_API_BASE=http://127.0.0.1:8317）失败的真因是 SSRF 门禁
   * 按设计拒绝环回地址，但横幅一律说「请到『账户 → 模型设置』填入你的 API 密钥」——
   * 把本机用户指引去填 BYOK 密钥，而那是本机部署不该走、也走不通的路。
   *
   * 下面两条把「两类病因 ⇒ 两套指引」钉在渲染层（分类逻辑本身另见 providerGuidance.test.ts）。
   * ------------------------------------------------------------------------ */
  it('本机端点被门禁拦下（provider_endpoint_blocked）：横幅讲放行开关，不叫用户去填 BYOK 密钥', async () => {
    const fetchMock = stubDialogueFetch({
      providerAvailable: false,
      providerUnavailableReason: 'provider_endpoint_blocked',
      providerBlockedHost: '127.0.0.1',
      providerDetail: 'SSRF 门禁：拒绝调用私有/环回/保留地址 127.0.0.1',
    })
    render(<DialogueStream book={BOOK} />)

    const banner = await screen.findByTestId('provider-unavailable')
    // 真正可行的下一步：显式放行开关
    expect(banner.textContent).toContain('MOZHOU_ALLOW_PRIVATE_LLM=1')
    // 点名被拒的端点
    expect(banner.textContent).toContain('127.0.0.1')
    // 缺陷本体的反面：不得把本机用户送去填密钥
    expect(banner.textContent).not.toContain('账户 → 模型设置')
    expect(banner.textContent).not.toContain('填入你的 API 密钥')
    // 病因分类透出，供排障/埋点用
    expect(banner.getAttribute('data-reason')).toBe('provider_endpoint_blocked')
    // 阻断行为不变：仍不可生成
    expect(screen.getByLabelText('发送')).toBeDisabled()
    expect(fetchMock.mock.calls.some((call) => call[0] === '/api/draft.stream')).toBe(false)
  })

  it('真没配 provider（no_provider_configured）：横幅仍指向模型设置页填密钥（云端路径不得回归）', async () => {
    stubDialogueFetch({ providerAvailable: false, providerUnavailableReason: 'no_provider_configured' })
    render(<DialogueStream book={BOOK} />)

    const banner = await screen.findByTestId('provider-unavailable')
    expect(banner.textContent).toContain('账户 → 模型设置')
    expect(banner.textContent).toContain('API 密钥')
    // 云端用户不得看到无关的本机放行提示
    expect(banner.textContent).not.toContain('MOZHOU_ALLOW_PRIVATE_LLM')
    expect(banner.getAttribute('data-reason')).toBe('no_provider_configured')
  })

  it('流中断 error 帧：显式报错（role=alert），不静默', async () => {
    stubDialogueFetch({
      stream: [
        { ok: true, event: 'start', chapterIndex: 1, receiptId: null },
        { ok: true, event: 'delta', text: '开头' },
        { ok: false, event: 'error', error: 'provider 断流' },
      ],
    })
    render(<DialogueStream book={BOOK} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '两者递进' })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button', { name: '两者递进' }))
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('provider 断流')
    })
  })

  it('未建书：显式建书引导，不渲染对话流', () => {
    render(<DialogueStream book={null} />)
    expect(screen.getByTestId('dialogue-no-book').textContent).toContain('先建书')
  })
})