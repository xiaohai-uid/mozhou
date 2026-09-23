/**
 * 出版导出弹窗测试：
 * - 打开时拉取结构化章节（POST /api/book.export-txt structured:true）；
 * - EPUB 路径产出 application/epub+zip Blob 并以正确文件名触发下载；
 * - 章节读取失败时显式报错，不假装成功（诚实态门禁）。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublicationExportModal } from './PublicationExportModal'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const STRUCTURED_RESPONSE = {
  ok: true,
  title: '夜雨江澜',
  chapters: [
    { index: 1, title: '第一章', content: '江水初涨。' },
    { index: 2, title: '第二章', content: '钟声骤响。' },
  ],
}

function stubFetch(data: unknown, status: number): ReturnType<typeof vi.fn<[path: string, init?: RequestInit], Promise<Response>>> {
  const fetchMock = vi.fn<[path: string, init?: RequestInit], Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify(data), { status })),
  )
  globalThis.fetch = fetchMock
  return fetchMock
}

function renderModal() {
  return render(
    <PublicationExportModal isOpen onClose={() => undefined} root="/tmp/book" bookTitle="夜雨江澜" />,
  )
}

describe('PublicationExportModal', () => {
  it('打开时以 structured:true 拉取章节并显示章数', async () => {
    const fetchMock = stubFetch(STRUCTURED_RESPONSE, 200)

    renderModal()

    await waitFor(() => expect(screen.getByTestId('pub-chapters-count')).toHaveTextContent('2 章'))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/book.export-txt',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = fetchMock.mock.calls[0]?.[1]?.body ?? ''
    expect(JSON.parse(body)).toEqual({ root: '/tmp/book', structured: true })
  })

  it('EPUB 导出：产出 epub+zip Blob 并以《书名》_EPUB.epub 触发下载', async () => {
    stubFetch(STRUCTURED_RESPONSE, 200)
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(), writable: true, configurable: true })
    }
    if (!URL.revokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true, configurable: true })
    }
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const user = userEvent.setup()
    renderModal()
    await waitFor(() => expect(screen.getByTestId('pub-chapters-count')).toHaveTextContent('2 章'))

    await user.click(screen.getByTestId('pub-format-epub'))
    await user.click(screen.getByTestId('pub-export-run'))

    await waitFor(() => expect(createObjectUrlSpy).toHaveBeenCalledTimes(1))
    const blob = createObjectUrlSpy.mock.calls[0]?.[0]
    expect(blob?.type).toBe('application/epub+zip')
    expect(blob?.size).toBeGreaterThan(0)
    expect(clickSpy).toHaveBeenCalled()
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('《夜雨江澜》_EPUB.epub')
  })

  it('章节读取失败时显式报错且导出按钮禁用', async () => {
    stubFetch({ ok: false, error: '无可导出章节正文' }, 400)

    renderModal()

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('无可导出章节正文'))
    expect(screen.getByTestId('pub-export-run')).toBeDisabled()
  })
})
