/**
 * 小说拆解（NovelBreakdownView）组件测试（实现票 T51）：
 * - 契约快照：输入形状 = server/api 导出类型（NovelBreakdownResponse），
 *   包类型漂移即 typecheck + 快照双报警；
 * - 故事核、黄金三章节奏、人物弧光与情绪高潮卡片渲染；
 * - 外部样本文本分析交互。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NovelBreakdownResponse } from '../../server/api'
import { okJson } from '../test/http'
import { NovelBreakdownView } from './NovelBreakdownView'

afterEach(() => {
  vi.unstubAllGlobals()
})

const MOCK_BREAKDOWN: NovelBreakdownResponse = {
  ok: true,
  result: {
    storyCore: {
      protagonist: '陆沉舟',
      mainGoal: '武道登神，横扫诸天',
      goldenFinger: '天道推演神图',
      mainConflict: '草根散修 vs 隐世世家',
    },
    chapterPacing: [
      {
        chapter: 1,
        title: '第 1 章 · 危机',
        hook: '暗夜截杀',
        payOff: '觉醒神图反杀',
        pacingGrade: 'A+',
      },
    ],
    characterArcs: [
      {
        name: '陆沉舟',
        role: '主角',
        desire: '长生',
        flaw: '多疑',
      },
    ],
    emotionalBeats: [
      {
        type: 'climax',
        label: '决战爆发',
        description: '当众反杀大宗师',
      },
    ],
  },
}

describe('NovelBreakdownView（小说拆解）', () => {
  it('故事核、黄金三章与人物卡片渲染；契约快照', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_BREAKDOWN)))
    const { container } = render(<NovelBreakdownView root="C:/tmp/book" />)

    await waitFor(() => {
      expect(screen.getByTestId('breakdown-story-core')).toBeInTheDocument()
    })

    expect(screen.getByTestId('breakdown-story-core').textContent).toContain('陆沉舟')
    expect(screen.getByTestId('breakdown-pacing').textContent).toContain('暗夜截杀')
    expect(screen.getByTestId('breakdown-characters').textContent).toContain('主角')
    expect(screen.getByTestId('breakdown-beats').textContent).toContain('决战爆发')

    const view = container.querySelector('[aria-label="novel-breakdown-view"]')
    if (view === null) throw new Error('missing novel-breakdown-view')
    expect(view).toMatchSnapshot()
  })

  it('样例填入与拆解交互', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(MOCK_BREAKDOWN))
    vi.stubGlobal('fetch', fetchMock)

    render(<NovelBreakdownView root="C:/tmp/book" />)
    const sampleBtn = screen.getByRole('button', { name: '样例 1' })
    await userEvent.click(sampleBtn)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
  })
})
