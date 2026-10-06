/**
 * 行内 AI 编辑链路面板测试（CHG-20261006-02 同变新增）。
 *
 * 守卫语义（specs/002 FR-3 / 任务验收）：
 * - 选区 → 契约请求（action/selectedText/selectionRange 逐字一致）→ 流式候选 → 双栏 diff；
 * - AI 失败（NDJSON error 帧）：诚实报错，正文一字不改；
 * - Accept：AST 局部替换落写作层（可撤销），绝不自动落盘；
 * - 选区不漂移守护：候选审阅期间正文变化 ⇒ 拒绝采纳并提示，不写错位置；
 * - Reject：正文不变、面板消失。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProseEditorPanel } from './ProseEditorPanel'
import { chapterDraftKey, saveDraftCache } from '../../shell/workbenchStorage'
import type { BookInfo } from '../../shell/workbenchStorage'

// jsdom 缺 DOM 几何 API（PM scrollToSelection → coordsAtPos 依赖 Range.getClientRects）；
// 返回零尺寸矩形让滚动定位走空兜底——仅测试环境，不影响生产路径。
beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect
  const proto = typeof Range !== 'undefined' ? Range.prototype : undefined
  if (proto !== undefined) {
    if (typeof proto.getClientRects !== 'function') {
      proto.getClientRects = (): DOMRectList => [zeroRect] as unknown as DOMRectList
    }
    if (typeof proto.getBoundingClientRect !== 'function') {
      proto.getBoundingClientRect = (): DOMRect => zeroRect
    }
  }
  document.elementFromPoint = (): Element | null => null
})

const BOOK: BookInfo = { root: 'C:/tmp/book-a', bookId: 'bk_aaaa', title: '雾港失真' }
const DRAFT = '夜幕降临，钟声在海港回荡。'

type Json = Record<string, unknown>

/** NDJSON 流应答（帧序即契约）。 */
function ndjsonResponse(frames: Json[]): Response {
  const body = frames.map((f) => JSON.stringify(f) + '\n').join('')
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } })
}

beforeEach(() => {
  saveDraftCache(DRAFT, chapterDraftKey(BOOK, 1))
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    if (input === '/api/chapter.prose') {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, exists: false, chapterIndex: 1 }), { status: 200 }))
    }
    throw new Error('unexpected fetch: ' + input)
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

/** 渲染 + 等编辑器就绪 + 以 DOM Selection 选中 [from,to) 并冒泡 mouseUp 唤出 Bubble。 */
async function selectAndSummonBubble(from: number, to: number): Promise<HTMLElement> {
  render(<ProseEditorPanel book={BOOK} chapterIndex={1} />)
  const editorEl = await waitFor(() => screen.getByRole('textbox'))
  await waitFor(() => expect((editorEl.textContent ?? '')).toBe(DRAFT))
  editorEl.focus()
  const textNode = editorEl.firstChild?.firstChild as Text
  const range = document.createRange()
  range.setStart(textNode, from)
  range.setEnd(textNode, to)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  fireEvent.mouseUp(editorEl, { clientY: 120, clientX: 120 })
  return editorEl
}

