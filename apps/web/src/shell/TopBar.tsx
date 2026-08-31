/**
 * 顶栏（实现票 T40）：品牌 / 书名切换（未建书时指向工作台建书卡）/
 * 全局状态。技能注册表抽屉、搜索与命令面板随后续实现票接入，
 * 以 disabled 显式呈现，不假装可用。
 */
import type { BookInfo } from './workbenchStorage'

export function TopBar({
  book,
  onHome,
  onReplayWizard,
}: {
  book: BookInfo | null
  onHome: () => void
  /** 书切换器重放：已建书时点书名 = 重放首次建书 Wizard（Q3 可重放）。 */
  onReplayWizard: () => void
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

      <button className="quiet-btn" disabled title="能力注册表抽屉随后续实现票接入">
        ⌘&nbsp; 能力注册表
      </button>

      <div className="top-actions">
        <button className="quiet-btn" disabled title="数据平面为本地存储；云同步随后续实现票接入">
          <i className="status-dot" />
          本地已就绪
        </button>
        <button className="iconbtn" disabled aria-label="搜索（未实现）" title="搜索：未实现">
          ⌕
        </button>
        <button className="iconbtn" disabled aria-label="命令面板（未实现）" title="命令面板：未实现">
          ⌘
        </button>
      </div>
    </header>
  )
}
