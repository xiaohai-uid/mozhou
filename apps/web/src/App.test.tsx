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
      if (path === '/api/capability-square') {
        return okJson({ ok: true, providerAvailable: false, groups: [] })
      }
      if (path === '/api/works') {
        return okJson({
          ok: true,
          book: { id: 'bk_app', title: '雾港失真', root: 'C:\\tmp\\stored-book', genres: [], createdAt: '2026-08-31' },
          stats: { totalChapters: 0, committedChapters: 0, draftChapters: 0, totalWords: 0, entityCount: 0 },
          chapters: [],
          outlineNodes: [],
        })
      }
      if (path === '/api/tasks') {
        return okJson({
          ok: true,
          totalEvents: 0,
          totalTraversals: 0,
          events: [],
          traversals: [],
        })
      }
      if (path === '/api/style' || path === '/api/style.distill') {
        return okJson({
          ok: true,
          currentProfiles: null,
          sampleMetrics: { charCount: 0, dialogueRatio: 0, avgSentenceLength: 0, shortSentenceRatio: 0, sensoryDensity: 0, actionPacing: 0 },
        })
      }
      if (path === '/api/novel-breakdown') {
        return okJson({
          ok: true,
          result: {
            storyCore: { protagonist: '主角', mainGoal: '主线', goldenFinger: '金手指', mainConflict: '矛盾' },
            chapterPacing: [],
            characterArcs: [],
            emotionalBeats: [],
          },
        })
      }
      if (path === '/api/rank-scan') {
        return okJson({
          ok: true,
          boards: [],
          trendingKeywords: [],
        })
      }
      if (path === '/api/web-search') {
        return okJson({
          ok: true,
          query: '',
          results: [],
          hotQueries: [],
        })
      }
      if (path === '/api/cloud-sync' || path === '/api/cloud-sync.backup') {
        return okJson({
          ok: true,
          localReady: true,
          syncStatus: 'offline_ready',
          lastLocalSnapshotAt: '',
          pendingChangesCount: 0,
          storageUsage: { localCanonFiles: 0, databaseBytes: 0 },
        })
      }
      if (path === '/api/membership' || path === '/api/membership.activate') {
        return okJson({
          ok: true,
          license: { planId: 'pro', planName: 'Pro', licenseKey: 'KEY', activatedAt: '', expiresAt: '', status: 'active' },
          plans: [],
        })
      }
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

  it('检视组导航点击切到中栏显式占位与检视塔联动', async () => {
    stubAppFetch()
    render(<App />)
    const receiptNav = document.querySelector('[data-view="context-receipt"]')
    if (receiptNav === null) throw new Error('missing context-receipt nav')
    await userEvent.click(receiptNav)
    // T42 起装配看板为真实 tab：未建书呈显式空态（InspectorEmpty），不假装可用
    const receiptPanel = document.querySelector('[data-panel="context-receipt"]')
    if (receiptPanel === null) throw new Error('missing context-receipt panel')
    expect(receiptPanel.querySelector('[data-testid="inspector-empty"]')?.textContent).toContain('装配看板')
    const dialogueNav = document.querySelector('[data-view="dialogue"]')
    if (dialogueNav === null) throw new Error('missing dialogue nav')
    await userEvent.click(dialogueNav)
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

  it('技能广场导航：点击 nav 挂载技能广场视图（V1 能力注册表读面）', async () => {
    window.localStorage.setItem(
      'mozhou.workbench.v1',
      JSON.stringify({ book: STORED_BOOK, view: 'workbench' }),
    )
    stubAppFetch()
    render(<App />)
    const squareNav = document.querySelector('[data-view="capability-square"]')
    if (squareNav === null) throw new Error('missing capability-square nav')
    await userEvent.click(squareNav)
    await waitFor(() => {
      expect(screen.getByLabelText('capability-square-view')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('capability-square-view').textContent).toContain('技能广场')
  })

  it('我的作品导航：点击 nav 挂载我的作品视图（作品概览与章节全景）', async () => {
    window.localStorage.setItem(
      'mozhou.workbench.v1',
      JSON.stringify({ book: STORED_BOOK, view: 'workbench' }),
    )
    stubAppFetch()
    render(<App />)
    const worksNav = document.querySelector('[data-view="works"]')
    if (worksNav === null) throw new Error('missing works nav')
    await userEvent.click(worksNav)
    await waitFor(() => {
      expect(screen.getByLabelText('works-view')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('works-view').textContent).toContain('我的作品')
  })

  it('任务中心导航：点击 nav 挂载任务中心视图（流水审计看板）', async () => {
    window.localStorage.setItem(
      'mozhou.workbench.v1',
      JSON.stringify({ book: STORED_BOOK, view: 'workbench' }),
    )
    stubAppFetch()
    render(<App />)
    const tasksNav = document.querySelector('[data-view="tasks"]')
    if (tasksNav === null) throw new Error('missing tasks nav')
    await userEvent.click(tasksNav)
    await waitFor(() => {
      expect(screen.getByLabelText('tasks-view')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('tasks-view').textContent).toContain('任务中心')
  })

  it('书源搜索导航：点击 nav 挂载书源搜索视图（书源检索与导入）', async () => {
    window.localStorage.setItem(
      'mozhou.workbench.v1',
      JSON.stringify({ book: STORED_BOOK, view: 'workbench' }),
    )
    stubAppFetch()
    render(<App />)
    const sourceNav = document.querySelector('[data-view="book-source"]')
    if (sourceNav === null) throw new Error('missing book-source nav')
    await userEvent.click(sourceNav)
    await waitFor(() => {
      expect(screen.getByLabelText('book-source-view')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('book-source-view').textContent).toContain('书源搜索')
  })

  it('风格蒸馏导航：点击 nav 挂载风格蒸馏视图（文风画像与范本分析）', async () => {
    window.localStorage.setItem(
      'mozhou.workbench.v1',
      JSON.stringify({ book: STORED_BOOK, view: 'workbench' }),
    )
    stubAppFetch()
    render(<App />)
    const styleNav = document.querySelector('[data-view="style-distill"]')
    if (styleNav === null) throw new Error('missing style-distill nav')
    await userEvent.click(styleNav)
    await waitFor(() => {
      expect(screen.getByLabelText('style-distill-view')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('style-distill-view').textContent).toContain('风格蒸馏')
  })

  it('小说拆解导航：点击 nav 挂载小说拆解视图（故事核与节奏拆解）', async () => {
    window.localStorage.setItem(
      'mozhou.workbench.v1',
      JSON.stringify({ book: STORED_BOOK, view: 'workbench' }),
    )
    stubAppFetch()
    render(<App />)
    const breakdownNav = document.querySelector('[data-view="novel-breakdown"]')
    if (breakdownNav === null) throw new Error('missing novel-breakdown nav')
    await userEvent.click(breakdownNav)
    await waitFor(() => {
      expect(screen.getByLabelText('novel-breakdown-view')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('novel-breakdown-view').textContent).toContain('小说拆解')
  })

  it('网文扫榜导航：点击 nav 挂载网文扫榜视图（多平台热榜透视）', async () => {
    window.localStorage.setItem(
      'mozhou.workbench.v1',
      JSON.stringify({ book: STORED_BOOK, view: 'workbench' }),
    )
    stubAppFetch()
    render(<App />)
    const rankNav = document.querySelector('[data-view="rank-scan"]')
    if (rankNav === null) throw new Error('missing rank-scan nav')
    await userEvent.click(rankNav)
    await waitFor(() => {
      expect(screen.getByLabelText('rank-scan-view')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('rank-scan-view').textContent).toContain('网文扫榜')
  })

  it('联网搜索导航：点击 nav 挂载联网搜索视图（设定资料检索）', async () => {
    window.localStorage.setItem(
      'mozhou.workbench.v1',
      JSON.stringify({ book: STORED_BOOK, view: 'workbench' }),
    )
    stubAppFetch()
    render(<App />)
    const searchNav = document.querySelector('[data-view="web-search"]')
    if (searchNav === null) throw new Error('missing web-search nav')
    await userEvent.click(searchNav)
    await waitFor(() => {
      expect(screen.getByLabelText('web-search-view')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('web-search-view').textContent).toContain('联网搜索')
  })

  it('云同步导航：点击 nav 挂载云同步视图（离线优先与快照）', async () => {
    window.localStorage.setItem(
      'mozhou.workbench.v1',
      JSON.stringify({ book: STORED_BOOK, view: 'workbench' }),
    )
    stubAppFetch()
    render(<App />)
    const cloudNav = document.querySelector('[data-view="cloud-sync"]')
    if (cloudNav === null) throw new Error('missing cloud-sync nav')
    await userEvent.click(cloudNav)
    await waitFor(() => {
      expect(screen.getByLabelText('cloud-sync-view')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('cloud-sync-view').textContent).toContain('云同步与备份')
  })

  it('会员中心导航：点击 nav 挂载会员中心视图（许可证与权益方案）', async () => {
    window.localStorage.setItem(
      'mozhou.workbench.v1',
      JSON.stringify({ book: STORED_BOOK, view: 'workbench' }),
    )
    stubAppFetch()
    render(<App />)
    const memberNav = document.querySelector('[data-view="membership"]')
    if (memberNav === null) throw new Error('missing membership nav')
    await userEvent.click(memberNav)
    await waitFor(() => {
      expect(screen.getByLabelText('membership-view')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('membership-view').textContent).toContain('会员与授权中心')
  })
})
