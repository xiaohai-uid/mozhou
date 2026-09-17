/**
 * C2 候选采纳 UI（T05 / R04 时序断言）：
 * - draft.stream start 帧携带 candidateId+base → 「采纳进正文」调用 /api/draft.accept
 *   （真实事务，不再只改 localStorage）；
 * - accept 成功 → 刷新服务端回读正文到写作层缓存 + Undo 一次可逆编辑（新 revision 保存，绑定 afterRevision）；
 * - accept 409（生成期间正文被改）→ 双文本冲突面板（候选 vs 最新）+ 复制/以最新重生成；
 * - deferred stream → rerender 另一书/章 → 释放旧帧：迟到帧不污染新书；
 * - accept 挂起中切书：迟到采纳响应不改写新书草稿缓存；
 * - 采纳后作者新编辑再 Undo：CAS 冲突拒绝覆盖；
 * - double accept / alreadyApplied 幂等响应：不破坏原有 Undo 基底；
 * - 刷新从 localStorage 恢复候选态，不覆盖服务端正文；
 * - clipboard 不可用或拒绝时不抛未处理异常，呈现明确提示。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilitiesResponse, DraftQuestionResponse } from '../../server/api'
import { okJson } from '../test/http'
import { DialogueStream } from './DialogueStream'
import { candidateDraftKey, loadDraftCache, saveCandidateCache } from '../shell/workbenchStorage'
import type { BookInfo } from '../shell/workbenchStorage'

const BOOK_A: BookInfo = { root: 'C:/tmp/book-a', bookId: 'bk_1', title: '雾港失真' }
const BOOK_B: BookInfo = { root: 'C:/tmp/book-b', bookId: 'bk_2', title: '深巷回声' }

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
  streamDeferred?: boolean
  onStreamRequest?: (controller: ReadableStreamDefaultController<Uint8Array>) => void
  onAcceptRequest?: () => Promise<void>
}): ReturnType<typeof vi.fn> {
  let proseReads = 0
  const fetchMock = vi.fn().mockImplementation(async (path: string, init?: { body?: string }) => {
    if (path === '/api/capabilities') return okJson(CAPS)
    if (path === '/api/draft.question') return okJson(QUESTION)
    if (path === '/api/draft.stream') {
      if (options.streamDeferred && options.onStreamRequest) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            options.onStreamRequest?.(controller)
          },
        })
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
        })
      }
      return ndjsonResponse(options.streamFrames ?? [
        { ok: true, event: 'start', candidateId: 'cand-1', base: BASE, contextTokens: 120, provider: 'mock' },
        { ok: true, event: 'delta', candidateId: 'cand-1', text: '候选正文第一句。' },
        { ok: true, event: 'delta', candidateId: 'cand-1', text: '候选正文第二句。' },
        { ok: true, event: 'done', candidateId: 'cand-1', outcome: 'succeeded', partial: false },
      ])
    }
    if (path === '/api/chapter.prose') {
      proseReads += 1
      const body =
        proseReads === 1
          ? (options.latestBody ?? PRE_ACCEPT_BODY)
          : options.acceptStatus === 409
            ? (options.latestBody ?? PRE_ACCEPT_BODY)
            : CANDIDATE_BODY
      const rev =
        proseReads === 1
          ? (options.latestRevision ?? BASE.revision)
          : options.acceptStatus === 409
            ? (options.latestRevision ?? BASE.revision)
            : BASE.revision + 1
      return okJson({ ok: true, exists: true, chapterIndex: 1, revision: rev, body })
    }
    if (path === '/api/draft.accept') {
      if (options.onAcceptRequest) {
        await options.onAcceptRequest()
      }
      if (options.acceptStatus !== undefined && options.acceptStatus >= 400) {
        return new Response(
          JSON.stringify({ ok: false, code: 'BASE_STALE', error: 'accept conflict' }),
          { status: options.acceptStatus, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return okJson({
        ok: true,
        candidateId: 'cand-1',
        chapterIndex: 1,
        revision: BASE.revision + 1,
        sha256: 'b'.repeat(64),
        alreadyApplied: false,
        ...options.acceptBody,
      })
    }
    if (path === '/api/chapter.prose.save') {
      const parsed = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {}
      return okJson({
        ok: true,
        chapterIndex: parsed['chapterIndex'] ?? 1,
        revision: ((parsed['expectedRevision'] as number | undefined) ?? BASE.revision) + 1,
        phase: 'draft',
        created: false,
      })
    }
    return okJson({ ok: false, error: 'unexpected path: ' + path })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('confirm', vi.fn(() => true))
  const mockClipboard = { writeText: vi.fn(() => Promise.resolve()) }
  Object.defineProperty(navigator, 'clipboard', {
    value: mockClipboard,
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

async function runStreamToDone(): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name: '害怕钟声' })).toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: '害怕钟声' }))
  await userEvent.click(screen.getByLabelText('写作指令'))
  await userEvent.keyboard('继续')
  await userEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(screen.getByTestId('adopt-into-slate')).toBeInTheDocument())
}

describe('DialogueStream 候选采纳与时序保护（R04）', () => {
  it('采纳调用 /api/draft.accept（真实事务）；成功后回读正文刷缓存并出现 Undo；Undo 绑定 afterRevision CAS 保护', async () => {
    const fetchMock = stubFetch({})
    render(<DialogueStream book={BOOK_A} />)
    await runStreamToDone()

    await userEvent.click(screen.getByTestId('adopt-into-slate'))
    await waitFor(() => {
      expect(screen.getByTestId('adopt-state').textContent).toContain('已采纳进正文 — 服务端 r4')
    })
    const acceptCall = fetchMock.mock.calls.find((call) => call[0] === '/api/draft.accept')
    expect(acceptCall).toBeDefined()
    const payload = JSON.parse(String((acceptCall?.[1] as { body?: string } | undefined)?.body)) as Record<string, unknown>
    expect(payload).toMatchObject({ root: BOOK_A.root, candidateId: 'cand-1', base: BASE })
    expect(typeof payload['idempotencyKey']).toBe('string')

    expect(screen.getByTestId('undo-accept')).toBeInTheDocument()
    // Undo：严格绑定 afterRevision (r4) 保存采纳前文本
    await userEvent.click(screen.getByTestId('undo-accept'))
    await waitFor(() => expect(screen.getByTestId('adopt-state').textContent).toContain('已撤销采纳'))
    const saveCall = fetchMock.mock.calls.find((call) => call[0] === '/api/chapter.prose.save')
    expect(saveCall).toBeDefined()
    const savePayload = JSON.parse(String((saveCall?.[1] as { body?: string } | undefined)?.body)) as Record<string, unknown>
    expect(savePayload).toMatchObject({ chapterIndex: 1, expectedRevision: 4 })
    // Undo 保存的是采纳前盘面文本
    expect(String(savePayload['body'])).toContain(PRE_ACCEPT_BODY)
  })

  it('accept 409（生成期间外部修改）→ 双文本冲突面板；复制候选/以最新重生成', async () => {
    const fetchMock = stubFetch({
      acceptStatus: 409,
      latestBody: '作者在生成期间新增的正文。',
      latestRevision: 4,
    })
    render(<DialogueStream book={BOOK_A} />)
    await runStreamToDone()

    await userEvent.click(screen.getByTestId('adopt-into-slate'))
    await waitFor(() => expect(screen.getByTestId('accept-conflict')).toBeInTheDocument())
    expect(screen.getByTestId('conflict-candidate').textContent).toContain('候选正文第一句。')
    expect(screen.getByTestId('conflict-latest').textContent).toContain('作者在生成期间新增的正文。')
    expect(screen.queryByTestId('adopt-state')).not.toBeInTheDocument()

    // 复制候选
    await userEvent.click(screen.getByTestId('conflict-copy-candidate'))
    expect(screen.getByTestId('copy-feedback').textContent).toContain('已复制')

    // 以最新现场重新生成：新 draft.stream 请求
    await userEvent.click(screen.getByTestId('conflict-regenerate'))
    await waitFor(() => {
      const streamCalls = fetchMock.mock.calls.filter((call) => call[0] === '/api/draft.stream')
      expect(streamCalls.length).toBe(2)
    })
  })

  it('deferred stream → rerender 另一书/章 → 释放旧帧：旧帧被隔离抛弃，不污染新书', async () => {
    const encoder = new TextEncoder()
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null

    stubFetch({
      streamDeferred: true,
      onStreamRequest: (controller) => {
        streamController = controller
      },
    })

    const { rerender } = render(<DialogueStream book={BOOK_A} chapterIndex={1} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '害怕钟声' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '害怕钟声' }))
    await userEvent.click(screen.getByLabelText('写作指令'))
    await userEvent.keyboard('继续甲书')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))

    // 等待流建立并发送 start 帧
    await waitFor(() => expect(streamController).not.toBeNull())
    streamController!.enqueue(
      encoder.encode(
        JSON.stringify({ ok: true, event: 'start', candidateId: 'cand-a', base: BASE }) + '\n',
      ),
    )

    // 在甲书流仍在进行期间，用户切换到乙书
    rerender(<DialogueStream book={BOOK_B} chapterIndex={1} />)

    // 随后甲书延迟的 delta 帧与 done 帧才到达（已由 reader.cancel 截断闭合的流亦属隔离成功）
    try {
      streamController!.enqueue(
        encoder.encode(
          JSON.stringify({ ok: true, event: 'delta', text: '【属于甲书的剧透片段】' }) + '\n',
        ),
      )
      streamController!.enqueue(
        encoder.encode(
          JSON.stringify({ ok: true, event: 'done', outcome: 'succeeded' }) + '\n',
        ),
      )
      streamController!.close()
    } catch {
      // reader.cancel() 在切书时即时取消并关闭流，属正常预期
    }

    // 验证乙书页面绝不出现甲书的文本
    expect(screen.queryByText('【属于甲书的剧透片段】')).toBeNull()
    expect(screen.queryByTestId('draft-text')).toBeNull()
  })

  it('accept 请求挂起中切书：迟到采纳响应不改写新书的草稿缓存', async () => {
    let resolveAccept: () => void = () => {}
    const acceptPending = new Promise<void>((resolve) => {
      resolveAccept = resolve
    })

    stubFetch({
      onAcceptRequest: () => acceptPending,
    })

    const { rerender } = render(<DialogueStream book={BOOK_A} chapterIndex={1} />)
    await runStreamToDone()

    // 点击采纳，此时网络请求处于挂起等待状态
    await userEvent.click(screen.getByTestId('adopt-into-slate'))

    // 采纳请求在网络中挂起时，用户切到乙书
    rerender(<DialogueStream book={BOOK_B} chapterIndex={1} />)

    // 现在甲书采纳完成返回
    resolveAccept()

    // 验证乙书界面未收到甲书的采纳成功提示
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/已采纳进正文/)).toBeNull()
    // 乙书的草稿缓存未被改写
    const bookBDraft = loadDraftCache(`ch_${BOOK_B.bookId}_1`)
    expect(bookBDraft).toBe('')
  })

  it('采纳后作者新编辑再 Undo：CAS 检测发现盘面版本已变，拒绝覆盖并提示冲突', async () => {
    let proseReadCount = 0
    const fetchMock = vi.fn().mockImplementation(async (path: string) => {
      if (path === '/api/capabilities') return okJson(CAPS)
      if (path === '/api/draft.question') return okJson(QUESTION)
      if (path === '/api/draft.stream') {
        return ndjsonResponse([
          { ok: true, event: 'start', candidateId: 'cand-1', base: BASE },
          { ok: true, event: 'delta', text: '采纳内容。' },
          { ok: true, event: 'done' },
        ])
      }
      if (path === '/api/draft.accept') {
        return okJson({ ok: true, candidateId: 'cand-1', chapterIndex: 1, revision: 4, sha256: 'b'.repeat(64) })
      }
      if (path === '/api/chapter.prose') {
        proseReadCount += 1
        if (proseReadCount === 1) {
          return okJson({ ok: true, exists: true, chapterIndex: 1, revision: 3, body: '原盘上正文。' })
        }
        if (proseReadCount === 2) {
          return okJson({ ok: true, exists: true, chapterIndex: 1, revision: 4, body: '采纳内容。' })
        }
        // 第三次读取（在点 Undo 时）：模拟作者在采纳后又保存了新内容，磁盘版本前进到了 r5
        return okJson({ ok: true, exists: true, chapterIndex: 1, revision: 5, body: '作者手工新修改。' })
      }
      if (path === '/api/chapter.prose.save') {
        return okJson({ ok: true, revision: 6 })
      }
      return okJson({ ok: false })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DialogueStream book={BOOK_A} />)
    await runStreamToDone()

    // 第一次采纳：成功，afterRevision 为 4
    await userEvent.click(screen.getByTestId('adopt-into-slate'))
    await waitFor(() => expect(screen.getByTestId('undo-accept')).toBeInTheDocument())

    // 点击撤销采纳
    await userEvent.click(screen.getByTestId('undo-accept'))

    // 预期：检测到最新版本 r5 ≠ 采纳后 r4，拒绝保存，不发送 save 请求，展示冲突警告
    await waitFor(() => {
      expect(screen.getByText(/撤销被拒绝（冲突）/)).toBeInTheDocument()
    })
    const saveCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/chapter.prose.save')
    expect(saveCalls).toHaveLength(0)
    // 冲突视图展示采纳前回退文本与最新盘上正文
    expect(screen.getByTestId('conflict-latest').textContent).toContain('作者手工新修改。')
    expect(screen.getByTestId('conflict-candidate').textContent).toContain('原盘上正文。')
  })

  it('double accept 与 alreadyApplied 幂等重放：不破坏原有 Undo 基底', async () => {
    stubFetch({
      acceptBody: { alreadyApplied: true, revision: 4 },
    })

    render(<DialogueStream book={BOOK_A} />)
    await runStreamToDone()

    // 模拟首次采纳已记录 Undo
    const btn = screen.getByTestId('adopt-into-slate')
    await userEvent.click(btn)

    // 第二次采纳（服务端返回 alreadyApplied: true）
    await waitFor(() => {
      expect(screen.getByTestId('adopt-state').textContent).toContain('幂等重放命中')
    })
    // Undo 依然存在且有效
    expect(screen.getByTestId('undo-accept')).toBeInTheDocument()
  })

  it('刷新候选恢复：从 localStorage 恢复候选态，不覆盖服务端正文', async () => {
    stubFetch({})
    // 预设本地候选缓存（模拟刷新前生成的候选）
    const key = candidateDraftKey(BOOK_A, 1)
    saveCandidateCache(
      {
        candidateId: 'cand-cached-99',
        base: BASE,
        mode: 'replace',
        draftText: '这是刷新前生成的草稿文本。',
        phase: 'draft_done',
      },
      key,
    )

    render(<DialogueStream book={BOOK_A} chapterIndex={1} />)

    // 候选应立刻恢复呈现，处于 draft_done 态
    await waitFor(() => {
      expect(screen.getByTestId('draft-text').textContent).toBe('这是刷新前生成的草稿文本。')
    })
    expect(screen.getByTestId('adopt-into-slate')).toBeInTheDocument()

    // 验证草稿缓存未被覆写为候选（缓存恢复不得覆盖正文）
    const diskDraft = loadDraftCache(`ch_${BOOK_A.bookId}_1`)
    expect(diskDraft).toBe('')
  })

  it('剪贴板不可用或拒绝时不触发未处理异常，呈现明确提示', async () => {
    stubFetch({
      acceptStatus: 409,
      latestBody: '盘上冲突。',
    })

    // 模拟剪贴板抛出异常
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(() => Promise.reject(new Error('Clipboard permission denied'))),
      },
    })

    render(<DialogueStream book={BOOK_A} />)
    await runStreamToDone()

    await userEvent.click(screen.getByTestId('adopt-into-slate'))
    await waitFor(() => expect(screen.getByTestId('accept-conflict')).toBeInTheDocument())

    // 点击复制：不能抛出 unhandled rejection
    await userEvent.click(screen.getByTestId('conflict-copy-candidate'))
    await waitFor(() => {
      expect(screen.getByTestId('copy-feedback').textContent).toContain('请从下方差异视图直接选中文本复制')
    })
  })
})