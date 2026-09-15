/**
 * ProseEditorPanel 组件级回归：
 * - T00：切书（同章号）必须重载对应书的 Active Draft；未绑书不显示任何缓存文本。
 * - R1/R2（发布评审）：冲突 409 → 横幅 + 文本保留 + 显式覆盖流程；
 *   committed 章 → 定稿横幅 + 显式重开；本地缓存为空时以服务端正文回填。
 * 与 workbenchStorage.test.ts 的函数级隔离互为表里。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProseEditorPanel } from './ProseEditorPanel'
import { chapterDraftKey, saveDraftCache } from '../../shell/workbenchStorage'
import type { BookInfo } from '../../shell/workbenchStorage'

const BOOK_A: BookInfo = { root: 'C:/tmp/book-a', bookId: 'bk_aaaa', title: '雾港失真' }
const BOOK_B: BookInfo = { root: 'C:/tmp/book-b', bookId: 'bk_bbbb', title: '深巷回声' }

type Json = Record<string, unknown>

/** fetch 记录器：prose/save 均可编程（函数形态可携带服务端状态迁移）。 */
function stubApi(routes: {
  prose?: (payload: Json) => Json
  save?: (payload: Json) => { status: number; body: Json }
  reopen?: (payload: Json) => Json
}) {
  const savePayloads: Json[] = []
  const reopenPayloads: Json[] = []
  vi.stubGlobal('fetch', vi.fn((input: string, init?: { body?: string }) => {
    const path = input
    const payload = init?.body !== undefined ? (JSON.parse(init.body) as Json) : {}
    const json = (body: Json, status = 200): Response => new Response(JSON.stringify(body), { status })
    if (path === '/api/chapter.prose') return json(routes.prose?.(payload) ?? { ok: true, exists: false, chapterIndex: payload['chapterIndex'] })
    if (path === '/api/chapter.prose.save') {
      savePayloads.push(payload)
      const hit = routes.save?.(payload) ?? { status: 200, body: { ok: true, chapterIndex: 1, revision: 2, phase: 'draft', created: false } }
      return json(hit.body, hit.status)
    }
    if (path === '/api/chapter.reopen') {
      reopenPayloads.push(payload)
      return json(routes.reopen?.(payload) ?? { ok: true, chapterIndex: 1, reopenedFromCommitId: 'cmit_default', proseRelPath: 'x' })
    }
    throw new Error('unexpected fetch: ' + path)
  }))
  return { savePayloads, reopenPayloads }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    throw new Error('unexpected fetch: ' + input)
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('ProseEditorPanel（T00 切书隔离）', () => {
  it('同章号切书：显示切后书的缓存而非前书未落盘文本；切回恢复前书缓存', async () => {
    stubApi({}) // 章均不存在（exists:false）——不影响本地缓存面的断言
    saveDraftCache('甲书已有草稿', chapterDraftKey(BOOK_A, 1))
    const user = userEvent.setup()
    const { rerender } = render(<ProseEditorPanel book={BOOK_A} chapterIndex={1} />)

    const editor = screen.getByRole<HTMLTextAreaElement>('textbox')
    expect(editor.value).toBe('甲书已有草稿')
    // 作者继续输入（每次变更即时入缓存）
    await user.type(editor, '续写')
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('甲书已有草稿续写')

    // 切到乙书同章号：不得显示甲书文本
    rerender(<ProseEditorPanel book={BOOK_B} chapterIndex={1} />)
    await waitFor(() => expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe(''))

    // 切回甲书：甲书缓存（含刚才输入）完整恢复
    rerender(<ProseEditorPanel book={BOOK_A} chapterIndex={1} />)
    await waitFor(() => expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('甲书已有草稿续写'))
  })

  it('未绑书（book=null）不显示任何草稿文本', () => {
    saveDraftCache('甲书已有草稿', chapterDraftKey(BOOK_A, 1))
    render(<ProseEditorPanel book={null} chapterIndex={1} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(/建书后此处成为当前章/)).toBeTruthy()
  })
})

describe('ProseEditorPanel（R1/R2 冲突保护与定稿边界）', () => {
  it('本地缓存为空且服务端有正文：编辑器先回填服务端正文（作者读过才覆盖）', async () => {
    stubApi({ prose: () => ({ ok: true, exists: true, chapterIndex: 1, revision: 3, phase: 'draft', body: '服务端正文。' }) })
    render(<ProseEditorPanel book={BOOK_A} chapterIndex={1} />)
    await waitFor(() => expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('服务端正文。'))
  })

  it('保存携带所读 revision；409 冲突后文本保留，显式覆盖以重读到的最新 revision 重发', async () => {
    const user = userEvent.setup()
    let diskRevision = 1
    const api = stubApi({
      prose: () => ({ ok: true, exists: true, chapterIndex: 1, revision: diskRevision, phase: 'draft', body: '' }),
      save: () => {
        const conflict = diskRevision === 1
        if (!conflict) diskRevision += 1
        else diskRevision = 2 // 他端已保存：磁盘前进到 r2
        return conflict
          ? { status: 409, body: { ok: false, code: 'PROSE_REVISION_CONFLICT', currentRevision: 2, error: 'conflict' } }
          : { status: 200, body: { ok: true, chapterIndex: 1, revision: diskRevision, phase: 'draft', created: false } }
      },
    })
    render(<ProseEditorPanel book={BOOK_A} chapterIndex={1} />)
    const editor = await waitFor(() => screen.getByRole('textbox'))
    await user.type(editor, '我的新文本')
    await user.click(screen.getByTestId('prose-accept-draft'))

    // 第一次保存：expectedRevision = 所读 r1 → 409，文本保留、磁盘语义由服务端持有
    await waitFor(() => expect(screen.getByTestId('prose-conflict-banner')).toBeTruthy())
    expect(screen.getByTestId('prose-save-result').textContent).toContain('保存被拒绝')
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toContain('我的新文本')
    expect(api.savePayloads[0]?.['expectedRevision']).toBe(1)

    // 显式解决：重读最新 r2 后以写作层文本覆盖
    await user.click(screen.getByTestId('prose-resolve-overwrite'))
    await waitFor(() => expect(screen.getByTestId('prose-save-result').textContent).toContain('已落为当前章草稿 r3'))
    expect(api.savePayloads[1]?.['expectedRevision']).toBe(2)
    expect(screen.queryByTestId('prose-conflict-banner')).toBeNull()
  })

  it('committed 章：Accept 不可用、显式重开恢复草稿态（ChapterReopened 语义由服务端执行）', async () => {
    const user = userEvent.setup()
    let phase: 'draft' | 'committed' = 'committed'
    const api = stubApi({
      prose: () => ({
        ok: true, exists: true, chapterIndex: 1,
        revision: phase === 'committed' ? 2 : 3,
        phase,
        commitId: phase === 'committed' ? 'cmit_abc' : undefined,
        body: '定稿正文。',
      }),
      reopen: () => {
        phase = 'draft' // 服务端状态迁移：committed → draft
        return { ok: true, chapterIndex: 1, reopenedFromCommitId: 'cmit_abcdefgh', proseRelPath: '正文/第一卷/第0001章.md' }
      },
    })
    render(<ProseEditorPanel book={BOOK_A} chapterIndex={1} />)
    await waitFor(() => expect(screen.getByTestId('prose-committed-banner')).toBeTruthy())
    expect(screen.queryByTestId('prose-accept-draft')).toBeNull() // 定稿态不提供普通保存
    expect(screen.getByTestId('prose-reopen')).toBeTruthy()

    await user.click(screen.getByTestId('prose-reopen'))
    await waitFor(() => expect(screen.queryByTestId('prose-committed-banner')).toBeNull())
    expect(screen.getByTestId('prose-accept-draft')).toBeTruthy() // 重开后恢复保存入口
    expect(screen.getByTestId('prose-save-result').textContent).toContain('已重开')
    expect(api.reopenPayloads).toHaveLength(1)
  })

  it('快照不可用：Accept 禁用，保存被拒绝（不静默覆盖）', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (input === '/api/chapter.prose') return new Response(JSON.stringify({ ok: false, error: 'boom' }), { status: 500 })
      throw new Error('unexpected ' + input)
    }))
    render(<ProseEditorPanel book={BOOK_A} chapterIndex={1} />)
    const accept = await waitFor(() => screen.getByTestId<HTMLButtonElement>('prose-accept-draft'))
    expect(accept.disabled).toBe(true)
    expect(screen.getByText(/章节状态不可用/)).toBeTruthy()
  })
})
