/**
 * 中栏写作对话流（实现票 T44 / spec #84 US4，Q7 裁决）：
 * 墨舟先问（choice-row 快捷回答）→ 作者作答 → AI 确认 → draft.stream
 * NDJSON 流式渲染草稿片段（打字机渐进 append）。composer 在 provider 未配时
 * 显式 unavailable（Gate 3 纪律：不静默假装可用）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  candidateDraftKey,
  chapterDraftKey,
  loadCandidateCache,
  saveCandidateCache,
  saveDraftBaseline,
  saveDraftCache,
} from '../shell/workbenchStorage'
import type { CapabilitiesResponse, DraftQuestionResponse } from '../../server/api'
import type { BookInfo } from '../shell/workbenchStorage'
import { describeContextMode, describeDraftResult, isDegradedContextMode, readDraftStream } from '../draftStream'
import { providerGuidance } from './providerGuidance'
import type { ProviderUnavailableReason } from './providerGuidance'

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

/** 采纳前的盘面现场（Undo 一次可逆编辑的数据源）。严格绑定采纳后的版本与指纹（CAS 冲突防护）。 */
interface AcceptUndo {
  readonly bookRoot: string
  readonly chapterIndex: number
  readonly oldText: string
  readonly oldRevision: number | null
  readonly afterRevision: number
  readonly afterSha256?: string | undefined
}

interface ConflictView {
  readonly candidateText: string
  readonly latestText: string
  readonly latestRevision: number | null
}


