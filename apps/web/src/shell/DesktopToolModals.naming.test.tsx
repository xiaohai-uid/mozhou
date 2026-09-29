/**
 * 灵感面板 AI 起名区测试（OpenWrite 对标切片 · 工单 22）：
 * - AI 起名区在 inspiration Sheet 内渲染，本地摇号预设区不受影响；
 * - 生成成功 → 渲染名称与释义；
 * - 服务端 501 NAMING_NOT_CONFIGURED → 显式提示（不伪造结果）。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopToolModals } from './DesktopToolModals'
import { okJson } from '../test/http'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DesktopToolModals · AI 起名（工单 22）', () => {
  it('inspiration Sheet 渲染本地预设区与 AI 起名区；生成成功显示名称释义', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({
      ok: true,
      mode: 'ai',
      names: [
        { name: '陆沉', meaning: '沉入深渊的剑客' },
        { name: '姜檀' },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<DesktopToolModals activeModal="inspiration" book={null} onClose={() => {}} />)

    expect(screen.getByTestId('naming-ai-section')).toBeInTheDocument()
    expect(screen.getByText('本地随机预设，零 API、零 AI 生成。')).toBeInTheDocument()

    await user.type(screen.getByTestId('naming-hint'), '东方玄幻')
    await user.click(screen.getByTestId('naming-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('naming-results')).toBeInTheDocument()
    })
    expect(screen.getByTestId('naming-results').textContent).toContain('陆沉')
    expect(screen.getByTestId('naming-results').textContent).toContain('沉入深渊的剑客')
    expect(screen.getByTestId('naming-results').textContent).toContain('姜檀')

    const request = fetchMock.mock.calls[0] as [string, { body: string }]
    expect(request[0]).toBe('/api/naming')
    expect(JSON.parse(request[1].body)).toEqual({ mode: 'ai', category: 'character', hint: '东方玄幻' })
  })

  it('未配置模型（501）→ 显式提示，不渲染任何伪造名称', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: false, code: 'NAMING_NOT_CONFIGURED', error: 'AI 起名需要可用模型：请到「模型设置」配置 API Key 后重试（本地随机摇号无需配置）。' }),
      { status: 501 },
    )))
    const user = userEvent.setup()

    render(<DesktopToolModals activeModal="inspiration" book={null} onClose={() => {}} />)
    await user.click(screen.getByTestId('naming-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('naming-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('naming-error').textContent).toContain('模型设置')
    expect(screen.queryByTestId('naming-results')).not.toBeInTheDocument()
  })
})
