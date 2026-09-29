// @vitest-environment jsdom
/**
 * 模型设置页（商业化阻断 2 的 UI 半边）。
 *
 * 断言目标：作者能在产品内自行接入大模型，且任何时刻都看得到
 * 「配置处于什么状态、密钥存在吗、存的是什么端点」——不必去改环境变量。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelSettingsView } from './ModelSettingsView'

function okJson(value: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(value) } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('模型设置页', () => {
  it('未配置时如实说「未配置」，并告诉作者密钥存在哪、怎么填', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okJson({
      ok: true,
      settings: { configured: false, providerId: 'deepseek', baseUrl: '', maskedKey: '', model: 'deepseek-chat', configVersion: 0, updatedAt: null },
    })))
    vi.stubGlobal('fetch', fetchMock)

    render(<ModelSettingsView />)

    await waitFor(() => expect(screen.getByTestId('provider-status')).toHaveTextContent('未配置'))
    // 密钥输入框真实存在——这是整个阻断的解药
    expect(screen.getByLabelText(/API 密钥/)).toBeInTheDocument()
    // 隐私话说清楚，不含糊
    expect(screen.getByTestId('provider-privacy-note')).toHaveTextContent('加密')
  })

  it('已配置时只显示掩码，明文密钥绝不回显', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okJson({
      ok: true,
      settings: { configured: true, providerId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', maskedKey: 'sk-****abcd', model: 'deepseek-chat', configVersion: 3, updatedAt: '2026-09-27T00:00:00.000Z' },
    })))
    vi.stubGlobal('fetch', fetchMock)

    render(<ModelSettingsView />)

    await waitFor(() => expect(screen.getByTestId('provider-status')).toHaveTextContent('已配置'))
    expect(screen.getByTestId('provider-masked-key')).toHaveTextContent('sk-****abcd')
    // 页面任何地方都不得出现明文
    expect(document.body.textContent).not.toContain('sk-secret-plaintext')
  })

  it('保存密钥走 POST /api/llm/settings，保存成功后状态变「已配置」', async () => {
    let saved: Record<string, unknown> | null = null
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        saved = JSON.parse(init.body as string) as Record<string, unknown>
        return Promise.resolve(okJson({ ok: true, settings: { configured: true, providerId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', maskedKey: 'sk-****wxyz', model: 'deepseek-chat', configVersion: 1, updatedAt: '2026-09-27T00:00:00.000Z' } }))
      }
      return Promise.resolve(okJson({
        ok: true,
        settings: { configured: false, providerId: 'deepseek', baseUrl: '', maskedKey: '', model: 'deepseek-chat', configVersion: 0, updatedAt: null },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ModelSettingsView />)
    await waitFor(() => expect(screen.getByTestId('provider-status')).toHaveTextContent('未配置'))

    await userEvent.type(screen.getByLabelText(/API 密钥/), 'sk-user-pasted-key')
    await userEvent.click(screen.getByRole('button', { name: /保存配置/ }))

    await waitFor(() => expect(screen.getByTestId('provider-save-notice')).toHaveTextContent('已保存'))
    expect(saved).toMatchObject({ apiKey: 'sk-user-pasted-key' })
    expect(fetchMock).toHaveBeenCalledWith('/api/llm/settings', expect.objectContaining({ method: 'POST' }))
  })

  it('测试连接走 POST /api/llm/test，并把探针结果如实呈现', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/llm/test') {
        return Promise.resolve(okJson({ ok: true, model: 'deepseek-chat', latencyMs: 412, maskedKey: 'sk-****abcd' }))
      }
      return Promise.resolve(okJson({
        ok: true,
        settings: { configured: true, providerId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', maskedKey: 'sk-****abcd', model: 'deepseek-chat', configVersion: 1, updatedAt: '2026-09-27T00:00:00.000Z' },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ModelSettingsView />)
    await waitFor(() => expect(screen.getByTestId('provider-status')).toHaveTextContent('已配置'))

    await userEvent.click(screen.getByRole('button', { name: /测试连接/ }))

    await waitFor(() => {
      const result = screen.getByTestId('provider-test-result')
      expect(result).toHaveTextContent('deepseek-chat')
      expect(result).toHaveTextContent('412')
    })
  })

  it('保存失败时错误照实呈现，不假装成功', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ ok: false, code: 'SSRF_BLOCKED', error: '端点未通过安全校验' }) } as unknown as Response)
      }
      return Promise.resolve(okJson({
        ok: true,
        settings: { configured: false, providerId: 'deepseek', baseUrl: '', maskedKey: '', model: 'deepseek-chat', configVersion: 0, updatedAt: null },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ModelSettingsView />)
    await waitFor(() => expect(screen.getByTestId('provider-status')).toHaveTextContent('未配置'))

    await userEvent.type(screen.getByLabelText(/API 密钥/), 'sk-bad')
    await userEvent.click(screen.getByRole('button', { name: /保存配置/ }))

    await waitFor(() => expect(screen.getByTestId('provider-error')).toHaveTextContent('端点未通过安全校验'))
    expect(screen.queryByTestId('provider-save-notice')).not.toBeInTheDocument()
  })

  it('本机模型接入说明常驻可见：讲清 base + 放行开关两个变量（不只说「填密钥」）', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okJson({
      ok: true,
      settings: { configured: false, providerId: 'deepseek', baseUrl: '', maskedKey: '', model: 'deepseek-chat', configVersion: 0, updatedAt: null },
    })))
    vi.stubGlobal('fetch', fetchMock)

    render(<ModelSettingsView />)
    // 本机说明是静态文案，不依赖 settings 读回；等一次读回让 React 树进入稳态
    // （否则 useProviderSettings 的异步 setState 落在断言之外，触发 act 警告）。
    await waitFor(() => expect(screen.getByTestId('provider-status')).toHaveTextContent('未配置'))

    // 缺陷本体：写作区把本机部署也指引到「填密钥」，而本机部署根本不该填这张表。
    // 作者被指引到本页时，必须在这里读到本机路径（含「只设 base 会被拦下」）。
    const note = screen.getByTestId('provider-local-model-note')
    expect(note).toHaveTextContent('MOZHOU_API_BASE')
    expect(note).toHaveTextContent('MOZHOU_ALLOW_PRIVATE_LLM=1')
    // 放行开关是「还需额外一个」的条件，不能被写成 base 的一部分
    expect(note).toHaveTextContent('只设 base 会被拦下')
  })
})
