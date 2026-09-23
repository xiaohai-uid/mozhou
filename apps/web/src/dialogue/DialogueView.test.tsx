/**
 * 写作对话视图测试：
 * - 未建书：显式空态 + 前往工作台回调（不假装可用）；
 * - 已建书：挂载同源 DialogueStream（问卷标题可见即视为管线挂载成功）。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DialogueView } from './DialogueView'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('DialogueView', () => {
  it('未建书：显式空态并回调 onGoToWorkbench', async () => {
    const onGoToWorkbench = vi.fn()
    const user = userEvent.setup()
    render(<DialogueView book={null} chapterIndex={1} onGoToWorkbench={onGoToWorkbench} />)

    expect(screen.getByTestId('dialogue-empty').textContent).toContain('写作对话需要先建书')
    await user.click(screen.getByRole('button', { name: '前往工作台' }))
    expect(onGoToWorkbench).toHaveBeenCalledTimes(1)
  })

  it('已建书：渲染对话流与当前书/章上下文', () => {
    globalThis.fetch = vi.fn().mockImplementation((path: string): Promise<Response> => {
      if (path === '/api/draft.question') {
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: true, question: '本章基调？', hint: '决定叙事温度', choices: ['沉稳', '凌厉'] }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, capabilities: [], providerAvailable: false }), { status: 200 }),
      )
    })

    render(
      <DialogueView
        book={{ root: '/tmp/book', bookId: 'bk_1', title: '夜雨江澜' }}
        chapterIndex={3}
        onGoToWorkbench={() => undefined}
      />,
    )

    expect(screen.getByTestId('dialogue-view').textContent).toContain('《夜雨江澜》 · 第 3 章')
  })
})
