/**
 * 技能广场（能力注册表）组件测试（实现票 T46）：
 * - 契约快照：输入形状 = server/api 导出类型（CapabilitySquareResponse），
 *   包类型漂移即 typecheck + 快照双报警；
 * - 分组/条目渲染（label/description/evidence + 状态徽标文字——语义由文字承载）；
 * - providerAvailable=true 时「Gate 3 已开」横幅；
 * - 读取失败显式报错（role=alert），不静默。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapabilitySquareResponse } from '../../server/api'
import { okJson } from '../test/http'
import { CapabilitySquareView } from './CapabilitySquareView'

afterEach(() => {
  vi.unstubAllGlobals()
})

const REGISTRY: CapabilitySquareResponse = {
  ok: true,
  providerAvailable: false,
  groups: [
    {
      group: '创作',
      entries: [
        {
          id: 'workbench',
          label: '工作台',
          description: '建书、首章与工作台',
          status: 'native',
          evidence: '已接入（T40–T44）',
        },
        {
          id: 'dialogue',
          label: '写作对话',
          description: '中栏写作对话与草稿流式生成',
          status: 'provider_required',
          evidence: 'provider 未配显式不可用（Gate 3）',
        },
      ],
    },
    {
      group: '资源',
      entries: [
        {
          id: 'rank-scan',
          label: '网文扫榜',
          description: '网文扫榜',
          status: 'external_source_required',
          evidence: '外部榜单源未接入；页面为显式占位',
        },
      ],
    },
  ],
}

describe('CapabilitySquareView（技能广场）', () => {
  it('分组/条目渲染（label/description/evidence + 状态徽标文字）；契约快照', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(REGISTRY)))
    const { container } = render(<CapabilitySquareView />)
    await waitFor(() => {
      expect(screen.getAllByTestId('capability-square-group').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByTestId('capability-square-group')).toHaveLength(2)
    // 徽标语义由文字承载（原生可用 / 需要模型服务 / 需要外部数据源）
    const badgeTexts = screen.getAllByTestId('capability-square-badge').map((b) => b.textContent)
    expect(badgeTexts).toContain('原生可用')
    expect(badgeTexts).toContain('需要模型服务')
    expect(badgeTexts).toContain('需要外部数据源')
    // 证据行（id · evidence）可见
    expect(screen.getAllByTestId('capability-square-group')[0]?.textContent).toContain('workbench')
    const view = container.querySelector('[aria-label="capability-square-view"]')
    if (view === null) throw new Error('missing capability-square-view')
    expect(view).toMatchSnapshot()
  })

  it('providerAvailable=true：显示「Gate 3 已开」横幅', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ ...REGISTRY, providerAvailable: true })))
    render(<CapabilitySquareView />)
    await waitFor(() => {
      expect(screen.getByTestId('capability-square-provider').textContent).toContain('Gate 3')
    })
  })

  it('读取失败显式报错（role=alert），不静默', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: '注册表读取失败' }), { status: 500 }),
      ),
    )
    render(<CapabilitySquareView />)
    await waitFor(() => {
      expect(screen.getByTestId('capability-square-error').textContent).toContain('注册表读取失败')
    })
  })

  it('点击能力卡片打开详情，并支持一键启用/停用技能到写作流', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(REGISTRY)))
    render(<CapabilitySquareView />)
    await waitFor(() => {
      expect(screen.getByText('工作台')).toBeInTheDocument()
    })
    // 点击工作台卡片展开 Sheet
    await userEvent.click(screen.getByText('工作台'))
    await waitFor(() => {
      expect(screen.getByTestId('capability-square-sheet')).toBeInTheDocument()
    })
    const toggleBtn = screen.getByRole('button', { name: '启用此技能到写作流' })
    expect(toggleBtn).toBeInTheDocument()
    await userEvent.click(toggleBtn)

    expect(screen.getByRole('button', { name: '停用此技能' })).toBeInTheDocument()
    expect(localStorage.getItem('mozhou.skills.active')).toContain('workbench')
  })
})
