/**
 * 顶栏（实现票 T40 · 商业化全景升级）：品牌 / 书名切换 / 码字目标环 /
 * 商业化快捷工具（时光机、灵感工坊、导出、敏感词审查）。
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

      {/* 每日码字目标进度条微部件 */}
      <div
        className="quiet-btn"
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        title="今日码字进度"
      >
        <span>🎯 今日码字: 3,420 / 4,000 字 (85%)</span>
      </div>

      <div className="top-actions" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          type="button"
          className="quiet-btn"
          style={{ cursor: 'pointer' }}
          onClick={() => onOpenModal?.('history')}
          title="打开版本时光机"
        >
          ⏱ 时光机
        </button>

        <button
          type="button"
          className="quiet-btn"
          style={{ cursor: 'pointer' }}
          onClick={() => onOpenModal?.('inspiration')}
          title="打开灵感起名工坊"
        >
          🎲 灵感工坊
        </button>

        <button
          type="button"
          className="quiet-btn"
          style={{ cursor: 'pointer' }}
          onClick={() => onOpenModal?.('export')}
          title="导出打包全书"
        >
          📦 导出
        </button>

        <button
          type="button"
          className="quiet-btn"
          style={{ cursor: 'pointer' }}
          onClick={() => onOpenModal?.('compliance')}
          title="网文敏感词审查"
        >
          🛡️ 敏感词
        </button>

        <button className="quiet-btn" disabled title="数据平面为本地存储；云同步就绪">
          <i className="status-dot" />
          本地已就绪
        </button>
      </div>
    </header>
  )
}
