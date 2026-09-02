import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { MobileShell } from './MobileShell'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MobileShell - 移动端商业化全景工作台组件测试', () => {
  const dummyBook = {
    root: 'C:\\tmp\\test-book',
    bookId: 'bk_test',
    title: '假神真显灵',
  }

  it('正确渲染移动端 5 大 Tab 导航与顶栏状态', () => {
    render(<MobileShell book={dummyBook} onSwitchBook={vi.fn()} />)

    // 状态栏
    expect(screen.getByText(/道玄先生 · Pro 终身版/)).toBeDefined()

    // 5 个导航按钮
    expect(screen.getByRole('button', { name: /创作/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /检视/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /作品/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /书源/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /设置/ })).toBeDefined()
  })

  it('点击底部导航可切换至检视塔并查看四枢纽', () => {
    render(<MobileShell book={dummyBook} onSwitchBook={vi.fn()} />)

    const inspectBtn = screen.getByRole('button', { name: /检视/ })
    fireEvent.click(inspectBtn)

    expect(screen.getByText(/真实数据面/)).toBeDefined()
    expect(screen.getByText('设定事实')).toBeDefined()
    expect(screen.getByText('装配看板')).toBeDefined()
    expect(screen.getByText('变更影响')).toBeDefined()
    expect(screen.getByText('质量审查')).toBeDefined()
  })

  it('点击时光机可呼出版本历史抽屉', () => {
    render(<MobileShell book={dummyBook} onSwitchBook={vi.fn()} />)

    const historyBtn = screen.getByTitle('版本历史时光机')
    fireEvent.click(historyBtn)

    expect(screen.getByText('版本时光机与差异回滚')).toBeDefined()
    expect(screen.getByText(/Rev 4 · 当前最新修改/)).toBeDefined()
    expect(screen.getByText(/Rev 3 · 30 分钟前快照/)).toBeDefined()
  })

  it('点击灵感起名可呼出网文灵感工坊', () => {
    render(<MobileShell book={dummyBook} onSwitchBook={vi.fn()} />)

    const inspirationBtn = screen.getByText(/灵感起名/)
    fireEvent.click(inspirationBtn)

    expect(screen.getByText('网文灵感与起名工坊')).toBeDefined()
    expect(screen.getByText(/角色龙套起名/)).toBeDefined()
    expect(screen.getByText(/宗门势力起名/)).toBeDefined()
    expect(screen.getByText(/法宝神兵起名/)).toBeDefined()
  })

  it('点击创作者胶囊可呼出登录与账号切换抽屉', () => {
    render(<MobileShell book={dummyBook} onSwitchBook={vi.fn()} />)

    const capsuleBtn = screen.getByTitle('创作者状态与账户')
    fireEvent.click(capsuleBtn)

    expect(screen.getByText('创作者账号登录与切换')).toBeDefined()
    expect(screen.getByPlaceholderText('请输入注册邮箱')).toBeDefined()
  })
})
