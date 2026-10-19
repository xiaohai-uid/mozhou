/**
 * apps/web/src/workbench/AgentToolboxPanel.test.tsx
 *
 * 智能体工具箱前端面板组件单元测试：
 * 验证：
 *   1. 工具列表加载与展示（POST /api/tools.list 默认下发 7 类工具，web_search 默认关闭）；
 *   2. 启用 web_search 开关触发重新拉取并携带 enabledTools: { web_search: true }；
 *   3. 工具卡片点击切换与参数 JSON Schema 规范展示（属性、类型、是否必填、说明）；
 *   4. 参数示例一键填充；
 *   5. 点击执行向 /api/tools.execute 发起调用并正确展示执行结果（ok: true, content, meta）；
 *   6. 参数 JSON 解析失败拦截与错误提示；
 *   7. 服务端执行报错展示（ok: false / 异常提示）及输出清除。
 *
 * 规范遵循：严禁静态引入 shared/**，测试 100% 通过。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentToolboxPanel, type ToolDefinitionDto } from './AgentToolboxPanel'
import { okJson } from '../test/http'

const MOCK_TOOLS_DEFAULT: ToolDefinitionDto[] = [
  {
    name: 'file_read',
    description: '读取书稿目录内的文件，或列出一个目录。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件或目录路径' },
        listOnly: { type: 'boolean', description: '只列目录' },
        offset: { type: 'number', description: '起始行' },
        limit: { type: 'number', description: '行数上限' },
      },
      required: ['path'],
    },
  },
  {
    name: 'file_write',
    description: '在书稿目录内创建或覆盖一个文本文件。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目标路径' },
        content: { type: 'string', description: '写入文本' },
        mode: { type: 'string', description: '模式 overwrite/append' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'file_manage',
    description: '管理文件：move_to_trash / rename / copy / mkdir。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '操作动作' },
        path: { type: 'string', description: '源路径' },
      },
      required: ['action', 'path'],
    },
  },
  {
    name: 'skill_lookup',
    description: '按 id 取回某个技能的全文。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '技能 id' },
      },
      required: ['id'],
    },
  },
  {
    name: 'skill_create',
    description: '新建一个技能。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '技能 id' },
        name: { type: 'string', description: '技能名称' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'skill_update',
    description: '更新一个既有技能。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '技能 id' },
      },
      required: ['id'],
    },
  },
  {
    name: 'question',
    description: '向作者提问并等待回答。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '问题正文' },
      },
      required: ['question'],
    },
  },
]

const MOCK_WEB_SEARCH_TOOL: ToolDefinitionDto = {
  name: 'web_search',
  description: '联网搜索（需要作者开启）。',
  parameters: {
    type: 'object',
    properties: {
      keywords: { type: 'string', description: '检索词' },
      limit: { type: 'number', description: '返回条数' },
    },
    required: ['keywords'],
  },
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentToolboxPanel 智能体工具箱前端面板', () => {
  it('1. 首次挂载调用 /api/tools.list 并正确渲染已就绪的默认 7 类核心工具', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/tools.list') {
        return Promise.resolve(okJson({ ok: true, tools: MOCK_TOOLS_DEFAULT }))
      }
      return Promise.reject(new Error('unhandled ' + url))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AgentToolboxPanel book={{ root: '/test/book', bookId: 'b1', title: '测试作品' }} />)

    expect(await screen.findByTestId('agent-toolbox-panel')).toBeInTheDocument()
    expect(await screen.findByTestId('tool-card-file_read')).toBeInTheDocument()
    expect(screen.getByTestId('tool-card-file_write')).toBeInTheDocument()
    expect(screen.getByTestId('tool-card-file_manage')).toBeInTheDocument()
    expect(screen.getByTestId('tool-card-skill_lookup')).toBeInTheDocument()
    expect(screen.getByTestId('tool-card-skill_create')).toBeInTheDocument()
    expect(screen.getByTestId('tool-card-skill_update')).toBeInTheDocument()
    expect(screen.getByTestId('tool-card-question')).toBeInTheDocument()
    // web_search 默认不展示
    expect(screen.queryByTestId('tool-card-web_search')).not.toBeInTheDocument()
    expect(screen.getByText('7 / 7 项工具已就绪')).toBeInTheDocument()
  })

  it('2. 开启 web_search 开关向 /api/tools.list 下发 enabledTools 并包含 web_search 工具', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/tools.list') {
        const rawBody = typeof init?.body === 'string' ? init.body : '{}'
        const body = JSON.parse(rawBody) as Record<string, unknown>
        const enabled = body['enabledTools'] as Record<string, unknown> | undefined
        if (enabled?.['web_search']) {
          return Promise.resolve(
            okJson({ ok: true, tools: [...MOCK_TOOLS_DEFAULT, MOCK_WEB_SEARCH_TOOL] }),
          )
        }
        return Promise.resolve(okJson({ ok: true, tools: MOCK_TOOLS_DEFAULT }))
      }
      return Promise.reject(new Error('unhandled ' + url))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AgentToolboxPanel book={null} />)

    await screen.findByTestId('tool-card-file_read')
    const toggle = screen.getByTestId('web-search-toggle')
    expect(toggle).not.toBeChecked()

    // 勾选联网搜索
    await user.click(toggle)

    await waitFor(() => {
      expect(screen.getByTestId('tool-card-web_search')).toBeInTheDocument()
    })
    expect(screen.getByText('8 / 8 项工具已就绪')).toBeInTheDocument()
  })

  it('3. 切换工具卡片，右侧参数规格联动更新并展示 JSON Schema 属性', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === '/api/tools.list') {
          return Promise.resolve(okJson({ ok: true, tools: MOCK_TOOLS_DEFAULT }))
        }
        return Promise.reject(new Error('unhandled ' + url))
      }),
    )

    render(<AgentToolboxPanel book={null} />)

    await screen.findByTestId('tool-card-file_read')
    expect(screen.getByTestId('tool-parameters-spec')).toHaveTextContent('path')
    expect(screen.getByTestId('tool-parameters-spec')).toHaveTextContent('listOnly')

    // 切换到 question
    await user.click(screen.getByTestId('tool-card-question'))

    await waitFor(() => {
      expect(screen.getByTestId('tool-parameters-spec')).toHaveTextContent('question')
    })
    expect(screen.getByTestId('tool-parameters-spec')).not.toHaveTextContent('listOnly')
  })

  it('4. 点击「测试执行」成功调用 /api/tools.execute 并渲染返回结果与元数据', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/tools.list') {
        return Promise.resolve(okJson({ ok: true, tools: MOCK_TOOLS_DEFAULT }))
      }
      if (url === '/api/tools.execute') {
        const rawBody = typeof init?.body === 'string' ? init.body : '{}'
        const body = JSON.parse(rawBody) as Record<string, unknown>
        expect(body['name']).toBe('file_read')
        expect(body['root']).toBe('/test/book')
        return Promise.resolve(
          okJson({
            ok: true,
            content: '共 12 行，返回第 1–12 行\n# 第一章\n云海微茫，天光乍破。',
            meta: { totalLines: 12 },
          }),
        )
      }
      return Promise.reject(new Error('unhandled ' + url))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AgentToolboxPanel book={{ root: '/test/book', bookId: 'b1', title: '测试作品' }} />)

    await screen.findByTestId('tool-card-file_read')
    const executeBtn = screen.getByTestId('tool-execute-btn')
    expect(executeBtn).toHaveTextContent('测试执行 file_read')

    await user.click(executeBtn)

    await waitFor(() => {
      expect(screen.getByTestId('tool-result-card')).toBeInTheDocument()
    })
    expect(screen.getByTestId('tool-result-status')).toHaveTextContent('✓ DISPATCH SUCCESS')
    expect(screen.getByTestId('tool-result-content')).toHaveTextContent('云海微茫，天光乍破。')
    expect(screen.getByText(/META:.*totalLines.*12/)).toBeInTheDocument()

    // 清除输出测试
    await user.click(screen.getByTestId('clear-result-btn'))
    expect(screen.queryByTestId('tool-result-card')).not.toBeInTheDocument()
  })

  it('5. 参数输入非法 JSON 时拦截请求并提示错误', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/tools.list') {
        return Promise.resolve(okJson({ ok: true, tools: MOCK_TOOLS_DEFAULT }))
      }
      return Promise.reject(new Error('unhandled ' + url))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AgentToolboxPanel book={null} />)

    await screen.findByTestId('tool-card-file_read')
    const textarea = screen.getByTestId('tool-args-input')

    // 清空并输入非法 JSON
    fireEvent.change(textarea, { target: { value: '{ invalid_json' } })

    await user.click(screen.getByTestId('tool-execute-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('tool-exec-error')).toHaveTextContent('参数 JSON 解析失败')
    })
    // 确保未发起 /api/tools.execute 调用
    expect(fetchMock).not.toHaveBeenCalledWith('/api/tools.execute', expect.anything())
  })

  it('6. 执行失败时（如路径未授权或外部异常），如实展示错误与失败状态', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === '/api/tools.list') {
          return Promise.resolve(okJson({ ok: true, tools: MOCK_TOOLS_DEFAULT }))
        }
        if (url === '/api/tools.execute') {
          return Promise.resolve(
            okJson({
              ok: false,
              content: '未确认的外部路径访问（需要作者确认授权）：C:\\secret.txt',
            }),
          )
        }
        return Promise.reject(new Error('unhandled ' + url))
      }),
    )

    render(<AgentToolboxPanel book={null} />)

    await screen.findByTestId('tool-card-file_read')
    await user.click(screen.getByTestId('tool-execute-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('tool-result-card')).toBeInTheDocument()
    })
    expect(screen.getByTestId('tool-result-status')).toHaveTextContent('✗ EXECUTION FAILED')
    expect(screen.getByTestId('tool-result-content')).toHaveTextContent('未确认的外部路径访问')
  })

  it('7. 搜索过滤工具，点击「填充示例参数」恢复预置模板', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === '/api/tools.list') {
          return Promise.resolve(okJson({ ok: true, tools: MOCK_TOOLS_DEFAULT }))
        }
        return Promise.reject(new Error('unhandled ' + url))
      }),
    )

    render(<AgentToolboxPanel book={null} />)

    await screen.findByTestId('tool-card-file_read')

    // 搜索过滤
    const searchInput = screen.getByTestId('tools-search-input')
    await user.type(searchInput, 'skill')

    expect(screen.getByTestId('tool-card-skill_lookup')).toBeInTheDocument()
    expect(screen.getByTestId('tool-card-skill_create')).toBeInTheDocument()
    expect(screen.queryByTestId('tool-card-file_read')).not.toBeInTheDocument()

    // 选中 skill_lookup
    await user.click(screen.getByTestId('tool-card-skill_lookup'))
    const textarea = screen.getByTestId('tool-args-input')
    expect(textarea).toHaveValue(JSON.stringify({ id: 'creative-writing' }, null, 2))

    // 修改内容后点击示例参数按钮
    fireEvent.change(textarea, { target: { value: '{"id": "custom"}' } })
    await user.click(screen.getByTestId('fill-sample-args-btn'))

    expect(textarea).toHaveValue(JSON.stringify({ id: 'creative-writing' }, null, 2))
  })
})
