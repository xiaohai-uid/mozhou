import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogueStream } from './DialogueStream'
import { okJson } from '../test/http'
import { candidateDraftKey, chapterDraftKey, loadDraftCache, saveCandidateCache } from '../shell/workbenchStorage'

const a = { root: 'C:/undo-a', bookId: 'undo-a', title: '甲书' }
const b = { root: 'C:/undo-b', bookId: 'undo-b', title: '乙书' }
const original = '采纳前作者原稿。'
const accepted = '已采纳的完整候选。'

beforeEach(() => {
  localStorage.clear()
  saveCandidateCache({ candidateId: 'undo-candidate', base: { revision: 1, sha256: 'a'.repeat(64) }, mode: 'replace', draftText: accepted, phase: 'draft_done', partial: false }, candidateDraftKey(a, 1))
})
afterEach(() => { vi.unstubAllGlobals() })

function install(mode: 'success' | 'read-error' | 'conflict') {
  let reads = 0
  let reached = false
  let release: () => void = () => { throw new Error('Pending response not reached') }
  vi.stubGlobal('fetch', vi.fn((path: string) => {
    if (path === '/api/capabilities') return Promise.resolve(okJson({ ok: true, capabilities: [], providerAvailable: true }))
    if (path === '/api/draft.question') return Promise.resolve(okJson({ ok: true, question: '下一段？', choices: [], hint: '' }))
    if (path === '/api/draft.accept') return Promise.resolve(okJson({ ok: true, revision: 2, sha256: 'b'.repeat(64) }))
    if (path === '/api/chapter.prose') {
      reads++
      if ((mode === 'read-error' && reads === 3) || (mode === 'conflict' && reads === 4)) {
        reached = true
        return new Promise<Response>((resolve, reject) => {
          release = mode === 'read-error'
            ? () => reject(new Error('甲书旧撤销读取失败'))
            : () => resolve(okJson({ ok: true, exists: true, revision: 3, body: '甲书外部新编辑。' }))
        })
      }
      return Promise.resolve(okJson({ ok: true, exists: true, revision: reads === 1 ? 1 : 2, body: reads === 1 ? original : accepted }))
    }
    if (path === '/api/chapter.prose.save') {
      if (mode === 'conflict') return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 409 }))
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        release = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ ok: true, revision: 3 }))); controller.close() }
      } })
      const response = new Response(body, { headers: { 'Content-Type': 'application/json' } })
      const json = response.json.bind(response)
      response.json = () => { reached = true; return json() }
      return Promise.resolve(response)
    }
    return Promise.resolve(okJson({ ok: false }))
  }))
  return { reached: () => reached, async release() { await act(async () => { release(); await Promise.resolve() }) } }
}

async function adoptAndUndo() {
  fireEvent.click(screen.getByTestId('adopt-into-slate'))
  await waitFor(() => expect(screen.getByTestId('undo-accept')).toBeInTheDocument())
  fireEvent.click(screen.getByTestId('undo-accept'))
}

describe('撤销采纳结果的书章隔离', () => {
  it.each([false, true])('旧撤销成功正文迟到时不发布到切书后的现场（切回原书=%s）', async (returnToA) => {
    const pending = install('success')
    const view = render(<DialogueStream book={a} />)
    await adoptAndUndo()
    await waitFor(() => expect(pending.reached()).toBe(true))
    view.rerender(<DialogueStream book={b} />)
    if (returnToA) view.rerender(<DialogueStream book={a} />)
    await pending.release()
    expect(screen.queryByTestId('adopt-state')).not.toBeInTheDocument()
    expect(loadDraftCache(chapterDraftKey(a, 1))).toBe(accepted)
    expect(loadDraftCache(chapterDraftKey(b, 1))).toBe('')
  })

  it('撤销前读取失败迟到时，不在新书显示旧书错误', async () => {
    const pending = install('read-error')
    const view = render(<DialogueStream book={a} />)
    await adoptAndUndo()
    await waitFor(() => expect(pending.reached()).toBe(true))
    view.rerender(<DialogueStream book={b} />)
    await pending.release()
    expect(screen.queryByText(/甲书旧撤销读取失败/)).not.toBeInTheDocument()
  })

  it('撤销冲突快照迟到时，不在新书显示旧书双文本冲突', async () => {
    const pending = install('conflict')
    const view = render(<DialogueStream book={a} />)
    await adoptAndUndo()
    await waitFor(() => expect(pending.reached()).toBe(true))
    view.rerender(<DialogueStream book={b} />)
    await pending.release()
    expect(screen.queryByTestId('accept-conflict')).not.toBeInTheDocument()
    expect(screen.queryByText(/撤销被拒绝/)).not.toBeInTheDocument()
  })
})
