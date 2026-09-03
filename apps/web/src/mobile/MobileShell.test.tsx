import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { MobileShell } from './MobileShell'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MobileShell - 移动端 Technical Preview 工作台组件测试', () => {
  const dummyBook = {
    root: 'C:\\tmp\\test-book',
    bookId: 'bk_test',
    title: '假神真显灵',
  }

  it('正确渲染移动端 5 大 Tab 导航与诚实状态', () => {
    render(<MobileShell book={dummyBook} onSwitchBook={vi.fn()} />)
    expect(screen.getByText(/本地创作者 · Technical Preview/)).toBeDefined()
    expect(screen.queryByText(/Pro 终身版/)).toBeNull()
    expect(screen.getByRole('button', { name: /创作/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /检视/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /作品/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /书源/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /设置/ })).toBeDefined()
  })

  it('点击底部导航可切换至检视塔并查看四枢纽', () => {
    render(<MobileShell book={dummyBook} onSwitchBook={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /检视/ }))
    expect(screen.getByText(/真实数据面/)).toBeDefined()
    expect(screen.getByText('设定事实')).toBeDefined()
    expect(screen.getByText('装配看板')).toBeDefined()
    expect(screen.getByText('变更影响')).toBeDefined()
    expect(screen.getByText('质量审查')).toBeDefined()
  })

  it('点击时光机只显示未接入状态，不伪造版本或回滚', () => {
    render(<MobileShell book={dummyBook} onSwitchBook={vi.fn()} />)
    fireEvent.click(screen.getByTitle('版本历史时光机'))
    expect(screen.getByText('版本时光机与差异回滚')).toBeDefined()
    expect(screen.getByText(/版本历史尚未接入/)).toBeDefined()
    expect(screen.queryByText(/Rev 4/)).toBeNull()
    expect(screen.queryByRole('button', { name: /恢复此版本/ })).toBeNull()
  })

  it('点击灵感起名可呼出本地灵感工坊', () => {
    render(<MobileShell book={dummyBook} onSwitchBook={vi.fn()} />)
    fireEvent.click(screen.getByText(/灵感起名/))
    expect(screen.getByText('网文灵感与起名工坊')).toBeDefined()
    expect(screen.getByText(/角色龙套起名/)).toBeDefined()
    expect(screen.getByText(/宗门势力起名/)).toBeDefined()
    expect(screen.getByText(/法宝神兵起名/)).toBeDefined()
  })

  it('点击创作者胶囊显示账号服务未接入', () => {
    render(<MobileShell book={dummyBook} onSwitchBook={vi.fn()} />)
    fireEvent.click(screen.getByTitle('创作者状态与账户'))
    expect(screen.getByText('创作者账号状态')).toBeDefined()
    expect(screen.getByText(/账号服务尚未接入/)).toBeDefined()
    expect(screen.queryByPlaceholderText('请输入注册邮箱')).toBeNull()
  })
})
