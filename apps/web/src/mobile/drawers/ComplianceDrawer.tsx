import { useState } from 'react'
import { runLocalComplianceCheck } from '../../shared/complianceCheck'

export function ComplianceDrawer(): JSX.Element {
  const [text, setText] = useState('')
  const [findings, setFindings] = useState<string[]>([])

  const checkCompliance = () => {
    setFindings(runLocalComplianceCheck(text))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="mobile-card" style={{ margin: 0, background: 'var(--surface-core-mobile)' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
          合规审查尚未接入（外部规则库尚未接入）
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 6, lineHeight: 1.6 }}>
          Technical Preview 尚未接入可验证的外部商业审查 API；当前提供本地离线规则核验（架空机构名、排版与引流规避）。
        </div>
      </div>

      <div
        className="mobile-card"
        style={{
          margin: 0,
          background: 'var(--surface-core-mobile)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
          本地离线规则核验
        </div>
        <textarea
          rows={3}
          placeholder="粘贴待审查章节正文段落…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{
            padding: '6px 8px',
            fontSize: 12,
            background: 'var(--surface-sunken)',
            border: '1px solid var(--hairline)',
            borderRadius: 6,
            color: 'var(--fg-pure-mobile)',
            resize: 'vertical',
          }}
        />
        <button
          type="button"
          className="mobile-action-btn"
          onClick={checkCompliance}
          style={{ background: 'var(--accent-mobile, #4f46e5)', color: '#fff' }}
        >
          运行本地规则核验
        </button>
        {findings.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            {findings.map((f, i) => (
              <div
                key={i}
                style={{
                  fontSize: 11,
                  color: f.includes('建议') || f.includes('未闭合') ? 'var(--warning)' : 'var(--success)',
                }}
              >
                • {f}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
