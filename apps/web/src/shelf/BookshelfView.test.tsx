/**
 * 书架（本地书库）组件测试：
 * - 契约快照：输入形状 = server/api 导出类型（LibraryResponse / LibraryOpenResponse），
 *   包类型漂移即 typecheck + 快照双报警；
 * - 书库列表渲染（书名/章数/书 id + root）+ 当前书高亮禁用「打开」；
 * - 开书 → onSwitchBook 回调（BookInfo 形状）；
 * - 书源导入：输入书名 → /api/library.import → 刷新列表 + 切书 + 清输入；
 * - 空书库 / 无书库目录显式引导；skipped 显式提示；错误显式报错。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryResponse, LibraryOpenResponse } from '../../server/api'
import { okJson } from '../test/http'
import { BookshelfView } from './BookshelfView'

afterEach(() => {
  vi.unstubAllGlobals()
})

const PARENT = 'C:/tmp/lib'

const LIBRARY: LibraryResponse = {
  ok: true,
  skipped: [],
  books: [
    { root: 'C:/tmp/lib/甲书', bookId: 'bk_a', title: '甲书', chapterCount: 1 },
    { root: 'C:/tmp/lib/乙书', bookId: 'bk_b', title: '乙书', chapterCount: 0 },
  ],
}

function stubShelfFetch(overrides?: { library?: LibraryResponse; open?: LibraryOpenResponse }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation((path: string) => {
    if (path === '/api/library') return okJson(overrides?.library ?? LIBRARY)
    if (path === '/api/library.open') {
      if (overrides?.open !== undefined) return okJson(overrides.open)
      return okJson({ ok: true, root: 'C:/tmp/lib/甲书', bookId: 'bk_a', title: '甲书' })
    }
    if (path === '/api/library.import') {
      return okJson({ ok: true, root: 'C:/tmp/lib/新书', bookId: 'bk_new', title: '新书' })
    }
    return okJson({ ok: false, error: 'unexpected path: ' + path })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('BookshelfView（书架）', () => {
  it('书库列表渲染（书名/章数/书 id）+ 当前书高亮禁用；契约快照', async () => {
    stubShelfFetch()
    const { container } = render(
      <BookshelfView parentDir={PARENT} currentRoot="C:/tmp/lib/甲书" onSwitchBook={() => {}} />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('bookshelf-list').textContent).toContain('甲书')
    })
    expect(screen.getByTestId('bookshelf-list').textContent).toContain('乙书')
    expect(screen.getByTestId('bookshelf-list').textContent).toContain('1 章')
    // 当前书（甲书）「打开」禁用
    const openButtons = screen.getAllByTestId('bookshelf-open')
    expect(openButtons).toHaveLength(2)
    const current = openButtons.find((b) => b.getAttribute('data-root') === 'C:/tmp/lib/甲书')
    if (current === undefined) throw new Error('missing current book open button')
    expect(current).toBeDisabled()
    expect(container.querySelector('[aria-label="bookshelf-view"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="bookshelf-view"]')).toMatchSnapshot()
  })

  it('开书 → onSwitchBook 回调 BookInfo（bookId/title/root）', async () => {
    stubShelfFetch()
    const onSwitchBook = vi.fn()
    render(<BookshelfView parentDir={PARENT} currentRoot="C:/tmp/lib/甲书" onSwitchBook={onSwitchBook} />)
    await waitFor(() => {
      expect(screen.getByTestId('bookshelf-list').textContent).toContain('乙书')
    })
    const openB = screen.getAllByTestId('bookshelf-open').find((b) => b.getAttribute('data-root') === 'C:/tmp/lib/乙书')
    if (openB === undefined) throw new Error('missing 乙书 open button')
    await userEvent.click(openB)
    await waitFor(() => {
      expect(onSwitchBook).toHaveBeenCalledWith({
        root: 'C:/tmp/lib/甲书',
        bookId: 'bk_a',
        title: '甲书',
      })
    })
  })

  it('书源导入：输入书名 → /api/library.import（携 parentDir+title）→ 刷新 + 切书 + 清输入', async () => {
    const fetchMock = stubShelfFetch()
    const onSwitchBook = vi.fn()
    render(<BookshelfView parentDir={PARENT} currentRoot={null} onSwitchBook={onSwitchBook} />)
    await waitFor(() => {
      expect(screen.getByLabelText('书源书名')).toBeInTheDocument()
    })
    await userEvent.type(screen.getByLabelText('书源书名'), '新书')
    await userEvent.click(screen.getByRole('button', { name: '导入书架' }))
    await waitFor(() => {
      expect(onSwitchBook).toHaveBeenCalledWith({ root: 'C:/tmp/lib/新书', bookId: 'bk_new', title: '新书' })
    })
    const importCall = fetchMock.mock.calls.find((call) => call[0] === '/api/library.import')
    if (importCall === undefined) throw new Error('missing import call')
    const init = importCall[1] as { body?: string }
    expect(JSON.parse(init.body ?? '{}')).toEqual({ parentDir: PARENT, title: '新书' })
    expect(screen.getByLabelText('书源书名')).toHaveValue('')
  })

  it('无书库目录：显式引导（不假装可用）', () => {
    render(<BookshelfView parentDir={null} currentRoot={null} onSwitchBook={() => {}} />)
    expect(screen.getByTestId('bookshelf-empty').textContent).toContain('书架暂不可用')
  })

  it('空书库 + skipped 显式提示', async () => {
    stubShelfFetch({ library: { ok: true, books: [], skipped: [{ path: '坏书', reason: 'bad book.json' }, { path: '残书', reason: 'missing book.json' }] } })
    render(<BookshelfView parentDir={PARENT} currentRoot={null} onSwitchBook={() => {}} />)
    await waitFor(() => {
      expect(screen.getByTestId('bookshelf-none').textContent).toContain('暂无书籍')
    })
    expect(screen.getByTestId('bookshelf-skipped').textContent).toContain('2 个目录')
  })

  it('读取失败显式报错（role=alert），不静默', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((path: string) => {
        if (path === '/api/library') {
          return new Response(JSON.stringify({ ok: false, error: '书库扫描失败' }), { status: 500 })
        }
        return okJson({ ok: false, error: 'unexpected path: ' + path })
      }),
    )
    render(<BookshelfView parentDir={PARENT} currentRoot={null} onSwitchBook={() => {}} />)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('书库扫描失败')
    })
  })
})