/**
 * 会员与授权中心（MembershipView）组件测试（实现票 T55）：
 * - 契约快照：输入形状 = server/api 导出类型（MembershipResponse），
 *   包类型漂移即 typecheck + 快照双报警；
 * - 许可证卡片与版本权益矩阵渲染；
 * - 密钥激活交互与成功提示。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MembershipResponse } from '../../server/api'
import { okJson } from '../test/http'
import { MembershipView } from './MembershipView'

afterEach(() => {
  vi.unstubAllGlobals()
})

const MOCK_MEMBERSHIP: MembershipResponse = {
  ok: true,
  license: {
    planId: 'pro_lifetime',
    planName: '墨舟 Pro 终身专业版',
    licenseKey: 'MOZHOU-PRO-LIFETIME-TEST',
    activatedAt: '2026-08-30',
    expiresAt: '永久有效',
    status: 'active',
  },
  plans: [
    {
      id: 'pro_lifetime',
      name: '墨舟 Pro 终身专业版',
      price: '¥299',
      tag: '当前已激活',
      features: ['无限作品库', 'Story Brain', '质量门审查'],
      current: true,
    },
  ],
}

describe('MembershipView（会员中心）', () => {
  it('许可证与方案矩阵渲染；契约快照', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_MEMBERSHIP)))
    const { container } = render(<MembershipView />)

    await waitFor(() => {
      expect(screen.getByTestId('membership-license-card')).toBeInTheDocument()
    })

    expect(screen.getByTestId('membership-license-card').textContent).toContain('墨舟 Pro 终身专业版')
    expect(screen.getByTestId('membership-plans-section').textContent).toContain('¥299')

    const view = container.querySelector('[aria-label="membership-view"]')
    if (view === null) throw new Error('missing membership-view')
    expect(view).toMatchSnapshot()
  })

  it('激活密钥交互', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((path: string) => {
        if (path === '/api/membership') return okJson(MOCK_MEMBERSHIP)
        if (path === '/api/membership.activate') return okJson(MOCK_MEMBERSHIP)
        return okJson({ ok: false })
      }),
    )

    render(<MembershipView />)
    await waitFor(() => {
      expect(screen.getByTestId('membership-activate-section')).toBeInTheDocument()
    })

    const input = screen.getByLabelText('许可证密钥输入')
    await userEvent.type(input, 'NEW-KEY-1234')
    const btn = screen.getByRole('button', { name: '激活授权' })
    await userEvent.click(btn)

    await waitFor(() => {
      expect(screen.getByTestId('membership-success')).toBeInTheDocument()
      expect(input).toHaveValue('')
    })
  })
})
