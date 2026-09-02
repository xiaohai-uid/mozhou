import { useState } from 'react'
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

export function DesktopToolModals({
  activeModal,
  onClose,
}: DesktopToolModalsProps): JSX.Element | null {
  const [nameResult, setNameResult] = useState('陆玄 / 顾清河 / 赵铁鹰')
  const [sectResult, setSectResult] = useState('太虚道宗 / 九曜魔门')
  const [itemResult, setItemResult] = useState('破煞法弩 / 七绝离火镜')
  const [crisisResult, setCrisisResult] = useState('庙外第三股势力逼近')

  if (activeModal === null) return null

  const rollDice = (type: 'name' | 'sect' | 'item' | 'crisis') => {
    if (type === 'name') {
      setNameResult(getRandomPreset(INSPIRATION_CHARACTERS, '陆玄'))
    } else if (type === 'sect') {
      setSectResult(getRandomPreset(INSPIRATION_SECTS, '太虚道宗'))
    } else if (type === 'item') {
      setItemResult(getRandomPreset(INSPIRATION_ITEMS, '破煞法弩'))
    } else if (type === 'crisis') {
      setCrisisResult(getRandomPreset(INSPIRATION_CRISES, '突发危机'))
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="card-shell"
        style={{
          width: '100%',
          maxWidth: 580,
          background: 'var(--surface)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.9)',
        }}
      >
        <div className="card" style={{ padding: 20 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <b style={{ fontSize: 16 }}>
              {activeModal === 'history' && '⏱ 版本时光机与差异回滚 (Diff)'}
              {activeModal === 'inspiration' && '🎲 网文灵感起名工坊与卡文骰子'}
              {activeModal === 'export' && '📦 作品全格式导出与平台打包'}
              {activeModal === 'compliance' && '🛡️ 网文平台敏感词与合规审查'}
            </b>
            <button className="btn" onClick={onClose}>
              关闭
            </button>
          </div>

          {/* 时光机 */}
          {activeModal === 'history' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="card" style={{ background: 'var(--surface-raised)', padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <b>Rev 4 · 当前最新草稿 (自动保存)</b>
                  <span className="cap-badge native">当前版本</span>
                </div>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  10 分钟前 · 增补赵捕头拔刀压迫感
                </span>
              </div>
              <div className="card" style={{ background: 'var(--surface-raised)', padding: 12 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <b>Rev 3 · 30 分钟前快照</b>
                  <button
                    className="btn-primary"
                    style={{ padding: '2px 8px' }}
                    onClick={() => {
                      alert('已安全回滚至 Rev 3！')
                      onClose()
                    }}
                  >
                    恢复此版本
                  </button>
                </div>
                <div
                  style={{
                    marginTop: 8,
                    padding: 8,
                    background: 'rgba(0,0,0,0.4)',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  <span style={{ textDecoration: 'line-through', color: 'var(--danger)' }}>
                    庙门被推开
                  </span>{' '}
                  <span style={{ color: 'var(--success)' }}>庙门哐当一声被撞开</span>
                  ，治安官赵捕头大步跨入...
                </div>
              </div>
            </div>
          )}

          {/* 灵感起名 */}
          {activeModal === 'inspiration' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 10,
                }}
              >
                <button
                  className="card"
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => rollDice('name')}
                >
                  <b>🎲 角色龙套起名</b>
                  <div className="mono" style={{ color: 'var(--accent-strong)', marginTop: 4 }}>
                    {nameResult}
                  </div>
                </button>
                <button
                  className="card"
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => rollDice('sect')}
                >
                  <b>🏯 宗门势力起名</b>
                  <div className="mono" style={{ color: 'var(--warning)', marginTop: 4 }}>
                    {sectResult}
                  </div>
                </button>
                <button
                  className="card"
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => rollDice('item')}
                >
                  <b>🗡️ 法宝神兵起名</b>
                  <div className="mono" style={{ color: 'var(--success)', marginTop: 4 }}>
                    {itemResult}
                  </div>
                </button>
                <button
                  className="card"
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => rollDice('crisis')}
                >
                  <b>⚡ 卡文突发事件</b>
                  <div className="mono" style={{ color: 'var(--danger)', marginTop: 4 }}>
                    {crisisResult}
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* 导出打包 */}
          {activeModal === 'export' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 10,
                }}
              >
                <button
                  className="btn"
                  style={{ padding: 14 }}
                  onClick={() => {
                    alert('已生成 Word (.docx) 标准排版文档！')
                    onClose()
                  }}
                >
                  导出 Word (.docx)
                </button>
                <button
                  className="btn"
                  style={{ padding: 14 }}
                  onClick={() => {
                    alert('已生成纯文本 (.txt)！')
                    onClose()
                  }}
                >
                  导出 纯文本 (.txt)
                </button>
                <button
                  className="btn"
                  style={{ padding: 14 }}
                  onClick={() => {
                    alert('已生成电子书 (.epub)！')
                    onClose()
                  }}
                >
                  导出 电子书 (.epub)
                </button>
                <button
                  className="btn"
                  style={{ padding: 14 }}
                  onClick={() => {
                    alert('已生成 Markdown 归档包！')
                    onClose()
                  }}
                >
                  导出 Markdown (.md)
                </button>
              </div>
              <button
                className="btn-primary"
                style={{ padding: 10, width: '100%' }}
                onClick={() => {
                  alert('当前章已按网文规范（首行缩进两格、去空行）复制到剪贴板！')
                  onClose()
                }}
              >
                番茄 / 起点后台一键复制当前章
              </button>
            </div>
          )}

          {/* 敏感词审查 */}
          {activeModal === 'compliance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="card" style={{ background: 'var(--surface-raised)', padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <b style={{ color: 'var(--success)' }}>
                    ✓ 敏感词全量检测通过 (合规率 100%)
                  </b>
                  <span className="cap-badge native">2026 红线库</span>
                </div>
                <p className="mono muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                  官方机构名已规范采用「龙国特事治安局」等架空命名，暴力与冲突尺度符合全年龄段过审标准。
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
