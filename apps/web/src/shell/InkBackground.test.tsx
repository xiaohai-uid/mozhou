/**
 * 背景墨流组件测试（实现票 T40）：jsdom 无 WebGL → 显式回落路径；
 * reduced-motion 纪律在真实浏览器按媒体查询生效（此处测无 WebGL 分支）。
 */
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InkBackground } from './InkBackground'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('InkBackground', () => {
  it('无 WebGL 环境回落静态渐变（ink-canvas-fallback），不崩溃', () => {
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(null)
    const { container } = render(<InkBackground focus={0.43} />)
    const canvas = container.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(canvas?.className).toContain('ink-canvas')
    expect(canvas?.className).toContain('ink-canvas-fallback')
    expect(spy).toHaveBeenCalledWith('webgl', expect.any(Object))
  })

  it('aria-hidden 装饰性画布', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const { container } = render(<InkBackground focus={0} />)
    expect(container.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true')
  })
})
