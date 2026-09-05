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
  stream?: readonly Record<string, unknown>[]
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation((path: string) => {
    if (path === '/api/capabilities') {
      return okJson({ ...CAPS, providerAvailable: options.providerAvailable ?? true })
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
      expect(screen.getByTestId('provider-unavailable').textContent).toContain('provider 未配置')
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
      expect(screen.getByTestId('provider-unavailable').textContent).toContain('provider 未配置')
    })
    expect(screen.getByLabelText('发送')).toBeDisabled()
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

  it('流未发送 done 提前断开：停在错误态，不展示生成完成', async () => {
    stubDialogueFetch({
      stream: [
        { ok: true, event: 'start', chapterIndex: 1, receiptId: null },
        { ok: true, event: 'delta', text: '半截正文' },
      ],
    })
    render(<DialogueStream book={BOOK} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '两者递进' })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button', { name: '两者递进' }))
    await userEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.getByRole('alert').textContent).toContain('中断')
    expect(screen.queryByTestId('draft-slice')?.textContent ?? '').not.toContain('完成')
  })

  it('切换章节重置对话流展示与输入，不残留上一章状态', async () => {
    stubDialogueFetch({
      stream: [
        { ok: true, event: 'start', chapterIndex: 1, receiptId: null },
        { ok: true, event: 'delta', text: '第1章草稿' },
        { ok: true, event: 'done', outcome: 'succeeded' },
      ],
    })
    const { rerender } = render(<DialogueStream book={BOOK} chapterIndex={1} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '两者递进' })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button', { name: '两者递进' }))
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => {
      expect(screen.getByTestId('draft-text').textContent).toBe('第1章草稿')
    })

    // 切到第 2 章
    rerender(<DialogueStream book={BOOK} chapterIndex={2} />)
    expect(screen.queryByTestId('draft-text')).toBeNull()
    expect(screen.getByLabelText('写作指令')).toHaveValue('')
  })
})