/**
 * 检视塔组件测试（实现票 T40）：四 tab 骨架 + 切换 + 显式占位纪律。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InspectorEmpty, InspectorPlaceholder, InspectorTower } from './InspectorTower'
import type { InspectorTabId } from './InspectorTower'

const PANELS: Record<InspectorTabId, string> = {
  quality: '质量门面板内容',
  'story-brain': 'Story Brain 面板内容',
  'context-receipt': '装配看板面板内容',
  'change-matrix': '变更矩阵面板内容',
  lorebook: '世界书面板内容',
}

function renderTower(activeTab: InspectorTabId, onTabChange: (tab: InspectorTabId) => void) {
  return render(
    <InspectorTower
      activeTab={activeTab}
      onTabChange={onTabChange}
      panels={Object.fromEntries(
        Object.entries(PANELS).map(([id, text]) => [id, <p key={id}>{text}</p>]),
      ) as Record<InspectorTabId, React.ReactNode>}
    />,
  )
}

describe('InspectorTower', () => {
  it('五 tab 骨架齐备，激活 tab 与对应面板可见（CSS 由 .panel.active 控制）', () => {
    renderTower('quality', () => {})
    expect(screen.getByRole('tab', { name: '质量门' }).className).toContain('active')
    expect(screen.getByRole('tab', { name: 'Story Brain' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '装配看板' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '变更矩阵' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '世界书' })).toBeInTheDocument()
    const panels = document.querySelectorAll('.panel')
    expect(panels).toHaveLength(5)
    expect(document.querySelector('[data-panel="quality"]')?.className).toContain('active')
    expect(document.querySelector('[data-panel="quality"]')?.textContent).toContain('质量门面板内容')
  })

  it('点击 tab 切换回调', async () => {
    const onTabChange = vi.fn()
    renderTower('quality', onTabChange)
    await userEvent.click(screen.getByRole('tab', { name: '装配看板' }))
    expect(onTabChange).toHaveBeenCalledWith('context-receipt')
  })

  it('显式占位卡携带落地票号与「未实现」声明，不假装可用', () => {
    render(<InspectorPlaceholder title="装配看板" ticket="T42" note="随实现票 T42 落地。" />)
    expect(screen.getByTestId('inspector-placeholder').textContent).toContain('T42')
    expect(screen.getByTestId('inspector-placeholder').textContent).toContain('未实现 · 显式占位')
  })

  it('建书前空态显式说明', () => {
    render(<InspectorEmpty note="建书后可用。" />)
    expect(screen.getByTestId('inspector-empty').textContent).toContain('建书后可用')
  })
})
