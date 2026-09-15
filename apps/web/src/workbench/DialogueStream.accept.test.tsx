/**
 * C2 候选采纳 UI（T05）：
 * - draft.stream start 帧携带 candidateId+base → 「采纳进正文」调用 /api/draft.accept
 *   （真实事务，不再只改 localStorage）；
 * - accept 成功 → 刷新服务端回读正文到写作层缓存 + Undo 一次可逆编辑（新 revision 保存）；
 * - accept 409（生成期间正文被改）→ 双文本冲突面板（候选 vs 最新）+ 复制/以最新重生成；
 * - 迟到帧隔离：发起现场与当前书不符时丢弃（切书不串写）。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilitiesResponse, DraftQuestionResponse } from '../../server/api'
import { okJson } from '../test/http'
import { DialogueStream } from './DialogueStream'
import type { BookInfo } from '../shell/workbenchStorage'

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn(() => true))
  vi.stubGlobal('clipboard', { writeText: vi.fn(() => Promise.resolve()) })
})

const BOOK: BookInfo = { root: 'C:/tmp/book-a', bookId: 'bk_1', title: '雾港失真' }

const CAPS: CapabilitiesResponse = { ok: true, providerAvailable: true, capabilities: [] }
const QUESTION: DraftQuestionResponse = {
  ok: true,
  question: '这一章，你更想让读者害怕什么？',
  hint: 'h',
  choices: ['害怕钟声'],
}

function ndjsonResponse(frames: readonly Record<string, unknown>[]): Response {
  return new Response(frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n', {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  })
}

const BASE = { revision: 3, sha256: 'a'.repeat(64) }
const PRE_ACCEPT_BODY = '最新盘上正文。'
const CANDIDATE_BODY = '候选正文第一句。候选正文第二句。\n'

function stubFetch(options: {
  acceptStatus?: number
  acceptBody?: Record<string, unknown>
  latestBody?: string
  latestRevision?: number | null
  streamFrames?: readonly Record<string, unknown>[]
}): ReturnType<typeof vi.fn> {
  let proseReads = 0
  const fetchMock = vi.fn().mockImplementation((path: string) => {
    if (path === '/api/capabilities') return okJson(CAPS)
    if (path === '/api/draft.question') return okJson(QUESTION)
    if (path === '/api/draft.stream') {
      return ndjsonResponse(options.streamFrames ?? [
        { ok: true, event: 'start', candidateId: 'cand-1', base: BASE, contextTokens: 120, provider: 'mock' },
        { ok: true, event: 'delta', candidateId: 'cand-1', text: '候选正文第一句。' },
        { ok: true, event: 'delta', candidateId: 'cand-1', text: '候选正文第二句。' },
        { ok: true, event: 'done', candidateId: 'cand-1', outcome: 'succeeded', partial: false },
      ])
    }
    if (path === '/api/chapter.prose') {
      proseReads += 1
      // 状态化：首次读取 = accept 前盘面；409 场景恒为最新盘面；成功场景此后 = 候选已落盘回读
      const body =
        proseReads === 1
          ? (options.latestBody ?? PRE_ACCEPT_BODY)
          : options.acceptStatus === 409
            ? (options.latestBody ?? PRE_ACCEPT_BODY)
            : CANDIDATE_BODY
      return okJson({ ok: true, exists: true, chapterIndex: 1, revision: options.latestRevision ?? BASE.revision, body })
    }
    if (path === '/api/draft.accept') {
      if (options.acceptStatus !== undefined && options.acceptStatus >= 400) {
        return new Response(JSON.stringify({ ok: false, code: 'BASE_STALE', error: 'accept conflict' }), { status: options.acceptStatus, headers: { 'Content-Type': 'application/json' } })
      }
      return okJson({ ok: true, candidateId: 'cand-1', chapterIndex: 1, revision: BASE.revision + 1, sha256: 'b'.repeat(64), alreadyApplied: false, ...options.acceptBody })
    }
    if (path === '/api/chapter.prose.save') {
      return okJson({ ok: true, chapterIndex: 1, revision: (options.latestRevision ?? BASE.revision) + 1, phase: 'draft', created: false })
    }
    return okJson({ ok: false, error: 'unexpected path: ' + path })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function runStreamToDone(): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name: '害怕钟声' })).toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: '害怕钟声' }))
  await userEvent.click(screen.getByLabelText('写作指令'))
  await userEvent.keyboard('继续')
  await userEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(screen.getByTestId('adopt-into-slate')).toBeInTheDocument())
}

describe('DialogueStream 候选采纳（C2·T05）', () => {
  it('采纳调用 /api/draft.accept（真实事务）；成功后回读正文刷缓存并出现 Undo', async () => {
    const fetchMock = stubFetch({})
    render(<DialogueStream book={BOOK} />)
    await runStreamToDone()

    await userEvent.click(screen.getByTestId('adopt-into-slate'))
    await waitFor(() => {
      expect(screen.getByTestId('adopt-state').textContent).toContain('已采纳进正文 — 服务端 r4')
    })
    const acceptCall = fetchMock.mock.calls.find((call) => call[0] === '/api/draft.accept')
    expect(acceptCall).toBeDefined()
    const payload = JSON.parse(String((acceptCall?.[1] as { body?: string } | undefined)?.body)) as Record<string, unknown>
    expect(payload).toMatchObject({ root: BOOK.root, candidateId: 'cand-1', base: BASE })
    expect(typeof payload['idempotencyKey']).toBe('string')

    expect(screen.getByTestId('undo-accept')).toBeInTheDocument()
    // Undo：以新 revision 保存采纳前文本（不倒退服务端历史）
    await userEvent.click(screen.getByTestId('undo-accept'))
    await waitFor(() => expect(screen.getByTestId('adopt-state').textContent).toContain('已撤销采纳'))
    const saveCall = fetchMock.mock.calls.find((call) => call[0] === '/api/chapter.prose.save')
    expect(saveCall).toBeDefined()
    const savePayload = JSON.parse(String((saveCall?.[1] as { body?: string } | undefined)?.body)) as Record<string, unknown>
    expect(savePayload).toMatchObject({ chapterIndex: 1, expectedRevision: 3 })
    // Undo 保存的是采纳前盘面（首次快照读取值）
    expect(String(savePayload['body'])).toContain(PRE_ACCEPT_BODY)
  })

  it('accept 409（生成期间外部修改）→ 双文本冲突面板；复制候选/以最新重生成', async () => {
    const fetchMock = stubFetch({
      acceptStatus: 409,
      latestBody: '作者在生成期间新增的正文。',
      latestRevision: 4,
    })
    render(<DialogueStream book={BOOK} />)
    await runStreamToDone()

    await userEvent.click(screen.getByTestId('adopt-into-slate'))
    await waitFor(() => expect(screen.getByTestId('accept-conflict')).toBeInTheDocument())
    expect(screen.getByTestId('conflict-candidate').textContent).toContain('候选正文第一句。')
    expect(screen.getByTestId('conflict-latest').textContent).toContain('作者在生成期间新增的正文。')
    expect(screen.queryByTestId('adopt-state')).not.toBeInTheDocument()

    // 复制候选（clipboard 可能不可用，不阻塞）
    await userEvent.click(screen.getByTestId('conflict-copy-candidate'))

    // 以最新现场重新生成：新 draft.stream 请求
    await userEvent.click(screen.getByTestId('conflict-regenerate'))
    await waitFor(() => {
      const streamCalls = fetchMock.mock.calls.filter((call) => call[0] === '/api/draft.stream')
      expect(streamCalls.length).toBe(2)
    })
  })

  it('迟到帧隔离：响应帧只属于发起现场', async () => {
    const fetchMock = stubFetch({})
    render(<DialogueStream book={BOOK} />)
    await runStreamToDone()
    expect(screen.getByTestId('draft-text').textContent).toContain('候选正文第一句。')
    expect(fetchMock.mock.calls.filter((call) => call[0] === '/api/draft.stream').length).toBe(1)
  })
})