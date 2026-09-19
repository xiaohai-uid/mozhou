/**
 * 主导航测试（U01 重组）：四域一级直达（作品/写作/分镜/素材）+
 * 工具箱收纳其余航道——全部旧入口可达，不把隐藏当删除；任务徽标纪律不变。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CapabilityChannels } from './CapabilityChannels'
import { VIEW_COUNT, VIEW_IDS } from './views'

const PRIMARY = ['works', 'workbench', 'storyboard', 'book-source'] as const

describe('CapabilityChannels（U01 四域 + 工具箱）', () => {
  it('四域一级直达；工具箱收纳其余全部航道（20 项均可达）', async () => {
    const user = userEvent.setup()
    render(<CapabilityChannels activeView="workbench" onSelect={() => {}} taskCount={0} />)
    for (const id of PRIMARY) {
      expect(document.querySelector(`[data-view="${id}"]`)).not.toBeNull()
    }
    // 默认（当前视图在四域内）工具箱收起，主导航不出现次级项
    expect(document.querySelector('[data-view="context-receipt"]')).toBeNull()
    await user.click(screen.getByTestId('nav-toolbox-toggle'))
    expect(document.querySelectorAll('.nav-item')).toHaveLength(VIEW_COUNT - PRIMARY.length)
    for (const id of VIEW_IDS) {
      expect(document.querySelector(`[data-view="${id}"]`)).not.toBeNull()
    }
    expect(VIEW_COUNT).toBe(20)
  })

  it('当前视图在工具箱内时自动展开并高亮', () => {
    render(<CapabilityChannels activeView="quality-gate" onSelect={() => {}} taskCount={0} />)
    const active = document.querySelector('.nav-item.active')
    expect(active?.getAttribute('data-view')).toBe('quality-gate')
    expect(screen.getByTestId('nav-toolbox-toggle').getAttribute('aria-expanded')).toBe('true')
  })

  it('四域与工具箱点击均回调对应视图 id', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<CapabilityChannels activeView="workbench" onSelect={onSelect} taskCount={0} />)
    await user.click(screen.getByText('分镜'))
    expect(onSelect).toHaveBeenCalledWith('storyboard')
    await user.click(screen.getByTestId('nav-toolbox-toggle'))
    await user.click(screen.getByText('装配看板'))
    expect(onSelect).toHaveBeenCalledWith('context-receipt')
    await user.click(screen.getByText('会员中心'))
    expect(onSelect).toHaveBeenCalledWith('membership')
  })

  it('任务徽标：计数 0 不呈现，>0 呈现（工具箱内任务中心）', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <CapabilityChannels activeView="workbench" onSelect={() => {}} taskCount={0} />,
    )
    await user.click(screen.getByTestId('nav-toolbox-toggle'))
    expect(document.querySelector('.count')).toBeNull()
    rerender(<CapabilityChannels activeView="workbench" onSelect={() => {}} taskCount={3} />)
    expect(document.querySelector('.count')?.textContent).toBe('3')
  })
})
