import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchView } from './WorkbenchView'
import { useShellTelemetry } from '../shell/useShellTelemetry'
import { candidateDraftKey, saveCandidateCache } from '../shell/workbenchStorage'
import { okJson } from '../test/http'

const book = { root: 'C:/tmp/telemetry-book', bookId: 'telemetry-book', title: '采纳状态同步' }
const original = '作者原稿。'
const generated = '新的完整候选正文。'

function Session() {
  const telemetry = useShellTelemetry(book.root, 1)
  return <WorkbenchView book={book} chapters={telemetry.works?.chapters} onBookCreated={() => {}} />
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals() })

describe('AI 采纳后的全局状态', () => {
  it('采纳与撤销无需刷新页面，顶部版本与目录字数都跟随服务器正文', async () => {
    let body = original
    let revision = 1
    vi.stubGlobal('fetch', vi.fn((path: string) => {
      if (path === '/api/works') return okJson({ ok: true, chapters: [{ chapterIndex: 1, title: '第一章', phase: 'draft', revision, wordCount: body.length }] })
      if (path === '/api/chapter.prose') return okJson({ ok: true, exists: true, chapterIndex: 1, body, revision })
      if (path === '/api/draft.accept') {
        body = generated
        revision++
        return okJson({ ok: true, revision, alreadyApplied: false })
      }
      if (path === '/api/chapter.prose.save') {
        body = original
        revision++
        return okJson({ ok: true, revision })
      }
      if (path === '/api/capabilities') return okJson({ ok: true, capabilities: [], providerAvailable: true })
      if (path === '/api/draft.question') return okJson({ ok: true, question: '下一段？', choices: [], hint: '' })
      if (path === '/api/receipts') return okJson({ ok: true, receipts: [] })
      if (path === '/api/chapter.quality') return okJson({ ok: true, status: 'no_review' })
      if (path === '/api/change-matrix') return okJson({ ok: true, matrix: { rows: [] } })
      return okJson({ ok: false, error: 'unsupported test path: ' + path })
    }))
    saveCandidateCache({ candidateId: 'complete', base: { revision: 1, sha256: 'a'.repeat(64) }, mode: 'replace', draftText: generated, phase: 'draft_done', partial: false }, candidateDraftKey(book, 1))
    const view = render(<Session />)
    const meta = () => view.container.querySelector('.chapterbar .meta')
    await waitFor(() => expect(meta()).toHaveTextContent('5 字 · r1'))
    fireEvent.click(screen.getByTestId('adopt-into-slate'))
    await waitFor(() => expect(screen.getByLabelText('章节正文编辑区')).toHaveValue(generated))
    await waitFor(() => expect(meta()).toHaveTextContent('9 字 · r2'))
    expect(within(screen.getByTestId('chapter-rail')).getByRole('button', { name: /第一章/ })).toHaveTextContent('9 字')
    fireEvent.click(screen.getByTestId('undo-accept'))
    await waitFor(() => expect(screen.getByLabelText('章节正文编辑区')).toHaveValue(original))
    await waitFor(() => expect(meta()).toHaveTextContent('5 字 · r3'))
    expect(within(screen.getByTestId('chapter-rail')).getByRole('button', { name: /第一章/ })).toHaveTextContent('5 字')
  })
})
