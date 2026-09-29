/**
 * 备忘录（MemoView）组件测试（OpenWrite 对标切片 · 工单 22）：
 * - 契约快照：输入形状 = server/api 导出类型（MemoListResponse / MemoMutationResponse），
 *   包类型漂移即 typecheck + 快照双报警；
 * - 便签列表渲染、空态；
 * - 新建（校验空内容）/ 编辑 / 删除交互与 action 载荷。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MemoListResponse } from '../../server/api'
import { okJson } from '../test/http'
import { MemoView } from './MemoView'

afterEach(() => {
  vi.unstubAllGlobals()
})

const MOCK_LIST: MemoListResponse = {
  ok: true,
  notes: [
    {
      id: 'n1',
      title: '第三章钩子',
      content: '雨夜追逐后留下断簪。',
      createdAt: '2026-09-30T08:00:00.000Z',
      updatedAt: '2026-09-30T08:30:00.000Z',
    },
  ],
}

describe('MemoView（备忘录）', () => {
  it('便签列表渲染与契约快照', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_LIST)))
    const { container } = render(<MemoView />)

    await waitFor(() => {
      expect(screen.getByTestId('memo-list')).toBeInTheDocument()
    })

    expect(screen.getByTestId('memo-item').textContent).toContain('第三章钩子')
    expect(screen.getByTestId('memo-item').textContent).toContain('雨夜追逐后留下断簪')

    const view = container.querySelector('[aria-label="memo-view"]')
    if (view === null) throw new Error('missing memo-view')
    expect(view).toMatchSnapshot()
  })

  it('空态提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ ok: true, notes: [] })))
    render(<MemoView />)
    await waitFor(() => {
      expect(screen.getByTestId('memo-empty')).toBeInTheDocument()
    })
  })

  it('新建便签：空内容前端拦截；成功后刷新列表并携带 action 载荷', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ ok: true, notes: [] }))
      .mockResolvedValueOnce(okJson({ ok: true, note: { id: 'n2', title: '标题', content: '内容', createdAt: '', updatedAt: '' } }))
      .mockResolvedValueOnce(okJson(MOCK_LIST))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<MemoView />)

    await waitFor(() => {
      expect(screen.getByTestId('memo-create')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('memo-save-new'))
    expect(await screen.findByTestId('memo-error')).toHaveTextContent('便签内容不能为空')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await user.type(screen.getByTestId('memo-input-title'), '标题')
    await user.type(screen.getByTestId('memo-input-content'), '内容')
    await user.click(screen.getByTestId('memo-save-new'))

    await waitFor(() => {
      expect(screen.getByTestId('memo-item')).toBeInTheDocument()
    })
    const createCall = fetchMock.mock.calls[1] as [string, { body: string }]
    expect(createCall[0]).toBe('/api/memo')
    expect(JSON.parse(createCall[1].body)).toEqual({ action: 'create', title: '标题', content: '内容' })
  })

  it('编辑后保存携带 update 载荷；删除携带 delete 载荷', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson(MOCK_LIST))
      .mockResolvedValueOnce(okJson({ ok: true, note: { id: 'n1', title: '改', content: '改后内容', createdAt: '', updatedAt: '' } }))
      .mockResolvedValueOnce(okJson(MOCK_LIST))
      .mockResolvedValueOnce(okJson({ ok: true, deleted: true }))
      .mockResolvedValueOnce(okJson({ ok: true, notes: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<MemoView />)

    await waitFor(() => {
      expect(screen.getByTestId('memo-item')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('memo-edit'))
    const editBox = screen.getByTestId('memo-edit-content')
    await user.clear(editBox)
    await user.type(editBox, '改后内容')
    await user.click(screen.getByTestId('memo-save-edit'))

    await waitFor(() => {
      expect(screen.queryByTestId('memo-edit-content')).not.toBeInTheDocument()
    })
    const updateCall = fetchMock.mock.calls[1] as [string, { body: string }]
    expect(JSON.parse(updateCall[1].body)).toEqual({ action: 'update', id: 'n1', title: '第三章钩子', content: '改后内容' })

    await user.click(screen.getByTestId('memo-delete'))
    await waitFor(() => {
      expect(screen.getByTestId('memo-empty')).toBeInTheDocument()
    })
    const deleteCall = fetchMock.mock.calls[3] as [string, { body: string }]
    expect(JSON.parse(deleteCall[1].body)).toEqual({ action: 'delete', id: 'n1' })
  })
})
