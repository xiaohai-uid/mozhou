import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreferenceProfilePanel } from './PreferenceProfilePanel'
import { ModelRoutingSuggestionsPanel } from './ModelRoutingSuggestionsPanel'
import type { BookInfo } from '../shell/workbenchStorage'
import { okJson } from '../test/http'

const TEST_BOOK: BookInfo = {
  root: '/test/books/book_1',
  bookId: 'book_1',
  title: '飞轮测试书',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PreferenceProfilePanel 作者偏好画像前端面板', () => {
  it('1. 无观测冷启动时渲染诚实空态', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === '/api/flywheel.preference') {
          return Promise.resolve(
            okJson({
              ok: true,
              materialized: false,
              observationCount: 0,
              profile: {
                cursor: 0,
                obsCount: 0,
                degradedWindows: 0,
                dims: {
                  sent_len_mean: { mean: 25.0, variance: 1.0, nEffective: 0, streak: 0 },
                  dlg_char_ratio: { mean: 0.35, variance: 0.05, nEffective: 0, streak: 0 },
                },
              },
            }),
          )
        }
        return Promise.reject(new Error('unhandled ' + url))
      }),
    )

    render(<PreferenceProfilePanel book={TEST_BOOK} />)

    // 等待数据加载
    expect(await screen.findByTestId('preference-profile-panel')).toBeInTheDocument()
    expect(await screen.findByTestId('preference-empty-state')).toBeInTheDocument()
    expect(screen.getByText(/暂无作者行为观测（诚实空态）/)).toBeInTheDocument()
    expect(screen.getByText(/冷启动先验/)).toBeInTheDocument()
    expect(screen.getByTestId('preference-dim-sent_len_mean')).toBeInTheDocument()
  })

  it('2. 真实数据物化后渲染已物化读数并支持手动全量重建', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/flywheel.preference') {
        return Promise.resolve(
          okJson({
            ok: true,
            materialized: true,
            observationCount: 15,
            profile: {
              cursor: 120,
              obsCount: 15,
              degradedWindows: 0,
              dims: {
                sent_len_mean: { mean: 31.25, variance: 0.8, nEffective: 15, streak: 0 },
                dlg_char_ratio: { mean: 0.42, variance: 0.03, nEffective: 15, streak: 0 },
              },
            },
          }),
        )
      }
      if (url === '/api/flywheel.preference.rebuild') {
        return Promise.resolve(
          okJson({
            ok: true,
            observationCount: 18,
            profile: {
              cursor: 150,
              obsCount: 18,
              degradedWindows: 0,
              dims: {
                sent_len_mean: { mean: 32.1, variance: 0.7, nEffective: 18, streak: 0 },
                dlg_char_ratio: { mean: 0.45, variance: 0.02, nEffective: 18, streak: 0 },
              },
            },
          }),
        )
      }
      return Promise.reject(new Error('unhandled ' + url))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<PreferenceProfilePanel book={TEST_BOOK} />)

    expect(await screen.findByText(/已物化 \(15 条观测\)/)).toBeInTheDocument()
    expect(screen.queryByTestId('preference-empty-state')).toBeNull()
    expect(screen.getByText('31.250')).toBeInTheDocument()

    // 点击重建画像
    const user = userEvent.setup()
    const rebuildBtn = screen.getByRole('button', { name: '重建画像' })
    await user.click(rebuildBtn)

    await waitFor(() => {
      expect(screen.getByText(/已物化 \(18 条观测\)/)).toBeInTheDocument()
      expect(screen.getByText('32.100')).toBeInTheDocument()
    })
  })
})

