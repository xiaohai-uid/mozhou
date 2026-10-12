/**
 * 迁移入口面板测试（P1-panel）：导出/导入两个入口 + 非导航挂载（`#migration`）。
 * 判定：npx pnpm --filter @mozhou/web exec vitest run src/migration/MigrationPanel.test.tsx src/shell/views.test.ts
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MigrationPanel } from './MigrationPanel'
import { SYNTHETIC_CURRENT_BOOK, installSyntheticExport } from './__fixtures__/syntheticBrowserExport'
import { exportLocalStorage } from './exportLocalStorage'
import { computePackageDigest } from './packageFormat'
import { App } from '../App'
import { chapterDraftKey } from '../shell/workbenchStorage'
import { okJson } from '../test/http'
import { emptyCanonState } from '../test/fixtures'

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem('mozhou.wizard.done', 'done')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.location.hash = ''
})

interface ProbeCall {
  readonly path: string
  readonly body: Record<string, unknown>
}

function stubProbeFetch(): ProbeCall[] {
  const calls: ProbeCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      let body: Record<string, unknown> = {}
      const rawBody = init?.body
      if (typeof rawBody === 'string') {
        try {
          body = JSON.parse(rawBody) as Record<string, unknown>
        } catch {
          body = {}
        }
      }
      calls.push({ path, body })
      if (path === '/api/book.state') return okJson({ ok: true, state: emptyCanonState() })
      if (path === '/api/chapter.prose') return okJson({ ok: true, exists: false, chapterIndex: body['chapterIndex'] ?? 1 })
      return okJson({ ok: false, error: 'unexpected path ' + path })
    }),
  )
  return calls
}

describe('MigrationPanel（导出入口）', () => {
  it('生成迁移包 → 展示作品/章/待认领计数与内容摘要', () => {
    installSyntheticExport(window.localStorage)
    render(<MigrationPanel onClose={() => {}} targetBook={SYNTHETIC_CURRENT_BOOK} />)

    fireEvent.click(screen.getByRole('button', { name: '生成迁移包' }))
    const summary = screen.getByTestId('export-summary')
    expect(summary.textContent).toContain('作品数：1')
    expect(summary.textContent).toContain('章条目数：3')
    expect(summary.textContent).toContain('待认领条目：1')
    expect(summary.textContent).toContain('内容摘要：')
  })

  it('提供可直接粘贴的控制台片段（只读文本域）', () => {
    render(<MigrationPanel onClose={() => {}} />)
    fireEvent.click(screen.getByText('控制台片段（可直接粘贴到旧页面控制台运行）'))
    const snippet = screen.getByLabelText<HTMLTextAreaElement>('控制台导出片段')
    expect(snippet.value).toContain('mozhou.workbench.v1')
    expect(snippet.value.startsWith('(function')).toBe(true)
  })
})

describe('MigrationPanel（导入入口）', () => {
  it('非法 JSON → 显式拒绝（不静默通过）', () => {
    render(<MigrationPanel onClose={() => {}} targetBook={SYNTHETIC_CURRENT_BOOK} />)
    fireEvent.click(screen.getByRole('button', { name: '导入（新壳）' }))
    fireEvent.change(screen.getByLabelText('迁移包 JSON'), { target: { value: '{ 不是 JSON' } })
    fireEvent.click(screen.getByRole('button', { name: '校验并生成导入计划' }))
    expect(screen.getByTestId('import-rejection').textContent).toContain('NOT_OBJECT')
  })

  it('合法包 → 生成导入计划；应用导入 → 报告写入/隔离/跳过', async () => {
    installSyntheticExport(window.localStorage)
    const pkg = exportLocalStorage(window.localStorage, {
      origin: 'http://localhost:43000',
      userAgent: 'ua',
      exportedAt: '2026-10-12T00:00:00.000Z',
    })
    stubProbeFetch()

    render(<MigrationPanel onClose={() => {}} targetBook={SYNTHETIC_CURRENT_BOOK} />)
    fireEvent.click(screen.getByRole('button', { name: '导入（新壳）' }))
    fireEvent.change(screen.getByLabelText('迁移包 JSON'), { target: { value: JSON.stringify(pkg) } })
    fireEvent.click(screen.getByRole('button', { name: '校验并生成导入计划' }))

    await waitFor(() => expect(screen.getByTestId('import-plan')).toBeInTheDocument())
    // 服务端无此章 → 全部 matched
    expect(screen.getByTestId('import-plan').textContent).toContain('匹配 3')

    // 应用时会按当前现场重查服务端状态（E01 合同「应用时重新检查」），结果是异步到达的。
    fireEvent.click(screen.getByRole('button', { name: '应用导入' }))
    const result = await screen.findByTestId('apply-result')
    expect(result.textContent).toContain('写入 3')
    expect(result.textContent).toContain('已迁移标记：是')
  })

  it('回归③：逐章探针使用目标作品根（而非包内 root）', async () => {
    installSyntheticExport(window.localStorage)
    const base = exportLocalStorage(window.localStorage, {
      origin: 'http://localhost:43000',
      userAgent: 'ua',
      exportedAt: '2026-10-12T00:00:00.000Z',
    })
    // 把包内作品 root 改成另一路径（bookId 不变 → 身份仍匹配目标），重算摘要
    const payload = {
      formatVersion: base.formatVersion,
      origin: base.origin,
      books: base.books.map((book) => ({ ...book, identity: { ...book.identity, root: 'C:\\tmp\\WRONG-ROOT' } })),
      unclaimed: base.unclaimed,
      preferences: base.preferences,
    }
    const pkg = { ...payload, digest: computePackageDigest(payload) }

    const calls = stubProbeFetch()
    render(<MigrationPanel onClose={() => {}} targetBook={SYNTHETIC_CURRENT_BOOK} />)
    fireEvent.click(screen.getByRole('button', { name: '导入（新壳）' }))
    fireEvent.change(screen.getByLabelText('迁移包 JSON'), { target: { value: JSON.stringify(pkg) } })
    fireEvent.click(screen.getByRole('button', { name: '校验并生成导入计划' }))

    await waitFor(() => expect(screen.getByTestId('import-plan')).toBeInTheDocument())
    const chapterCalls = calls.filter((call) => call.path === '/api/chapter.prose')
    expect(chapterCalls.length).toBeGreaterThan(0)
    expect(chapterCalls.every((call) => call.body['root'] === SYNTHETIC_CURRENT_BOOK.root)).toBe(true)
    expect(chapterCalls.some((call) => call.body['root'] === 'C:\\tmp\\WRONG-ROOT')).toBe(false)
  })

  it('E01：切书后旧计划失效，不能拿 A 书的计划应用到 B 书', async () => {
    installSyntheticExport(window.localStorage)
    const pkg = exportLocalStorage(window.localStorage, {
      origin: 'http://localhost:43000',
      userAgent: 'ua',
      exportedAt: '2026-10-12T00:00:00.000Z',
    })
    stubProbeFetch()

    const { rerender } = render(<MigrationPanel onClose={() => {}} targetBook={SYNTHETIC_CURRENT_BOOK} />)
    fireEvent.click(screen.getByRole('button', { name: '导入（新壳）' }))
    fireEvent.change(screen.getByLabelText('迁移包 JSON'), { target: { value: JSON.stringify(pkg) } })
    fireEvent.click(screen.getByRole('button', { name: '校验并生成导入计划' }))
    await waitFor(() => expect(screen.getByTestId('import-plan')).toBeInTheDocument())

    // 切到另一本书：既有计划立即失效，应用按钮不可用
    rerender(<MigrationPanel onClose={() => {}} targetBook={{ root: 'C:\\tmp\\beta', bookId: 'bk_beta', title: '乙书' }} />)
    await waitFor(() => expect(screen.queryByTestId('import-plan')).toBeNull())
    expect(screen.getByRole('button', { name: '应用导入' })).toBeDisabled()
  })

  it('E01：预览后作者改稿 → 应用时改落隔离槽，新稿保留', async () => {
    installSyntheticExport(window.localStorage)
    const pkg = exportLocalStorage(window.localStorage, {
      origin: 'http://localhost:43000',
      userAgent: 'ua',
      exportedAt: '2026-10-12T00:00:00.000Z',
    })
    stubProbeFetch()

    render(<MigrationPanel onClose={() => {}} targetBook={SYNTHETIC_CURRENT_BOOK} />)
    fireEvent.click(screen.getByRole('button', { name: '导入（新壳）' }))
    fireEvent.change(screen.getByLabelText('迁移包 JSON'), { target: { value: JSON.stringify(pkg) } })
    fireEvent.click(screen.getByRole('button', { name: '校验并生成导入计划' }))
    await waitFor(() => expect(screen.getByTestId('import-plan')).toBeInTheDocument())
    expect(screen.getByTestId('import-plan').textContent).toContain('匹配 3')

    // 预览之后作者继续写作：壳内第 1 章草稿变了（计划里的 verdict 已过期）
    const chKey = chapterDraftKey(SYNTHETIC_CURRENT_BOOK, 1)!
    window.localStorage.setItem(`mozhou.draft.cache.${chKey}`, '作者预览后新写的正文')

    fireEvent.click(screen.getByRole('button', { name: '应用导入' }))
    const result = await screen.findByTestId('apply-result')

    expect(result.textContent).toContain('写入 2')
    // 隔离 2 = 应用时重查拦下的第 1 章 + 包级待认领条目（乙书第 1 章）
    expect(result.textContent).toContain('隔离 2')
    expect(screen.getByTestId('apply-recheck').textContent).toContain('1 项')
    // 新稿未被覆盖；包内版本保留在隔离槽
    expect(window.localStorage.getItem(`mozhou.draft.cache.${chKey}`)).toBe('作者预览后新写的正文')
  })
})

describe('非导航挂载（#migration）', () => {
  it('hash 为 #migration 时挂载面板；否则不挂载（且不改动 NAV_GROUPS）', () => {
    stubShellFetch()
    window.location.hash = ''
    const first = render(<App />)
    expect(screen.queryByRole('dialog', { name: '浏览器数据迁移' })).toBeNull()
    first.unmount()

    window.location.hash = '#migration'
    render(<App />)
    expect(screen.getByRole('dialog', { name: '浏览器数据迁移' })).toBeInTheDocument()
  })
})

/** App 壳级按路径 stub（book 为 null 的初始态；未知路径显式抛错防静默通过）。 */
function stubShellFetch(): void {
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
      if (path === '/api/change-matrix') return okJson({ ok: true, matrix: { columns: [], rows: [] } })
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: false })
      if (path === '/api/capability-square') return okJson({ ok: true, providerAvailable: false, groups: [] })
      if (path === '/api/works') {
        return okJson({ ok: true, book: null, stats: { totalChapters: 0, committedChapters: 0, draftChapters: 0, totalWords: 0, entityCount: 0 }, chapters: [], outlineNodes: [] })
      }
      if (path === '/api/tasks') return okJson({ ok: true, totalEvents: 0, totalTraversals: 0, events: [], traversals: [] })
      if (path === '/api/library') return okJson({ ok: true, books: [], skipped: 0 })
      if (path === '/api/chapter.quality') return okJson({ ok: true, hasReport: false })
      if (path === '/api/draft.question') return okJson({ ok: true, question: '问题', hint: '提示', choices: [] })
      throw new Error('unexpected fetch path in shell test: ' + path)
    }),
  )
}
