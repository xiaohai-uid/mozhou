/**
 * 顶栏（实现票 T40 · 商业化全景升级）：品牌 / 书名切换 / 码字统计状态 /
 * 商业化快捷工具入口（尚未接线的工具只展示明确不可用状态）。
 */
import type { BookInfo } from './workbenchStorage'
import type { DesktopModalType } from './DesktopToolModals'

export function TopBar({
  book,
  onHome,
  onReplayWizard,
  onOpenModal,
}: {
  book: BookInfo | null
  onHome: () => void
  /** 书切换器重放：已建书时点书名 = 重放首次建书 Wizard（Q3 可重放）。 */
  onReplayWizard: () => void
  onOpenModal?: (modal: DesktopModalType) => void
}): JSX.Element {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="seal">墨</div>
        <div>
          <b>墨舟</b>
          <small>NOVEL OS 2.0</small>
        </div>
      </div>

      <button
        className="book-switch"
        onClick={book === null ? onHome : onReplayWizard}
        title={book === null ? '回到工作台' : '重放首次建书 Wizard'}
      >
        <span className="cover" aria-hidden="true" />
        <span>
          {book === null ? '建立作品' : `《${book.title}》`}
          <em>{book === null ? '尚未建书 · 前往工作台' : '本地书库 · 点按重放 Wizard'}</em>
        </span>
      </button>

      <div className="quiet-btn" style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="每日码字统计尚未接入">
        <span>今日码字统计未接入</span>
      </div>

      <div className="top-actions" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button" className="quiet-btn" onClick={() => onOpenModal?.('history')} title="版本历史尚未接入">
          ⏱ 时光机
        </button>
        <button type="button" className="quiet-btn" onClick={() => onOpenModal?.('inspiration')} title="打开本地灵感工坊">
          🎲 灵感工坊
        </button>
        <button type="button" className="quiet-btn" onClick={() => onOpenModal?.('export')} title="导出尚未接入">
          📦 导出
        </button>
        <button type="button" className="quiet-btn" onClick={() => onOpenModal?.('compliance')} title="合规审查尚未接入">
          🛡️ 敏感词
        </button>
        <button className="quiet-btn" disabled title="数据平面为本地存储；云同步未接入">
          <i className="status-dot" />
          本地已就绪
        </button>
      </div>
    </header>
  )
}
