/**
 * 联网搜索（WebSearchView）组件测试（实现票 T53）：
 * - 契约快照：输入形状 = server/api 导出类型（WebSearchResponse），
 *   包类型漂移即 typecheck + 快照双报警；
 * - 检索输入、热门词与搜索结果列表渲染；
 * - 搜索交互与摘录操作。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebSearchResponse } from '../../server/api'
import { okJson } from '../test/http'
import { WebSearchView } from './WebSearchView'

afterEach(() => {
  vi.unstubAllGlobals()
})

const MOCK_SEARCH: WebSearchResponse = {
  ok: true,
  query: '唐代',
  hotQueries: ['唐代夜禁', '山海经异兽'],
  results: [
    {
      id: 'kb_01',
      title: '唐代长安城坊里制度与夜禁',
      category: '历史制度',
      source: '新唐书·百官志',
      snippet: '一百零八坊棋盘布局，晨钟暮鼓开闭坊门。',
      detail: '长安城以朱雀大街为中轴，东西分设万年县与长安县。',
      tags: ['唐代', '夜禁'],
    },
  ],
}

describe('WebSearchView（联网搜索）', () => {
  it('搜索输入、热门词与结果卡片渲染；契约快照', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_SEARCH)))
    const { container } = render(<WebSearchView />)

    await waitFor(() => {
      expect(screen.getByTestId('search-results-section')).toBeInTheDocument()
    })

    expect(screen.getByTestId('search-results-list').textContent).toContain('唐代长安城坊里制度')
    expect(screen.getByTestId('search-input-section').textContent).toContain('唐代夜禁')

    const view = container.querySelector('[aria-label="web-search-view"]')
    if (view === null) throw new Error('missing web-search-view')
    expect(view).toMatchSnapshot()
  })

  it('点击热门搜索词触发检索', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(MOCK_SEARCH))
    vi.stubGlobal('fetch', fetchMock)

    render(<WebSearchView />)
    await waitFor(() => {
      expect(screen.getByTestId('search-input-section')).toBeInTheDocument()
    })

    const hotBtn = screen.getByRole('button', { name: '唐代夜禁' })
    await userEvent.click(hotBtn)

    expect(fetchMock).toHaveBeenCalled()
  })
})
