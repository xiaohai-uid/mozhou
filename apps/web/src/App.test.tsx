/**
 * 壳集成测试（实现票 T40）：Ink Orbit 工作台壳拼装 + localStorage
 * 恢复（书名 + 视图状态，刷新不丢）+ 导航切换显式占位。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { okJson } from './test/http'
import { emptyCanonState } from './test/fixtures'

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

const STORED_BOOK = {
  root: 'C:\\tmp\\stored-book',
  bookId: 'bk_stored',
  title: '雾港失真',
}

/** 壳级按路径 stub：建书 + Story Brain 三读面 + 质量门缺省；未知 /api 路径显式抛错（防未来回归静默通过）。 */
function stubAppFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (path: string) => {
      if (path === '/api/book') return okJson({ ok: true, root: 'C:\\tmp\\app-book', bookId: 'bk_app' })
      if (path === '/api/book.state') return okJson({ ok: true, state: emptyCanonState() })
      if (path === '/api/story-brain.entities') return okJson({ ok: true, cards: [] })
      if (path === '/api/story-brain.facts') {
        return okJson({ ok: true, chapter: 1, currentChapterIndex: null, chapters: [], canon: [], perspective: [], invalidated: [] })
      }
      if (path === '/api/chapter.quality') return okJson({ ok: true, hasReport: false })
      throw new Error('unexpected fetch path in shell test: ' + path)
    }),
  )
}

describe('App 壳集成（T40）', () => {
  it('五屏齐备：顶栏 / 管线条 / 航道 / 中栏 / 检视塔', () => {
    stubAppFetch()
    render(<App />)
    expect(document.querySelector('.topbar')).not.toBeNull()
    expect(screen.getByLabelText('章节生产管线')).not.toBeNull()
    expect(screen.getByLabelText('完整功能导航')).not.toBeNull()
    expect(screen.getByTestId('create-book')).not.toBeNull()
    expect(screen.getByLabelText('检视塔')).not.toBeNull()
    expect(screen.getByLabelText('章节生产管线').querySelectorAll('.step')).toHaveLength(8)
  })

  it('刷新恢复：localStorage 中的书与视图状态还原（US12）', async () => {
    window.localStorage.setItem(
      'mozhou.workbench.v1',
      JSON.stringify({ book: STORED_BOOK, view: 'workbench' }),
    )
    stubAppFetch()
    render(<App />)
    expect(document.querySelector('.topbar .book-switch')?.textContent).toContain('雾港失真')
    expect(document.querySelector('.chapterbar h1')?.textContent).toBe('《雾港失真》')
    expect(screen.getByTestId('created-book').textContent).toContain('bk_stored')
  })

  it('未建书时质量门 tab 呈显式空态；建书后挂载 QualityPanel', async () => {
    stubAppFetch()
    render(<App />)
    // 建书前 quality 与 story-brain 两个 tab 均为显式空态（T41 起两处）；
    // 此处断言质量门空态的专属文案在列
    const empties = screen.getAllByTestId('inspector-empty')
    expect(empties.map((el) => el.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('文学质量审查')]),
    )

    const titleInput = screen.getByLabelText('作品名')
    await userEvent.clear(titleInput)
    await userEvent.type(titleInput, '新书')
    await userEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      expect(screen.getByLabelText('literary-quality-panel')).toBeInTheDocument()
    })
    expect(document.querySelector('.chapterbar h1')?.textContent).toBe('《新书》')
  })

  it('检视组导航点击切到中栏显式占位（未实现页不假装可用）', async () => {
    stubAppFetch()
    render(<App />)
    const receiptNav = document.querySelector('[data-view="context-receipt"]')
    if (receiptNav === null) throw new Error('missing context-receipt nav')
    await userEvent.click(receiptNav as HTMLElement)
    expect(screen.getByTestId('placeholder-view').textContent).toContain('T42')
    const rankNav = document.querySelector('[data-view="rank-scan"]')
    if (rankNav === null) throw new Error('missing rank-scan nav')
    await userEvent.click(rankNav as HTMLElement)
    expect(screen.getByTestId('placeholder-view').textContent).toContain('尚未实现')
  })

  it('管线条点击切换激活阶段（牵引背景墨迹聚焦）', async () => {
    stubAppFetch()
    render(<App />)
    const commit = document.querySelector('[data-stage="commit"]')
    if (commit === null) throw new Error('missing commit step')
    await userEvent.click(commit as HTMLElement)
    expect(commit.className).toContain('active')
    expect(document.querySelector('[data-stage="prepare"]')?.className).toContain('done')
  })

  it('书名与视图经 localStorage 持久化（建书后写入）', async () => {
    stubAppFetch()
    render(<App />)
    const titleInput = screen.getByLabelText('作品名')
    await userEvent.clear(titleInput)
    await userEvent.type(titleInput, '持久之书')
    await userEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      const raw = window.localStorage.getItem('mozhou.workbench.v1')
      expect(raw).not.toBeNull()
      const state = JSON.parse(raw as string) as { book: { title: string } | null }
      expect(state.book?.title).toBe('持久之书')
    })
  })
})
