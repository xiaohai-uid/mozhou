import { useEffect, useState } from 'react'
import { TensionSparkWidget } from '../components/TensionSparkWidget'
import { PlotBranchWidget } from '../components/PlotBranchWidget'
import { ProseReadingFlow } from '../components/ProseReadingFlow'
import { MobileComposer } from '../components/MobileComposer'
import { HistoryIcon, ListIcon } from '../components/MobileIcons'
import { post } from '../../lib/post'
import { chapterDraftKey, loadDraftCache } from '../../shell/workbenchStorage'
import type { BookInfo } from '../../shell/workbenchStorage'
import type { ActiveDrawerType } from '../types'
import type { DraftQuestionResponse, WorksChapterSummary } from '../../../server/api'

export interface WorkbenchHubProps {
  book: BookInfo | null
  onOpenDrawer: (type: ActiveDrawerType) => void
  chapterIndex?: number | undefined
  onSelectChapter?: ((index: number) => void) | undefined
  /** 灵感/情节选择回填管道（MobileShell 注入）。 */
  composerInject?: { id: number; text: string } | undefined
}

export function WorkbenchHub({
  book,
  onOpenDrawer,
  chapterIndex = 1,
  composerInject: shellInject,
}: WorkbenchHubProps): JSX.Element {
  const [currentStage, setCurrentStage] = useState(2)
  const [questionData, setQuestionData] = useState<DraftQuestionResponse | null>(null)
  const [drafting, setDrafting] = useState(false)
  /** 内联反馈（规格 §25.3：alert → inline，业务语义不变）。 */
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  /** works 真实章节元数据（阅读面 + 章切换）。 */
  const [chapterMeta, setChapterMeta] = useState<WorksChapterSummary | null>(null)
  /** 情节选择回填（本地）；与 Shell 灵感管道合并后进 Composer。 */
  const [plotInject, setPlotInject] = useState<{ id: number; text: string } | null>(null)
  const composerInject = shellInject ?? plotInject ?? undefined

  useEffect(() => {
    let mounted = true
    post<DraftQuestionResponse>('/api/draft.question', {})
      .then((q) => {
        if (mounted && q) setQuestionData(q)
      })
      .catch(() => null)

    return () => {
      mounted = false
    }
  }, [])

  // 当前章真实元数据（/api/works）——阅读面标题/字数/Rev 的来源。
  useEffect(() => {
    if (book === null) {
      setChapterMeta(null)
      return
    }
    let mounted = true
    void post<{ ok: boolean; chapters: readonly WorksChapterSummary[] }>('/api/works', { root: book.root })
      .then((data) => {
        if (!mounted) return
        const found = (data.chapters ?? []).find((ch) => ch.chapterIndex === chapterIndex) ?? null
        setChapterMeta(found)
      })
      .catch(() => null)
    return () => {
      mounted = false
    }
  }, [book, chapterIndex])

  // 本地 Active Draft 草稿缓存（桌面写作层与移动端同一 workbenchStorage 面）。
  const draftCacheText = loadDraftCache(chapterDraftKey(chapterIndex))
  const proseParagraphs = draftCacheText
    .split(/\n+/)
    .map((p) => p.replace(/^　+/, '').trim())
    .filter((p) => p.length > 0)

  const handleSendPrompt = async (prompt: string): Promise<void> => {
    if (drafting) return
    if (book === null) {
      setNotice({ kind: 'err', text: '请先建书，再开始正文生成。' })
      return
    }

    setDrafting(true)
    try {
      const res = await fetch('/api/draft.stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: book.root,
          chapterIndex,
          prompt,
          activeSkills: [],
        }),
      })

      const contentType = res.headers.get('Content-Type') ?? ''
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? `草稿请求失败（HTTP ${res.status}）`)
      }
      if (!contentType.includes('ndjson') || res.body === null) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? '草稿服务未返回预期的流式响应')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let completed = false
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (line.length > 0) {
            const frame = JSON.parse(line) as { ok?: boolean; event?: string; error?: string }
            if (frame.ok === false || frame.event === 'error') {
              throw new Error(frame.error ?? '草稿生成失败')
            }
            if (frame.event === 'done') completed = true
          }
          newline = buffer.indexOf('\n')
        }
      }

      if (!completed) throw new Error('草稿流在完成帧之前结束')
      setNotice({ kind: 'ok', text: '正文草稿已由真实生成链路完成并持久化——可在正文/作品视图查看。' })
    } catch (error) {
      setNotice({ kind: 'err', text: `草稿生成失败：${(error as Error).message}` })
    } finally {
      setDrafting(false)
    }
  }

  const choices = questionData?.choices?.map((c, i) => ({
    id: `opt_${i}`,
    text: c,
    tag: i === 0 ? '推荐' : '备选',
  }))

  return (
    <>
      <div className="mobile-hub-header">
        <div className="mobile-hub-title-group">
          <div className="mobile-mark-seal">墨</div>
          <div>
            <h1 className="mobile-hub-title">{book?.title ?? '尚未建书'}</h1>
            <div className="mobile-hub-subtitle">
              {book === null ? '先建立作品后开始章节生产' : '当前章节与统计以作品数据面为准'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="mobile-action-btn"
            onClick={() => onOpenDrawer('history')}
            title="版本历史时光机"
          >
            <HistoryIcon className="svg-icon" />
            <span>时光机</span>
          </button>
          <button
            type="button"
            className="mobile-action-btn"
            data-open-drawer="chapters"
            onClick={() => onOpenDrawer('chapters')}
          >
            <ListIcon className="svg-icon" />
            <span>目录</span>
          </button>
        </div>
      </div>

      {notice !== null && (
        <div
          role={notice.kind === 'err' ? 'alert' : 'status'}
          className={'mobile-inline-note ' + notice.kind}
          style={{ margin: '10px 18px 0' }}
          data-testid="workbench-notice"
        >
          {notice.text}
        </div>
      )}

      <div className="mobile-card" style={{ margin: '10px 18px 0' }}>
        <b>今日码字统计未接入</b>
        <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--fg-muted-mobile)' }}>
          Technical Preview 不展示虚构字数、目标完成率或连更天数。
        </div>
      </div>

      <TensionSparkWidget currentStage={currentStage} onSelectStage={setCurrentStage} />

      <PlotBranchWidget
        question={questionData?.question}
        choices={choices}
        onSelectChoice={(choice) => {
          setPlotInject({ id: Date.now(), text: choice.text })
          setNotice({ kind: 'ok', text: '情节选择已回填写作输入框——可继续补充后发送。' })
        }}
      />

      <ProseReadingFlow
        title={chapterMeta !== null ? `第 ${chapterIndex} 章 · ${chapterMeta.title}` : `第 ${chapterIndex} 章`}
        wordCount={chapterMeta?.wordCount}
        revision={chapterMeta?.revision}
        proseParagraphs={proseParagraphs}
      />
      {proseParagraphs.length > 0 && (
        <p className="mobile-inline-note ok" style={{ margin: '10px 18px 0' }}>
          以上为本地 Active Draft 草稿缓存（非 Chapter Commit）；正式正文读面在后续票接入。
        </p>
      )}

      <MobileComposer
        onSendPrompt={(p) => { void handleSendPrompt(p) }}
        onOpenInspiration={() => onOpenDrawer('inspiration')}
        inject={composerInject}
      />
    </>
  )
}
