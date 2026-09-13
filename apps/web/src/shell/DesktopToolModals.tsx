/**
 * 桌面辅助工具面板（T40 · Ink Realm Modal Discipline 修订，ADR-0028）：
 * History / Inspiration / Export / Compliance 属非 blocking 工具——按规格 §9/§23
 * 以右侧 non-blocking Sheet 呈现（不设全屏 scrim，写作上下文不被遮死），
 * Escape / 收起按钮关闭。灵感骰子为本地预设（LOCAL PRESET，零 AI 生成）。
 */
import { useState } from 'react'
import { useSheetA11y } from './useSheetA11y'
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
}

const TITLES: Record<Exclude<DesktopModalType, null>, string> = {
  history: '版本时光机与差异回滚',
  inspiration: '本地灵感起名工坊与卡文骰子',
  export: '作品导出',
  compliance: '平台敏感词与合规审查',
}

function Unavailable({ children }: { children: string }): JSX.Element {
  return (
    <div className="ir-unavailable">
      <b style={{ color: 'var(--warning)' }}>{children}尚未接入</b>
      <br />
      <span style={{ fontSize: 12 }}>
        Technical Preview 不会展示虚构记录，也不会模拟成功操作。接入真实数据面后再开放此功能。
      </span>
    </div>
  )
}

export function DesktopToolModals({ activeModal, onClose }: DesktopToolModalsProps): JSX.Element | null {
  const [nameResult, setNameResult] = useState('陆玄 / 顾清河 / 赵铁鹰')
  const [sectResult, setSectResult] = useState('太虚道宗 / 九曜魔门')
  const [itemResult, setItemResult] = useState('破煞法弩 / 七绝离火镜')
  const [crisisResult, setCrisisResult] = useState('庙外第三股势力逼近')

  const { panelRef } = useSheetA11y(activeModal !== null, onClose)

  if (activeModal === null) return null

  const rollDice = (type: 'name' | 'sect' | 'item' | 'crisis') => {
    if (type === 'name') setNameResult(getRandomPreset(INSPIRATION_CHARACTERS, '陆玄'))
    else if (type === 'sect') setSectResult(getRandomPreset(INSPIRATION_SECTS, '太虚道宗'))
    else if (type === 'item') setItemResult(getRandomPreset(INSPIRATION_ITEMS, '破煞法弩'))
    else setCrisisResult(getRandomPreset(INSPIRATION_CRISES, '突发危机'))
  }

  return (
    <aside
      ref={panelRef}
      className="capability-sheet"
      role="dialog"
      aria-label={TITLES[activeModal]}
      data-testid="desktop-tool-sheet"
    >
      <div className="scene-sheet-head">
        <div>
          <div className="kicker">DESKTOP TOOL · 非阻塞面板</div>
          <b style={{ fontFamily: 'var(--serif)', fontSize: 16 }}>{TITLES[activeModal]}</b>
        </div>
        <button type="button" className="quiet-btn" onClick={onClose} data-autofocus>
          收起 ✕
        </button>
      </div>
      <div className="scene-sheet-body">
        {activeModal === 'history' && <Unavailable>版本历史</Unavailable>}

        {activeModal === 'inspiration' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button type="button" className="card-capability cap" style={{ minHeight: 0 }} onClick={() => rollDice('name')}>
                <span className="cap-statusbar"><span className="badge b-neutral">LOCAL PRESET</span></span>
                <b className="cap-label" style={{ minHeight: 0 }}>角色龙套起名</b>
                <span className="cap-desc" style={{ color: 'var(--jade)' }}>{nameResult}</span>
              </button>
              <button type="button" className="card-capability cap" style={{ minHeight: 0 }} onClick={() => rollDice('sect')}>
                <span className="cap-statusbar"><span className="badge b-neutral">LOCAL PRESET</span></span>
                <b className="cap-label" style={{ minHeight: 0 }}>宗门势力起名</b>
                <span className="cap-desc" style={{ color: 'var(--warning)' }}>{sectResult}</span>
              </button>
              <button type="button" className="card-capability cap" style={{ minHeight: 0 }} onClick={() => rollDice('item')}>
                <span className="cap-statusbar"><span className="badge b-neutral">LOCAL PRESET</span></span>
                <b className="cap-label" style={{ minHeight: 0 }}>法宝神兵起名</b>
                <span className="cap-desc" style={{ color: 'var(--success)' }}>{itemResult}</span>
              </button>
              <button type="button" className="card-capability cap" style={{ minHeight: 0 }} onClick={() => rollDice('crisis')}>
                <span className="cap-statusbar"><span className="badge b-neutral">LOCAL PRESET</span></span>
                <b className="cap-label" style={{ minHeight: 0 }}>卡文突发事件</b>
                <span className="cap-desc" style={{ color: 'var(--danger)' }}>{crisisResult}</span>
              </button>
            </div>
            <p className="muted" style={{ fontSize: 11, lineHeight: 1.7, marginTop: 12 }}>
              本地随机预设，零 API、零 AI 生成。
            </p>
          </>
        )}

        {activeModal === 'export' && <Unavailable>导出</Unavailable>}
        {activeModal === 'compliance' && <Unavailable>合规审查</Unavailable>}
      </div>
    </aside>
  )
}
