import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  RecycleListDtoResponse,
  RecyclePurgeDtoResponse,
  RecycleRestoreDtoResponse,
} from '../../shared/api'
import { okJson } from '../test/http'
import { RecycleBinModal } from './RecycleBinModal'

afterEach(() => {
  vi.unstubAllGlobals()
})

const MOCK_TRASH_ENTRIES: RecycleListDtoResponse = {
  ok: true,
  entries: [
    {
      id: '20261019T100000-a1b2',
      originalPath: 'C:/books/cangqiong/正文/第一卷/第0003章.md',
      name: '第0003章.md',
      deletedAt: '2026-10-19T10:00:00.000Z',
      isDirectory: false,
    },
    {
      id: '20261019T090000-c3d4',
      originalPath: 'C:/books/cangqiong/大纲/废弃支线',
      name: '废弃支线',
      deletedAt: '2026-10-19T09:00:00.000Z',
      isDirectory: true,
    },
  ],
}

describe('RecycleBinModal (工作区回收站弹窗)', () => {
  it('isOpen=false 时不渲染 DOM，isOpen=true 时展示标题与无障碍属性', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ ok: true, entries: [] })))

    const { rerender } = render(
      <RecycleBinModal isOpen={false} onClose={() => {}} />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(<RecycleBinModal isOpen={true} onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('工作区回收站')).toBeInTheDocument()
    expect(screen.getByText(/隔离保护区 · 废弃章节与文件软删除存档/)).toBeInTheDocument()
  })

  it('空态时正确展示空提示与引导', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ ok: true, entries: [] })))

    render(<RecycleBinModal isOpen={true} onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByTestId('recycle-empty')).toBeInTheDocument()
    })
    expect(screen.getByText('回收站空空如也')).toBeInTheDocument()
    expect(screen.getByText(/被废弃的章节、大纲或素材会安全存放于此/)).toBeInTheDocument()
  })

  it('展示回收站条目列表及元信息（文件/目录图标、名称、原路径、时间）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_TRASH_ENTRIES)))

    render(<RecycleBinModal isOpen={true} onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByTestId('recycle-item-20261019T100000-a1b2')).toBeInTheDocument()
    })

    expect(screen.getByText('第0003章.md')).toBeInTheDocument()
    expect(screen.getByText('废弃支线')).toBeInTheDocument()
    expect(screen.getByText('文件/章节')).toBeInTheDocument()
    expect(screen.getByText('目录')).toBeInTheDocument()
    expect(screen.getByText(/C:\/books\/cangqiong\/正文\/第一卷\/第0003章\.md/)).toBeInTheDocument()
    expect(screen.getByText(/当前废弃项：/)).toHaveTextContent('2')
  })

  it('支持一键还原：调用 /api/recycle.restore 并触发 onRestored 回调与成功提示', async () => {
    const restoreResponse: RecycleRestoreDtoResponse = {
      ok: true,
      restoredTo: 'C:/books/cangqiong/正文/第一卷/第0003章.md',
    }

    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/recycle.list') {
        return okJson(MOCK_TRASH_ENTRIES)
      }
      if (path === '/api/recycle.restore') {
        return okJson(restoreResponse)
      }
      return okJson({ ok: false })
    })
    vi.stubGlobal('fetch', fetchMock)

    const onRestored = vi.fn()
    render(<RecycleBinModal isOpen={true} root="C:/books/cangqiong" onClose={() => {}} onRestored={onRestored} />)

    await waitFor(() => {
      expect(screen.getByTestId('recycle-restore-20261019T100000-a1b2')).toBeInTheDocument()
    })

    const restoreBtn = screen.getByTestId('recycle-restore-20261019T100000-a1b2')
    await userEvent.click(restoreBtn)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/recycle.restore', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ id: '20261019T100000-a1b2', root: 'C:/books/cangqiong' }),
      }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('recycle-success')).toHaveTextContent('已成功还原「第0003章.md」至原路径')
    })
    expect(onRestored).toHaveBeenCalledWith(
      MOCK_TRASH_ENTRIES.entries[0],
      'C:/books/cangqiong/正文/第一卷/第0003章.md',
    )
  })

  it('还原时原路径被占用显式展示 409 PATH_OCCUPIED 错误信息', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/recycle.list') {
        return okJson(MOCK_TRASH_ENTRIES)
      }
      if (path === '/api/recycle.restore') {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'PATH_OCCUPIED',
            error: '原路径已被占用，拒绝覆盖：C:/books/cangqiong/正文/第一卷/第0003章.md',
          }),
          { status: 409 },
        )
      }
      return okJson({ ok: false })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<RecycleBinModal isOpen={true} onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByTestId('recycle-restore-20261019T100000-a1b2')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByTestId('recycle-restore-20261019T100000-a1b2'))

    await waitFor(() => {
      expect(screen.getByTestId('recycle-error')).toHaveTextContent('原路径已被占用，拒绝覆盖')
    })
  })

  it('支持二次确认后彻底粉碎单个条目：调用 /api/recycle.purge', async () => {
    const purgeResponse: RecyclePurgeDtoResponse = {
      ok: true,
      purged: true,
    }

    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/recycle.list') {
        return okJson(MOCK_TRASH_ENTRIES)
      }
      if (path === '/api/recycle.purge') {
        return okJson(purgeResponse)
      }
      return okJson({ ok: false })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<RecycleBinModal isOpen={true} root="C:/books/cangqiong" onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByTestId('recycle-purge-20261019T100000-a1b2')).toBeInTheDocument()
    })

    // 点击彻底粉碎，出现确认按钮
    await userEvent.click(screen.getByTestId('recycle-purge-20261019T100000-a1b2'))
    expect(screen.getByText('不可恢复，确认？')).toBeInTheDocument()

    // 确认粉碎
    const confirmBtn = screen.getByTestId('recycle-confirm-purge-20261019T100000-a1b2')
    await userEvent.click(confirmBtn)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/recycle.purge', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ id: '20261019T100000-a1b2', root: 'C:/books/cangqiong' }),
      }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('recycle-success')).toHaveTextContent('已彻底粉碎「第0003章.md」')
    })
  })

  it('支持二次确认后一键排空回收站', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/recycle.list') {
        return okJson(MOCK_TRASH_ENTRIES)
      }
      if (path === '/api/recycle.purge') {
        return okJson({ ok: true, purged: true })
      }
      return okJson({ ok: false })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<RecycleBinModal isOpen={true} onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByTestId('recycle-purge-all-btn')).toBeInTheDocument()
    })

    // 点击清空回收站按钮
    await userEvent.click(screen.getByTestId('recycle-purge-all-btn'))
    expect(screen.getByText('确定清空全部吗？')).toBeInTheDocument()

    // 确认粉碎全部
    await userEvent.click(screen.getByTestId('recycle-confirm-purge-all'))

    await waitFor(() => {
      expect(screen.getByTestId('recycle-success')).toHaveTextContent('已彻底排空回收站内全部废弃项目')
    })
  })

  it('点击关闭按钮或 Escape 键触发 onClose', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ ok: true, entries: [] })))
    const onClose = vi.fn()
    render(<RecycleBinModal isOpen={true} onClose={onClose} />)

    const closeBtn = screen.getByRole('button', { name: '关闭回收站' })
    await userEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
