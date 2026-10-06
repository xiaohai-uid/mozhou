/**
 * 正文写作层（Reading Slate · ADR-0028 · P1-2 修订落地）：
 * 把已存在的 editor 组件链（Canvas + Slash + Bubble）正式挂载进 Workbench。
 *
 * 持久化：Active Draft 本地草稿缓存（mozhou.draft.cache.ch_<书身份>_<N>，T00 起键绑定书，
 * 与移动端/账本同一 workbenchStorage 纪律）——这是作者的工作文本，不是 Chapter Commit。
 * 冲突保护（发布评审 R1/R2）：挂载/切章时读取服务端章快照（/api/chapter.prose），
 * Accept 保存携带 expectedRevision（null=仅新建）；409 冲突不改磁盘、写作层文本
 * 不丢，须作者显式「核对最新内容后覆盖」或「显式重开定稿」才完成保存。
 * 本地缓存为空且服务端有正文时先回填显示——作者保存前必然读过所覆盖的内容。
 * AI 行内编辑（CHG-20261006-02）：Bubble 预设与自定义指令走 /api/prose.edit.stream
 * 契约——流式只产候选（InlineDiffViewer 双栏对照），Accept 走 AST 局部替换（可撤销），
 * Reject/失败一字不改正文；采纳前质量遥测（De-AI + 4-gram）绿/黄提示（FR-3.3）。
 * 质量遥测条（EditorQualityTelemetry）：已挂载于正文画布下方，随作者键入实时
 * 计算字数/段落/4-gram 复读/Tier1/Tier2——数据来自 @mozhou/quality-engine/de-ai
 * 浏览器安全子路径（零 Token、确定性），非示例值。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { post } from '../../lib/post'
import { NovelEditorCanvas } from './NovelEditorCanvas'
import type { NovelEditorCanvasHandle } from './NovelEditorCanvas'
import { EditorQualityTelemetry } from './EditorQualityTelemetry'
import { InlineDiffViewer } from './InlineDiffViewer'
import { runDeAiDiagnostics } from '@mozhou/quality-engine/de-ai'
import { blocksFromText } from './customNodes'
import { chapterDraftKey, draftCacheMatchesBaseline, loadDraftCache, saveDraftBaseline, saveDraftCache, saveEditorProjection } from '../../shell/workbenchStorage'
import type { BookInfo } from '../../shell/workbenchStorage'
import type { ChapterProseResponse, ChapterProseSaveResponse } from '../../../shared/api'
// W4-2c-2b：视图代次（切书/切章 +1，供在飞生成流的第二层判定）
import { viewGeneration } from '../../../shared/taskStream'

export interface ProseEditorPanelProps {
  book: BookInfo | null
  chapterIndex: number
  /** 选区变化回调（from/to UTF-16 偏移与所选原文）。 */
  onSelectionChange?: ((selection: { from: number; to: number; selectedText: string } | null) => void) | undefined
}

/** 服务端章快照：保存预期版本的唯一来源；不可用时拒绝不安全保存（Gate 3 纪律）。 */
type Snapshot =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'ready'; revision: number; phase: 'draft' | 'committed'; commitId: string | undefined; body: string }
  | { kind: 'unavailable' }

/**
 * 行内 AI 编辑候选（CHG-20261006-02 /api/prose.edit.stream）：
 * 只承载「流式候选 + 选区快照」，Accept 才动写作层，Reject/失败一字不改。
 */
interface PendingInlineEdit {
  candidateId?: string
  action: string
  customInstruction: string | undefined
  from: number
  to: number
  original: string
  proposed: string
  status: 'streaming' | 'ready'
}

export function ProseEditorPanel(props: ProseEditorPanelProps): JSX.Element {
  // 正文与版本快照属于同一个书章会话；切换时一起重建，禁止旧快照回填新缓存。
  const sessionKey = JSON.stringify([props.book?.root, props.book?.bookId, props.chapterIndex])
  return <ProseEditorSession key={sessionKey} {...props} />
}

