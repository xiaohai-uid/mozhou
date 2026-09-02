import { useState, useEffect, useRef } from 'react'
import { SendIcon } from './MobileIcons'
import { loadDraftCache, saveDraftCache } from '../../shell/workbenchStorage'

export interface MobileComposerProps {
  onSendPrompt?: (prompt: string) => void
  onOpenInspiration?: () => void
}

export function MobileComposer({
  onSendPrompt,
  onOpenInspiration,
}: MobileComposerProps): JSX.Element {
  const [text, setText] = useState(() => loadDraftCache('composer_draft'))
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // 动态监听 iOS/Android visualViewport 软键盘高度避让
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return

    const handleViewportResize = () => {
      if (!window.visualViewport) return
      const currentHeight = window.visualViewport.height
      const fullHeight = window.innerHeight
      const offset = Math.max(0, fullHeight - currentHeight)
      setKeyboardOffset(offset)
    }

    window.visualViewport.addEventListener('resize', handleViewportResize)
    window.visualViewport.addEventListener('scroll', handleViewportResize)

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportResize)
      window.visualViewport?.removeEventListener('scroll', handleViewportResize)
    }
  }, [])

  const handleChange = (val: string) => {
    setText(val)
    saveDraftCache(val, 'composer_draft')
  }

  const handleAddTag = (tag: string) => {
    const next = (text ? `${text} ` : '') + tag
    setText(next)
    saveDraftCache(next, 'composer_draft')
    textareaRef.current?.focus()
  }

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSendPrompt?.(trimmed)
    setText('')
    saveDraftCache('', 'composer_draft')
  }

  return (
    <div
      className="composer-bottom-dock"
      style={{
        bottom: keyboardOffset > 0 ? keyboardOffset + 8 : undefined,
      }}
    >
      <div className="composer-context-bar">
        <span>主角视角：陆玄 · 山神庙场景</span>
        <span style={{ color: 'var(--emerald-mobile)' }}>● 服务就绪</span>
      </div>

      <textarea
        ref={textareaRef}
        className="composer-textarea"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="输入推进指令（如：强化雷雨声势、描写赵捕头神色变化）..."
      />

      <div className="composer-bottom-tools">
        <div className="tool-pills-list">
          <button
            type="button"
            className="tool-mini-chip"
            onClick={onOpenInspiration}
          >
            🎲 灵感起名
          </button>
          <button
            type="button"
            className="tool-mini-chip"
            onClick={() => handleAddTag('【增加冲突】')}
          >
            增加冲突
          </button>
          <button
            type="button"
            className="tool-mini-chip"
            onClick={() => handleAddTag('【精简叙述】')}
          >
            精简叙述
          </button>
          <button
            type="button"
            className="tool-mini-chip"
            onClick={() => handleAddTag('【回收伏笔】')}
          >
            回收伏笔
          </button>
        </div>

        <button
          type="button"
          className="send-action-circle"
          onClick={handleSend}
          title="生成草稿"
        >
          <SendIcon className="svg-icon" style={{ stroke: '#fff', width: 16, height: 16 }} />
        </button>
      </div>
    </div>
  )
}
