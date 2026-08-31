/**
 * 书源搜索与导入（BookSourceView）组件测试（实现票 T49）：
 * - 契约快照：输入形状 = server/api 导出类型（LibraryOpenResponse），
 *   包类型漂移即 typecheck + 快照双报警；
 * - 检索区域与推荐样例卡片渲染；
 * - 手动输入书名导入与预设样例一键导入；
 * - 导入成功后触发切书并呈现成功横幅；
 * - 未建书库根时的显式空态与引导。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { okJson } from '../test/http'
import { BookSourceView } from './BookSourceView'

afterEach(() => {
  vi.unstubAllGlobals()
})

const PARENT_DIR = 'C:/tmp/lib'

describe('BookSourceView（书源搜索与导入）', () => {
  it('搜索与推荐样例渲染；契约快照', () => {
    const { container } = render(
      <BookSourceView
        parentDir={PARENT_DIR}
        onSwitchBook={() => {}}
        onGoToWorkbench={() => {}}
      />,
    )
    expect(screen.getByTestId('book-source-search')).toBeInTheDocument()
    expect(screen.getByTestId('book-source-samples')).toBeInTheDocument()
    expect(screen.getByTestId('book-source-samples').textContent).toContain('仙道求索录')
    expect(screen.getByTestId('book-source-samples').textContent).toContain('诡秘夜行录')

    const view = container.querySelector('[aria-label="book-source-view"]')
    if (view === null) throw new Error('missing book-source-view')
    expect(view).toMatchSnapshot()
  })

  it('手动输入书名导入并触发切书与成功横幅', async () => {
    const onSwitchBook = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okJson({
          ok: true,
          root: 'C:/tmp/lib/凡人问仙',
          bookId: 'bk_fanren',
          title: '凡人问仙',
        }),
      ),
    )

    render(
      <BookSourceView
        parentDir={PARENT_DIR}
        onSwitchBook={onSwitchBook}
        onGoToWorkbench={() => {}}
      />,
    )

    const input = screen.getByLabelText('书源检索输入')
    await userEvent.type(input, '凡人问仙')
    const importBtn = screen.getByRole('button', { name: '导入本地书库' })
    await userEvent.click(importBtn)

    await waitFor(() => {
      expect(onSwitchBook).toHaveBeenCalledWith({
        root: 'C:/tmp/lib/凡人问仙',
        bookId: 'bk_fanren',
        title: '凡人问仙',
      })
    })

    expect(screen.getByTestId('book-source-success')).toBeInTheDocument()
    expect(screen.getByTestId('book-source-success').textContent).toContain('《凡人问仙》')
    expect(input).toHaveValue('')
  })

  it('预设样例一键导入', async () => {
    const onSwitchBook = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okJson({
          ok: true,
          root: 'C:/tmp/lib/仙道求索录',
          bookId: 'bk_xiandao',
          title: '仙道求索录',
        }),
      ),
    )

    render(
      <BookSourceView
        parentDir={PARENT_DIR}
        onSwitchBook={onSwitchBook}
        onGoToWorkbench={() => {}}
      />,
    )

    const sampleBtns = screen.getAllByRole('button', { name: '一键导入' })
    expect(sampleBtns.length).toBeGreaterThanOrEqual(1)
    const firstBtn = sampleBtns[0]
    if (firstBtn === undefined) throw new Error('missing sample button')
    await userEvent.click(firstBtn)

    await waitFor(() => {
      expect(onSwitchBook).toHaveBeenCalledWith({
        root: 'C:/tmp/lib/仙道求索录',
        bookId: 'bk_xiandao',
        title: '仙道求索录',
      })
    })
  })

  it('未设置书库根时呈现显式引导', () => {
    render(
      <BookSourceView
        parentDir={null}
        onSwitchBook={() => {}}
        onGoToWorkbench={() => {}}
      />,
    )
    expect(screen.getByTestId('book-source-empty')).toBeInTheDocument()
    expect(screen.getByTestId('book-source-empty').textContent).toContain('书源服务暂不可用')
  })

  it('导入失败显式报错（role=alert），不静默', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: '书籍已存在，导入冲突' }), { status: 409 }),
      ),
    )

    render(
      <BookSourceView
        parentDir={PARENT_DIR}
        onSwitchBook={() => {}}
        onGoToWorkbench={() => {}}
      />,
    )

    const input = screen.getByLabelText('书源检索输入')
    await userEvent.type(input, '冲突之书')
    const importBtn = screen.getByRole('button', { name: '导入本地书库' })
    await userEvent.click(importBtn)

    await waitFor(() => {
      expect(screen.getByTestId('book-source-error')).toBeInTheDocument()
      expect(screen.getByTestId('book-source-error').textContent).toContain('书籍已存在，导入冲突')
    })
  })
})
