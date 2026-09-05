/**
 * 功能航道组件测试（实现票 T40）：17 项 / 五组全可见可点击 + 任务徽标纪律。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CapabilityChannels } from './CapabilityChannels'
import { NAV_GROUPS, VIEW_COUNT, VIEW_IDS } from './views'

describe('CapabilityChannels', () => {
  it('17 项一级功能分五组全部可见', () => {
    render(<CapabilityChannels activeView="workbench" onSelect={() => {}} taskCount={0} />)
    expect(screen.getByText('CAPABILITY INDEX')).toBeInTheDocument()
    for (const group of NAV_GROUPS) {
      expect(screen.getByText(group.group)).toBeInTheDocument()
    }
    expect(document.querySelectorAll('.nav-item')).toHaveLength(VIEW_COUNT)
    expect(VIEW_COUNT).toBe(17)
    expect(new Set(VIEW_IDS).size).toBe(VIEW_COUNT)
  })

  it('未开放的云同步在一级入口直接标记为规划中', () => {
    render(<CapabilityChannels activeView="workbench" onSelect={() => {}} taskCount={0} />)
    expect(screen.getByText('云同步 · 规划中')).toBeInTheDocument()
  })

  it('点击功能项回调对应视图 id', async () => {
    const onSelect = vi.fn()
    render(<CapabilityChannels activeView="workbench" onSelect={onSelect} taskCount={0} />)
    await userEvent.click(screen.getByText('装配看板'))
    expect(onSelect).toHaveBeenCalledWith('context-receipt')
    await userEvent.click(screen.getByText('会员中心'))
    expect(onSelect).toHaveBeenCalledWith('membership')
  })

  it('当前视图高亮 active', () => {
    render(<CapabilityChannels activeView="quality-gate" onSelect={() => {}} taskCount={0} />)
    const active = document.querySelector('.nav-item.active')
    expect(active?.getAttribute('data-view')).toBe('quality-gate')
  })

  it('任务徽标：计数 0 不呈现（任务数据源未接入，不假装有后台任务），>0 呈现', () => {
    const { rerender } = render(
      <CapabilityChannels activeView="workbench" onSelect={() => {}} taskCount={0} />,
    )
    expect(document.querySelector('.count')).toBeNull()
    rerender(<CapabilityChannels activeView="workbench" onSelect={() => {}} taskCount={3} />)
    expect(document.querySelector('.count')?.textContent).toBe('3')
  })
})
