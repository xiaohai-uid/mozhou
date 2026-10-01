import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogueStream } from './DialogueStream'
import { okJson } from '../test/http'

const book = { root: 'C:/tmp/cancel-book', bookId: 'cancel-book', title: '停止生成验收' }
const base = { revision: 1, sha256: 'a'.repeat(64) }
const encoder = new TextEncoder()

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals() })

function install(pending = false) {
  let controller: ReadableStreamDefaultController<Uint8Array>
  let signal: AbortSignal | null = null
  let release: ((response: Response) => void) | undefined
  const cancel = vi.fn()
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/capabilities') return okJson({ ok: true, providerAvailable: true, capabilities: [] })
    if (path === '/api/draft.question') return okJson({ ok: true, question: '下一段？', choices: [], hint: '' })
    if (path === '/api/draft.stream') {
      signal = init?.signal ?? null
      if (pending) return await new Promise<Response>((resolve) => { release = resolve })
      return new Response(new ReadableStream<Uint8Array>({
        start(c) { controller = c },
        cancel,
      }), { headers: { 'Content-Type': 'application/x-ndjson' } })
    }
    return okJson({ ok: false })
  })
  vi.stubGlobal('fetch', fetcher)
  return {
    fetcher, cancel, signal: () => signal,
    emit(frame: object) { act(() => { controller.enqueue(encoder.encode(JSON.stringify(frame) + '\n')) }) },
    async finish() { await act(async () => { controller.close(); await Promise.resolve() }) },
    release(response: Response) { act(() => { release?.(response) }) },
  }
}

async function send() {
  await waitFor(() => expect(screen.getByText('下一段？')).toBeInTheDocument())
  fireEvent.change(screen.getByRole('textbox', { name: '写作指令' }), { target: { value: '继续写' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
}

describe('作者停止生成', () => {
  it('停止正在输出的流，保留半稿且不采纳；重新生成能完成', async () => {
    const stream = install()
    render(<DialogueStream book={book} />)
    await send()
    await waitFor(() => expect(stream.signal()).not.toBeNull())
    stream.emit({ ok: true, event: 'start', candidateId: 'cancelled', base })
    stream.emit({ ok: true, event: 'delta', text: '尚未完成的半稿' })
    await waitFor(() => expect(screen.getByTestId('draft-text')).toHaveTextContent('尚未完成的半稿'))
    expect(screen.getByRole('button', { name: '停止生成' }).closest('.composer-wrap')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
    expect(stream.signal()?.aborted).toBe(true)
    await waitFor(() => expect(stream.cancel).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('draft-terminal-note')).toHaveTextContent('已停止')
    expect(screen.getByTestId('adopt-into-slate')).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '写作指令' })).toBeEnabled()
    expect(stream.fetcher.mock.calls.some(([path]) => path === '/api/draft.accept' || path === '/api/chapter.prose.save')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(stream.fetcher.mock.calls.filter(([p]) => p === '/api/draft.stream')).toHaveLength(2))
    stream.emit({ ok: true, event: 'start', candidateId: 'complete', base })
    stream.emit({ ok: true, event: 'delta', text: '新的完整候选' })
    stream.emit({ ok: true, event: 'done', partial: false, outcome: 'succeeded', chars: 6 })
    await waitFor(() => expect(screen.getByTestId('adopt-into-slate')).toBeEnabled())
    expect(screen.getByTestId('draft-text')).toHaveTextContent('新的完整候选')
    expect(screen.getByTestId('draft-text')).not.toHaveTextContent('尚未完成')
  })

  it('请求尚未返回也能停止，迟到的响应不恢复旧候选', async () => {
    const stream = install(true)
    render(<DialogueStream book={book} />)
    await send()
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
    expect(stream.signal()?.aborted).toBe(true)
    const cancel = vi.fn()
    stream.release(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/x-ndjson' } }))
    await waitFor(() => expect(cancel).toHaveBeenCalled())
    expect(screen.getByRole('textbox', { name: '写作指令' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument()
  })

  it('半稿缓存重新打开仍不可当完整候选采纳', async () => {
    const stream = install()
    const view = render(<DialogueStream book={book} />)
    await send()
    await waitFor(() => expect(stream.signal()).not.toBeNull())
    stream.emit({ ok: true, event: 'start', candidateId: 'partial-cache', base })
    stream.emit({ ok: true, event: 'delta', text: '半稿' })
    await waitFor(() => expect(screen.getByTestId('draft-text')).toHaveTextContent('半稿'))
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
    view.unmount()
    render(<DialogueStream book={book} />)
    expect(screen.getByTestId('draft-slice')).toHaveTextContent('半稿')
    expect(screen.getByTestId('adopt-into-slate')).toBeDisabled()
  })

  it('切章取消尚未返回的请求，不占住新章节的输入', async () => {
    const stream = install(true)
    const view = render(<DialogueStream book={book} chapterIndex={1} />)
    await send()
    view.rerender(<DialogueStream book={book} chapterIndex={2} />)
    expect(stream.signal()?.aborted).toBe(true)
    expect(screen.getByRole('textbox', { name: '写作指令' })).toBeEnabled()
  })

  it('无终帧断开也解除生成状态，保留半稿并禁止采纳', async () => {
    const stream = install()
    render(<DialogueStream book={book} />)
    await send()
    stream.emit({ ok: true, event: 'start', candidateId: 'eof', base })
    stream.emit({ ok: true, event: 'delta', text: '连接突然中断前的文字' })
    await waitFor(() => expect(screen.getByTestId('draft-text')).toHaveTextContent('连接突然中断前的文字'))
    await stream.finish()
    expect(screen.getByRole('textbox', { name: '写作指令' })).toBeEnabled()
    expect(screen.getByTestId('adopt-into-slate')).toBeDisabled()
    expect(screen.getByTestId('draft-slice')).toHaveTextContent('断流半稿')
  })
})
