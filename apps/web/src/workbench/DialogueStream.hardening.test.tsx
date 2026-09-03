import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DialogueStream } from './DialogueStream'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('DialogueStream release contract', () => {
  it('sends selected skills through the activeSkills field consumed by the server', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
      requests.push({ url, body })

      if (url === '/api/capabilities') {
        return new Response(JSON.stringify({
          ok: true,
          providerAvailable: true,
          capabilities: [{ id: 'suspense', label: '悬念调度' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/draft.question') {
        return new Response(JSON.stringify({
          ok: true,
          question: '下一段？',
          hint: '测试',
          choices: ['继续'],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/draft.stream') {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ ok: true, event: 'done', chars: 0 }) + '\n'))
            controller.close()
          },
        })
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    render(<DialogueStream book={{ root: '/tmp/book', bookId: 'book_1', title: '书' }} />)

    const skill = await screen.findByRole('button', { name: '悬念调度' })
    fireEvent.click(skill)
    fireEvent.change(screen.getByLabelText('写作指令'), { target: { value: '继续写' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(requests.some((request) => request.url === '/api/draft.stream')).toBe(true))
    const draft = requests.find((request) => request.url === '/api/draft.stream')!
    expect(draft.body.activeSkills).toEqual(['suspense'])
    expect(draft.body).not.toHaveProperty('skills')
  })
})
