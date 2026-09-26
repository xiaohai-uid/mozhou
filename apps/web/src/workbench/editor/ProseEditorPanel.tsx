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
 * AI 选区动作（bubble 预设 / rewrite / deslop）：当前无正文编辑 AI 契约——
 * 呈现诚实不可用（需 provider/契约），不伪造调优结果。
 * 质量遥测条（EditorQualityTelemetry）：已挂载于正文画布下方，随作者键入实时
 * 计算字数/段落/4-gram 复读/Tier1/Tier2——数据来自 @mozhou/quality-engine/de-ai
 * 浏览器安全子路径（零 Token、确定性），非示例值。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { post } from '../../lib/post'
import { NovelEditorCanvas } from './NovelEditorCanvas'
import { EditorQualityTelemetry } from './EditorQualityTelemetry'
import { chapterDraftKey, loadDraftCache, saveDraftCache } from '../../shell/workbenchStorage'
import type { BookInfo } from '../../shell/workbenchStorage'
import type { ChapterProseResponse, ChapterProseSaveResponse } from '../../../server/api'

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

export function ProseEditorPanel({ book, chapterIndex, onSelectionChange }: ProseEditorPanelProps): JSX.Element {
  // T00：缓存键绑定书身份——切书（含同章号）必须重载对应书的草稿；未绑书不读缓存。
  const draftKey = book !== null ? chapterDraftKey(book, chapterIndex) : null
  const [text, setText] = useState(() => loadDraftCache(draftKey))
  const [loadedFor, setLoadedFor] = useState(draftKey)
  const [notice, setNotice] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<{ kind: 'busy' | 'ok' | 'err'; text: string } | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>({ kind: 'loading' })
  const [reloadTick, setReloadTick] = useState(0)

  // 切书或切章：载入对应书章的本地 Active Draft 缓存
  if (loadedFor !== draftKey) {
    setLoadedFor(draftKey)
    setText(loadDraftCache(draftKey))
    setNotice(null)
    setConflict(null)
  }

  const root = book?.root ?? null

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
    return () => {
      window.removeEventListener('mozhou:prose-adopted', handleProseAdopted)
    }
  }, [book?.bookId, chapterIndex, draftKey])

  // 本地缓存为空且服务端有正文：先回填显示（作者保存前必然读过所覆盖的内容）
  useEffect(() => {
    if (draftKey === null || snapshot.kind !== 'ready' || snapshot.body.trim() === '') return
    if (loadDraftCache(draftKey).trim() !== '') return // 作者已有工作文本（含读取期间的新键入）
    saveDraftCache(snapshot.body, draftKey)
    setText(snapshot.body)
  }, [draftKey, snapshot])

  const handleChange = useCallback(
    (next: string) => {
      setText(next)
      saveDraftCache(next, draftKey)
    },
    [draftKey],
  )

  const handleSelectionAction = useCallback((action: string): void => {
    setNotice(
      action === 'rewrite'
        ? 'AI 自动续写需 draft provider（Gate 3）；正文选区编辑契约在后续票——可复制选段到左侧写作对话。'
        : '选区 AI 调优需正文编辑契约（后续票）——当前版本不伪造调优结果，可手动修改或复制到写作对话。',
    )
  }, [])

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
  }, [book, chapterIndex, text])

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
                  value={text}
                  onChange={handleChange}
                  onSelectionAction={handleSelectionAction}
                  onSelectionChange={onSelectionChange}
                  placeholder={`第 ${chapterIndex} 章正文……（Enter 自动两全角缩进；行首 / 唤起快捷指令；选中文字浮出调优菜单）`}
                />
              </div>
              <div style={{ marginTop: 8 }}>
                <EditorQualityTelemetry content={text} />
              </div>
              {notice !== null && (
                <div className="ir-unavailable" style={{ marginTop: 10 }} role="status">
                  <b style={{ color: 'var(--warning)' }}>AI 选区动作 · 未接入</b>
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
                选区 AI（Bubble 预设/rewrite/deslop）无契约时不伪造结果。
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
