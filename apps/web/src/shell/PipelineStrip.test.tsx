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

  it('选中阶段高亮 active；无证据时不得伪造 done（ADR-0028 六态真实绑定）', () => {
    render(<PipelineStrip activeStage={3} onSelect={() => {}} />)
    expect(step('review').className).toContain('active')
    // 无证据（未传 stageStates）的阶段一律不标记——「选中之前自动 done」已废除
    expect(step('prepare').className).not.toContain('done')
    expect(step('commit').className).not.toContain('done')
    expect(step('review')).toHaveAttribute('aria-current', 'step')
  })

  it('stageStates 覆盖真实证据态；选中与 unavailable 正交', () => {
    render(
      <PipelineStrip
        activeStage={3}
        onSelect={() => {}}
        stageStates={{ prepare: 'done', compile: 'done', review: 'blocked', commit: 'unavailable' }}
      />,
    )
    expect(step('prepare').className).toContain('done')
    expect(step('compile').className).toContain('done')
    expect(step('review').className).toContain('blocked')
    // 选中的 blocked 阶段同时表达焦点
    expect(step('review').className).toContain('active')
    expect(step('commit').className).toContain('unavailable')
    expect(step('draft').className).not.toContain('done')
  })

  it('点击阶段回调其索引（牵引背景墨迹聚焦由 App 换算）', async () => {
    const onSelect = vi.fn()
    render(<PipelineStrip activeStage={3} onSelect={onSelect} />)
    await userEvent.click(step('commit'))
    expect(onSelect).toHaveBeenCalledWith(7)
  })
})
