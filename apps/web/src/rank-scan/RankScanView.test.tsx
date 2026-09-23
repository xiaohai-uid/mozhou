/**
 * 网文扫榜（RankScanView）组件测试（实现票 T52）：
 * - 契约快照：输入形状 = server/api 导出类型（RankScanResponse），
 *   包类型漂移即 typecheck + 快照双报警；
 * - 热门风向词与榜单排行卡片渲染；
 * - 多平台榜单切换交互。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RankScanResponse } from '../../server/api'
import { okJson } from '../test/http'
import { RankScanView } from './RankScanView'

afterEach(() => {
  vi.unstubAllGlobals()
})

const MOCK_RANK: RankScanResponse = {
  ok: true,
  boards: [
    {
      id: 'fanqie_hot',
      name: '番茄热读榜',
      platform: 'fanqie',
      updatedAt: '2026-08-31',
      items: [
        {
          rank: 1,
          title: '惹金枝',
          author: '青青子衿',
          category: '古言脑洞',
          hotScore: '98.5万在读',
          tags: ['双洁', '真假千金'],
          goldenFinger: '前世记忆预知',
          oneLineHook: '重回替嫁当夜，她直接掀翻了喜堂。',
        },
      ],
    },
    {
      id: 'qidian_yuepiao',
      name: '起点风云榜',
      platform: 'qidian',
      updatedAt: '2026-08-31',
      items: [
        {
          rank: 1,
          title: '道诡异仙',
          author: '狐尾的笔',
          category: '东方玄幻',
          hotScore: '月票榜 Top 1',
          tags: ['克苏鲁修仙'],
          goldenFinger: '真假世界穿梭',
          oneLineHook: '我分不清。',
        },
      ],
    },
  ],
  trendingKeywords: [
    { name: '长生苟道', heat: 98 },
    { name: '规则怪谈', heat: 95 },
  ],
}

describe('RankScanView（网文扫榜）', () => {
  it('风向词与榜单项目渲染；契约快照', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_RANK)))
    const { container } = render(<RankScanView />)

    await waitFor(() => {
      expect(screen.getByTestId('rank-trending')).toBeInTheDocument()
    })

    expect(screen.getByTestId('rank-trending').textContent).toContain('长生苟道')
    expect(screen.getByTestId('rank-items').textContent).toContain('惹金枝')
    expect(screen.getByTestId('rank-items').textContent).toContain('前世记忆预知')

    const view = container.querySelector('[aria-label="rank-scan-view"]')
    if (view === null) throw new Error('missing rank-scan-view')
    expect(view).toMatchSnapshot()
  })

  it('切换榜单平台 Tab', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_RANK)))
    render(<RankScanView />)

    await waitFor(() => {
      expect(screen.getByTestId('rank-boards')).toBeInTheDocument()
    })

    const qidianBtn = screen.getByRole('button', { name: '起点风云榜' })
    await userEvent.click(qidianBtn)

    expect(screen.getByTestId('rank-items').textContent).toContain('道诡异仙')
  })
})
