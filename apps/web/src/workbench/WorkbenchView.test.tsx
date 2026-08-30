/**
 * 工作台中栏组件测试（实现票 T40）：存量功能（建书 / 实体网格 / 账本）
 * 在新壳内可用 + 对话区骨架显式占位（不假装可用）。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchView } from './WorkbenchView'
import type { BookInfo } from '../shell/workbenchStorage'

afterEach(() => {
  vi.unstubAllGlobals()
})

const BOOK: BookInfo = { root: 'C:\\tmp\\book-a', bookId: 'bk_1', title: '测试之书' }

describe('WorkbenchView', () => {
  it('对话区骨架：composer disabled 显式占位并点名 T44，不假装可用', () => {
    render(<WorkbenchView book={null} onBookCreated={() => {}} />)
    expect(screen.getByTestId('dialogue-skeleton').textContent).toContain('T44')
    expect(screen.getByLabelText('写作对话输入（T44 接入前占位）')).toBeDisabled()
    expect(screen.getByLabelText('发送（T44 接入前占位）')).toBeDisabled()
  })

  it('建书成功回调 BookInfo（含书名，供 localStorage 记忆）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, root: 'C:\\tmp\\book-a', bookId: 'bk_1' }), {
        status: 200,
      }),
    )
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
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
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

  it('实体网格：按类型分栏渲染实体卡（data-entity-ref 契约保留）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            cards: [
              { ref: 'char:linzhou', cardType: 'char', name: '林舟', brief: '主角', aiContext: 'detected' },
              { ref: 'loc:harbor', cardType: 'loc', name: '雾港', brief: null, aiContext: 'detected' },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    render(<WorkbenchView book={BOOK} onBookCreated={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '刷新实体' }))
    await waitFor(() => {
      expect(document.querySelector('[data-entity-ref="char:linzhou"]')).not.toBeNull()
    })
    expect(document.querySelector('[data-entity-ref="loc:harbor"]')?.textContent).toContain('雾港')
    expect(screen.getByTestId('story-brain-entities').textContent).toContain('三区面板随 T41 迁入检视塔')
  })

  it('账本刷新：事件类型直出（task 事件取 event.type）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            events: [
              { kind: 'task', event: { type: 'TraverseCompleted' } },
              { kind: 'style_learned', type: 'style_learned' },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    render(<WorkbenchView book={BOOK} onBookCreated={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '刷新账本' }))
    await waitFor(() => {
      expect(screen.getByTestId('ledger').textContent).toContain('TraverseCompleted')
    })
    expect(screen.getByTestId('ledger').textContent).toContain('style_learned')
  })
})
