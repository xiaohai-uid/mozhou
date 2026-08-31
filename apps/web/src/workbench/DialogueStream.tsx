/**
 * 中栏写作对话流（实现票 T44 / spec #84 US4，Q7 裁决）：
 * 墨舟先问（choice-row 快捷回答）→ 作者作答 → AI 确认 → draft.stream
 * NDJSON 流式渲染草稿片段（打字机渐进 append）。composer 在 provider 未配时
 * 显式 unavailable（Gate 3 纪律：不静默假装可用）。
 *
 * 数据面（/api 中间件直出，组件 type-only 直引契约形状，零 any）：
 * - /api/capabilities   → 技能多选胶囊列表
 * - /api/draft.question → 墨舟先问（V1 mock）
 * - /api/draft.stream   → NDJSON 流式草稿（start/delta/done 帧，error 帧）
 *
 * 双胶囊轨：技能多选选中集随请求注入 draft.stream；风格单选 V1 显式空态
 * 「未接入」（styleProfile 数据源未到，不假装可用）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CapabilitiesResponse, DraftQuestionResponse } from '../../server/api'
import type { BookInfo } from '../shell/workbenchStorage'

type DialoguePhase = 'ask' | 'answered' | 'drafting' | 'draft_done' | 'error'

interface DraftStreamFrame {
  readonly ok: boolean
  readonly event?: 'start' | 'delta' | 'done' | 'error'
  readonly text?: string
  readonly error?: string
  readonly outcome?: string
  readonly partial?: boolean
  readonly chars?: number
  readonly code?: string
}

export function DialogueStream({
  book,
}: {
  book: BookInfo | null
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
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

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

  /** 发送：把作者回答送进 draft.stream，逐 NDJSON 帧渐进渲染。 */
  const handleSend = useCallback(async (): Promise<void> => {
    if (book === null || phase === 'drafting' || sending) return
    const prompt = answer.trim()
    setError(null)
    setSending(true)
    setDraftText('')
    try {
      const res = await fetch('/api/draft.stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: book.root,
          chapterIndex: 1,
          prompt,
          skills: selectedSkills,
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
          if (frame.event === 'delta' && typeof frame.text === 'string') {
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
  }, [answer, book, phase, selectedSkills, sending])

  const handleChoice = (choice: string): void => {
    setAnswer(choice)
  }

  const handleNewDraft = (): void => {
    setPhase('ask')
    setDraftText('')
    setError(null)
    setAnswer('')
  }

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
      <div className="date-rule">CHAPTER PRODUCTION SESSION · 对话流 T44</div>

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
        <article className="draft-slice" data-testid="draft-slice">
          <div className="kicker">DRAFT STREAM · {phase === 'drafting' ? '渲染中' : '完成'}</div>
          <p data-testid="draft-text">{draftText}</p>
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
              <span>
                已注入 {selectedSkills.length} 项技能 · 风格未接入 · 质量门常驻
              </span>
              <span>⌘ Enter 发送</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/** JSON 契约助手（与 lib/post 同语义；组件内聚避免二次依赖）。 */
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