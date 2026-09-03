import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DialogueStream } from './DialogueStream'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function installFetchRecorder(): { requests: { url: string; body: Record<string, unknown> }[] } {
  const requests: { url: string; body: Record<string, unknown> }[] = []
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
    requests.push({ url, body })

    if (url === '/api/capabilities') {
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        providerAvailable: true,
        capabilities: [{ id: 'suspense', label: '悬念调度' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    if (url === '/api/draft.question') {
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        question: '下一段？',
        hint: '测试',
        choices: ['继续'],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    if (url === '/api/draft.stream') {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ ok: true, event: 'done', chars: 0 }) + '\n'))
          controller.close()
        },
      })
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }))
    }
    return Promise.resolve(new Response('404', { status: 404 }))
  })
  return { requests }
}

async function sendDraft(): Promise<void> {
  const skill = await screen.findByRole('button', { name: '悬念调度' })
  fireEvent.click(skill)
  fireEvent.change(screen.getByLabelText('写作指令'), { target: { value: '继续写' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
}

describe('DialogueStream release contract', () => {
  it('sends selected skills through the activeSkills field consumed by the server', async () => {
    const { requests } = installFetchRecorder()
    render(<DialogueStream book={{ root: '/tmp/book', bookId: 'book_1', title: '书' }} />)
    await sendDraft()

    await waitFor(() => expect(requests.some((request) => request.url === '/api/draft.stream')).toBe(true))
    const draft = requests.find((request) => request.url === '/api/draft.stream')!
    expect(draft.body.activeSkills).toEqual(['suspense'])
    expect(draft.body).not.toHaveProperty('skills')
  })

  it('sends the selected chapter index instead of hard-coding chapter 1', async () => {
    const { requests } = installFetchRecorder()
    const Component = DialogueStream as unknown as (props: {
      book: { root: string; bookId: string; title: string }
      chapterIndex: number
    }) => JSX.Element
    render(<Component book={{ root: '/tmp/book', bookId: 'book_1', title: '书' }} chapterIndex={7} />)
    await sendDraft()

    await waitFor(() => expect(requests.some((request) => request.url === '/api/draft.stream')).toBe(true))
    const draft = requests.find((request) => request.url === '/api/draft.stream')!
    expect(draft.body.chapterIndex).toBe(7)
  })
})
