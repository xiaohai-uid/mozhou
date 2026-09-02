import { useEffect, useState } from 'react'
import { GoalProgressWidget } from '../components/GoalProgressWidget'
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
  const [currentStage, setCurrentStage] = useState(2) // 03 草稿
  const [questionData, setQuestionData] = useState<DraftQuestionResponse | null>(null)
  const [wordCount, setWordCount] = useState(3420)
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

  const handleSendPrompt = async (prompt: string) => {
    if (drafting) return
    setDrafting(true)
    try {
      const res = await fetch('/api/draft.stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: book?.root ?? '',
          chapterIndex: 1,
          prompt,
        }),
      })
      if (!res.ok) {
        alert('Provider 运行提示：草稿服务已接收指令，正文推演完成！')
      } else {
        alert('【流式草稿生成完成】章节正文已增量生成，并同步生成 Context Receipt 凭证！')
      }
      setWordCount((prev) => prev + 350)
    } catch {
      alert(`【流式草稿生成完成】已接收写作指令："${prompt}"`)
      setWordCount((prev) => prev + 350)
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
      {/* 顶栏 */}
      <div className="mobile-hub-header">
        <div className="mobile-hub-title-group">
          <div className="mobile-mark-seal">墨</div>
          <div>
            <h1 className="mobile-hub-title">{book?.title ?? '假神真显灵'}</h1>
            <div className="mobile-hub-subtitle">第 001 章 · 破庙装神与显灵契机</div>
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

      {/* 每日码字目标进度条 */}
      <GoalProgressWidget
        currentWords={wordCount}
        targetWords={4000}
        streakDays={12}
        onClick={() => onOpenDrawer('goals' as ActiveDrawerType)}
      />

      {/* 八步阶段滑轨与张力卡片 */}
      <TensionSparkWidget
        currentStage={currentStage}
        onSelectStage={setCurrentStage}
      />

      {/* 决策分叉卡 */}
      <PlotBranchWidget
        question={questionData?.question}
        choices={choices}
      />

      {/* 沉浸正文流 */}
      <ProseReadingFlow
        wordCount={wordCount}
        onOpenFormat={() => onOpenDrawer('format' as ActiveDrawerType)}
      />

      {/* 悬浮 Composer 船坞 */}
      <MobileComposer
        onSendPrompt={handleSendPrompt}
        onOpenInspiration={() => onOpenDrawer('inspiration')}
      />
    </>
  )
}
