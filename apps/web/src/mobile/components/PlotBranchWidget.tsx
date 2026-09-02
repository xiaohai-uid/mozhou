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

const DEFAULT_CHOICES: PlotBranchChoice[] = [
  { id: 'opt_1', text: '借夜雷与袖中白磷引燃神像背光（回收道具伏笔）', tag: '契合' },
  { id: 'opt_2', text: '反客为主：揭露赵捕头私下纳妾的秘密', tag: '备选' },
]

export function PlotBranchWidget({
  question,
  choices,
  onSelectChoice,
}: PlotBranchWidgetProps): JSX.Element {
  const activeQuestion = question || '赵捕头按佩刀逼问神像真容时，陆玄如何化解危机？'
  const activeChoices = choices && choices.length > 0 ? choices : DEFAULT_CHOICES
  const [selectedId, setSelectedId] = useState<string>(activeChoices[0]?.id || '')

  const handleSelect = (c: PlotBranchChoice) => {
    setSelectedId(c.id)
    onSelectChoice?.(c)
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
        <span className="mobile-tag accent">逻辑推荐</span>
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
          {activeChoices.map((c) => {
            const isSel = c.id === selectedId
            return (
              <div
                key={c.id}
                style={{
                  padding: '10px 12px',
                  background: isSel ? 'var(--accent-soft-mobile)' : 'var(--surface-core-mobile)',
                  border: `1px solid ${isSel ? 'var(--accent-mobile)' : 'var(--hairline-crisp-mobile)'}`,
                  borderRadius: 12,
                  fontSize: 13,
                  color: isSel ? 'var(--fg-pure-mobile)' : 'var(--fg-secondary-mobile)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onClick={() => handleSelect(c)}
              >
                <span>{c.text}</span>
                <span className={`mobile-tag ${isSel ? 'accent' : ''}`}>{c.tag}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
