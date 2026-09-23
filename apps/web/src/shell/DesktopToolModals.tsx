import { useState } from 'react'
import type { BookInfo } from './workbenchStorage'
import { PublicationExportModal } from '../export-suite/PublicationExportModal'
import {
  INSPIRATION_CHARACTERS,
  INSPIRATION_SECTS,
  INSPIRATION_ITEMS,
  INSPIRATION_CRISES,
  getRandomPreset,
} from '../shared/inspirationPresets'

export type DesktopModalType = null | 'history' | 'inspiration' | 'export' | 'compliance'

export interface DesktopToolModalsProps {
  activeModal: DesktopModalType
  onClose: () => void
  book?: BookInfo | null
}

function Unavailable({ children }: { children: string }): JSX.Element {
  return (
    <div className="card" style={{ background: 'var(--surface-raised)', padding: 12 }}>
      <b>{children}尚未接入</b>
      <p className="mono muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
        Technical Preview 不会展示虚构记录，也不会模拟成功操作。接入真实数据面后再开放此功能。
      </p>
    </div>
  )
}

export function DesktopToolModals({ activeModal, onClose, book = null }: DesktopToolModalsProps): JSX.Element | null {
  const [nameResult, setNameResult] = useState('陆玄 / 顾清河 / 赵铁鹰')
  const [sectResult, setSectResult] = useState('太虚道宗 / 九曜魔门')
  const [itemResult, setItemResult] = useState('破煞法弩 / 七绝离火镜')
  const [crisisResult, setCrisisResult] = useState('庙外第三股势力逼近')

  if (activeModal === null) return null

  // 出版导出走独立弹层（自带遮罩与标题），避免与外层卡片双层嵌套。
  if (activeModal === 'export') {
    if (book === null) {
      return (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
        >
          <div className="card-shell" style={{ width: '100%', maxWidth: 580, background: 'var(--surface)', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.9)' }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <b style={{ fontSize: 16 }}>📦 作品导出</b>
                <button className="btn" onClick={onClose}>关闭</button>
              </div>
              <div className="card" style={{ background: 'var(--surface-raised)', padding: 12 }}>
                <b>导出尚未接入（未选作品）</b>
                <p className="mono muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                  Technical Preview 仅支持已打开作品的真实导出（TXT / Word 兼容 Doc / EPUB 3 电子书）；请在工作台打开作品后再执行导出。
                </p>
              </div>
            </div>
          </div>
        </div>
      )
    }
    return <PublicationExportModal isOpen onClose={onClose} root={book.root} bookTitle={book.title} />
  }

  const rollDice = (type: 'name' | 'sect' | 'item' | 'crisis') => {
    if (type === 'name') setNameResult(getRandomPreset(INSPIRATION_CHARACTERS, '陆玄'))
    else if (type === 'sect') setSectResult(getRandomPreset(INSPIRATION_SECTS, '太虚道宗'))
    else if (type === 'item') setItemResult(getRandomPreset(INSPIRATION_ITEMS, '破煞法弩'))
    else setCrisisResult(getRandomPreset(INSPIRATION_CRISES, '突发危机'))
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="card-shell" style={{ width: '100%', maxWidth: 580, background: 'var(--surface)', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.9)' }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <b style={{ fontSize: 16 }}>
              {activeModal === 'history' && '⏱ 版本时光机与差异回滚'}
              {activeModal === 'inspiration' && '🎲 本地灵感起名工坊与卡文骰子'}
              {activeModal === 'compliance' && '🛡️ 平台敏感词与合规审查'}
            </b>
            <button className="btn" onClick={onClose}>关闭</button>
          </div>

          {activeModal === 'history' && <Unavailable>版本历史</Unavailable>}

          {activeModal === 'inspiration' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <button className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => rollDice('name')}>
                <b>🎲 角色龙套起名</b><div className="mono" style={{ color: 'var(--accent-strong)', marginTop: 4 }}>{nameResult}</div>
              </button>
              <button className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => rollDice('sect')}>
                <b>🏯 宗门势力起名</b><div className="mono" style={{ color: 'var(--warning)', marginTop: 4 }}>{sectResult}</div>
              </button>
              <button className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => rollDice('item')}>
                <b>🗡️ 法宝神兵起名</b><div className="mono" style={{ color: 'var(--success)', marginTop: 4 }}>{itemResult}</div>
              </button>
              <button className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => rollDice('crisis')}>
                <b>⚡ 卡文突发事件</b><div className="mono" style={{ color: 'var(--danger)', marginTop: 4 }}>{crisisResult}</div>
              </button>
            </div>
          )}

          {activeModal === 'compliance' && <Unavailable>合规审查</Unavailable>}
        </div>
      </div>
    </div>
  )
}
