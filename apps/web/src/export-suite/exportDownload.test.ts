// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchBookChaptersForExport } from './exportDownload'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function requestBody(init?: RequestInit): string {
  return typeof init?.body === 'string' ? init.body : '{}'
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchBookChaptersForExport', () => {
  it('任一章节读取失败时整体拒绝导出，不用空字符串伪装成功', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input)
      if (url === '/api/works') {
        return jsonResponse({
          ok: true,
          chapters: [
            { chapterIndex: 1, title: '第一章' },
            { chapterIndex: 2, title: '第二章' },
          ],
        })
      }

      if (url === '/api/chapter.prose') {
        const payload = JSON.parse(requestBody(init)) as { chapterIndex?: number }
        if (payload.chapterIndex === 1) {
          return jsonResponse({ ok: true, body: '第一章正文' })
        }
        return jsonResponse({ ok: false, code: 'CHAPTER_MISSING', error: 'chapter 2 missing' }, 404)
      }

      return jsonResponse({ ok: false, error: 'unexpected request' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchBookChaptersForExport('C:/book')).rejects.toThrow(
      '第 2 章正文读取失败，已取消导出',
    )
  })

  it('章节正文为空时同样整体拒绝导出', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url === '/api/works') {
        return jsonResponse({ ok: true, chapters: [{ chapterIndex: 1, title: '第一章' }] })
      }
      if (url === '/api/chapter.prose') {
        return jsonResponse({ ok: true, body: '   ' })
      }
      return jsonResponse({ ok: false, error: 'unexpected request' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchBookChaptersForExport('C:/book')).rejects.toThrow(
      '第 1 章正文读取失败，已取消导出',
    )
  })
})
