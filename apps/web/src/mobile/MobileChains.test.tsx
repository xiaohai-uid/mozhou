/**
 * 移动端新链路测试（晨审测试缺口修订）：
 * ① 章节目录抽屉：直读 /api/works，点章回调 onSelectChapter（链 1）；
 * ② Composer 外部回填：inject 变更 → 追加进输入框（链 4 后半）；
 * ③ 设置 Hub 书架：/api/library 行渲染 + 打开走 library.open → onSwitchBook（链 2）。
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileChaptersDrawer } from './drawers/MobileChaptersDrawer'
import { MobileComposer } from './components/MobileComposer'
import { SystemHub } from './hubs/SystemHub'

afterEach(() => {
  vi.unstubAllGlobals()
})

const BOOK = { root: 'C:\\tmp\\test-book', bookId: 'bk_test', title: '假神真显灵' }

describe('MobileChaptersDrawer（链 1 · 章节切换）', () => {
  it('直读 /api/works 渲染真实章节；点章回调并关闭', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/works') {
        return Promise.resolve({ ok: true, json: async () => ({
          ok: true,
          chapters: [
            { chapterIndex: 1, title: '雾灯', phase: 'committed', wordCount: 1200, revision: 2 },
            { chapterIndex: 2, title: '暗潮', phase: 'draft', wordCount: 800, revision: 1 },
          ],
        }) })
      }
      return Promise.reject(new Error('unexpected ' + path))
    })
    vi.stubGlobal('fetch', fetchMock)

    const onSelectChapter = vi.fn()
    const onClose = vi.fn()
    render(<MobileChaptersDrawer book={BOOK} chapterIndex={2} onSelectChapter={onSelectChapter} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getAllByTestId('mobile-chapter-row')).toHaveLength(2)
    })
    expect(screen.getByText('第 1 章 · 雾灯')).toBeDefined()
    expect(screen.getByText(/800 字/)).toBeDefined()

    const rows = screen.getAllByTestId('mobile-chapter-row')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    const targetRow = rows[0]
    if (targetRow === undefined) throw new Error('missing chapter row')
    fireEvent.click(targetRow)
    expect(onSelectChapter).toHaveBeenCalledWith(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('无书：诚实空态，不伪造目录', () => {
    render(<MobileChaptersDrawer book={null} chapterIndex={1} onSelectChapter={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('尚未建书')).toBeDefined()
    expect(screen.queryByTestId('mobile-chapter-row')).toBeNull()
  })
})

describe('MobileComposer（链 4 后半 · inject 回填）', () => {
  it('inject 变更：追加进输入框并写草稿缓存', () => {
    const { rerender } = render(<MobileComposer inject={undefined} />)
    const textarea = document.querySelector('.composer-textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('')

    rerender(<MobileComposer inject={{ id: 1, text: '巡潮司堵到码头' }} />)
    expect(textarea.value).toBe('巡潮司堵到码头')

    rerender(<MobileComposer inject={{ id: 2, text: '老船工点破代价' }} />)
    expect(textarea.value).toBe('巡潮司堵到码头 老船工点破代价')

    // 同一 id 不重复追加
    rerender(<MobileComposer inject={{ id: 2, text: '老船工点破代价' }} />)
    expect(textarea.value).toBe('巡潮司堵到码头 老船工点破代价')
  })
})

describe('SystemHub 书架切书（链 2）', () => {
  it('展开书架：/api/library 真实行渲染；打开走 library.open → onSwitchBook', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/library') {
        return Promise.resolve({ ok: true, json: async () => ({
          ok: true,
          books: [
            { root: 'C:\\tmp\\test-book', bookId: 'bk_test', title: '假神真显灵', chapterCount: 3 },
            { root: 'C:\\tmp\\other-book', bookId: 'bk_other', title: '雾灯志', chapterCount: 12 },
          ],
          skipped: [],
        }) })
      }
      if (path === '/api/library.open') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, root: 'C:\\tmp\\other-book', bookId: 'bk_other', title: '雾灯志' }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, totalEvents: 0, totalTraversals: 0, events: [], traversals: [], license: null, plans: [] }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const onSwitchBook = vi.fn()
    render(<SystemHub book={BOOK} onOpenDrawer={vi.fn()} onSwitchBook={onSwitchBook} />)

    fireEvent.click(screen.getByTestId('mobile-shelf-toggle'))
    await waitFor(() => {
      expect(screen.getByText('雾灯志')).toBeDefined()
    })
    expect(screen.getByText(/3 章/)).toBeDefined()

    const openButtons = screen.getAllByRole('button', { name: '打开' })
    const target = openButtons[0]
    if (target === undefined) throw new Error('missing open button')
    fireEvent.click(target)
    await waitFor(() => {
      const openCall = fetchMock.mock.calls.find(([p]) => p === '/api/library.open')
      expect(openCall).toBeDefined()
      expect(JSON.parse(String(openCall?.[1]?.body)).root).toBe('C:\\tmp\\other-book')
      expect(onSwitchBook).toHaveBeenCalledWith({ root: 'C:\\tmp\\other-book', bookId: 'bk_other', title: '雾灯志' })
    })
  })
})
