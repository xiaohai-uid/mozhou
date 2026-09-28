/**
 * 桌面端工作台 · 草稿终帧诚实性。
 *
 * 这里钉的是一条真实存在的缺陷：桌面端收到 done 帧一律 setPhase('draft_done')，
 * 界面上就是「AI CANDIDATE · DONE · 完成」加一个可采纳的候选，
 * 措辞从不经过 describeDraftResult——断流半稿（partial=true）和完整一章长得一模一样。
 * 移动端当时已经接了措辞，两端因此对同一帧给出不同说法；
 * draftStream 的注释写「两端不可能各说各话」，那句话当时是假的。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DialogueStream } from './DialogueStream'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function installStream(frames: Record<string, unknown>[]): void {
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url === '/api/capabilities') {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, providerAvailable: true, capabilities: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    if (url === '/api/draft.stream') {
      const lines = frames.map((f) => JSON.stringify(f) + '\n')
      const stream = new ReadableStream({
        start(controller) {
          for (const line of lines) controller.enqueue(new TextEncoder().encode(line))
          controller.close()
        },
      })
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }))
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }))
  })
}

function sendDraft(): void {
  fireEvent.change(screen.getByLabelText('写作指令'), { target: { value: '继续写' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
}

function renderStream(): void {
  render(<DialogueStream book={{ root: '/tmp/book', bookId: 'book_1', title: '书' }} />)
}

describe('DialogueStream · 草稿终帧诚实性', () => {
  it('断流半稿：不得报「DONE · 完成」，必须说清是半稿', async () => {
    installStream([
      { ok: true, event: 'start', candidateId: 'c1', base: '第一章', contextTokens: 1200, provider: 'byok' },
      { ok: true, event: 'delta', candidateId: 'c1', text: '只写了一半' },
      { ok: true, event: 'done', candidateId: 'c1', outcome: 'failed_recoverable', partial: true, chars: 5 },
    ])
    renderStream()
    sendDraft()

    await waitFor(() => {
      expect(screen.getByTestId('draft-text').textContent).toContain('只写了一半')
    })
    const kicker = screen.getByTestId('draft-slice').textContent ?? ''
    expect(kicker).not.toContain('DONE · 完成')
    expect(kicker).toContain('半稿')
  })

  it('完整成功：可以说完成，但正文仍未进小说——候选待采纳', async () => {
    installStream([
      { ok: true, event: 'start', candidateId: 'c2', base: '第一章', contextTokens: 1200, provider: 'byok' },
      { ok: true, event: 'delta', candidateId: 'c2', text: '完整一章' },
      { ok: true, event: 'done', candidateId: 'c2', outcome: 'succeeded', partial: false, chars: 4 },
    ])
    renderStream()
    sendDraft()

    await waitFor(() => {
      expect(screen.getByTestId('draft-slice').textContent).toContain('完整一章')
    })
    expect(screen.getByTestId('draft-slice').textContent).toContain('DONE · 完成')
  })

  it('未知 contextMode 也要透出，不得只认 structural_fallback', async () => {
    installStream([
      { ok: true, event: 'start', candidateId: 'c3', base: '第一章', contextMode: 'some_future_mode' },
      { ok: true, event: 'delta', candidateId: 'c3', text: '正文' },
      { ok: true, event: 'done', candidateId: 'c3', outcome: 'succeeded', partial: false, chars: 2 },
    ])
    renderStream()
    sendDraft()

    await waitFor(() => {
      expect(screen.getByTestId('context-degraded')).toBeDefined()
    })
    // 原样透出：模式名不认识也要让作者看见看见了什么，
    // 硬编码一个白名单等于把新模式的提示悄悄吞掉。
    expect(screen.getByTestId('context-degraded').textContent).toContain('some_future_mode')
  })

  it('无降级时不得凭空出现降级提示', async () => {
    installStream([
      { ok: true, event: 'start', candidateId: 'c4', base: '第一章', contextMode: 'compiled_receipt' },
      { ok: true, event: 'delta', candidateId: 'c4', text: '正文' },
      { ok: true, event: 'done', candidateId: 'c4', outcome: 'succeeded', partial: false, chars: 2 },
    ])
    renderStream()
    sendDraft()

    await waitFor(() => {
      expect(screen.getByTestId('draft-text').textContent).toContain('正文')
    })
    expect(screen.queryByTestId('context-degraded')).toBeNull()
  })
})
