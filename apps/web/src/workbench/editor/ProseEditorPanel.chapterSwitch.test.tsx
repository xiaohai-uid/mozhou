import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProseEditorPanel } from './ProseEditorPanel'
import { chapterDraftKey, loadDraftCache } from '../../shell/workbenchStorage'
import { okJson } from '../../test/http'

const a = { root: 'C:/chapter-a', bookId: 'chapter-a', title: '甲书' }
const b = { root: 'C:/chapter-b', bookId: 'chapter-b', title: '乙书' }
beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals() })

describe('编辑区切章的快照归属', () => {
  it.each([false, true])('重开时已保存缓存跟随磁盘，未保存编辑保留（有未保存编辑=%s）', async (dirty) => {
    let diskBody = '服务端初稿。'
    let revision = 1
    vi.stubGlobal('fetch', vi.fn((path: string, init: RequestInit) => {
      if (path === '/api/chapter.prose.save') {
        const payload = JSON.parse(init.body as string) as { body: string }
        diskBody = payload.body
        revision++
        return Promise.resolve(okJson({ ok: true, revision, created: false }))
      }
      return Promise.resolve(okJson({ ok: true, exists: true, phase: 'draft', revision, body: diskBody }))
    }))
    const view = render(<ProseEditorPanel book={a} chapterIndex={1} />)
    await waitFor(() => expect(screen.getByLabelText('章节正文编辑区')).toHaveValue('服务端初稿。'))
    fireEvent.change(screen.getByLabelText('章节正文编辑区'), { target: { value: '已保存的草稿。' } })
    fireEvent.click(screen.getByTestId('prose-accept-draft'))
    await waitFor(() => expect(screen.getByTestId('prose-save-result')).toHaveTextContent('r2'))
    if (dirty) fireEvent.change(screen.getByLabelText('章节正文编辑区'), { target: { value: '作者尚未保存的新修改。' } })
    view.unmount()
    diskBody = '服务端已撤销后的原稿。'
    revision++
    render(<ProseEditorPanel book={a} chapterIndex={1} />)
    await waitFor(() => expect(screen.getByTestId('prose-accept-draft')).toBeEnabled())
    expect(screen.getByLabelText('章节正文编辑区')).toHaveValue(dirty ? '作者尚未保存的新修改。' : diskBody)
  })

  it.each([false, true])('旧快照不回填新书章空缓存（切书=%s）', async (switchBook) => {
    let release: (response: Response) => void = () => { throw new Error('New chapter read not started') }
    const nextBook = switchBook ? b : a
    const nextChapter = switchBook ? 1 : 2
    vi.stubGlobal('fetch', vi.fn((_path: string, init: RequestInit) => {
      const payload = JSON.parse(init.body as string) as { root: string; chapterIndex: number }
      if (payload.root === a.root && payload.chapterIndex === 1) return Promise.resolve(okJson({ ok: true, exists: true, revision: 1, phase: 'draft', body: '甲书第一章原文。' }))
      return new Promise<Response>(resolve => { release = resolve })
    }))
    const view = render(<ProseEditorPanel book={a} chapterIndex={1} />)
    await waitFor(() => expect(screen.getByLabelText('章节正文编辑区')).toHaveValue('甲书第一章原文。'))
    view.rerender(<ProseEditorPanel book={nextBook} chapterIndex={nextChapter} />)
    expect(loadDraftCache(chapterDraftKey(nextBook, nextChapter))).toBe('')
    expect(screen.getByLabelText('章节正文编辑区')).toHaveValue('')
    await act(async () => { release(okJson({ ok: true, exists: true, revision: 7, phase: 'draft', body: '新现场的正确正文。' })); await Promise.resolve() })
    expect(screen.getByLabelText('章节正文编辑区')).toHaveValue('新现场的正确正文。')
    expect(loadDraftCache(chapterDraftKey(nextBook, nextChapter))).toBe('新现场的正确正文。')
    expect(loadDraftCache(chapterDraftKey(a, 1))).toBe('甲书第一章原文。')
  })

  it('旧章节保存失败迟到时，不污染新章节的保存结果和编辑内容', async () => {
    let rejectSave: (error: Error) => void = () => { throw new Error('Save not started') }
    vi.stubGlobal('fetch', vi.fn((path: string, init: RequestInit) => {
      if (path === '/api/chapter.prose.save') return new Promise<Response>((_resolve, reject) => { rejectSave = reject })
      const payload = JSON.parse(init.body as string) as { chapterIndex: number }
      return Promise.resolve(okJson({ ok: true, exists: true, phase: 'draft', revision: 1, body: payload.chapterIndex === 1 ? '第一章。' : '第二章。' }))
    }))
    const view = render(<ProseEditorPanel book={a} chapterIndex={1} />)
    await waitFor(() => expect(screen.getByLabelText('章节正文编辑区')).toHaveValue('第一章。'))
    fireEvent.click(screen.getByTestId('prose-accept-draft'))
    view.rerender(<ProseEditorPanel book={a} chapterIndex={2} />)
    await act(async () => { rejectSave(new Error('第一章旧保存失败')); await Promise.resolve() })
    expect(screen.queryByText(/第一章旧保存失败/)).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('章节正文编辑区')).toHaveValue('第二章。'))
  })
})
