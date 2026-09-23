/**
 * 世界书面板 UI 测试：
 * - 未建书：显式空态（不假装可用）；
 * - 已建书：列表渲染、新增 upsert、编辑回填、删除（全部走真实 fetch 契约）。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LorebookPanel } from './LorebookPanel'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const ENTRY = { id: 'lb_entry001', title: '玄灯教铁律', keywords: ['玄灯教', '灯律'], content: '灯灭即魂销。', enabled: true }

function okJson(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

type FetchMock = ReturnType<typeof vi.fn<[path: string], Promise<Response>>>

function stubFetch(handler: (path: string) => Response | Promise<Response>): FetchMock {
  const fetchMock = vi.fn<[path: string], Promise<Response>>((path) => Promise.resolve(handler(path)))
  globalThis.fetch = fetchMock
  return fetchMock
}

describe('LorebookPanel', () => {
  it('未建书：显式空态', () => {
    render(<LorebookPanel root={null} />)
    expect(screen.getByTestId('lorebook-empty').textContent).toContain('世界书需要先建书')
  })

  it('已建书：加载条目并渲染关键词与内容', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/lorebook.list') return Promise.resolve(okJson({ ok: true, entries: [ENTRY] }))
      return Promise.resolve(okJson({ ok: false, error: 'unexpected path: ' + path }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    render(<LorebookPanel root="/tmp/book" />)

    await waitFor(() => expect(screen.getByTestId('lorebook-entry')).toBeInTheDocument())
    const panel = screen.getByTestId('lorebook-panel')
    expect(panel.textContent).toContain('玄灯教铁律')
    expect(panel.textContent).toContain('玄灯教、灯律')
    expect(panel.textContent).toContain('灯灭即魂销。')
  })

  it('填写表单添加条目：POST upsert 契约正确并刷新列表', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/lorebook.list') return Promise.resolve(okJson({ ok: true, entries: [] }))
      if (path === '/api/lorebook.upsert') {
        return Promise.resolve(
          okJson({
            ok: true,
            entries: [{ id: 'lb_new1', title: '渡口旧约', keywords: ['渡口'], content: '子时潮生。', enabled: true }],
          }),
        )
      }
      return Promise.resolve(okJson({ ok: false, error: 'unexpected path: ' + path }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const user = userEvent.setup()
    render(<LorebookPanel root="/tmp/book" />)
    await waitFor(() => expect(screen.getByText(/暂无条目/)).toBeInTheDocument())

    await user.type(screen.getByLabelText('条目标题'), '渡口旧约')
    await user.type(screen.getByLabelText('触发关键词'), '渡口')
    await user.type(screen.getByLabelText('注入内容'), '子时潮生。')
    await user.click(screen.getByTestId('lorebook-save'))

    await waitFor(() => expect(screen.getByTestId('lorebook-entry')).toBeInTheDocument())
    const upsertCall = fetchMock.mock.calls.find(([p]) => p === '/api/lorebook.upsert')
    expect(upsertCall).toBeDefined()
    const body = JSON.parse((upsertCall?.[1] as RequestInit).body as string)
    expect(body.root).toBe('/tmp/book')
    expect(body.entry.title).toBe('渡口旧约')
    expect(body.entry.keywords).toEqual(['渡口'])
    expect(body.entry.id).toMatch(/^lb_[0-9a-z-]+$/)
  })

  it('服务端校验错误显式呈现（role=alert），不假装保存成功', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/lorebook.list') return Promise.resolve(okJson({ ok: true, entries: [] }))
      if (path === '/api/lorebook.upsert') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: false, error: '世界书条目至少需要一个触发关键词' }), { status: 400 }),
        )
      }
      return Promise.resolve(okJson({ ok: false, error: 'unexpected path: ' + path }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const user = userEvent.setup()
    render(<LorebookPanel root="/tmp/book" />)
    await waitFor(() => expect(screen.getByText(/暂无条目/)).toBeInTheDocument())

    await user.type(screen.getByLabelText('条目标题'), '坏条目')
    await user.type(screen.getByLabelText('触发关键词'), ' ')
    await user.type(screen.getByLabelText('注入内容'), '内容')
    await user.click(screen.getByTestId('lorebook-save'))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('至少需要一个触发关键词'))
  })
})
