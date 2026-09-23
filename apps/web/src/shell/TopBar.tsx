/**
 * 顶栏（实现票 T40 · Ink Realm 墨境化，ADR-0028）：
 * 品牌 / 书名切换 / 码字统计状态 / 场景系统入口 / 商业化快捷工具入口
 * （尚未接线的工具只展示明确不可用状态）。图标为 18px/1.4px stroke 自有
 * SVG 线性图标——emoji 不再作为正式 UI 图标（规格 §9）。
 */
import type { BookInfo } from './workbenchStorage'
import type { DesktopModalType } from './DesktopToolModals'

function ToolIcon({ path }: { path: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

const ICONS = {
  history: 'M12 7v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z',
  inspiration: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  export: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  compliance: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  scene: 'M3 5h18v12H3zM3 13l5-4 4 3 3-2 6 4M8.5 8.5h.01',
} as const

export function TopBar({
  book,
  onHome,
  onReplayWizard,
  onOpenModal,
  onOpenScene,
}: {
  book: BookInfo | null
  onHome: () => void
  /** 书切换器重放：已建书时点书名 = 重放首次建书 Wizard（Q3 可重放）。 */
  onReplayWizard: () => void
  onOpenModal?: (modal: DesktopModalType) => void
  /** 墨境场景设置入口（Scene System 一等公民，规格 §3.5）。 */
  onOpenScene?: () => void
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

      <div className="quiet-btn quiet-btn-static" style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="每日码字统计尚未接入">
        <span className="quiet-btn-static-label">今日码字统计未接入</span>
      </div>

      <div className="top-actions" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button" className="quiet-btn" onClick={() => onOpenScene?.()} title="墨境场景设置（背景 / 氛围 / 人物 / 作用域）">
          <ToolIcon path={ICONS.scene} /> <span className="top-btn-label">场景</span>
        </button>
        <button type="button" className="quiet-btn" onClick={() => onOpenModal?.('history')} title="版本历史尚未接入">
          <ToolIcon path={ICONS.history} /> <span className="top-btn-label">时光机</span>
        </button>
        <button type="button" className="quiet-btn" onClick={() => onOpenModal?.('inspiration')} title="打开本地灵感工坊">
          <ToolIcon path={ICONS.inspiration} /> <span className="top-btn-label">灵感工坊</span>
        </button>
        <button type="button" className="quiet-btn" onClick={() => onOpenModal?.('export')} title="导出尚未接入">
          <ToolIcon path={ICONS.export} /> <span className="top-btn-label">导出</span>
        </button>
        <button type="button" className="quiet-btn" onClick={() => onOpenModal?.('compliance')} title="合规审查尚未接入">
          <ToolIcon path={ICONS.compliance} /> <span className="top-btn-label">敏感词</span>
        </button>
        <button className="quiet-btn" disabled title="数据平面为本地存储；云同步未接入">
          <i className="status-dot" />
          <span className="top-btn-label">本地已就绪</span>
        </button>
      </div>
    </header>
  )
}
