/**
 * 我的作品（WorksView）组件测试（实现票 T47）：
 * - 契约快照：输入形状 = server/api 导出类型（WorksOverviewResponse），
 *   包类型漂移即 typecheck + 快照双报警；
 * - 作品元信息与统计渲染（书名/ID/题材/总字数/章数/实体数）；
 * - 章节列表渲染（章序号/标题/已定稿或草稿徽标/字数）；
 * - 未建书时的显式空态与引导。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorksOverviewResponse } from '../../server/api'
import { okJson } from '../test/http'
import { WorksView } from './WorksView'

afterEach(() => {
  vi.unstubAllGlobals()
})

const MOCK_WORKS: WorksOverviewResponse = {
  ok: true,
  book: {
    id: 'bk_mock_1',
    title: '假神真显灵',
    root: 'C:/tmp/fake-god',
    genres: ['灵异', '悬疑'],
    createdAt: '2026-08-31T00:00:00.000Z',
  },
  stats: {
    totalChapters: 2,
    committedChapters: 1,
    draftChapters: 1,
    totalWords: 5200,
    entityCount: 3,
  },
  chapters: [
    {
      chapterIndex: 1,
      title: '第一章 骗子与真神',
      phase: 'committed',
      wordCount: 3000,
      revision: 2,
    },
    {
      chapterIndex: 2,
      title: '第二章 庙堂惊变',
      phase: 'draft',
      wordCount: 2200,
      revision: 1,
    },
  ],
  outlineNodes: [
    {
      id: 'zonggang',
      nodeType: 'book',
      title: '全书总纲',
      status: 'active',
    },
    {
      id: 'vol_1',
      nodeType: 'volume',
      title: '第一卷 借假修真',
      status: 'active',
    },
  ],
}

describe('WorksView（我的作品）', () => {
  it('作品概览与章节目录渲染（书名/统计/大纲节点/章节）；契约快照', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_WORKS)))
    const { container } = render(
      <WorksView root="C:/tmp/fake-god" onGoToWorkbench={() => {}} />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('works-overview')).toBeInTheDocument()
    })
    expect(screen.getByTestId('works-overview').textContent).toContain('假神真显灵')
    expect(screen.getByTestId('works-overview').textContent).toContain('5200')
    expect(screen.getByTestId('works-outlines').textContent).toContain('借假修真')
    expect(screen.getByTestId('works-chapters').textContent).toContain('第一章 骗子与真神')
    expect(screen.getByTestId('works-chapters').textContent).toContain('已定稿')
    expect(screen.getByTestId('works-chapters').textContent).toContain('草稿中')

    const view = container.querySelector('[aria-label="works-view"]')
    if (view === null) throw new Error('missing works-view')
    expect(view).toMatchSnapshot()
  })

  it('未建书时呈现显式引导与前往工作台按钮', async () => {
    const onGoToWorkbench = vi.fn()
    render(<WorksView root={null} onGoToWorkbench={onGoToWorkbench} />)
    expect(screen.getByTestId('works-empty')).toBeInTheDocument()
    expect(screen.getByTestId('works-empty').textContent).toContain('尚未选择或建立作品')

    const btn = screen.getByRole('button', { name: '前往工作台建书' })
    await userEvent.click(btn)
    expect(onGoToWorkbench).toHaveBeenCalled()
  })

  it('读取失败显式报错（role=alert），不静默', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: '作品读取失败' }), { status: 500 }),
      ),
    )
    render(<WorksView root="C:/tmp/fake-god" onGoToWorkbench={() => {}} />, )
    await waitFor(() => {
      expect(screen.getByTestId('works-error').textContent).toContain('作品读取失败')
    })
  })
})
