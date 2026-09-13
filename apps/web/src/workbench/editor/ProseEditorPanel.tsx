/**
 * 正文写作层（Reading Slate · ADR-0028 · P1-2 修订落地）：
 * 把已存在的 editor 组件链（Canvas + Slash + Bubble）正式挂载进 Workbench。
 *
 * 持久化：Active Draft 本地草稿缓存（mozhou.draft.cache.ch<N>，与移动端/账本
 * 同一 workbenchStorage 纪律）——这是作者的工作文本，不是 Chapter Commit。
 * AI 选区动作（bubble 预设 / rewrite / deslop）：当前无正文编辑 AI 契约——
 * 呈现诚实不可用（需 provider/契约），不伪造调优结果。
 * 质量遥测条：@mozhou/quality-engine 包根携 node:crypto，不进浏览器包——
 * 留出插槽并诚实标注（EditorQualityTelemetry 已 Ink Realm 化，待安全子路径）。
 */
import { useCallback, useMemo, useState } from 'react'
import { post } from '../../lib/post'
import { NovelEditorCanvas } from './NovelEditorCanvas'
import { chapterDraftKey, loadDraftCache, saveDraftCache } from '../../shell/workbenchStorage'
import type { BookInfo } from '../../shell/workbenchStorage'

export interface ProseEditorPanelProps {
  book: BookInfo | null
  chapterIndex: number
}

export function ProseEditorPanel({ book, chapterIndex }: ProseEditorPanelProps): JSX.Element {
  const [text, setText] = useState(() => loadDraftCache(chapterDraftKey(chapterIndex)))
  const [loadedFor, setLoadedFor] = useState(chapterIndex)
  const [notice, setNotice] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<{ kind: 'busy' | 'ok' | 'err'; text: string } | null>(null)

  // 切章：载入对应章的本地 Active Draft 缓存
  if (loadedFor !== chapterIndex) {
    setLoadedFor(chapterIndex)
    setText(loadDraftCache(chapterDraftKey(chapterIndex)))
    setNotice(null)
  }

  const handleChange = useCallback(
    (next: string) => {
      setText(next)
      saveDraftCache(next, chapterDraftKey(chapterIndex))
    },
    [chapterIndex],
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
    return `${chars} 字 · 本地缓存 ${chapterDraftKey(chapterIndex)}`
  }, [text, chapterIndex])

  /** Accept → Active Draft：作者显式把写作层文本落为当前章草稿（phase 恒 draft；
   *  Commit 仍只经管线质量门后的 commitChapter）。成功后广播遥测刷新。 */
  const handleSaveAsDraft = useCallback(async (): Promise<void> => {
    if (book === null || text.trim() === '') return
    setNotice(null)
    setSaveState({ kind: 'busy', text: '落盘中…' })
    try {
      const result = await post<{ ok: boolean; revision: number; phase: 'draft'; created: boolean }>(
        '/api/chapter.prose.save',
        { root: book.root, chapterIndex, body: text, title: book.title },
      )
      setSaveState({
        kind: 'ok',
        text: `已落为当前章草稿 r${result.revision}${result.created ? '（新建章）' : ''}——Active Draft；Commit 经质量门后由管线执行（Accepted ≠ Committed）。`,
      })
      window.dispatchEvent(new CustomEvent('mozhou:telemetry-refresh'))
    } catch (cause) {
      setSaveState({ kind: 'err', text: `落盘失败：${(cause as Error).message}` })
    }
  }, [book, chapterIndex, text])

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
              <div style={{ marginTop: 10 }}>
                <NovelEditorCanvas
                  value={text}
                  onChange={handleChange}
                  onSelectionAction={handleSelectionAction}
                  placeholder={`第 ${chapterIndex} 章正文……（Enter 自动两全角缩进；行首 / 唤起快捷指令；选中文字浮出调优菜单）`}
                />
              </div>
              {notice !== null && (
                <div className="ir-unavailable" style={{ marginTop: 10 }} role="status">
                  <b style={{ color: 'var(--warning)' }}>AI 选区动作 · 未接入</b>
                  <br />
                  <span>{notice}</span>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-author"
                  disabled={saveState?.kind === 'busy' || text.trim() === ''}
                  onClick={() => { void handleSaveAsDraft() }}
                  data-testid="prose-accept-draft"
                  title="Accept：把写作层文本落为当前章 Active Draft（phase 恒 draft；Commit 经质量门后由管线执行）"
                >
                  {saveState?.kind === 'busy' ? '落盘中…' : '落为当前章草稿（Accept → Active Draft）'}
                </button>
                <span className="note" style={{ fontSize: 11 }}>
                  Candidate（写作对话）→ Accept（本按钮/采纳进写作层）→ Active Draft → Commit（质量门后）
                </span>
              </div>
              <p className="note" style={{ margin: '8px 0 0', fontSize: 11 }}>
                这是作者的 Active Draft 工作面（本地草稿缓存，非 Chapter Commit）；质量遥测条待
                quality-engine 浏览器安全导出后接入。选区 AI（Bubble 预设/rewrite/deslop）无契约时不伪造结果。
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
