/**
 * 任务中心（TasksView）组件测试（实现票 T48）：
 * - 契约快照：输入形状 = server/api 导出类型（TasksResponse），
 *   包类型漂移即 typecheck + 快照双报警；
 * - 任务统计、Traversal 影响审计记录与管线事件流水卡片渲染；
 * - 类别筛选（全部 / 管线 / 遍历 / 审查）；
 * - 未建书时的显式空态与引导。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TasksResponse } from '../../server/api'
import { okJson } from '../test/http'
import { TasksView } from './TasksView'

afterEach(() => {
  vi.unstubAllGlobals()
})

const MOCK_TASKS: TasksResponse = {
  ok: true,
  totalEvents: 3,
  totalTraversals: 1,
  events: [
    {
      position: 3,
      type: 'QualityReviewed',
      summary: 'QualityReviewed (taskRef: tsk_rev_1)',
      category: 'review',
      timestamp: '2026-08-31T12:00:00.000Z',
    },
    {
      position: 2,
      type: 'TraversalFinished',
      summary: 'TraversalFinished (taskRef: tsk_trav_1)',
      category: 'traversal',
      timestamp: '2026-08-31T11:00:00.000Z',
    },
    {
      position: 1,
      type: 'ChapterCommitted',
      summary: 'ChapterCommitted (seq: 1)',
      category: 'pipeline',
      timestamp: '2026-08-31T10:00:00.000Z',
    },
  ],
  traversals: [
    {
      projectionVersion: 1,
      traversalId: 'trav_demo_1',
      taskRef: 'tsk_trav_1',
      trigger: { source: 'commit', ref: 'cmit_01' },
      affectedChapters: [1, 2],
      affectedFingerprint: 'sha256_mock_fp',
      upstreamChanges: [],
      recordedAt: '2026-08-31T11:00:00.000Z',
    },
  ],
}

describe('TasksView（任务中心）', () => {
  it('流水与 Traversal 审计渲染（统计/分类徽标/受影响章）；契约快照', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_TASKS)))
    const { container } = render(
      <TasksView root="C:/tmp/fake-book" onGoToWorkbench={() => {}} />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('tasks-traversals')).toBeInTheDocument()
    })
    expect(screen.getByTestId('tasks-traversals').textContent).toContain('trav_demo_1')
    expect(screen.getByTestId('tasks-traversals').textContent).toContain('第1章, 第2章')
    expect(screen.getByTestId('tasks-events').textContent).toContain('QualityReviewed')
    expect(screen.getByTestId('tasks-events').textContent).toContain('ChapterCommitted')

    const view = container.querySelector('[aria-label="tasks-view"]')
    if (view === null) throw new Error('missing tasks-view')
    expect(view).toMatchSnapshot()
  })

  it('事件流水类别筛选交互', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_TASKS)))
    render(<TasksView root="C:/tmp/fake-book" onGoToWorkbench={() => {}} />)
    await waitFor(() => {
      expect(screen.getByTestId('tasks-events')).toBeInTheDocument()
    })

    // 点击「审查」筛选
    const reviewBtn = screen.getByRole('button', { name: '审查' })
    await userEvent.click(reviewBtn)
    expect(screen.getByTestId('tasks-events').textContent).toContain('QualityReviewed')
    expect(screen.getByTestId('tasks-events').textContent).not.toContain('ChapterCommitted')
  })

  it('未建书时呈现显式引导', () => {
    render(<TasksView root={null} onGoToWorkbench={() => {}} />)
    expect(screen.getByTestId('tasks-empty')).toBeInTheDocument()
    expect(screen.getByTestId('tasks-empty').textContent).toContain('任务中心暂不可用')
  })

  it('读取失败显式报错（role=alert），不静默', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: '任务账本读取失败' }), { status: 500 }),
      ),
    )
    render(<TasksView root="C:/tmp/fake-book" onGoToWorkbench={() => {}} />)
    await waitFor(() => {
      expect(screen.getByTestId('tasks-error').textContent).toContain('任务账本读取失败')
    })
  })
})
