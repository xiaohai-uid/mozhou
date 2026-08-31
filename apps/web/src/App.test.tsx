/**
 * 壳集成测试（实现票 T40）：Ink Orbit 工作台壳拼装 + localStorage
 * 恢复（书名 + 视图状态，刷新不丢）+ 导航切换显式占位。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { okJson } from './test/http'
import { emptyCanonState } from './test/fixtures'

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

/** 其余测试默认「Wizard 已完成」——Q3 仅首次，避免覆盖层挡住工作台断言。 */
beforeEach(() => {
  window.localStorage.setItem('mozhou.wizard.done', 'done')
})

const STORED_BOOK = {
  root: 'C:\\tmp\\stored-book',
  bookId: 'bk_stored',
  title: '雾港失真',
}

/** 壳级按路径 stub：建书 + Story Brain 三读面 + 装配看板 + 质量门缺省；未知 /api 路径显式抛错（防未来回归静默通过）。 */
function stubAppFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((path: string) => {
      if (path === '/api/book') return okJson({ ok: true, root: 'C:\\tmp\\app-book', bookId: 'bk_app' })
      if (path === '/api/book.state') return okJson({ ok: true, state: emptyCanonState() })
      if (path === '/api/story-brain.entities') return okJson({ ok: true, cards: [] })
      if (path === '/api/story-brain.facts') {
        return okJson({ ok: true, chapter: 1, currentChapterIndex: null, chapters: [], canon: [], perspective: [], invalidated: [] })
      }
      if (path === '/api/receipts') return okJson({ ok: true, receipts: [] })
      if (path === '/api/receipt') {
        return okJson({ ok: false, error: 'unexpected receipt path in shell test: ' + path })
      }
      if (path === '/api/change-matrix') return okJson({ ok: true, matrix: { columns: [], rows: [] } })
      if (path === '/api/change-matrix.rerun') {
        return okJson({ ok: false, error: 'unexpected rerun path in shell test: ' + path })
      }
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: false })
      if (path === '/api/draft.question') return okJson({ ok: true, question: '问题', hint: '提示', choices: [] })
      if (path === '/api/draft.stream') {
        return okJson({ ok: false, error: 'unexpected draft path in shell test: ' + path })
      }
      if (path === '/api/library') return okJson({ ok: true, books: [], skipped: 0 })
      if (path === '/api/library.open') {
        return okJson({ ok: false, error: 'unexpected library.open path in shell test: ' + path })
      }
      if (path === '/api/library.import') {
        return okJson({ ok: false, error: 'unexpected library.import path in shell test: ' + path })
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

  it('刷新恢复：localStorage 中的书与视图状态还原（US12）', () => {
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
    await userEvent.click(receiptNav)
    // T42 起装配看板为真实 tab：未建书呈显式空态（InspectorEmpty），不假装可用
    const receiptPanel = document.querySelector('[data-panel="context-receipt"]')
    if (receiptPanel === null) throw new Error('missing context-receipt panel')
    expect(receiptPanel.querySelector('[data-testid="inspector-empty"]')?.textContent).toContain('装配看板')
    const rankNav = document.querySelector('[data-view="rank-scan"]')
    if (rankNav === null) throw new Error('missing rank-scan nav')
    await userEvent.click(rankNav)
    expect(screen.getByTestId('placeholder-view').textContent).toContain('尚未实现')
  })

  it('管线条点击切换激活阶段（牵引背景墨迹聚焦）', async () => {
    stubAppFetch()
    render(<App />)
    const commit = document.querySelector('[data-stage="commit"]')
    if (commit === null) throw new Error('missing commit step')
    await userEvent.click(commit)
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

/* ----------------------------------------------------------------------------
 * T42（#87）首次建书 Wizard 集成：仅首次自动进入 / 完成后不再自动弹出 /
 * 书切换器可重放（Q3 US11）。
 * ------------------------------------------------------------------------- */

describe('App 首次建书 Wizard（T42）', () => {
  it('无书且未完成 Wizard：覆盖层自动进入', () => {
    window.localStorage.removeItem('mozhou.wizard.done')
    stubAppFetch()
    render(<App />)
    expect(screen.getByTestId('wizard-overlay')).not.toBeNull()
  })

  it('Wizard 完成后进入常驻工作台；刷新不再自动弹出（localStorage 记忆）', async () => {
    window.localStorage.removeItem('mozhou.wizard.done')
    stubAppFetch()
    render(<App />)
    const wizard = screen.getByTestId('wizard-overlay')
    await userEvent.type(within(wizard).getByLabelText('作品名'), '雾港失真')
    await userEvent.click(within(wizard).getByRole('button', { name: /继续/ }))
    await waitFor(() => {
      expect(screen.getByTestId('wizard-eyebrow').textContent).toBe('STEP 02 / 05')
    })
    // 其余步空输入可过（输入为增强）
    await userEvent.click(within(wizard).getByRole('button', { name: /继续/ }))
    await waitFor(() => {
      expect(screen.getByTestId('wizard-eyebrow').textContent).toBe('STEP 03 / 05')
    })
    await userEvent.click(within(wizard).getByRole('button', { name: /继续/ }))
    await waitFor(() => {
      expect(screen.getByTestId('wizard-eyebrow').textContent).toBe('STEP 04 / 05')
    })
    await userEvent.click(within(wizard).getByRole('button', { name: /继续/ }))
    await waitFor(() => {
      expect(screen.getByTestId('wizard-eyebrow').textContent).toBe('STEP 05 / 05')
    })
    await userEvent.click(within(wizard).getByRole('button', { name: /进入工作台/ }))
    // 落地工作台：Wizard 覆盖层卸载（wizardOpen=false），书名出现在 chapterbar
    await waitFor(() => {
      expect(screen.queryByTestId('wizard-overlay')).toBeNull()
    })
    expect(document.querySelector('.chapterbar h1')?.textContent).toBe('《雾港失真》')
    // wizard.done 已写
    expect(window.localStorage.getItem('mozhou.wizard.done')).toBe('done')
  })

  it('Wizard 已完成后刷新：不自动弹出（常驻工作台）', () => {
    stubAppFetch()
    render(<App />)
    expect(screen.queryByTestId('wizard-overlay')).toBeNull()
  })

  it('书切换器可重放：已建书时点书名重开 Wizard 覆盖层（Q3 可重放）', async () => {
    window.localStorage.setItem(
      'mozhou.workbench.v1',
      JSON.stringify({ book: STORED_BOOK, view: 'workbench' }),
    )
    stubAppFetch()
    render(<App />)
    expect(screen.queryByTestId('wizard-overlay')).toBeNull()
    const bookSwitch = document.querySelector('.book-switch')
    if (bookSwitch === null) throw new Error('missing book-switch')
    await userEvent.click(bookSwitch)
    await waitFor(() => {
      expect(screen.getByTestId('wizard-overlay')).not.toBeNull()
    })
  })

  it('书源书架导航：点击 nav 挂载书架视图（本地书库读面）', async () => {
    window.localStorage.setItem(
      'mozhou.workbench.v1',
      JSON.stringify({ book: STORED_BOOK, view: 'workbench' }),
    )
    stubAppFetch()
    render(<App />)
    const shelfNav = document.querySelector('[data-view="book-shelf"]')
    if (shelfNav === null) throw new Error('missing book-shelf nav')
    await userEvent.click(shelfNav)
    await waitFor(() => {
      expect(screen.getByLabelText('bookshelf-view')).toBeInTheDocument()
    })
    // 书库根 = 当前书父目录（C:\tmp\stored-book → C:\tmp）
    expect(screen.getByLabelText('bookshelf-view').textContent).toContain('C:\\tmp')
  })
})
