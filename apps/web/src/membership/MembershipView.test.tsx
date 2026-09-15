/**
 * 会员与授权中心（MembershipView）Technical Preview 组件测试：
 * - 社区免费版是真实当前状态；
 * - 未开放购买/激活时不显示付费许可证或密钥输入；
 * - 未来方案可以展示，但不得伪装为已激活。
 */
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MembershipResponse } from '../../server/api'
import { okJson } from '../test/http'
import { MembershipView } from './MembershipView'

afterEach(() => {
  vi.unstubAllGlobals()
})

const MOCK_MEMBERSHIP: MembershipResponse = {
  ok: true,
  license: null,
  plans: [
    {
      id: 'free_community',
      name: '社区免费版',
      price: '免费',
      tag: 'Technical Preview 当前版本',
      features: ['单书本地正典创作', '本地 SQLite 数据库存储'],
      current: true,
    },
    {
      id: 'pro_monthly',
      name: '墨舟 Pro 月费',
      price: '19 元/月',
      tag: 'catalog 2026-09-15.1 · 尚未开放购买',
      features: ['style-distill', 'storyboard'],
      amountFen: 1900,
      currency: 'CNY',
      catalogVersion: '2026-09-15.1',
      current: false,
    },
    {
      id: 'max_monthly',
      name: '墨舟 Max 月费',
      price: '39 元/月',
      tag: '官方调用额度待真实成本测算后开放（当前不可购买）',
      features: [],
      amountFen: 3900,
      currency: 'CNY',
      catalogVersion: '2026-09-15.1',
      sellable: false,
      current: false,
    },
  ],
}

describe('MembershipView（会员中心）', () => {
  it('社区免费版为当前版本，付费方案只作为未开放计划展示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_MEMBERSHIP)))
    render(<MembershipView />)

    await waitFor(() => {
      expect(screen.getByTestId('membership-no-license')).toBeInTheDocument()
    })

    expect(screen.getByText('会员与授权中心')).toBeInTheDocument()
    expect(screen.getByTestId('membership-no-license').textContent).toContain('社区免费版')
    expect(screen.getByTestId('membership-plans-section').textContent).toContain('尚未开放')
    expect(screen.queryByTestId('membership-license-card')).not.toBeInTheDocument()
    expect(screen.queryByText(/当前已激活/)).not.toBeInTheDocument()
  })

  it('未开放激活服务时不暴露密钥输入或激活按钮，并明确不接受密钥', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_MEMBERSHIP)))
    render(<MembershipView />)

    await waitFor(() => {
      expect(screen.getByTestId('membership-activate-section')).toBeInTheDocument()
    })

    expect(screen.queryByLabelText('许可证密钥输入')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '激活授权' })).not.toBeInTheDocument()
    expect(screen.getByTestId('membership-activate-section').textContent).toContain('尚未开放')
    expect(screen.getByTestId('membership-activate-section').textContent).toContain('不会接受或保存许可证密钥')
  })
})
