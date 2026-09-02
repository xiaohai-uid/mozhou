import { useState } from 'react'
import {
  INSPIRATION_CHARACTERS,
  INSPIRATION_SECTS,
  INSPIRATION_ITEMS,
  INSPIRATION_CRISES,
  getRandomPreset,
} from '../../shared/inspirationPresets'

export interface InspirationDrawerProps {
  onClose: () => void
}

export function InspirationDrawer({ onClose }: InspirationDrawerProps): JSX.Element {
  const [nameResult, setNameResult] = useState('陆玄 / 顾清河 / 赵铁鹰')
  const [sectResult, setSectResult] = useState('太虚道宗 / 九曜魔门')
  const [itemResult, setItemResult] = useState('破煞法弩 / 七绝离火镜')
  const [crisisResult, setCrisisResult] = useState('庙外第三股势力逼近')

  const rollName = () => {
    setNameResult(getRandomPreset(INSPIRATION_CHARACTERS, '陆玄'))
  }

  const rollSect = () => {
    setSectResult(getRandomPreset(INSPIRATION_SECTS, '太虚道宗'))
  }

  const rollItem = () => {
    setItemResult(getRandomPreset(INSPIRATION_ITEMS, '破煞法弩'))
  }

  const rollCrisis = () => {
    setCrisisResult(getRandomPreset(INSPIRATION_CRISES, '突发危机'))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-muted-mobile)' }}>
        点击卡片随机摇号生成元素，快速启发情节构思：
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        <button
          type="button"
          className="mobile-card"
          style={{
            margin: 0,
            padding: 12,
            cursor: 'pointer',
            textAlign: 'left',
            background: 'var(--surface-core-mobile)',
            border: '1px solid var(--hairline-crisp-mobile)',
          }}
          onClick={rollName}
        >
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg-pure-mobile)' }}>
            🎲 角色龙套起名
          </div>
          <div style={{ fontSize: 11, color: 'var(--accent-strong-mobile)', marginTop: 4 }}>
            {nameResult}
          </div>
        </button>

        <button
          type="button"
          className="mobile-card"
          style={{
            margin: 0,
            padding: 12,
            cursor: 'pointer',
            textAlign: 'left',
            background: 'var(--surface-core-mobile)',
            border: '1px solid var(--hairline-crisp-mobile)',
          }}
          onClick={rollSect}
        >
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg-pure-mobile)' }}>
            🏯 宗门势力起名
          </div>
          <div style={{ fontSize: 11, color: 'var(--gold-mobile)', marginTop: 4 }}>
            {sectResult}
          </div>
        </button>

        <button
          type="button"
          className="mobile-card"
          style={{
            margin: 0,
            padding: 12,
            cursor: 'pointer',
            textAlign: 'left',
            background: 'var(--surface-core-mobile)',
            border: '1px solid var(--hairline-crisp-mobile)',
          }}
          onClick={rollItem}
        >
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg-pure-mobile)' }}>
            🗡️ 法宝神兵起名
          </div>
          <div style={{ fontSize: 11, color: 'var(--emerald-mobile)', marginTop: 4 }}>
            {itemResult}
          </div>
        </button>

        <button
          type="button"
          className="mobile-card"
          style={{
            margin: 0,
            padding: 12,
            cursor: 'pointer',
            textAlign: 'left',
            background: 'var(--surface-core-mobile)',
            border: '1px solid var(--hairline-crisp-mobile)',
          }}
          onClick={rollCrisis}
        >
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg-pure-mobile)' }}>
            ⚡ 卡文突发事件
          </div>
          <div style={{ fontSize: 11, color: 'var(--rose-mobile)', marginTop: 4 }}>
            {crisisResult}
          </div>
        </button>
      </div>

      <button
        type="button"
        className="mobile-action-btn"
        style={{
          width: '100%',
          justifyContent: 'center',
          padding: 10,
          background: 'var(--accent-mobile)',
          color: '#fff',
          border: 'none',
          marginTop: 6,
        }}
        onClick={() => {
          alert(`已将灵感元素填入写作上下文：${nameResult}`)
          onClose()
        }}
      >
        采用灵感并返回写作
      </button>
    </div>
  )
}