export function DialogueStream({
  book,
  chapterIndex = 1,
  selection,
}: {
  book: BookInfo | null
  /** 兼容旧调用面缺省第 1 章；生产 App 始终传入当前选中章。 */
  chapterIndex?: number | undefined
  /** C2（T05）选择插入/替换：生成开始时选区现场（from/to/selectedTextHash）。
   *  写作面（ProseEditorPanel）接入前保持诚实空态；传入后按 replace-selection 模式生成，
   *  生成期间编辑 → accept 409 → 冲突对比面板（本组件既有冲突恢复路径）。 */
  selection?: { from: number; to: number; selectedTextHash: string } | undefined
}): JSX.Element {
  const [phase, setPhase] = useState<DialoguePhase>('ask')
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse['capabilities']>([])
  const [question, setQuestion] = useState<DraftQuestionResponse | null>(null)
  const [answer, setAnswer] = useState('')
  const [draftText, setDraftText] = useState('')
  const [selectedSkills, setSelectedSkills] = useState<readonly string[]>(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('mozhou.skills.active') : null
      return raw ? (JSON.parse(raw) as string[]) : []
    } catch {
      return []
    }
  })
  const [error, setError] = useState<string | null>(null)
  const [providerUnavailable, setProviderUnavailable] = useState(false)
  /**
   * provider 不可用的**病因**（P2「本机模型接入指引误导」）。
   * 存 reason 而非文案：文案由 providerGuidance 按 reason 现算，判据与呈现分离。
   * 缺省 null ⇒ 兼容不带该字段的老服务端，落到 BYOK 指引（原文案，成立）。
   */
  const [providerReason, setProviderReason] = useState<ProviderUnavailableReason | null>(null)
  const [providerBlockedHost, setProviderBlockedHost] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)
  /** start 帧证据（装配 tokens/provider）——AI CANDIDATE 的来源可追溯性。 */
  const [streamMeta, setStreamMeta] = useState<{ contextTokens?: number; provider?: string; contextMode?: string } | null>(null)
  /**
   * done 帧的终态判定。断流半稿（partial）与完整一章必须让作者看出区别——
   * 此前这里不看 done 的 payload，一律当完成，措辞与移动端各说各话。
   */
  const [draftTerminal, setDraftTerminal] = useState<{ partial: boolean } | null>(null)
  const [draftStopped, setDraftStopped] = useState(false)
  /** 采纳进写作层的回执（Candidate → Accept → Active Draft 链）。 */
  const [adoptState, setAdoptState] = useState<string | null>(null)
  /** C2（T05）：候选状态（candidateId+base+mode），随流请求建立；切书/切章/重开即失效。 */
  const [candidate, setCandidate] = useState<CandidateState | null>(null)
  /** 冲突现场：accept 409 时保留双文本 + 最新版本供作者裁决。 */
  const [conflictView, setConflictView] = useState<ConflictView | null>(null)
  /** Undo 一次可逆编辑（accept 前的盘面）。严格绑定采纳后的版本与指纹（CAS 保护）。 */
  const [undo, setUndo] = useState<AcceptUndo | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const requestControllerRef = useRef<AbortController | null>(null)
  /** 发起流请求时的书/章现场：迟到响应与切书后身份不符时丢弃（T05 切书隔离）。 */
  const requestSiteRef = useRef<{ bookId: string; chapterIndex: number } | null>(null)
  const requestIdRef = useRef(0)
  const currentSiteRef = useRef({ bookId: book?.bookId ?? null, chapterIndex, root: book?.root ?? null })

  useEffect(() => {
    currentSiteRef.current = { bookId: book?.bookId ?? null, chapterIndex, root: book?.root ?? null }
    return () => {
      currentSiteRef.current = { bookId: null, chapterIndex: 0, root: null }
    }
  }, [book?.bookId, book?.root, chapterIndex])

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
        // 病因随可用性一起存：布尔只说「不能用」，reason 才说「下一步做什么」。
        setProviderReason(caps.providerAvailable ? null : caps.providerUnavailableReason ?? null)
        setProviderBlockedHost(caps.providerAvailable ? null : caps.providerBlockedHost ?? null)
        setQuestion(q)
      } catch (cause) {
        setError((cause as Error).message)
      }
    })()
  }, [book])

  useEffect(() => {
    return () => {
      ++requestIdRef.current
      requestControllerRef.current?.abort()
      void readerRef.current?.cancel().catch(() => {})
    }
  }, [])

  useEffect(() => {
    // 切书或切章：取消正在读取的流
    ++requestIdRef.current
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
    void readerRef.current?.cancel().catch(() => {})
    readerRef.current = null
    requestSiteRef.current = null

    // 候选状态按书章恢复（仅在内存/UI展示，不覆盖服务器正文）
    if (book !== null) {
      const cKey = candidateDraftKey(book, chapterIndex)
      const cached = loadCandidateCache(cKey)
      if (cached !== null) {
        setCandidate({ candidateId: cached.candidateId, base: cached.base, mode: cached.mode })
        setDraftText(cached.draftText)
        setPhase(cached.phase === 'drafting' ? 'draft_done' : cached.phase)
        setDraftTerminal({ partial: cached.partial === true || cached.phase === 'drafting' })
      } else {
        setCandidate(null)
        setDraftText('')
        setPhase('ask')
        setDraftTerminal(null)
      }
    } else {
      setCandidate(null)
      setDraftText('')
      setPhase('ask')
      setDraftTerminal(null)
    }
    setDraftStopped(false)
    setStreamMeta(null)
    setAdoptState(null)
    setConflictView(null)
    setUndo(null)
    setError(null)
    setSending(false)
    setAccepting(false)
    setCopyFeedback(null)
  }, [book?.bookId, book?.root, chapterIndex])

  const handleSend = useCallback(async (): Promise<void> => {
    if (book === null || phase === 'drafting' || sending || requestControllerRef.current !== null) return
    const controller = new AbortController()
    requestControllerRef.current = controller
    const prompt = answer.trim()
    setError(null)
    setSending(true)
    setPhase('drafting')
    setDraftText('')
    setDraftTerminal(null)
    setDraftStopped(false)
    setStreamMeta(null)
    saveCandidateCache(null, candidateDraftKey(book, chapterIndex))
    setCandidate(null)
    setConflictView(null)
    setUndo(null)
    setCopyFeedback(null)
    setAdoptState(null)

    // 切书/切章隔离：递增请求 ID，捕获发起时的具体书/章现场
    const reqId = ++requestIdRef.current
    const site = { bookId: book.bookId, chapterIndex, root: book.root }
    requestSiteRef.current = site

    try {
      const res = await fetch('/api/draft.stream', {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: book.root,
          chapterIndex,
          prompt,
          activeSkills: selectedSkills,
          ...(selection === undefined ? {} : { mode: 'replace-selection', selection }),
        }),
      })

      // 检查请求发起后是否已切书/切章
      if (
        requestIdRef.current !== reqId ||
        currentSiteRef.current.bookId !== site.bookId ||
        currentSiteRef.current.chapterIndex !== site.chapterIndex
      ) {
        void res.body?.cancel().catch(() => {})
        return
      }

      const contentType = res.headers.get('Content-Type') ?? ''
      if (!res.ok) {
        const errorPayload = (await res.json().catch(() => null)) as { error?: string; code?: string } | null
        if (
          requestIdRef.current === reqId &&
          currentSiteRef.current.bookId === site.bookId &&
          currentSiteRef.current.chapterIndex === site.chapterIndex
        ) {
          setError(errorPayload?.error ?? '流式草稿请求失败（HTTP ' + res.status + '）')
          setProviderUnavailable(errorPayload?.code === 'PROVIDER_UNAVAILABLE')
          setPhase('error')
          setSending(false)
        }
        return
      }
      if (contentType.includes('json') && !contentType.includes('ndjson')) {
        const payload = (await res.json()) as { ok?: boolean; error?: string; code?: string }
        if (
          requestIdRef.current === reqId &&
          currentSiteRef.current.bookId === site.bookId &&
          currentSiteRef.current.chapterIndex === site.chapterIndex
        ) {
          if (payload.ok === false || payload.code === 'PROVIDER_UNAVAILABLE') {
            setError(payload.error ?? '草稿生成 provider 未配置')
            setProviderUnavailable(payload.code === 'PROVIDER_UNAVAILABLE')
            setPhase('error')
            setSending(false)
            return
          }
        }
      }
      if (!contentType.includes('ndjson') || !res.body) {
        if (
          requestIdRef.current === reqId &&
          currentSiteRef.current.bookId === site.bookId &&
          currentSiteRef.current.chapterIndex === site.chapterIndex
        ) {
          setError('响应非预期（缺流式 Content-Type）')
          setPhase('error')
          setSending(false)
        }
        return
      }

      setPhase('drafting')
      // 走到这里说明服务端前置闸已放行 ⇒ 之前那条「provider 未配置」横幅已过期。
      // 不复位的话作者在「模型设置」填完密钥回来，输入框仍然被永久禁用。
      setProviderUnavailable(false)
      let accumulatedDraftText = ''
      let currentCandidateState: CandidateState | null = null

      const stillOnSite = (): boolean =>
        requestIdRef.current === reqId &&
        currentSiteRef.current.bookId === site.bookId &&
        currentSiteRef.current.chapterIndex === site.chapterIndex

      // 帧协议与终帧判定只有一份实现（../draftStream）。本文件此前自己解了一遍，
      // 移动端也解了一遍；契约一变就有一侧静默漂移。
      const result = await readDraftStream(res, {
        onReader: (reader) => {
          if (!stillOnSite()) {
            void reader.cancel().catch(() => {})
            return
          }
          readerRef.current = reader
        },
        shouldStop: () => !stillOnSite(),
        onDelta: (chunk) => {
          if (!stillOnSite()) return
          accumulatedDraftText += chunk
          setDraftText((prev) => prev + chunk)
        },
        onFrame: (frame) => {
          if (!stillOnSite()) return
          if (frame.event === 'start') {
            setStreamMeta({
              ...(frame.contextTokens !== undefined ? { contextTokens: frame.contextTokens } : {}),
              ...(frame.provider !== undefined ? { provider: frame.provider } : {}),
              ...(frame.contextMode !== undefined ? { contextMode: frame.contextMode } : {}),
            })
            if (frame.candidateId !== undefined && frame.base !== undefined) {
              const candState: CandidateState = {
                candidateId: frame.candidateId,
                base: frame.base,
                mode: selection === undefined ? 'replace' : 'replace-selection',
              }
              currentCandidateState = candState
              setCandidate(candState)
            }
          } else if (frame.event === 'done') {
            setDraftTerminal({ partial: frame.partial === true })
            setPhase('draft_done')
            // 将就绪候选保存到本地缓存（按书章恢复）
            if (currentCandidateState !== null) {
              saveCandidateCache(
                {
                  candidateId: currentCandidateState.candidateId,
                  base: currentCandidateState.base,
                  mode: currentCandidateState.mode,
                  draftText: accumulatedDraftText,
                  phase: 'draft_done',
                  partial: frame.partial === true,
                },
                candidateDraftKey(site, site.chapterIndex),
              )
            }
          } else if (frame.event === 'error') {
            setError(frame.error)
            setPhase('error')
          }
        },
      })
      if (stillOnSite() && result.terminal === 'aborted') {
        setDraftTerminal({ partial: true })
        setPhase('draft_done')
        // start 回调赋值；TypeScript 不追踪 await 内回调对局部变量的写入。
        const interruptedCandidate = currentCandidateState as CandidateState | null
        if (interruptedCandidate !== null) {
          saveCandidateCache({ ...interruptedCandidate, draftText: accumulatedDraftText, phase: 'draft_done', partial: true }, candidateDraftKey(site, site.chapterIndex))
        }
      }
      if (
        requestIdRef.current === reqId &&
        currentSiteRef.current.bookId === site.bookId &&
        currentSiteRef.current.chapterIndex === site.chapterIndex
      ) {
        setSending(false)
      }
    } catch (cause) {
      if (
        requestIdRef.current === reqId &&
        currentSiteRef.current.bookId === site.bookId &&
        currentSiteRef.current.chapterIndex === site.chapterIndex
      ) {
        setError((cause as Error).message)
        setPhase('error')
        setSending(false)
      }
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null
        readerRef.current = null
      }
    }
  }, [answer, book, chapterIndex, phase, selectedSkills, sending, selection])

  const handleStop = (): void => {
    ++requestIdRef.current
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
    void readerRef.current?.cancel().catch(() => {})
    readerRef.current = null
    requestSiteRef.current = null
    setSending(false)
    setDraftStopped(true)
    setDraftTerminal({ partial: true })
    setPhase('draft_done')
    if (book !== null && candidate !== null) {
      saveCandidateCache({ ...candidate, draftText, phase: 'draft_done', partial: true }, candidateDraftKey(book, chapterIndex))
    }
  }

  const handleChoice = (choice: string): void => {
    setAnswer(choice)
  }

  const handleNewDraft = (): void => {
    if (book !== null) {
      saveCandidateCache(null, candidateDraftKey(book, chapterIndex))
    }
    setPhase('ask')
    setDraftText('')
    setError(null)
    setAnswer('')
    setStreamMeta(null)
    setDraftTerminal(null)
    setDraftStopped(false)
    setAdoptState(null)
    setCandidate(null)
    setConflictView(null)
    setUndo(null)
    setCopyFeedback(null)
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
    if (book === null || candidate === null || accepting || draftTerminal?.partial === true) return
    const site = { bookId: book.bookId, chapterIndex, root: book.root }
    setError(null)
    setAdoptState(null)
    setAccepting(true)
    let oldSnapshot: { body: string; revision: number | null }
    try {
      oldSnapshot = await loadSnapshot(book)
    } catch (cause) {
      setError((cause as Error).message)
      setAccepting(false)
      return
    }
    // await 之后重查现场：若已切书/切章，丢弃后续操作
    if (
      currentSiteRef.current.bookId !== site.bookId ||
      currentSiteRef.current.chapterIndex !== site.chapterIndex
    ) {
      setAccepting(false)
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

      // 再次重查现场
      if (
        currentSiteRef.current.bookId !== site.bookId ||
        currentSiteRef.current.chapterIndex !== site.chapterIndex
      ) {
        setAccepting(false)
        return
      }

      const data = (await res.json()) as {
        ok?: boolean
        revision?: number
        sha256?: string
        alreadyApplied?: boolean
        code?: string
        error?: string
      }

      if (
        currentSiteRef.current.bookId !== site.bookId ||
        currentSiteRef.current.chapterIndex !== site.chapterIndex
      ) {
        setAccepting(false)
        return
      }

      if (res.ok && data.ok === true) {
        // 成功后以服务端回读正文刷新写作层草稿缓存
        const readback = await loadSnapshot(book)
        if (
          currentSiteRef.current.bookId !== site.bookId ||
          currentSiteRef.current.chapterIndex !== site.chapterIndex
        ) {
          setAccepting(false)
          return
        }
        saveDraftCache(readback.body, chapterDraftKey(book, chapterIndex))
        saveDraftBaseline(readback.body, chapterDraftKey(book, chapterIndex))
        saveCandidateCache(null, candidateDraftKey(book, chapterIndex))
        window.dispatchEvent(new CustomEvent('mozhou:prose-adopted', { detail: { bookId: book.bookId, chapterIndex } }))
        window.dispatchEvent(new CustomEvent('mozhou:telemetry-refresh'))

        // 处理幂等与连续采纳：避免第二次采纳（alreadyApplied: true）把 Undo 基底变成已采纳正文
        if (data.alreadyApplied !== true || undo === null) {
          setUndo({
            bookRoot: book.root,
            chapterIndex,
            oldText: oldSnapshot.body,
            oldRevision: oldSnapshot.revision,
            afterRevision: data.revision!,
            afterSha256: data.sha256,
          })
        }

        setAdoptState(
          data.alreadyApplied === true
            ? `已采纳（幂等重放命中，不重复写入）——第 ${chapterIndex} 章服务端 r${String(data.revision)}`
            : `已采纳进正文 — 服务端 r${String(data.revision)} · ${book.title} 第 ${chapterIndex} 章 Active Draft 已刷新，可在 Reading Slate 继续编辑`,
        )
        return
      }
      if (res.status === 409) {
        // 冲突：保留两份文本供作者裁决
        const latest = await loadSnapshot(book)
        if (
          currentSiteRef.current.bookId !== site.bookId ||
          currentSiteRef.current.chapterIndex !== site.chapterIndex
        ) {
          setAccepting(false)
          return
        }
        setConflictView({ candidateText: draftText, latestText: latest.body, latestRevision: latest.revision })
        setAdoptState(null)
        return
      }
      setError(data.error ?? '采纳失败（HTTP ' + res.status + '）')
    } catch (cause) {
      if (
        currentSiteRef.current.bookId === site.bookId &&
        currentSiteRef.current.chapterIndex === site.chapterIndex
      ) {
        setError((cause as Error).message)
      }
    } finally {
      setAccepting(false)
    }
  }, [accepting, book, candidate, chapterIndex, draftText, draftTerminal, loadSnapshot, undo])

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

  /** 冲突双文本：复制候选文本到剪贴板。剪贴板不可用或拒绝时不崩溃，提示明确操作。 */
  const handleCopyCandidate = useCallback(async (): Promise<void> => {
    if (conflictView === null) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(conflictView.candidateText)
        setCopyFeedback('已复制候选文本到剪贴板')
      } else {
        setCopyFeedback('剪贴板不可用，请从下方差异视图直接选中文本复制')
      }
    } catch {
      setCopyFeedback('复制失败，请从下方差异视图直接选中文本复制')
    }
  }, [conflictView])

  /** Undo：一次可逆编辑——以新 revision 保存采纳前文本（严格绑定采纳后的版本 CAS 保护）。 */
  const handleUndoAccept = useCallback(async (): Promise<void> => {
    if (book === null || undo === null) return
    if (undo.bookRoot !== book.root || undo.chapterIndex !== chapterIndex) {
      setError('当前书或章已变更，无法在此撤销其他章节的采纳')
      return
    }
    setError(null)
    // 对象身份区分同书同章的不同打开现场，切走再切回也不能接收旧撤销。
    const site = currentSiteRef.current
    const stillOnSite = (): boolean => currentSiteRef.current === site
    let latest: { body: string; revision: number | null }
    try {
      latest = await loadSnapshot(book)
    } catch (cause) {
      if (stillOnSite()) setError((cause as Error).message)
      return
    }
    if (!stillOnSite()) return

    // 冲突保护：若盘面最新版本不等于采纳后的 afterRevision，说明采纳后有新编辑（手工/外部），拒绝覆盖
    if (latest.revision !== undo.afterRevision) {
      setError(`撤销被拒绝（冲突）：该章在采纳后已有新编辑（最新 r${String(latest.revision)} ≠ 采纳后 r${undo.afterRevision}）。磁盘原文与撤销文本都已保留，未覆盖新内容。`)
      setConflictView({
        candidateText: undo.oldText,
        latestText: latest.body,
        latestRevision: latest.revision,
      })
      return
    }

    try {
      const res = await fetch('/api/chapter.prose.save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: book.root,
          chapterIndex,
          body: undo.oldText,
          expectedRevision: undo.afterRevision, // 绑定采纳后版本，拒绝覆盖后续新修改
        }),
      })
      if (!stillOnSite()) return
      const data = (await res.json()) as { ok?: boolean; revision?: number; error?: string }
      if (!stillOnSite()) return
      if (res.ok && data.ok === true) {
        saveDraftCache(undo.oldText, chapterDraftKey(book, chapterIndex))
        saveDraftBaseline(undo.oldText, chapterDraftKey(book, chapterIndex))
        window.dispatchEvent(new CustomEvent('mozhou:prose-adopted', { detail: { bookId: book.bookId, chapterIndex } }))
        window.dispatchEvent(new CustomEvent('mozhou:telemetry-refresh'))
        setUndo(null)
        setAdoptState('已撤销采纳（新 revision 保存，不倒退服务端历史）')
      } else if (res.status === 409) {
        const currentSnap = await loadSnapshot(book).catch(() => latest)
        if (!stillOnSite()) return
        setError(`撤销被拒绝（冲突）：该章在采纳后已被外部修改或已存有新版本。磁盘原文与撤销文本都已保留，未覆盖新内容。`)
        setConflictView({
          candidateText: undo.oldText,
          latestText: currentSnap.body,
          latestRevision: currentSnap.revision,
        })
      } else {
        setError(data.error ?? '撤销保存失败')
      }
    } catch (cause) {
      if (stillOnSite()) {
        setError((cause as Error).message)
      }
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

      {providerUnavailable &&
        (() => {
          // 指引按病因现算（P2）：本机端点被门禁拦下时，说的是「让部署者显式放行」，
          // 而不是把人送去填 BYOK 密钥——后者对本机部署是条走不通的路。
          const guidance = providerGuidance({ reason: providerReason, blockedHost: providerBlockedHost })
          return (
            <div className="wb-error" role="alert" data-testid="provider-unavailable" data-reason={guidance.reason}>
              <strong>{guidance.headline}</strong>
              {guidance.body !== '' && <span> {guidance.body}</span>}
            </div>
          )
        })()}

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
            <span className="candidate-tag">
              AI CANDIDATE · 
              {phase === 'drafting'
                ? 'STREAMING · 渲染中'
                : draftTerminal?.partial === true
                  ? 'DONE · 断流半稿（未完成）'
                  : 'DONE · 完成'}
            </span>
            {streamMeta !== null && (
              <span className="mono muted" style={{ marginLeft: 8, fontSize: 10 }}>
                start · {streamMeta.contextTokens !== undefined ? `${streamMeta.contextTokens} tok` : 'context —'}
                {streamMeta.provider !== undefined ? ` · ${streamMeta.provider}` : ''}
              </span>
            )}
          </div>
          {/* 未知模式也透出：describeContextMode 认不出的会原样带出模式名。
            硬编码白名单等于把新模式的提示悄悄吞掉——那正是本条要防的静默。 */}
          {isDegradedContextMode(streamMeta?.contextMode) && (
              <p
                role="status"
                data-testid="context-degraded"
                className="mono"
                style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--warning, #d98b2b)' }}
              >
                {describeContextMode(streamMeta?.contextMode)}
              </p>
            )}
          <p data-testid="draft-text" className={phase === 'drafting' ? 'stream-caret' : undefined}>{draftText}</p>
          {phase === 'draft_done' && (
            <>
              <p
                className="mono muted"
                data-testid="draft-terminal-note"
                style={{ margin: '6px 0 0', fontSize: 10 }}
              >
                {/* 措辞走 draftStream：桌面与移动对同一终帧必须说同一句话。
                  半稿尤其不能只靠 kicker 的「完成」二字一笔带过——
                  断流半稿若被当作可采纳的完整一章，作者会把半章写进正文。 */}
                {draftStopped
                  ? '已停止生成，半稿已保留，正文未改变。半稿不能直接采纳，可重新生成。'
                  : draftTerminal?.partial === true
                    ? '本次为断流半稿，已保留收到的内容，不能直接采纳；可重新生成。'
                    : draftTerminal !== null
                  ? describeDraftResult({
                      terminal: 'done',
                      candidateId: candidate?.candidateId ?? null,
                      text: draftText,
                      partial: draftTerminal.partial,
                      outcome: draftTerminal.partial ? 'failed_recoverable' : 'succeeded',
                      chars: draftText.length,
                      error: null,
                      contextMode: null,
                    })
                  : '候选已就绪（未写入正文）——采纳经服务端受控事务（CAS + 幂等），质量门常驻，Accepted ≠ Committed。'}
              </p>
              {adoptState !== null && (
                <p role="status" className="mono" style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--success)' }} data-testid="adopt-state">
                  {adoptState}
                </p>
              )}
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-author btn-sm"
                  data-testid="adopt-into-slate"
                  onClick={() => { void handleAccept() }}
                  disabled={candidate === null || accepting || draftTerminal?.partial === true}
                >
                  {accepting ? '采纳落盘中…' : '采纳进正文（Accept → Active Draft）'}
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
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className="btn btn-sm" data-testid="conflict-regenerate" onClick={() => { void handleRetryAcceptWithLatest() }}>
                  读最新 → 以最新现场重新生成
                </button>
                <button type="button" className="btn btn-sm" data-testid="conflict-copy-candidate" onClick={() => { void handleCopyCandidate() }}>
                  复制候选文本
                </button>
                {copyFeedback !== null && (
                  <span className="mono muted" style={{ fontSize: 11 }} data-testid="copy-feedback">
                    {copyFeedback}
                  </span>
                )}
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
              {phase === 'drafting'
                ? <button type="button" className="btn btn-sm" onClick={handleStop}>停止生成</button>
                : <span>⌘ Enter 发送</span>}
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
