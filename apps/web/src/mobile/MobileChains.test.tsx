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
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
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
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/library') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          ok: true,
          books: [
            { root: 'C:\\tmp\\test-book', bookId: 'bk_test', title: '假神真显灵', chapterCount: 3 },
            { root: 'C:\\tmp\\other-book', bookId: 'bk_other', title: '雾灯志', chapterCount: 12 },
          ],
          skipped: [],
        }) })
      }
      if (path === '/api/library.open') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, root: 'C:\\tmp\\other-book', bookId: 'bk_other', title: '雾灯志' }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, totalEvents: 0, totalTraversals: 0, events: [], traversals: [], license: null, plans: [] }) })
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
      const openCall = fetchMock.mock.calls.find(([p]) => p === '/api/library.open') as [string, { body?: string }] | undefined
      expect(openCall).toBeDefined()
      const openBody = JSON.parse(openCall?.[1]?.body ?? '{}') as { root: string }
      expect(openBody.root).toBe('C:\\tmp\\other-book')
      expect(onSwitchBook).toHaveBeenCalledWith({ root: 'C:\\tmp\\other-book', bookId: 'bk_other', title: '雾灯志' })
    })
  })
})
/**
 * 商业化阻断 2 的移动端半边：系统中心必须能配 API 密钥。
 *
 * 缺陷：模型设置只挂在 App.tsx 的桌面分支，MobileShell 完全够不着——
 * 于是「从安装到拿到第一段 AI 正文」在移动端这条路上依然走不通。
 */
describe('SystemHub 模型设置入口（商业化阻断 2 · 移动端）', () => {
  it('系统中心如实显示未配置，展开后能填密钥并保存', async () => {
    const saved: Record<string, unknown>[] = []
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/llm/settings' && init?.method === 'POST') {
        saved.push(JSON.parse(init.body as string) as Record<string, unknown>)
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            ok: true,
            settings: {
              configured: true,
              providerId: 'deepseek',
              baseUrl: 'https://api.deepseek.com/v1',
              maskedKey: 'sk-****wxyz',
              model: 'deepseek-chat',
              configVersion: 1,
              updatedAt: '2026-09-27T00:00:00.000Z',
            },
          }),
        })
      }
      if (path === '/api/llm/settings') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            ok: true,
            settings: {
              configured: false,
              providerId: 'deepseek',
              baseUrl: '',
              maskedKey: '',
              model: 'deepseek-chat',
              configVersion: 0,
              updatedAt: null,
            },
          }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SystemHub book={BOOK} onOpenDrawer={vi.fn()} />)

    const toggle = await screen.findByTestId('mobile-model-settings-toggle')
    await waitFor(() => expect(toggle.textContent).toContain('未配置'))
    expect(screen.queryByTestId('mobile-model-settings-panel')).toBeNull()

    fireEvent.click(toggle)
    const panel = await screen.findByTestId('mobile-model-settings-panel')
    const keyInput = panel.querySelector('input[type=password]') as HTMLInputElement
    expect(keyInput).not.toBeNull()

    const baseInput = panel.querySelector('input[type=text]') as HTMLInputElement
    await waitFor(() => expect(baseInput.value).toBe('https://api.deepseek.com/v1'))
    fireEvent.change(keyInput, { target: { value: 'sk-mobile-key' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({ apiKey: 'sk-mobile-key' })
    expect(screen.getByTestId('provider-save-notice')).toBeDefined()
  })
})
