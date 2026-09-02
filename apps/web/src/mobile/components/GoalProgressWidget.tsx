import { TargetIcon } from './MobileIcons'

export interface GoalProgressWidgetProps {
  currentWords?: number
  targetWords?: number
  streakDays?: number
  onClick?: () => void
}

export function GoalProgressWidget({
  currentWords = 3420,
  targetWords = 4000,
  streakDays = 12,
  onClick,
}: GoalProgressWidgetProps): JSX.Element {
  const percentage = Math.min(100, Math.round((currentWords / targetWords) * 100))

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        background: 'var(--surface-shell-mobile)',
        border: '1px solid var(--hairline-subtle-mobile)',
        borderRadius: 14,
        padding: '10px 14px',
        margin: '10px 18px 0',
        cursor: 'pointer',
      }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontSize: 11.5,
            color: 'var(--fg-muted-mobile)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <TargetIcon
            className="svg-icon"
            style={{ width: 13, height: 13, color: 'var(--accent-strong-mobile)' }}
          />
          今日码字目标
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono-mobile)',
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--fg-pure-mobile)',
          }}
        >
          {currentWords.toLocaleString()}{' '}
          <span style={{ fontSize: 11, fontWeight: 'normal', color: 'var(--fg-muted-mobile)' }}>
            / {targetWords.toLocaleString()} 字 ({percentage}%)
          </span>
        </span>
      </div>

      <div
        style={{
          flex: 1,
          height: 6,
          background: 'var(--surface-core-mobile)',
          borderRadius: 999,
          overflow: 'hidden',
          border: '1px solid var(--hairline-subtle-mobile)',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${percentage}%`,
            background: 'linear-gradient(90deg, var(--accent-mobile) 0%, var(--emerald-mobile) 100%)',
            borderRadius: 999,
          }}
        />
      </div>

      <span style={{ fontSize: 11, color: 'var(--emerald-mobile)' }}>连更 {streakDays} 天 ›</span>
    </div>
  )
}
