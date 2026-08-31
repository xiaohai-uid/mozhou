/**
 * 变更矩阵组件测试（T43）：
 * - 契约快照：输入形状 = @mozhou/data-plane 包类型（ChangeMatrix / ChangeMatrixRow /
 *   ChangeMatrixCellState），包类型漂移即 typecheck + 快照双报警；
 * - 矩阵表三态渲染（红 needs_rework / 绿 resolved / — not_affected）+ 直引零 any；
 * - 行级重跑触发 /api/change-matrix.rerun 且幂等（重复点击不产生多余副作用）；
 * - 空态 / 失败显式报错。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChangeMatrix } from '@mozhou/data-plane'
import { okJson } from '../test/http'
import { ChangeMatrixPanel } from './ChangeMatrixPanel'

afterEach(() => {
  vi.unstubAllGlobals()
})

const MATRIX: ChangeMatrix = {
  columns: [17, 18, 19],
  rows: [
    {
      traversalId: 't_1',
      taskRef: 'trav_1',
      trigger: { source: 'reconciliation', ref: 'rcln_x' },
      upstreamChanges: [{ kind: 'temporalFact', id: 'fact_a', revision: 2 }],
      recordedAt: '2026-08-28T00:00:00.000Z',
      staleCount: 2,
      cells: [
        { chapterIndex: 17, state: 'resolved' },
        { chapterIndex: 18, state: 'needs_rework' },
        { chapterIndex: 19, state: 'not_affected' },
      ],
    },
    {
      traversalId: 't_2',
      taskRef: 'trav_2',
      trigger: { source: 'commit', ref: 'c2' },
      upstreamChanges: [{ kind: 'outlineNode', id: 'node_o', revision: 3 }],
      recordedAt: '2026-08-28T00:00:01.000Z',
      staleCount: 1,
      cells: [
        { chapterIndex: 17, state: 'not_affected' },
        { chapterIndex: 18, state: 'needs_rework' },
        { chapterIndex: 19, state: 'not_affected' },
      ],
    },
  ],
}

/** stub：change-matrix 返回指定矩阵；rerun 返回同一矩阵（幂等语义）。 */
function stubMatrixFetch(matrix: ChangeMatrix = MATRIX): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation((path: string) => {
    if (path === '/api/change-matrix') return okJson({ ok: true, matrix })
    if (path === '/api/change-matrix.rerun') return okJson({ ok: true, matrix, rerunCount: 1 })
    return okJson({ ok: false, error: 'unexpected path: ' + path })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('ChangeMatrixPanel（T43）', () => {
  it('矩阵表渲染：行=Traversal、列=章、三态格红/绿/—；契约快照', async () => {
    stubMatrixFetch()
    const { container } = render(<ChangeMatrixPanel root="C:\\tmp\\book-a" />)
    await waitFor(() => {
      expect(screen.getByTestId('matrix-table')).toBeInTheDocument()
    })
    // 列头
    const headers = [...screen.getByTestId('matrix-table').querySelectorAll('th')].map((th) => th.textContent)
    expect(headers).toEqual(['上游变更', 'ch17', 'ch18', 'ch19'])
    // rowname 摘要
    expect(screen.getAllByTestId('matrix-rownames')[0]?.textContent).toContain('temporalFact:fact_a')
    // 三态格
    const cells = [...screen.getByTestId('matrix-table').querySelectorAll('[data-cell]')].map(
      (cell) => cell.getAttribute('data-cell'),
    )
    expect(cells).toEqual([
      'resolved', 'needs_rework', 'not_affected',
      'not_affected', 'needs_rework', 'not_affected',
    ])
    // 总 stale 徽标 = 2+1 = 3
    expect(document.querySelector('.panel-head .verdict')?.textContent).toContain('stale 3')
    expect(container.querySelector('[aria-label="change-matrix-panel"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="change-matrix-panel"]')).toMatchSnapshot()
  })

  it('行级重跑按钮：点击触发 /api/change-matrix.rerun（携 traversalId）且幂等', async () => {
    const fetchMock = stubMatrixFetch()
    const ROOT = 'C:/tmp/book-a' // 正斜杠避免 Windows 反斜杠在 jsdom/断言中转义歧义
    render(<ChangeMatrixPanel root={ROOT} />)
    await waitFor(() => {
      expect(screen.getByTestId('matrix-table')).toBeInTheDocument()
    })
    // 只有 staleCount>0 的选择器被启用（t_1、t_2 均 >0）
    const rerunButtons = screen.getAllByTestId('matrix-rerun')
    expect(rerunButtons).toHaveLength(2)
    await userEvent.click(rerunButtons[0] as HTMLElement)
    await waitFor(() => {
      const rerunCalls = fetchMock.mock.calls.filter((call) => call[0] === '/api/change-matrix.rerun')
      expect(rerunCalls).toHaveLength(1)
      const init = rerunCalls[0]?.[1] as { body?: string } | undefined
      const body = JSON.parse(init?.body ?? '{}') as { root: string; traversalId: string }
      expect(body).toEqual({ root: ROOT, traversalId: 't_1' })
    })
    // 再次点击：仍只多一次（幂等，不重复副作用）
    await userEvent.click(rerunButtons[1] as HTMLElement)
    await waitFor(() => {
      const rerunCalls = fetchMock.mock.calls.filter((call) => call[0] === '/api/change-matrix.rerun')
      expect(rerunCalls).toHaveLength(2)
    })
  })

  it('staleCount=0 的行禁用重跑（无需重跑）', async () => {
    const resolvedOnly: ChangeMatrix = {
      columns: [17],
      rows: [
        {
          traversalId: 't_3',
          taskRef: 'trav_3',
          trigger: { source: 'reconciliation', ref: 'r' },
          upstreamChanges: [{ kind: 'temporalFact', id: 'fact_a', revision: 2 }],
          recordedAt: '2026-08-28T00:00:02.000Z',
          staleCount: 0,
          cells: [{ chapterIndex: 17, state: 'resolved' }],
        },
      ],
    }
    stubMatrixFetch(resolvedOnly)
    render(<ChangeMatrixPanel root="C:\\tmp\\book-a" />)
    await waitFor(() => {
      expect(screen.getByTestId('matrix-table')).toBeInTheDocument()
    })
    const rerun = screen.getByTestId('matrix-rerun')
    expect((rerun as HTMLButtonElement).disabled).toBe(true)
  })

  it('空态：无 impact 记录时显式提示', async () => {
    stubMatrixFetch({ columns: [], rows: [] })
    render(<ChangeMatrixPanel root="C:\\tmp\\book-a" />)
    await waitFor(() => {
      expect(screen.getByTestId('matrix-empty').textContent).toContain('暂无变更')
    })
  })

  it('读取失败显式报错（role=alert），不静默', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((path: string) => {
        if (path === '/api/change-matrix') {
          return new Response(JSON.stringify({ ok: false, error: '矩阵读取失败' }), { status: 500 })
        }
        return okJson({ ok: false, error: 'unexpected path: ' + path })
      }),
    )
    render(<ChangeMatrixPanel root="C:\\tmp\\book-a" />)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('矩阵读取失败')
    })
  })
})