describe('行内 AI 编辑（/api/prose.edit.stream 接线）', () => {
  it('Bubble 预设 → 契约请求（action/selectedText/selectionRange 一致）→ 流式候选 → 双栏 diff + FR-3.3 质检徽标', async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input === '/api/prose.edit.stream') {
        return Promise.resolve(ndjsonResponse([
          { ok: true, event: 'start', candidateId: 'cand_1', action: 'sensory_expansion', provider: 'mock' },
          { ok: true, event: 'delta', candidateId: 'cand_1', text: '夜幕垂落，' },
          { ok: true, event: 'delta', candidateId: 'cand_1', text: '海雾漫过窗棂，' },
          { ok: true, event: 'done', candidateId: 'cand_1', action: 'sensory_expansion', chars: 13 },
        ]))
      }
      if (input === '/api/chapter.prose') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, exists: false, chapterIndex: 1 }), { status: 200 }))
      }
      throw new Error('unexpected fetch: ' + input)
    })
    vi.stubGlobal('fetch', fetchMock)

    const editorEl = await selectAndSummonBubble(0, 5) // 「夜幕降临，」
    // 唤出 Bubble 后点「描写强化」预设（title 与 FloatingBubbleMenu 一致）
    fireEvent.click(await screen.findByTitle('增强五感细节'))

    // 契约请求体：root/chapterIndex/action/selectedText/selectionRange 逐字一致
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([p]) => p === '/api/prose.edit.stream')
      expect(call).toBeTruthy()
    })
    const streamCall = fetchMock.mock.calls.find((args) => args[0] === '/api/prose.edit.stream')
    const requestInit = (streamCall as unknown[] | undefined)?.[1] as RequestInit | undefined
    const bodyText = typeof requestInit?.body === 'string' ? requestInit.body : '{}'
    const sentBody = JSON.parse(bodyText) as Json
    expect(sentBody).toMatchObject({
      root: BOOK.root,
      chapterIndex: 1,
      action: 'sensory_expansion',
      selectedText: '夜幕降临，',
      selectionRange: { from: 0, to: 5 },
    })

    // 双栏 diff 面板出现（原始片段 vs 候选），FR-3.3 质检徽标在位
    await waitFor(() => expect(screen.getByTestId('inline-diff-viewer')).toBeTruthy())
    expect(screen.getByTestId('inline-diff-viewer').textContent).toContain('海雾漫过窗棂')
    expect(screen.getByTestId('inline-diff-quality')).toBeTruthy()
    // 正文未被自动覆盖（候选只进面板）
    expect(editorEl.textContent).toBe(DRAFT)
  })

  it('AI 失败（NDJSON error 帧）：诚实报错，正文一字不改，无 diff 面板', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (input === '/api/prose.edit.stream') {
        return Promise.resolve(ndjsonResponse([
          { ok: true, event: 'start', candidateId: 'cand_2', action: 'dialogue_polish', provider: 'mock' },
          { ok: false, event: 'error', candidateId: 'cand_2', error: 'provider upstream 502' },
        ]))
      }
      if (input === '/api/chapter.prose') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, exists: false, chapterIndex: 1 }), { status: 200 }))
      }
      throw new Error('unexpected fetch: ' + input)
    }))

    const editorEl = await selectAndSummonBubble(0, 5)
    fireEvent.click(await screen.findByTitle('强化角色声线'))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('AI 行内编辑失败')
      expect(screen.getByRole('status').textContent).toContain('provider upstream 502')
    })
    expect(editorEl.textContent).toBe(DRAFT) // 失败不改正文
    expect(screen.queryByTestId('inline-diff-viewer')).toBeNull()
  })

  it('Accept：AST 局部替换落写作层（前缀/后缀逐字节保留），不自动落盘；Reject 则一字不改', async () => {
    let answer: 'accept' | 'reject' = 'accept'
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (input === '/api/prose.edit.stream') {
        return Promise.resolve(ndjsonResponse([
          { ok: true, event: 'start', candidateId: 'cand_3', action: 'deslop_sharpen', provider: 'mock' },
          { ok: true, event: 'delta', candidateId: 'cand_3', text: '夜色四合，' },
          { ok: true, event: 'done', candidateId: 'cand_3', action: 'deslop_sharpen', chars: 5 },
        ]))
      }
      if (input === '/api/chapter.prose') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, exists: false, chapterIndex: 1 }), { status: 200 }))
      }
      throw new Error('unexpected fetch: ' + input)
    }))

    const editorEl = await selectAndSummonBubble(0, 5)
    fireEvent.click(await screen.findByTitle('去空洞修辞'))
    await waitFor(() => expect(screen.getByTestId('inline-diff-viewer')).toBeTruthy())

    if (answer === 'accept') {
      fireEvent.click(screen.getByTestId('inline-diff-accept'))
      // 前缀为空：候选替换 [0,5)，后缀「钟声在海港回荡。」逐字节保留
      await waitFor(() => expect(editorEl.textContent).toBe('夜色四合，钟声在海港回荡。'))
      // Accept ≠ 落盘：不触发 /api/chapter.prose.save（走既有 revision-safe 保存入口）
      const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]))
      expect(calls).not.toContain('/api/chapter.prose.save')
      // 落盘提示明确「尚未落盘」
      expect(screen.getByTestId('prose-save-result').textContent).toContain('尚未落盘')
    }

    // Reject 分支：重新选中（Accept 后选区已折叠）再唤出 Bubble，正文必须一字不改
    answer = 'reject'
    const textNodeAfter = editorEl.firstChild?.firstChild as Text
    const range2 = document.createRange()
    range2.setStart(textNodeAfter, 0)
    range2.setEnd(textNodeAfter, 5)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range2)
    document.dispatchEvent(new Event('selectionchange'))
    fireEvent.mouseUp(editorEl, { clientY: 120, clientX: 120 })
    fireEvent.click(await screen.findByTitle('去空洞修辞'))
    await waitFor(() => expect(screen.getByTestId('inline-diff-viewer')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /放弃/ }))
    await waitFor(() => expect(screen.queryByTestId('inline-diff-viewer')).toBeNull())
    expect(editorEl.textContent).toBe('夜色四合，钟声在海港回荡。') // Reject 不回退已 Accept 的内容
  })

  it('选区不漂移守护：候选审阅期间正文变化 ⇒ Accept 被拒绝并提示，不写错位置', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (input === '/api/prose.edit.stream') {
        return Promise.resolve(ndjsonResponse([
          { ok: true, event: 'start', candidateId: 'cand_4', action: 'plot_twist', provider: 'mock' },
          { ok: true, event: 'delta', candidateId: 'cand_4', text: '反转候选文本' },
          { ok: true, event: 'done', candidateId: 'cand_4', action: 'plot_twist', chars: 6 },
        ]))
      }
      if (input === '/api/chapter.prose') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, exists: false, chapterIndex: 1 }), { status: 200 }))
      }
      throw new Error('unexpected fetch: ' + input)
    }))

    const editorEl = await selectAndSummonBubble(0, 5)
    fireEvent.click(await screen.findByTitle('构思冲突变数'))
    await waitFor(() => expect(screen.getByTestId('inline-diff-viewer')).toBeTruthy())

    // 审阅期间作者继续改写正文（选区基线失效）
    editorEl.innerHTML = '<p>作者已重写整段，选区早已不在。</p>'
    await new Promise((resolve) => setTimeout(resolve, 60))

    fireEvent.click(screen.getByTestId('inline-diff-accept'))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('选区不再匹配')
    })
    // 守卫生效：候选没有落到错误位置
    expect(editorEl.textContent).toContain('作者已重写整段')
    expect(editorEl.textContent).not.toContain('反转候选文本')
  })

  it('快捷键操作（specs/002 FR-3.2）：Esc 放弃候选，Enter 采纳替换', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (input === '/api/prose.edit.stream') {
        return Promise.resolve(ndjsonResponse([
          { ok: true, event: 'start', candidateId: 'cand_key', action: 'sensory_expansion', provider: 'mock' },
          { ok: true, event: 'delta', candidateId: 'cand_key', text: '破晓时分，' },
          { ok: true, event: 'done', candidateId: 'cand_key', action: 'sensory_expansion', chars: 5 },
        ]))
      }
      if (input === '/api/chapter.prose') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, exists: false, chapterIndex: 1 }), { status: 200 }))
      }
      throw new Error('unexpected fetch: ' + input)
    }))

    const editorEl = await selectAndSummonBubble(0, 5)
    fireEvent.click(await screen.findByTitle('增强五感细节'))
    await waitFor(() => expect(screen.getByTestId('inline-diff-viewer')).toBeTruthy())

    // 1) Esc 键放弃
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('inline-diff-viewer')).toBeNull())
    expect(editorEl.textContent).toBe(DRAFT)

    // 2) 再次发起编辑
    const textNodeAfter = editorEl.firstChild?.firstChild as Text
    const range = document.createRange()
    range.setStart(textNodeAfter, 0)
    range.setEnd(textNodeAfter, 5)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    fireEvent.mouseUp(editorEl, { clientY: 120, clientX: 120 })
    fireEvent.click(await screen.findByTitle('增强五感细节'))
    await waitFor(() => expect(screen.getByTestId('inline-diff-viewer')).toBeTruthy())

    // 3) Enter 键采纳
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(editorEl.textContent).toBe('破晓时分，钟声在海港回荡。'))
    expect(screen.queryByTestId('inline-diff-viewer')).toBeNull()
  })
})