describe('ModelRoutingSuggestionsPanel 模型建议前端面板', () => {
  it('1. 暂无建议时渲染诚实空态与硬不变量约定', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === '/api/flywheel.suggestions') {
          return Promise.resolve(
            okJson({
              ok: true,
              suggestions: [],
              count: 0,
            }),
          )
        }
        if (url === '/api/flywheel.evaluator.status') {
          return Promise.resolve(
            okJson({
              ok: true,
              eligible: false,
              sampleSize: { decisions: 2, chapterWindows: 1 },
              thresholds: { minDecisions: 20, minChapterWindows: 5 },
            }),
          )
        }
        return Promise.reject(new Error('unhandled ' + url))
      }),
    )

    render(<ModelRoutingSuggestionsPanel book={TEST_BOOK} />)

    expect(await screen.findByTestId('model-suggestions-panel')).toBeInTheDocument()
    expect(await screen.findByTestId('suggestions-empty-state')).toBeInTheDocument()
    expect(screen.getByText(/当前暂无模型路由建议（诚实空态）/)).toBeInTheDocument()
    expect(screen.getByTestId('routing-invariant-notice')).toBeInTheDocument()
    expect(screen.getByText(/所有生成条目均为参考建议，墨舟绝不会自动修改当前模型路由配置/)).toBeInTheDocument()
    expect(screen.getByText(/样本积累中 \(观察模式\)/)).toBeInTheDocument()
  })

  it('2. 包含建议时渲染建议列表与详细指标，且提供重新评估入口', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/flywheel.suggestions') {
        return Promise.resolve(
          okJson({
            ok: true,
            count: 1,
            suggestions: [
              {
                suggestionId: 'sug_test_01',
                createdAtUtc: '2026-10-06T12:00:00.000Z',
                cell: {
                  taskType: 'CHAPTER_DRAFTING',
                  providerId: 'deepseek',
                  model: 'deepseek-chat',
                  recipeVersion: null,
                },
                kind: 'promote',
                proposedRoute: {
                  providerId: 'deepseek',
                  model: 'deepseek-reasoner',
                },
                basis: {
                  sampleSize: { decisions: 25, chapterWindows: 6 },
                  challengerAcceptanceWilson: [0.75, 0.92],
                  incumbentAcceptanceWilson: [0.55, 0.70],
                  editRatioDeltaPct: -0.15,
                  benchmarkGatePassed: true,
                  matrixRowRef: null,
                },
                status: 'sufficient_sample',
              },
            ],
          }),
        )
      }
      if (url === '/api/flywheel.evaluator.status') {
        return Promise.resolve(
          okJson({
            ok: true,
            eligible: true,
            sampleSize: { decisions: 25, chapterWindows: 6 },
            thresholds: { minDecisions: 20, minChapterWindows: 5 },
          }),
        )
      }
      if (url === '/api/flywheel.evaluator.run') {
        return Promise.resolve(
          okJson({
            ok: true,
            mode: 'evaluated',
            bridgePresent: true,
            appendedCount: 1,
            suggestions: [
              {
                suggestionId: 'sug_test_01',
                createdAtUtc: '2026-10-06T12:00:00.000Z',
                cell: {
                  taskType: 'CHAPTER_DRAFTING',
                  providerId: 'deepseek',
                  model: 'deepseek-chat',
                  recipeVersion: null,
                },
                kind: 'promote',
                proposedRoute: {
                  providerId: 'deepseek',
                  model: 'deepseek-reasoner',
                },
                basis: {
                  sampleSize: { decisions: 25, chapterWindows: 6 },
                  challengerAcceptanceWilson: [0.75, 0.92],
                  incumbentAcceptanceWilson: [0.55, 0.70],
                  editRatioDeltaPct: -0.15,
                  benchmarkGatePassed: true,
                  matrixRowRef: null,
                },
                status: 'sufficient_sample',
              },
            ],
          }),
        )
      }
      return Promise.reject(new Error('unhandled ' + url))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ModelRoutingSuggestionsPanel book={TEST_BOOK} />)

    expect(await screen.findByText('推荐晋级')).toBeInTheDocument()
    expect(screen.getByText('CHAPTER_DRAFTING')).toBeInTheDocument()
    expect(screen.getByText(/deepseek\/deepseek-reasoner/)).toBeInTheDocument()
    expect(screen.getByText('满足最小评估样本')).toBeInTheDocument()

    // 点击重新评估
    const user = userEvent.setup()
    const evalBtn = screen.getByRole('button', { name: '重新评估' })
    await user.click(evalBtn)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/flywheel.evaluator.run',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })
})
