import { useState } from 'react'

export interface PlotBranchChoice {
  id: string
  text: string
  tag: string
}

export interface PlotBranchWidgetProps {
  question?: string | undefined
  choices?: PlotBranchChoice[] | undefined
  onSelectChoice?: (choice: PlotBranchChoice) => void
}

export function PlotBranchWidget({
  question,
  choices,
  onSelectChoice,
}: PlotBranchWidgetProps): JSX.Element {
  const available = typeof question === 'string' && question.trim().length > 0 && Array.isArray(choices) && choices.length > 0
  const activeChoices = available ? choices : []
  const [selectedId, setSelectedId] = useState<string>('')

  const handleSelect = (choice: PlotBranchChoice): void => {
    setSelectedId(choice.id)
    onSelectChoice?.(choice)
  }

  if (!available) {
    return (
      <div className="mobile-card">
        <b>情节走向推演尚未生成</b>
        <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--fg-muted-mobile)', lineHeight: 1.6 }}>
          Technical Preview 仅展示真实生成链路返回的问题与候选，不使用示例情节冒充当前作品建议。
        </div>
      </div>
    )
  }

  return (
    <div className="mobile-card">
      <div className="mobile-card-header">
        <span className="mobile-card-title">
          <svg
            className="svg-icon"
            style={{ color: 'var(--accent-strong-mobile)' }}
            viewBox="0 0 24 24"
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          情节走向推演
        </span>
        <span className="mobile-tag accent">生成结果</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div
          style={{
            fontFamily: 'var(--font-prose-mobile)',
            fontSize: 14.5,
            lineHeight: 1.6,
            color: 'var(--fg-primary-mobile)',
          }}
        >
          {question}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activeChoices.map((choice) => {
            const isSelected = choice.id === selectedId
            return (
              <div
                key={choice.id}
                style={{
                  padding: '10px 12px',
                  background: isSelected ? 'var(--accent-soft-mobile)' : 'var(--surface-core-mobile)',
                  border: `1px solid ${isSelected ? 'var(--accent-mobile)' : 'var(--hairline-crisp-mobile)'}`,
                  borderRadius: 12,
                  fontSize: 13,
                  color: isSelected ? 'var(--fg-pure-mobile)' : 'var(--fg-secondary-mobile)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onClick={() => handleSelect(choice)}
              >
                <span>{choice.text}</span>
                <span className={`mobile-tag ${isSelected ? 'accent' : ''}`}>{choice.tag}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
