/**
 * 中栏写作对话流（实现票 T44 / spec #84 US4，Q7 裁决）：
 * 墨舟先问（choice-row 快捷回答）→ 作者作答 → AI 确认 → draft.stream
 * NDJSON 流式渲染草稿片段（打字机渐进 append）。composer 在 provider 未配时
 * 显式 unavailable（Gate 3 纪律：不静默假装可用）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { chapterDraftKey, saveDraftCache } from '../shell/workbenchStorage'
import type { CapabilitiesResponse, DraftQuestionResponse } from '../../server/api'
import type { BookInfo } from '../shell/workbenchStorage'

type DialoguePhase = 'ask' | 'answered' | 'drafting' | 'draft_done' | 'error'

interface WriteBaseFields {
  readonly revision: number
  readonly sha256: string
}

interface CandidateState {
  readonly candidateId: string
  readonly base: WriteBaseFields
  readonly mode: 'replace' | 'continue' | 'insert' | 'replace-selection'
}

/** 采纳前的盘面现场（Undo 一次可逆编辑的数据源）。 */
interface AcceptUndo {
  readonly bookRoot: string
  readonly chapterIndex: number
  readonly oldText: string
  readonly oldRevision: number | null
}

interface ConflictView {
  readonly candidateText: string
  readonly latestText: string
  readonly latestRevision: number | null
}

interface DraftStreamFrame {
  readonly ok: boolean
  readonly event?: 'start' | 'delta' | 'done' | 'error'
  readonly text?: string
  readonly error?: string
  readonly outcome?: string
  readonly partial?: boolean
  readonly chars?: number
  readonly code?: string
  /** start 帧（规格 §12.3：候选证据行）。 */
  readonly contextTokens?: number
  readonly provider?: string
  readonly contextMode?: string
  /** C2（T05）：候选 id 与生成起点 base（服务端取盘面现场返回）。 */
  readonly candidateId?: string
  readonly base?: { readonly revision: number; readonly sha256: string }
}

