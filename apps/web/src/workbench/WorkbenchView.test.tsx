/**
 * 工作台中栏组件测试（实现票 T44）：对话流、建书 / 账本存量功能。
 * 实体网格切片已随 T41 迁入检视塔；对话流契约测试在 DialogueStream.test.tsx。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchView } from './WorkbenchView'
import type { BookInfo } from '../shell/workbenchStorage'
import { okJson } from '../test/http'

afterEach(() => {
  vi.unstubAllGlobals()
})

const BOOK: BookInfo = { root: 'C:\\tmp\\book-a', bookId: 'bk_1', title: '测试之书' }

describe('WorkbenchView', () => {
  it('空书对话流显示建书提示；composer 不在未建书状态伪装可用', () => {
    render(<WorkbenchView book={null} onBookCreated={() => {}} />)
    expect(screen.getByTestId('dialogue-no-book').textContent).toContain('先建书')
    expect(screen.getByTestId('create-book')).toBeInTheDocument()
  })

  it('建书成功回调 BookInfo（含书名，供 localStorage 记忆）', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/book') return okJson({ ok: true, root: 'C:\\tmp\\book-a', bookId: 'bk_1' })
      return okJson({ ok: false, error: 'unexpected path: ' + path })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onBookCreated = vi.fn()
    render(<WorkbenchView book={null} onBookCreated={onBookCreated} />)
    const input = screen.getByLabelText('作品名')
    await userEvent.clear(input)
    await userEvent.type(input, '雾港失真')
    await userEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      expect(onBookCreated).toHaveBeenCalledWith({
        root: 'C:\\tmp\\book-a',
        bookId: 'bk_1',
        title: '雾港失真',
      })
    })
    const init = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined
    expect(JSON.parse(init?.body ?? '{}')).toEqual({
      title: '雾港失真',
    })
  })

  it('建书失败显式报错（role=alert），不静默', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: '目录已存在' }), { status: 400 }),
      ),
    )
    render(<WorkbenchView book={null} onBookCreated={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('目录已存在')
    })
  })

  it('账本刷新：事件类型直出（task 事件取 event.type）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((path: string) => {
        if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: false })
        if (path === '/api/draft.question') return okJson({ ok: true, question: '问题', hint: '提示', choices: [] })
        if (path === '/api/chapter.read') {
          return okJson({ ok: true, chapterIndex: 1, title: '第一章', phase: 'draft', body: '初始正文内容', wordCount: 6, revision: 1, hash: 'h_1' })
        }
        if (path === '/api/ledger') {
          return okJson({
            ok: true,
            events: [
              { kind: 'task', event: { type: 'TraverseCompleted' } },
              { kind: 'style_learned', type: 'style_learned' },
            ],
          })
        }
        return okJson({ ok: false, error: 'unexpected path: ' + path })
      }),
    )
    render(<WorkbenchView book={BOOK} onBookCreated={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '刷新账本' }))
    await waitFor(() => {
      expect(screen.getByTestId('ledger').textContent).toContain('TraverseCompleted')
    })
    expect(screen.getByTestId('ledger').textContent).toContain('style_learned')
  })

  it('正文编辑器：读取展示正文，编辑后点击保存正文触发 /api/chapter.save', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: false })
      if (path === '/api/draft.question') return okJson({ ok: true, question: '问题', hint: '提示', choices: [] })
      if (path === '/api/chapter.read') {
        return okJson({
          ok: true,
          chapterIndex: 1,
          title: '第一章 启程',
          phase: 'draft',
          body: '原有正文',
          wordCount: 4,
          revision: 1,
          hash: 'h_initial',
        })
      }
      if (path === '/api/chapter.save') {
        return okJson({
          ok: true,
          chapterIndex: 1,
          wordCount: 10,
          revision: 2,
          hash: 'h_saved',
        })
      }
      return okJson({ ok: false, error: 'unexpected path: ' + path })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkbenchView book={BOOK} onBookCreated={() => {}} chapterIndex={1} />)
    await waitFor(() => {
      expect(screen.getByTestId('prose-editor')).toBeInTheDocument()
    })
    expect(screen.getByTestId('prose-editor').textContent).toContain('第一章 启程')

    const textarea = screen.getByPlaceholderText('在此处撰写或手工修改正文，点击保存正文写入磁盘…')
    expect(textarea).toHaveValue('原有正文')

    await userEvent.type(textarea, '，追加手工修改')
    expect(screen.getByTestId('save-prose-btn')).not.toBeDisabled()

    await userEvent.click(screen.getByTestId('save-prose-btn'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chapter.save',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            root: BOOK.root,
            chapterIndex: 1,
            body: '原有正文，追加手工修改',
            baseHash: 'h_initial',
          }),
        }),
      )
    })
  })
})
