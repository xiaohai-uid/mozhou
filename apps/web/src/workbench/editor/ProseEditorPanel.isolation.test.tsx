/**
 * T00 组件级回归：ProseEditorPanel 切书（同章号）必须重载对应书的 Active Draft；
 * 未绑书不显示任何缓存文本。与 workbenchStorage.test.ts 的函数级隔离互为表里。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ProseEditorPanel } from './ProseEditorPanel'
import { chapterDraftKey, saveDraftCache } from '../../shell/workbenchStorage'
import type { BookInfo } from '../../shell/workbenchStorage'

const BOOK_A: BookInfo = { root: 'C:/tmp/book-a', bookId: 'bk_aaaa', title: '雾港失真' }
const BOOK_B: BookInfo = { root: 'C:/tmp/book-b', bookId: 'bk_bbbb', title: '深巷回声' }

afterEach(() => {
  window.localStorage.clear()
})

describe('ProseEditorPanel（T00 切书隔离）', () => {
  it('同章号切书：显示切后书的缓存而非前书未落盘文本；切回恢复前书缓存', async () => {
    const user = userEvent.setup()
    saveDraftCache('甲书已有草稿', chapterDraftKey(BOOK_A, 1))
    const { rerender } = render(<ProseEditorPanel book={BOOK_A} chapterIndex={1} />)

    const editor = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(editor.value).toBe('甲书已有草稿')
    // 作者继续输入（每次变更即时入缓存）
    await user.type(editor, '续写')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('甲书已有草稿续写')

    // 切到乙书同章号：不得显示甲书文本
    rerender(<ProseEditorPanel book={BOOK_B} chapterIndex={1} />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')

    // 切回甲书：甲书缓存（含刚才输入）完整恢复
    rerender(<ProseEditorPanel book={BOOK_A} chapterIndex={1} />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('甲书已有草稿续写')
  })

  it('未绑书（book=null）不显示任何草稿文本', () => {
    saveDraftCache('甲书已有草稿', chapterDraftKey(BOOK_A, 1))
    render(<ProseEditorPanel book={null} chapterIndex={1} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(/建书后此处成为当前章/)).toBeTruthy()
  })
})