function ProseEditorSession({ book, chapterIndex, onSelectionChange }: ProseEditorPanelProps): JSX.Element {
  // T00：缓存键绑定书身份——切书（含同章号）必须重载对应书的草稿；未绑书不读缓存。
  const draftKey = book !== null ? chapterDraftKey(book, chapterIndex) : null
  const [text, setText] = useState(() => loadDraftCache(draftKey))
  const [notice, setNotice] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<{ kind: 'busy' | 'ok' | 'err'; text: string } | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>({ kind: 'loading' })
  const [reloadTick, setReloadTick] = useState(0)

  const root = book?.root ?? null
  const canvasRef = useRef<NovelEditorCanvasHandle>(null)
  const [pendingEdit, setPendingEdit] = useState<PendingInlineEdit | null>(null)
  const inlineEditAbortRef = useRef<AbortController | null>(null)
  // 最近一次编辑器选区快照（Bubble 动作发起行内编辑的输入；onSelectionChange 同源）。
  const lastSelectionRef = useRef<{ from: number; to: number; selectedText: string } | null>(null)

  // R1：读取服务端章快照（预期版本来源 + 定稿态识别）；保存/重开/解决冲突后 reloadTick 触发重读
  useEffect(() => {
    if (root === null) return
    let cancelled = false
    setSnapshot({ kind: 'loading' })
    void post<ChapterProseResponse>('/api/chapter.prose', { root, chapterIndex })
      .then((data) => {
        if (cancelled) return
        if (!data.exists) {
          setSnapshot({ kind: 'missing' })
          return
        }
        setSnapshot({
          kind: 'ready',
          revision: Number(data.revision),
          phase: data.phase === 'committed' ? 'committed' : 'draft',
          commitId: data.commitId,
          body: String(data.body ?? ''),
        })
      })
      .catch(() => { if (!cancelled) setSnapshot({ kind: 'unavailable' }) })
    return () => { cancelled = true }
  }, [root, chapterIndex, reloadTick])

  // 监听 DialogueStream 采纳/撤销正文事件，同步正文缓存并重载快照版本
  useEffect(() => {
    const handleProseAdopted = (e: Event) => {
      const ce = e as CustomEvent<{ bookId?: string; chapterIndex?: number }>
      if (ce.detail?.bookId === book?.bookId && ce.detail?.chapterIndex === chapterIndex) {
        if (draftKey !== null) {
          setText(loadDraftCache(draftKey))
        }
        setConflict(null)
        setNotice(null)
        setReloadTick((v) => v + 1)
      }
    }
    window.addEventListener('mozhou:prose-adopted', handleProseAdopted)
    // W4-2c-2b：切书/切章 = 视图代次 +1（本 effect 的依赖同时覆盖两者）——
    // 在飞的旧生成流此后到达的 chunk 不得再更新编辑器。
    viewGeneration.bump('chapter-switch')
    return () => {
      window.removeEventListener('mozhou:prose-adopted', handleProseAdopted)
    }
  }, [book?.bookId, chapterIndex, draftKey])

  // 本地缓存为空且服务端有正文：先回填显示（作者保存前必然读过所覆盖的内容）
  useEffect(() => {
    if (draftKey === null || snapshot.kind !== 'ready' || snapshot.body.trim() === '') return
    const cached = loadDraftCache(draftKey)
    if (cached.trim() !== '' && !draftCacheMatchesBaseline(cached, draftKey)) return
    saveDraftCache(snapshot.body, draftKey)
    saveDraftBaseline(snapshot.body, draftKey)
    setText(snapshot.body)
  }, [draftKey, snapshot])

  // 防误关丢稿守卫：正文处于未保存（dirty）状态时拦截页面卸载
  useEffect(() => {
    if (typeof window === 'undefined' || draftKey === null) return
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!draftCacheMatchesBaseline(text, draftKey)) {
        if (text.trim() === '') return
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [draftKey, text])

  const handleChange = useCallback(
    (next: string) => {
      setText(next)
      saveDraftCache(next, draftKey)
      // CHG-20261006-02：编辑器结构投影（场景块等）随正文回写，不进 Chapter body。
      saveEditorProjection(blocksFromText(next), draftKey)
    },
    [draftKey],
  )

  /** 行内选区 AI 编辑（四预设 + 自定义同一契约）：流式只产候选，正文绝不自动改动。 */
  const handleSelectionAction = useCallback(
    (action: string, selectedText: string, customInstruction?: string): void => {
      if (root === null) return
      const selection = lastSelectionRef.current
      if (selection === null || selection.from >= selection.to || selection.selectedText.trim() === '') {
        setNotice('行内 AI 编辑需要先在正文中选中一段文字——当前没有可用选区，正文未改动。')
        return
      }
      inlineEditAbortRef.current?.abort()
      const controller = new AbortController()
      inlineEditAbortRef.current = controller
      const surroundingContext = [
        text.slice(Math.max(0, selection.from - 200), selection.from),
        text.slice(selection.to, Math.min(text.length, selection.to + 200)),
      ].join('\n')
      setPendingEdit({
        action,
        customInstruction,
        from: selection.from,
        to: selection.to,
        original: selection.selectedText,
        proposed: '',
        status: 'streaming',
      })
      setNotice(null)
      void (async () => {
        try {
          const response = await fetch('/api/prose.edit.stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              root,
              chapterIndex,
              action,
              selectedText: selection.selectedText,
              selectionRange: { from: selection.from, to: selection.to },
              surroundingContext,
              ...(customInstruction !== undefined ? { customInstruction } : {}),
            }),
            signal: controller.signal,
          })
          if (!response.ok || response.body === null) {
            const detail = await response.json().catch(() => ({})) as { error?: unknown }
            throw new Error(typeof detail['error'] === 'string' ? detail['error'] : `HTTP ${response.status}`)
          }
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              if (line.trim() === '') continue
              const frame = JSON.parse(line) as { ok?: boolean; event?: string; text?: unknown; error?: unknown; candidateId?: unknown }
              const frameCandidateId = typeof frame['candidateId'] === 'string' ? frame['candidateId'] : undefined
              if (frame['event'] === 'start' && frameCandidateId) {
                setPendingEdit((prev) => (prev === null ? prev : { ...prev, candidateId: frameCandidateId }))
              } else if (frame['event'] === 'delta' && typeof frame['text'] === 'string') {
                const chunk = frame['text']
                setPendingEdit((prev) => (prev === null ? prev : {
                  ...prev,
                  proposed: prev.proposed + chunk,
                  ...(frameCandidateId ? { candidateId: frameCandidateId } : {}),
                }))
              } else if (frame['event'] === 'done') {
                setPendingEdit((prev) => (prev === null ? prev : {
                  ...prev,
                  status: 'ready',
                  ...(frameCandidateId ? { candidateId: frameCandidateId } : {}),
                }))
              } else if (frame['event'] === 'error') {
                const message = typeof frame['error'] === 'string' ? frame['error'] : '生成失败'
                setPendingEdit(null)
                setNotice(`AI 行内编辑失败：${message}——正文未改动。`)
              }
            }
          }
          setPendingEdit((prev) => (prev !== null && prev.status === 'streaming' ? { ...prev, status: 'ready' } : prev))
        } catch (cause) {
          if (controller.signal.aborted) return
          setPendingEdit(null)
          setNotice(`AI 行内编辑失败：${(cause as Error).message}——正文未改动。`)
        }
      })()
    },
    [root, chapterIndex, text],
  )

  /** Accept：选区不漂移守护（正文 [from,to) 仍逐字等于候选基线才替换）→ AST 局部替换（可撤销）。 */
  const acceptInlineEdit = useCallback((): void => {
    const edit = pendingEdit
    if (edit === null || edit.status !== 'ready') return
    if (text.slice(edit.from, edit.to) !== edit.original) {
      setPendingEdit(null)
      setNotice('正文在你审阅候选期间已变化，选区不再匹配——候选已失效未采纳，请重新选择后再试。')
      return
    }
    canvasRef.current?.replaceRange(edit.from, edit.to, edit.proposed)
    setPendingEdit(null)
    setSaveState({ kind: 'ok', text: 'AI 候选已采纳进写作层（Ctrl+Z 可撤销）；尚未落盘——落盘请点「落为当前章草稿」走 revision-safe 保存。' })
    if (book !== null && edit.candidateId) {
      void post('/api/prose.edit.decision', {
        root: book.root,
        chapterIndex,
        editCandidateId: edit.candidateId,
        decision: 'accepted',
        selectedText: edit.original,
        proposedText: edit.proposed,
      }).catch(() => {
        // 决策观测上报失败不阻断写作主路径
      })
    }
  }, [pendingEdit, text, book, chapterIndex])

  const rejectInlineEdit = useCallback((): void => {
    const edit = pendingEdit
    setPendingEdit(null)
    if (edit !== null && edit.status === 'ready' && book !== null && edit.candidateId) {
      void post('/api/prose.edit.decision', {
        root: book.root,
        chapterIndex,
        editCandidateId: edit.candidateId,
        decision: 'rejected',
        selectedText: edit.original,
        proposedText: edit.proposed,
      }).catch(() => {
        // 决策观测上报失败不阻断写作主路径
      })
    }
  }, [pendingEdit, book, chapterIndex])

  // FR-3.2 / specs/002：候选就绪期 Enter (采纳) / Esc (放弃) 全局热键绑定
  useEffect(() => {
    if (pendingEdit === null || pendingEdit.status !== 'ready') return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        rejectInlineEdit()
      } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement | null
        if (target?.tagName === 'TEXTAREA' || (target?.isContentEditable && target.getAttribute('role') === 'textbox')) {
          return
        }
        e.preventDefault()
        acceptInlineEdit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [pendingEdit, acceptInlineEdit, rejectInlineEdit])

  // 切书/切章/卸载：中止在飞行内编辑流（与生成流第二层判定同纪律）。
  useEffect(() => {
    return () => {
      inlineEditAbortRef.current?.abort()
    }
  }, [book?.bookId, chapterIndex])

  /** 采纳前质量遥测（FR-3.3）：De-AI 机检 + 4-gram 复读，绿=纯净 / 黄=待复核。 */
  const inlineDiffQuality = useMemo(() => {
    if (pendingEdit === null || pendingEdit.proposed.trim() === '') return undefined
    const report = runDeAiDiagnostics(pendingEdit.proposed, [])
    const cleanChars = pendingEdit.proposed.replace(/[^\u4e00-\u9fa5]/g, '')
    const ngrams = new Map<string, number>()
    let repetitions = 0
    for (let i = 0; i <= cleanChars.length - 4; i++) {
      const gram = cleanChars.slice(i, i + 4)
      const count = (ngrams.get(gram) ?? 0) + 1
      ngrams.set(gram, count)
      if (count > 2) repetitions++
    }
    return { clean: report.clean && repetitions === 0, tier1: report.tier1Count, tier2: report.tier2Count, repetitions }
  }, [pendingEdit])

  const draftMeta = useMemo(() => {
    const chars = text.replace(/\s/g, '').length
    return `${chars} 字 · 本地缓存 ${draftKey ?? '未绑定书'}`
  }, [text, draftKey])

  /** 保存执行（携带预期版本）；409 按码分流到冲突/定稿形态。confirmExternalOverwrite 仅由显式解决按钮发出。 */
  const doSave = useCallback(async (expectedRevision: number | null, baseLabel: string, confirmExternalOverwrite = false): Promise<void> => {
    if (book === null || text.trim() === '') return
    setNotice(null)
    setSaveState({ kind: 'busy', text: '落盘中…' })
    try {
      const result = await post<ChapterProseSaveResponse>(
        '/api/chapter.prose.save',
        { root: book.root, chapterIndex, body: text, title: book.title, expectedRevision, confirmExternalOverwrite },
      )
      saveDraftBaseline(text, draftKey)
      setConflict(null)
      setSaveState({
        kind: 'ok',
        text: `已落为当前章草稿 r${result.revision}（基线 ${baseLabel}）${result.created ? '· 新建章' : ''}——Active Draft；Commit 经质量门后由管线执行（Accepted ≠ Committed）。`,
      })
      setReloadTick((v) => v + 1)
      window.dispatchEvent(new CustomEvent('mozhou:telemetry-refresh'))
    } catch (cause) {
      const error = cause as Error
      if (error.name === 'CHAPTER_COMMITTED') {
        setConflict(null)
        setReloadTick((v) => v + 1) // 快照刷新后界面转为「已定稿」形态
        setSaveState({ kind: 'err', text: '保存被拒绝：该章已在其他入口定稿（committed）。写作层文本完整保留，需显式重开后才能保存。' })
        return
      }
      if (error.name === 'PROSE_REVISION_CONFLICT' || error.name === 'PROSE_EXTERNAL_CHANGE' || error.name === 'CHAPTER_EXISTS') {
        setConflict(error.name)
        setSaveState({ kind: 'err', text: '保存被拒绝（冲突）：磁盘内容已有更新——外部修改或其他入口保存。磁盘原文与你的写作层文本都完整保留。' })
        return
      }
      setSaveState({ kind: 'err', text: `落盘失败：${error.message}` })
    }
  }, [book, chapterIndex, draftKey, text])

  /** Accept → Active Draft：按快照选预期版本（missing=null 新建；draft=所读 revision）。 */
  const saveAsDraft = useCallback(async (): Promise<void> => {
    if (book === null) return
    if (snapshot.kind === 'missing') {
      await doSave(null, '新建章草稿')
      return
    }
    if (snapshot.kind === 'ready' && snapshot.phase === 'draft') {
      await doSave(snapshot.revision, `r${snapshot.revision}`)
      return
    }
    if (snapshot.kind === 'ready' && snapshot.phase === 'committed') {
      setSaveState({ kind: 'err', text: '该章已定稿（committed）——普通保存被拒绝，需显式重开后才能继续。写作层文本完整保留。' })
      return
    }
    setSaveState({ kind: 'err', text: '无法读取章节当前状态——冲突保护不可用，已停止保存（不静默覆盖）。请刷新后重试。' })
  }, [book, snapshot, doSave])

  /** 显式解决冲突：重新读取最新版本，作者确认以写作层文本覆盖后才保存（R1 验收 E）。
   *  confirmExternalOverwrite：外部改盘时 revision 不变，必须显式确认位才能解封保存。 */
  const resolveConflictOverwrite = useCallback(async (): Promise<void> => {
    if (book === null) return
    setSaveState({ kind: 'busy', text: '核对最新版本…' })
    try {
      const snap = await post<ChapterProseResponse>('/api/chapter.prose', { root: book.root, chapterIndex })
      const base = snap.exists ? { revision: Number(snap.revision), label: `r${snap.revision}` } : { revision: null, label: '新建章草稿' }
      await doSave(base.revision, `核对后覆盖 ${base.label}`, true)
    } catch (cause) {
      setSaveState({ kind: 'err', text: `无法读取最新版本：${(cause as Error).message}——保存已停止，写作层文本保留。` })
    }
  }, [book, chapterIndex, doSave])

  /** 显式重开定稿（复用数据平面 reopenChapter：写前哈希 + ChapterReopened 事件 + 基线刷新）。 */
  const reopenCommitted = useCallback(async (): Promise<void> => {
    if (book === null) return
    setSaveState({ kind: 'busy', text: '重开中…' })
    try {
      const result = await post<{ ok: true; reopenedFromCommitId: string }>('/api/chapter.reopen', { root: book.root, chapterIndex })
      setSaveState({ kind: 'ok', text: `已重开（${result.reopenedFromCommitId.slice(0, 12)}…）：定稿正文回到草稿态，原 commit 保留可追溯——现在可继续编辑保存。` })
      setReloadTick((v) => v + 1)
    } catch (cause) {
      const error = cause as Error
      setSaveState({
        kind: 'err',
        text: error.name === 'PROSE_EXTERNAL_CHANGE'
          ? '重开被拒绝：定稿文件已被外部修改——请先人工核对外部改动。'
          : `重开失败：${error.message}`,
      })
    }
  }, [book, chapterIndex])

  const isCommitted = snapshot.kind === 'ready' && snapshot.phase === 'committed'
  const saveBlocked = snapshot.kind === 'loading'
    ? '读取章节状态中…'
    : snapshot.kind === 'unavailable'
      ? '章节状态不可用——冲突保护无法保证，已停止保存'
      : isCommitted
        ? '已定稿——需显式重开后才能保存'
        : null

  return (
    <section className="wb-section" data-testid="prose-editor" aria-label="正文写作层">
      <div className="card-shell">
        <div className="card">
          <div className="card-title">
            <b style={{ fontFamily: 'var(--serif)' }}>正文 · Active Draft</b>
            <span className="mono muted" style={{ fontSize: 10 }}>{draftMeta}</span>
          </div>
          {book === null ? (
            <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
              建书后此处成为当前章的 Active Draft 写作面（Reading Slate）。
            </p>
          ) : (
            <>
              {isCommitted && (
                <div role="status" style={{ margin: '10px 0 0', padding: '8px 10px', borderRadius: 9, border: '1px solid var(--warning, #a06a1f)', fontSize: 12 }} data-testid="prose-committed-banner">
                  <b style={{ color: 'var(--warning, #a06a1f)' }}>该章已定稿</b>
                  {snapshot.kind === 'ready' && snapshot.commitId !== undefined && (
                    <span className="mono muted" style={{ marginLeft: 6, fontSize: 10 }}>{snapshot.commitId.slice(0, 12)}…</span>
                  )}
                  <span style={{ marginLeft: 6 }}>定稿正文只读；编辑须显式重开（生成 ChapterReopened 事件，原 commit 保留追溯）。</span>
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <NovelEditorCanvas
                  ref={canvasRef}
                  value={text}
                  onChange={handleChange}
                  onSelectionAction={handleSelectionAction}
                  onSelectionChange={(sel) => {
                    lastSelectionRef.current = sel
                    onSelectionChange?.(sel)
                  }}
                  placeholder={`第 ${chapterIndex} 章正文……（Enter 自动两全角缩进；行首 / 唤起快捷指令；选中文字浮出调优菜单）`}
                />
              </div>
              <div style={{ marginTop: 8 }}>
                <EditorQualityTelemetry content={text} />
              </div>
              {pendingEdit !== null && (
                <div style={{ marginTop: 10 }} data-testid="inline-edit-panel">
                  <InlineDiffViewer
                    originalText={pendingEdit.original}
                    proposedText={pendingEdit.proposed}
                    onAccept={acceptInlineEdit}
                    onReject={rejectInlineEdit}
                    actionLabel={pendingEdit.action === 'custom' ? '自定义指令调优' : 'AI 选区调优'}
                    loading={pendingEdit.status === 'streaming'}
                    quality={inlineDiffQuality}
                  />
                </div>
              )}
              {notice !== null && (
                <div className="ir-unavailable" style={{ marginTop: 10 }} role="status">
                  <b style={{ color: 'var(--warning)' }}>AI 选区动作</b>
                  <br />
                  <span>{notice}</span>
                </div>
              )}
              {conflict !== null && (
                <div role="alert" style={{ margin: '10px 0 0', padding: '8px 10px', borderRadius: 9, border: '1px solid var(--danger, #b3423a)', fontSize: 12 }} data-testid="prose-conflict-banner">
                  <b style={{ color: 'var(--danger, #b3423a)' }}>保存冲突</b>
                  <span style={{ marginLeft: 6 }}>磁盘内容已有更新（外部修改或其他入口保存）。你的写作层文本完整保留；磁盘原文未被改动。</span>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn" onClick={() => { void resolveConflictOverwrite() }} data-testid="prose-resolve-overwrite">
                      我已核对最新内容——以写作层文本覆盖
                    </button>
                    <button type="button" className="btn" onClick={() => { setConflict(null); setSaveState(null) }}>
                      先不保存，我自己核对
                    </button>
                  </div>
                </div>
              )}
              {saveState !== null && (
                <p
                  role={saveState.kind === 'err' ? 'alert' : 'status'}
                  className={saveState.kind === 'err' ? 'wb-error' : 'mono'}
                  style={{ margin: '10px 0 0', fontSize: 12, ...(saveState.kind === 'ok' ? { color: 'var(--success)' } : {}) }}
                  data-testid="prose-save-result"
                >
                  {saveState.text}
                </p>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {isCommitted ? (
                  <button
                    type="button"
                    className="btn btn-author"
                    disabled={saveState?.kind === 'busy'}
                    onClick={() => { void reopenCommitted() }}
                    data-testid="prose-reopen"
                    title="显式重开：定稿移回草稿态（ChapterReopened 事件 + 基线刷新），原 commit 永不改写"
                  >
                    {saveState?.kind === 'busy' ? '重开中…' : '显式重开（回到草稿态）'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-author"
                    disabled={saveState?.kind === 'busy' || text.trim() === '' || saveBlocked !== null}
                    onClick={() => { void saveAsDraft() }}
                    data-testid="prose-accept-draft"
                    title={saveBlocked ?? 'Accept：把写作层文本落为当前章 Active Draft（携带预期版本；冲突 409 不覆盖）'}
                  >
                    {saveState?.kind === 'busy' ? '落盘中…' : '落为当前章草稿（Accept → Active Draft）'}
                  </button>
                )}
                {saveBlocked !== null && !isCommitted && (
                  <span className="note" style={{ fontSize: 11, color: 'var(--warning, #a06a1f)' }}>{saveBlocked}</span>
                )}
                <span className="note" style={{ fontSize: 11 }}>
                  Candidate（写作对话）→ Accept（本按钮/采纳进写作层）→ Active Draft → Commit（质量门后）
                </span>
              </div>
              <p className="note" style={{ margin: '8px 0 0', fontSize: 11 }}>
                这是作者的 Active Draft 工作面（本地草稿缓存，非 Chapter Commit）；保存携带预期版本，冲突时明确拒绝不静默覆盖。
                选区 AI（Bubble 预设 / 自定义指令）走 /api/prose.edit.stream 契约：只产候选、采纳/放弃由你决断，正文不被自动覆盖。
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
