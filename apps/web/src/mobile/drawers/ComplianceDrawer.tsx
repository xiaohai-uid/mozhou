import { useState } from 'react'

export function ComplianceDrawer(): JSX.Element {
  const [text, setText] = useState('')
  const [findings, setFindings] = useState<string[]>([])

  const checkCompliance = () => {
    const list: string[] = []
    if (!text.trim()) {
      setFindings(['请输入待审查的正文段落'])
      return
    }
    const realOfficialNames = ['公安部', '国务院', '中纪委', '省委', '市委', '信访局']
    for (const name of realOfficialNames) {
      if (text.includes(name)) {
        list.push(`发现真实官方机构名「${name}」：建议架空为龙国治安局、特事处等`)
      }
    }
    if (/(?:qq|微信|vx|vx号|扣扣|群号)[\s:：]*[0-9a-zA-Z]{5,}/i.test(text)) {
      list.push('发现疑似联系方式/社交账号引流违规表达，建议移除')
    }
    const leftQuotes = (text.match(/“/g) || []).length
    const rightQuotes = (text.match(/”/g) || []).length
    if (leftQuotes !== rightQuotes) {
      list.push(`引号未闭合：左引号 ${leftQuotes} 处，右引号 ${rightQuotes} 处`)
    }
    if (list.length === 0) {
      list.push('本地基础规则检查通过：未发现真实机构冲突、未闭合引号或违规引流。')
    }
    setFindings(list)
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
