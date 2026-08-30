/**
 * 八步管线条组件测试（实现票 T40）：渲染结构 + 点击反馈，
 * 只测外部行为。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PIPELINE_STAGES, PipelineStrip } from './PipelineStrip'

function step(id: string): HTMLElement {
  const found = document.querySelector(`[data-stage="${id}"]`)
  if (found === null) throw new Error('missing step: ' + id)
  return found as HTMLElement
}

describe('PipelineStrip', () => {
  it('渲染八步（prepare→commit），含 en 词与中文标签', () => {
    render(<PipelineStrip activeStage={3} onSelect={() => {}} />)
    const strip = screen.getByLabelText('章节生产管线')
    expect(strip.querySelectorAll('.step')).toHaveLength(PIPELINE_STAGES.length)
    expect(PIPELINE_STAGES.map((stage) => stage.id)).toEqual([
      'prepare', 'compile', 'draft', 'review', 'extract', 'continuity', 'proposal', 'commit',
    ])
    expect(screen.getByText('准备')).toBeInTheDocument()
    expect(screen.getByText('提交')).toBeInTheDocument()
  })

  it('当前阶段高亮 active，之前阶段标 done', () => {
    render(<PipelineStrip activeStage={3} onSelect={() => {}} />)
    expect(step('review').className).toContain('active')
    expect(step('prepare').className).toContain('done')
    expect(step('commit').className).not.toContain('done')
    expect(step('review')).toHaveAttribute('aria-current', 'step')
  })

  it('点击阶段回调其索引（牵引背景墨迹聚焦由 App 换算）', async () => {
    const onSelect = vi.fn()
    render(<PipelineStrip activeStage={3} onSelect={onSelect} />)
    await userEvent.click(step('commit'))
    expect(onSelect).toHaveBeenCalledWith(7)
  })
})
