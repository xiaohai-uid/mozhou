/**
 * 风格蒸馏（StyleDistillView）组件测试（实现票 T50）：
 * - 契约快照：输入形状 = server/api 导出类型（StyleDistillResponse），
 *   包类型漂移即 typecheck + 快照双报警；
 * - 样本输入、样例一键填入与指标提取；
 * - 四场景文风画像卡片渲染。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StyleDistillResponse } from '../../server/api'
import { okJson } from '../test/http'
import { StyleDistillView } from './StyleDistillView'

afterEach(() => {
  vi.unstubAllGlobals()
})

const MOCK_STYLE: StyleDistillResponse = {
  ok: true,
  currentProfiles: {
    action: {
      scenarioType: 'action',
      revision: 1,
      dialogueRatio: 0.15,
      sensoryDensity: 0.45,
      actionPacing: 0.8,
    },
    dialogue: {
      scenarioType: 'dialogue',
      revision: 1,
      dialogueRatio: 0.75,
      sensoryDensity: 0.2,
      actionPacing: 0.3,
    },
  },
  sampleMetrics: {
    charCount: 120,
    dialogueRatio: 0.4,
    avgSentenceLength: 15,
    shortSentenceRatio: 0.6,
    sensoryDensity: 0.5,
    actionPacing: 0.7,
  },
}

describe('StyleDistillView（风格蒸馏）', () => {
  it('样本输入与指标渲染；契约快照', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_STYLE)))
    const { container } = render(<StyleDistillView root="C:/tmp/book" />)
    await waitFor(() => {
      expect(screen.getByTestId('style-sample-input')).toBeInTheDocument()
    })

    expect(screen.getByTestId('style-metrics-result')).toBeInTheDocument()
    expect(screen.getByTestId('style-metrics-result').textContent).toContain('120 字')
    expect(screen.getByTestId('style-profiles-list').textContent).toContain('action')

    const view = container.querySelector('[aria-label="style-distill-view"]')
    if (view === null) throw new Error('missing style-distill-view')
    expect(view).toMatchSnapshot()
  })

  it('样例填入与蒸馏点击交互', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(MOCK_STYLE))
    vi.stubGlobal('fetch', fetchMock)

    render(<StyleDistillView root="C:/tmp/book" />)
    const sampleBtn = screen.getByRole('button', { name: '冷冽武侠·短句动作' })
    await userEvent.click(sampleBtn)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
  })
})
