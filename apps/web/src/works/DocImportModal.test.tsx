import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { okJson } from '../test/http'
import { DocImportModal } from './DocImportModal'

afterEach(() => {
  vi.unstubAllGlobals()
})

const MOCK_PREVIEW_RESPONSE = {
  ok: true,
  preview: true,
  chapterCount: 3,
  chapters: [
    {
      chapterIndex: 1,
      title: '第一章 苍穹惊雷',
      wordCount: 2850,
      preview: '天地初开，万物混沌，苍穹之上雷声轰鸣…',
    },
    {
      chapterIndex: 2,
      title: '第二章 宗门选拔',
      wordCount: 3120,
      preview: '太玄山脚下，各方少年汇聚于此，翘首以盼…',
    },
    {
      chapterIndex: 3,
      title: '第三章 试炼之峰',
      wordCount: 2980,
      preview: '陡峭的青云阶梯直插云霄，冷风凛冽…',
    },
  ],
}

const MOCK_EXECUTE_RESPONSE = {
  ok: true,
  root: 'C:/data/books/cang-qiong',
  bookId: 'book_cangqiong_123',
  title: '苍穹纪元',
  chapterCount: 3,
  chapters: [
    { chapterIndex: 1, title: '第一章 苍穹惊雷', wordCount: 2850 },
    { chapterIndex: 2, title: '第二章 宗门选拔', wordCount: 3120 },
    { chapterIndex: 3, title: '第三章 试炼之峰', wordCount: 2980 },
  ],
}

describe('DocImportModal (既有稿件导入弹窗)', () => {
  it('isOpen=false 时不渲染任何 DOM，isOpen=true 时具备完整 dialog 与 aria 属性', () => {
    const { rerender } = render(
      <DocImportModal isOpen={false} onClose={() => {}} onSuccess={() => {}} />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(<DocImportModal isOpen={true} onClose={() => {}} onSuccess={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('导入已有书稿建书')).toBeInTheDocument()
    expect(screen.getByText('既有稿件导入 · 支持 WORD / TXT / MARKDOWN')).toBeInTheDocument()
  })

  it('点击取消按钮或按 Escape 键可触发 onClose', async () => {
    const onClose = vi.fn()
    render(<DocImportModal isOpen={true} onClose={onClose} onSuccess={() => {}} />)

    const cancelBtn = screen.getByRole('button', { name: '取消' })
    await userEvent.click(cancelBtn)
    expect(onClose).toHaveBeenCalledTimes(1)

    // Escape 键测试
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('支持切换至粘贴长文本 Tab 并输入正文，自动触发分章预览', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_PREVIEW_RESPONSE)))

    render(<DocImportModal isOpen={true} onClose={() => {}} onSuccess={() => {}} />)

    // 切换至粘贴长文本
    const pasteTab = screen.getByRole('button', { name: '粘贴长文本' })
    await userEvent.click(pasteTab)

    const textarea = screen.getByLabelText('粘贴书稿内容')
    expect(textarea).toBeInTheDocument()

    // 输入正文
    await userEvent.type(textarea, '第1章 开始\n天道苍茫。\n第2章 延续\n风起云涌。')

    // 等待 debounce 自动触发预览
    await waitFor(() => {
      expect(screen.getByTestId('doc-import-chapters-preview')).toBeInTheDocument()
    })

    expect(screen.getByText('第一章 苍穹惊雷')).toBeInTheDocument()
    expect(screen.getByText('第二章 宗门选拔')).toBeInTheDocument()
    expect(screen.getByText('第三章 试炼之峰')).toBeInTheDocument()
    expect(screen.getByText(/共识别出/)).toHaveTextContent('共识别出 3 章')
  })

  it('分章策略切换为按字数阈值时展示阈值输入框并支持修改', async () => {
    render(<DocImportModal isOpen={true} onClose={() => {}} onSuccess={() => {}} />)

    const select = screen.getByLabelText('分章策略')
    await userEvent.selectOptions(select, 'word-count')

    const thresholdInput = screen.getByLabelText('单章目标字数')
    expect(thresholdInput).toBeInTheDocument()
    expect(thresholdInput).toHaveValue(3000)

    await userEvent.clear(thresholdInput)
    await userEvent.type(thresholdInput, '4500')
    expect(thresholdInput).toHaveValue(4500)
  })

  it('完整执行流程：输入书名、解析预览并确认建书成功调用 onSuccess', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const rawBody = typeof init?.body === 'string' ? init.body : '{}'
      const body = JSON.parse(rawBody) as Record<string, unknown>
      if (body['previewOnly'] === true || body['action'] === 'preview') {
        return Promise.resolve(okJson(MOCK_PREVIEW_RESPONSE))
      }
      return Promise.resolve(okJson(MOCK_EXECUTE_RESPONSE))
    })
    vi.stubGlobal('fetch', fetchMock)

    const onSuccess = vi.fn()
    const onClose = vi.fn()

    render(
      <DocImportModal
        isOpen={true}
        parentDir="C:/data/books"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    )

    // 切换至文本输入
    await userEvent.click(screen.getByRole('button', { name: '粘贴长文本' }))
    await userEvent.type(screen.getByLabelText('粘贴书稿内容'), '第1章 正文内容')

    // 填写书名
    const titleInput = screen.getByLabelText('作品名称')
    await userEvent.type(titleInput, '苍穹纪元')

    // 等待预览就绪
    await waitFor(() => {
      expect(screen.getByTestId('doc-import-chapters-preview')).toBeInTheDocument()
    })

    // 点击建书按钮
    const submitBtn = screen.getByRole('button', { name: '确认导入建书 →' })
    expect(submitBtn).not.toBeDisabled()
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        root: 'C:/data/books/cang-qiong',
        bookId: 'book_cangqiong_123',
        title: '苍穹纪元',
      })
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('后端报错时显式展示 role=alert 错误提示，不静默失败', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: 'DOCX 文件损坏或格式非法' }), {
          status: 400,
        }),
      ),
    )

    render(<DocImportModal isOpen={true} onClose={() => {}} onSuccess={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: '粘贴长文本' }))
    await userEvent.type(screen.getByLabelText('粘贴书稿内容'), '损坏测试')

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert).toBeInTheDocument()
      expect(alert.textContent).toContain('DOCX 文件损坏或格式非法')
    })
  })
})