export function DialogueStream({
  book,
  chapterIndex = 1,
  selection,
}: {
  book: BookInfo | null
  /** 兼容旧调用面缺省第 1 章；生产 App 始终传入当前选中章。 */
  chapterIndex?: number
  /** C2（T05）选择插入/替换：生成开始时选区现场（from/to/selectedTextHash）。
   *  写作面（ProseEditorPanel）接入前保持诚实空态；传入后按 replace-selection 模式生成，
   *  生成期间编辑 → accept 409 → 冲突对比面板（本组件既有冲突恢复路径）。 */
  selection?: { from: number; to: number; selectedTextHash: string }
}): JSX.Element {
  const [phase, setPhase] = useState<DialoguePhase>('ask')
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse['capabilities']>([])
  const [question, setQuestion] = useState<DraftQuestionResponse | null>(null)
  const [answer, setAnswer] = useState('')
  const [draftText, setDraftText] = useState('')
  const [selectedSkills, setSelectedSkills] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [providerUnavailable, setProviderUnavailable] = useState(false)
  const [sending, setSending] = useState(false)
  /** start 帧证据（装配 tokens/provider）——AI CANDIDATE 的来源可追溯性。 */
  const [streamMeta, setStreamMeta] = useState<{ contextTokens?: number; provider?: string } | null>(null)
  /** 采纳进写作层的回执（Candidate → Accept → Active Draft 链）。 */
  const [adoptState, setAdoptState] = useState<string | null>(null)
  /** C2（T05）：候选状态（candidateId+base+mode），随流请求建立；切书/切章/重开即失效。 */
  const [candidate, setCandidate] = useState<CandidateState | null>(null)
  /** 冲突现场：accept 409 时保留双文本 + 最新版本供作者裁决。 */
  const [conflictView, setConflictView] = useState<ConflictView | null>(null)
  /** Undo 一次可逆编辑（accept 前的盘面）。 */
  const [undo, setUndo] = useState<AcceptUndo | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  /** 发起流请求时的书/章现场：迟到响应与切书后身份不符时丢弃（T05 切书隔离）。 */
  const requestSiteRef = useRef<{ bookId: string; chapterIndex: number } | null>(null)


  useEffect(() => {
    if (book === null) return
    void (async () => {
      try {
        const [caps, q] = await Promise.all([
          fetchJson<CapabilitiesResponse>('/api/capabilities', {}),
          fetchJson<DraftQuestionResponse>('/api/draft.question', {}),
        ])
        setCapabilities(caps.capabilities)
        setProviderUnavailable(!caps.providerAvailable)
        setQuestion(q)
      } catch (cause) {
        setError((cause as Error).message)
      }
    })()
  }, [book])

  useEffect(() => {
    return () => { void readerRef.current?.cancel() }
  }, [])

  const handleSend = useCallback(async (): Promise<void> => {
    if (book === null || phase === 'drafting' || sending) return
    const prompt = answer.trim()
    setError(null)
    setSending(true)
    setDraftText('')
    setCandidate(null)
    setConflictView(null)
    setUndo(null)
    // 切书/切章隔离：迟到帧只属于发起现场（T05）
    requestSiteRef.current = { bookId: book.bookId, chapterIndex }
    try {
      const res = await fetch('/api/draft.stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: book.root,
          chapterIndex,
          prompt,
          activeSkills: selectedSkills,
          ...(selection === undefined ? {} : { mode: 'replace-selection', selection }),
          // base 缺省：服务端取盘面现场并在 start 帧回传（UI 以回传值为准）
        }),
      })
      const contentType = res.headers.get('Content-Type') ?? ''
      if (!res.ok) {
        const errorPayload = (await res.json().catch(() => null)) as { error?: string; code?: string } | null
        setError(errorPayload?.error ?? '流式草稿请求失败（HTTP ' + res.status + '）')
        setProviderUnavailable(errorPayload?.code === 'PROVIDER_UNAVAILABLE')
        setPhase('error')
        setSending(false)
        return
      }
      if (contentType.includes('json') && !contentType.includes('ndjson')) {
        const payload = (await res.json()) as { ok?: boolean; error?: string; code?: string }
        if (payload.ok === false || payload.code === 'PROVIDER_UNAVAILABLE') {
          setError(payload.error ?? '草稿生成 provider 未配置')
          setProviderUnavailable(payload.code === 'PROVIDER_UNAVAILABLE')
          setPhase('error')
          setSending(false)
          return
        }
      }
      if (!contentType.includes('ndjson') || !res.body) {
        setError('响应非预期（缺流式 Content-Type）')
        setPhase('error')
        setSending(false)
        return
      }
      setPhase('drafting')
      const reader = res.body.getReader()
      readerRef.current = reader
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          if (line.trim().length === 0) continue
          const frame = JSON.parse(line) as DraftStreamFrame
          // 迟到响应隔离：发起现场与当前书/章不符 → 丢弃该帧（不写入当前新书）
          const site = requestSiteRef.current
          if (book === null || site === null || site.bookId !== book.bookId || site.chapterIndex !== chapterIndex) {
            continue
          }
          if (frame.event === 'start') {
            setStreamMeta({
              ...(frame.contextTokens !== undefined ? { contextTokens: frame.contextTokens } : {}),
              ...(frame.provider !== undefined ? { provider: frame.provider } : {}),
            })
            if (typeof frame.candidateId === 'string' && frame.base !== undefined) {
              setCandidate({ candidateId: frame.candidateId, base: frame.base, mode: selection === undefined ? 'replace' : 'replace-selection' })
            }
          } else if (frame.event === 'delta' && typeof frame.text === 'string') {
            setDraftText((prev) => prev + frame.text)
          } else if (frame.event === 'done') {
            setPhase('draft_done')
          } else if (frame.event === 'error' || frame.ok === false) {
            setError(frame.error ?? '草稿流中断')
            setPhase('error')
          }
        }
      }
      setSending(false)
    } catch (cause) {
      setError((cause as Error).message)
      setPhase('error')
      setSending(false)
    }
  }, [answer, book, chapterIndex, phase, selectedSkills, sending, selection])

  const handleChoice = (choice: string): void => {
    setAnswer(choice)
  }

  const handleNewDraft = (): void => {
    setPhase('ask')
    setDraftText('')
    setError(null)
    setAnswer('')
    setStreamMeta(null)
    setAdoptState(null)
    setCandidate(null)
    setConflictView(null)
    setUndo(null)
    requestSiteRef.current = null
  }

  /** 拉取章快照（accept 前置的盘面现场；Undo 数据源）。 */
  const loadSnapshot = useCallback(async (activeBook: NonNullable<typeof book>): Promise<{ body: string; revision: number | null }> => {
    const res = await fetch('/api/chapter.prose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: activeBook.root, chapterIndex }),
    })
    const data = (await res.json()) as { ok?: boolean; exists?: boolean; body?: string; revision?: number; error?: string }
    if (!res.ok || data.ok !== true) throw new Error(data.error ?? '章快照读取失败')
    return { body: data.body ?? '', revision: data.exists === false ? null : (data.revision ?? null) }
  }, [chapterIndex])

  /** C2（T05）Accept：调用 /api/draft.accept 真实落盘（不再先改 localStorage 却称已落盘）。
   *  成功 → 刷新章快照到本地写作缓存 + 通知 Reading Slate + 记录一次可逆 Undo；
   *  409 冲突 → 保留两份文本（候选 vs 最新盘面），交作者裁决。 */
  const handleAccept = useCallback(async (): Promise<void> => {
    if (book === null || candidate === null) return
    setError(null)
    setAdoptState(null)
    let oldSnapshot: { body: string; revision: number | null }
    try {
      oldSnapshot = await loadSnapshot(book)
    } catch (cause) {
      setError((cause as Error).message)
      return
    }
    try {
      const res = await fetch('/api/draft.accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: book.root,
          candidateId: candidate.candidateId,
          base: candidate.base,
          idempotencyKey: 'ui_accept_' + candidate.candidateId,
        }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        revision?: number
        sha256?: string
        alreadyApplied?: boolean
        code?: string
        error?: string
      }
      if (res.ok && data.ok === true) {
        // 成功后以服务端回读正文刷新写作层缓存（采纳后盘上正文为准）
        const readback = await loadSnapshot(book)
        saveDraftCache(readback.body, chapterDraftKey(book, chapterIndex))
        window.dispatchEvent(new CustomEvent('mozhou:prose-adopted', { detail: { bookId: book.bookId, chapterIndex } }))
        setUndo({ bookRoot: book.root, chapterIndex, oldText: oldSnapshot.body, oldRevision: oldSnapshot.revision })
        setAdoptState(
          data.alreadyApplied === true
            ? `已采纳（幂等重放命中，不重复写入）——第 ${chapterIndex} 章服务端 r${String(data.revision)}`
            : `已采纳进正文 — 服务端 r${String(data.revision)} · ${book.title} 第 ${chapterIndex} 章 Active Draft 已刷新，可在 Reading Slate 继续编辑`,
        )
        return
      }
      if (res.status === 409) {
        // 冲突：候选文本保留（UI 内存+服务端候选区），展示差异
        const latest = await loadSnapshot(book)
        setConflictView({ candidateText: draftText, latestText: latest.body, latestRevision: latest.revision })
        setAdoptState(null)
        return
      }
      setError(data.error ?? '采纳失败（HTTP ' + res.status + '）')
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [book, candidate, chapterIndex, draftText, loadSnapshot])

  /** 冲突裁决：作者读最新版并明确确认后，以最新盘面现场重新生成候选（再走 accept）。
   *  旧候选文本保留在服务端候选区，可人工复制。 */
  const handleRetryAcceptWithLatest = useCallback(async (): Promise<void> => {
    if (book === null || conflictView === null) return
    if (!window.confirm('以最新版本（r' + String(conflictView.latestRevision) + '）为基准重新生成候选？当前候选将被放弃（文本保留在候选区可复制）。')) return
    setConflictView(null)
    setDraftText('')
    setCandidate(null)
    setPhase('answered')
    await handleSend()
  }, [book, conflictView, handleSend])

  /** 冲突双文本：复制候选文本到剪贴板。 */
  const handleCopyCandidate = useCallback(async (): Promise<void> => {
    if (conflictView === null) return
    await navigator.clipboard.writeText(conflictView.candidateText).catch(() => undefined)
  }, [conflictView])

  /** Undo：一次可逆编辑——以新 revision 保存采纳前文本（不倒退服务器历史）。 */
  const handleUndoAccept = useCallback(async (): Promise<void> => {
    if (book === null || undo === null) return
    const latest = await loadSnapshot(book)
    try {
      const res = await fetch('/api/chapter.prose.save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: book.root,
          chapterIndex,
          body: undo.oldText,
          expectedRevision: latest.revision,
        }),
      })
      const data = (await res.json()) as { ok?: boolean; revision?: number; error?: string }
      if (res.ok && data.ok === true) {
        saveDraftCache(undo.oldText, chapterDraftKey(book, chapterIndex))
        window.dispatchEvent(new CustomEvent('mozhou:prose-adopted', { detail: { bookId: book.bookId, chapterIndex } }))
        setUndo(null)
        setAdoptState('已撤销采纳（新 revision 保存，不倒退服务端历史）')
      } else {
        setError(data.error ?? '撤销保存失败')
      }
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [book, chapterIndex, loadSnapshot, undo])

  const toggleSkill = (skillId: string): void => {
    setSelectedSkills((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId],
    )
  }

  if (book === null) {
    return (
      <div className="msg ai" data-testid="dialogue-no-book">
        <div className="avatar">舟</div>
        <div className="bubble">
          先建书，再开始第一条航线的对话。
          <span className="hint">Wizard 或下方建书卡任一方式即可。</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="date-rule">CHAPTER {chapterIndex} PRODUCTION SESSION · 对话流 T44</div>

      {providerUnavailable && (
        <div className="wb-error" role="alert" data-testid="provider-unavailable">
          草稿生成 provider 未配置——中栏写作对话当前不可用（Gate 3）。配置后无需刷新即可继续。
        </div>
      )}

      <div className="msg ai">
        <div className="avatar">舟</div>
        <div className="bubble">
          {question !== null && (
            <>
              <strong>{question.question}</strong>
              <br />
              <span className="hint">{question.hint}</span>
              {phase === 'ask' && (
                <div className="choice-row">
                  {question.choices.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      className="choice"
                      aria-pressed={answer === choice}
                      onClick={() => handleChoice(choice)}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {phase === 'answered' || phase === 'drafting' || phase === 'draft_done' ? (
        <div className="msg user">
          <div className="bubble">{answer}</div>
          <div className="avatar">我</div>
        </div>
      ) : null}

      {(phase === 'drafting' || phase === 'draft_done') && (
        <article className="draft-slice candidate" data-testid="draft-slice">
          <div className="kicker">
            <span className="candidate-tag">AI CANDIDATE · {phase === 'drafting' ? 'STREAMING · 渲染中' : 'DONE · 完成'}</span>
            {streamMeta !== null && (
              <span className="mono muted" style={{ marginLeft: 8, fontSize: 10 }}>
                start · {streamMeta.contextTokens !== undefined ? `${streamMeta.contextTokens} tok` : 'context —'}
                {streamMeta.provider !== undefined ? ` · ${streamMeta.provider}` : ''}
              </span>
            )}
          </div>
          <p data-testid="draft-text" className={phase === 'drafting' ? 'stream-caret' : undefined}>{draftText}</p>
          {phase === 'draft_done' && (
            <>
              <p className="mono muted" style={{ margin: '6px 0 0', fontSize: 10 }}>
                候选已就绪（未写入正文）——采纳经服务端受控事务（CAS + 幂等），质量门常驻，Accepted ≠ Committed。
              </p>
              {adoptState !== null && (
                <p role="status" className="mono" style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--success)' }} data-testid="adopt-state">
                  {adoptState}
                </p>
              )}
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-author btn-sm" data-testid="adopt-into-slate" onClick={() => { void handleAccept() }} disabled={candidate === null}>
                  采纳进正文（Accept → Active Draft）
                </button>
                {undo !== null && (
                  <button type="button" className="btn btn-sm" data-testid="undo-accept" onClick={() => { void handleUndoAccept() }}>
                    撤销采纳（Undo）
                  </button>
                )}
              </div>
            </>
          )}

          {conflictView !== null && (
            <div className="wb-conflict" data-testid="accept-conflict" style={{ marginTop: 10, border: '1px solid var(--warn)', padding: 10, borderRadius: 8 }}>
              <p role="alert" style={{ margin: 0, fontWeight: 600 }}>
                采纳冲突：生成期间正文已被修改（基础版本过期，r{String(conflictView.latestRevision ?? '—')}）。
              </p>
              <p style={{ margin: '6px 0', fontSize: 12 }}>
                两份文本都已保留，未覆盖任何内容。请选择：读最新正文 → 以最新现场重新生成；或复制候选文本自行处理。
              </p>
              <details style={{ margin: '6px 0', fontSize: 12 }}>
                <summary>查看差异（候选 vs 最新盘上正文）</summary>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                  <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--bg-soft)', padding: 8, borderRadius: 6, margin: 0 }} data-testid="conflict-candidate">{conflictView.candidateText}</pre>
                  <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--bg-soft)', padding: 8, borderRadius: 6, margin: 0 }} data-testid="conflict-latest">{conflictView.latestText}</pre>
                </div>
              </details>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm" data-testid="conflict-regenerate" onClick={() => { void handleRetryAcceptWithLatest() }}>
                  读最新 → 以最新现场重新生成
                </button>
                <button type="button" className="btn btn-sm" data-testid="conflict-copy-candidate" onClick={() => { void handleCopyCandidate() }}>
                  复制候选文本
                </button>
              </div>
            </div>
          )}
        </article>
      )}

      {error !== null && (
        <p className="wb-error" role="alert">
          错误：{error}
        </p>
      )}

      {(phase === 'draft_done' || phase === 'error') && (
        <div className="actions">
          <button className="btn" onClick={handleNewDraft}>
            再来一轮
          </button>
        </div>
      )}

      <div className="composer-wrap">
        <div className="rails" data-testid="rails">
          <div className="rail">
            <span className="rail-label">技能</span>
            {capabilities.map((cap) => (
              <button
                key={cap.id}
                type="button"
                className={'pill' + (selectedSkills.includes(cap.id) ? ' on' : '')}
                aria-pressed={selectedSkills.includes(cap.id)}
                onClick={() => toggleSkill(cap.id)}
                disabled={providerUnavailable}
              >
                {cap.label}
              </button>
            ))}
          </div>
          <div className="rail">
            <span className="rail-label">风格</span>
            <button type="button" className="pill radio on" disabled>
              未接入（V1 空态）
            </button>
            <span className="rail-hint">风格胶囊数据源未到，显式空态</span>
          </div>
        </div>

        <div className="composer-shell">
          <div className="composer">
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
              disabled={sending || phase === 'drafting' || providerUnavailable}
              placeholder={providerUnavailable ? '草稿 provider 未接入——此处不可用' : '回答墨舟，或描述下一段需要发生什么…'}
              aria-label="写作指令"
            />
            <button
              className="send"
              aria-label="发送"
              onClick={() => { void handleSend() }}
              disabled={sending || phase === 'drafting' || providerUnavailable || answer.trim().length === 0}
            >
              ↑
            </button>
            <div className="composer-foot">
              <span>已注入 {selectedSkills.length} 项技能 · 风格未接入 · 质量门常驻</span>
              <span>⌘ Enter 发送</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

async function fetchJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as { ok?: boolean; error?: string } & T
  if (!res.ok || data.ok === false) {
    throw new Error(data.error ?? '请求失败 (HTTP ' + res.status + ')')
  }
  return data
}
