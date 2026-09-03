import { useEffect, useState } from 'react'
import { TensionSparkWidget } from '../components/TensionSparkWidget'
import { PlotBranchWidget } from '../components/PlotBranchWidget'
import { ProseReadingFlow } from '../components/ProseReadingFlow'
import { MobileComposer } from '../components/MobileComposer'
import { HistoryIcon, ListIcon } from '../components/MobileIcons'
import { post } from '../../lib/post'
import type { BookInfo } from '../../shell/workbenchStorage'
import type { ActiveDrawerType } from '../types'
import type { DraftQuestionResponse } from '../../../server/api'

export interface WorkbenchHubProps {
  book: BookInfo | null
  onOpenDrawer: (type: ActiveDrawerType) => void
}

export function WorkbenchHub({ book, onOpenDrawer }: WorkbenchHubProps): JSX.Element {
  const [currentStage, setCurrentStage] = useState(2)
  const [questionData, setQuestionData] = useState<DraftQuestionResponse | null>(null)
  const [drafting, setDrafting] = useState(false)

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

  const handleSendPrompt = async (prompt: string): Promise<void> => {
    if (drafting) return
    if (book === null) {
      alert('请先建书，再开始正文生成。')
      return
    }

    setDrafting(true)
    try {
      const res = await fetch('/api/draft.stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: book.root,
          chapterIndex: 1,
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
      alert('正文草稿已由真实生成链路完成。请在正文/作品视图查看持久化结果。')
    } catch (error) {
      alert(`草稿生成失败：${(error as Error).message}`)
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
            onClick={() => onOpenDrawer('chapters')}
          >
            <ListIcon className="svg-icon" />
            <span>目录</span>
          </button>
        </div>
      </div>

      <div className="mobile-card" style={{ margin: '10px 18px 0' }}>
        <b>今日码字统计未接入</b>
        <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--fg-muted-mobile)' }}>
          Technical Preview 不展示虚构字数、目标完成率或连更天数。
        </div>
      </div>

      <TensionSparkWidget currentStage={currentStage} onSelectStage={setCurrentStage} />

      <PlotBranchWidget question={questionData?.question} choices={choices} />

      <ProseReadingFlow />

      <MobileComposer
        onSendPrompt={(p) => { void handleSendPrompt(p) }}
        onOpenInspiration={() => onOpenDrawer('inspiration')}
      />
    </>
  )
}
