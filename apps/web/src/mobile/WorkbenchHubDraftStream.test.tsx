/**
 * 移动端工作台 · 草稿流诚实性测试。
 *
 * 这里钉的是一条曾经真实存在的缺陷：本文件曾自己解一遍 NDJSON 帧，
 * 于是把 done(partial=true) 的断流半稿也报成「已完成并持久化」。
 * 帧协议与措辞现在共用 ../../draftStream，本测试守住渲染面不许回退。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchHub } from './hubs/WorkbenchHub'

const BOOK = { root: 'C:\\tmp\\honest-book', bookId: 'bk_honest', title: '诚实书' }

afterEach(() => {
  vi.unstubAllGlobals()
})

function ndjson(lines: string[]): Response {
  const chunks = lines.map((line) => new TextEncoder().encode(line + '\n'))
  let index = 0
  return {
    ok: true,
    status: 200,
    headers: { get: (key: string) => (key.toLowerCase() === 'content-type' ? 'application/x-ndjson; charset=utf-8' : null) },
    body: {
      getReader: () => ({
        read: () =>
          Promise.resolve(
            index < chunks.length
              ? { done: false, value: chunks[index++] }
              : { done: true, value: undefined },
          ),
      }),
    },
  } as unknown as Response
}

function stubFetch(frames: string[]): void {
  const fetchMock = vi.fn().mockImplementation((path: string) => {
    if (path === '/api/draft.stream') return Promise.resolve(ndjson(frames))
    if (path === '/api/draft.question') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, choices: [] }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
  })
  vi.stubGlobal('fetch', fetchMock)
}

function sendPrompt(): void {
  const input = screen.getByPlaceholderText(/输入推进指令/)
  fireEvent.change(input, { target: { value: '推进' } })
  fireEvent.click(screen.getByLabelText('生成草稿'))
}

function renderHub(): void {
  render(<WorkbenchHub book={BOOK} onOpenDrawer={vi.fn()} chapterIndex={1} />)
}

/** 提示条的配色档位：末位那个词就是 kind（ok / warn / err）。 */
function noticeKind(): string {
  const cls = screen.getByTestId('workbench-notice').className
  return (cls.split(' ').pop() ?? '').trim()
}

describe('WorkbenchHub · 草稿流终帧诚实性', () => {
  it('done(partial=true) 断流半稿：必须说是半稿，不得说已持久化', async () => {
    stubFetch([
      JSON.stringify({ ok: true, event: 'start', candidateId: 'c1' }),
      JSON.stringify({ ok: true, event: 'delta', candidateId: 'c1', text: '只写了一半' }),
      JSON.stringify({ ok: true, event: 'done', candidateId: 'c1', outcome: 'failed_recoverable', partial: true, chars: 5 }),
    ])
    renderHub()
    sendPrompt()

    await waitFor(() => {
      expect(screen.getByTestId('workbench-notice')).toBeDefined()
    })
    const text = screen.getByTestId('workbench-notice').textContent ?? ''
    expect(text).toContain('半稿')
    expect(text).not.toContain('已持久化')
    expect(text).not.toContain('已落盘')
    // 文字对了、颜色错了，等于还在骗人：半稿挂绿色成功档，
    // 作者扫一眼就当成了完整一章。配色必须跟着事实走。
    expect(noticeKind()).not.toBe('ok')
    expect(noticeKind()).toBe('warn')
  })

  it('完整成功：说是候选并说明需采纳，不得说已持久化', async () => {
    stubFetch([
      JSON.stringify({ ok: true, event: 'start', candidateId: 'c2' }),
      JSON.stringify({ ok: true, event: 'delta', candidateId: 'c2', text: '完整一章' }),
      JSON.stringify({ ok: true, event: 'done', candidateId: 'c2', outcome: 'succeeded', partial: false, chars: 4 }),
    ])
    renderHub()
    sendPrompt()

    await waitFor(() => {
      const text = screen.getByTestId('workbench-notice').textContent ?? ''
      expect(text).toContain('候选')
    })
    const text = screen.getByTestId('workbench-notice').textContent ?? ''
    expect(text).toContain('采纳')
    expect(text).not.toContain('已持久化')
    // 完整成功才配绿色：这是唯一一种「绿得对」的情况。
    expect(noticeKind()).toBe('ok')
  })

  it('error 帧：报失败，不得报完成', async () => {
    stubFetch([
      JSON.stringify({ ok: true, event: 'start', candidateId: 'c3' }),
      JSON.stringify({ ok: false, event: 'error', error: '上游 502' }),
    ])
    renderHub()
    sendPrompt()

    await waitFor(() => {
      const text = screen.getByTestId('workbench-notice').textContent ?? ''
      expect(text).toContain('生成失败')
    })
    const text = screen.getByTestId('workbench-notice').textContent ?? ''
    expect(text).toContain('上游 502')
    expect(text).not.toContain('已持久化')
  })
})
