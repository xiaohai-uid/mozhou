/**
 * 左侧功能导航（U01 重组）：主任务四域（作品/写作/分镜/素材）一级直达；
 * 其余航道收进「工具箱」可发现折叠组——全部旧入口可达，不把隐藏当删除。
 * 未实现页在切换后呈现显式占位（PlaceholderView），不假装可用。
 */
import { useState } from 'react'
import { NAV_GROUPS, VIEW_COUNT } from './views'
import type { ViewId } from './views'

/** 主任务四域：保留既有信息架构，视觉升级不改变导航契约。 */
const PRIMARY_DOMAINS: readonly { id: ViewId; label: string; icon: 'pen' | 'book' | 'graph' | 'kit' | 'board' | 'source' | 'task' }[] = [
  { id: 'workbench', label: '创作', icon: 'pen' },
  { id: 'works', label: '作品', icon: 'book' },
  { id: 'storyboard', label: '分镜', icon: 'board' },
  { id: 'book-source', label: '素材', icon: 'source' },
]

const NAV_ICON_PATHS = {
  pen: 'M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Zm9.5-12.5 3 3M12 4l1.5-1.5a2.1 2.1 0 0 1 3 3L15 7',
  book: 'M5 4.5h8a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5Zm11 3h3v12h-3M8 8h5M8 11h5',
  graph: 'M6 6h4v4H6zM14 14h4v4h-4zM14 5h4v4h-4zM10 8h4M8 10v4h6M16 9v5',
  kit: 'M5 7h14v12H5zM8 7V5h8v2M9 11h6M9 15h4',
  board: 'M4 5h16v14H4zM8 9h3v3H8zM13 9h3M13 12h3M8 15h8',
  source: 'M4 6h7l2 2h7v10H4zM8 12h8M8 15h5',
  task: 'M5 5h14v14H5zM8 9l1.5 1.5L12 8M13 10h3M8 14l1.5 1.5L12 13M13 15h3',
} as const

function NavGlyph({ name }: { name: keyof typeof NAV_ICON_PATHS }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.45} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={NAV_ICON_PATHS[name]} />
    </svg>
  )
}

export function CapabilityChannels({
  activeView,
  onSelect,
  taskCount,
}: {
  activeView: ViewId
  onSelect: (view: ViewId) => void
  taskCount: number
}): JSX.Element {
  const primaryIds = new Set(PRIMARY_DOMAINS.map((d) => d.id))
  const toolboxGroups = NAV_GROUPS
    .map(({ group, items }) => ({ group, items: items.filter((item) => !primaryIds.has(item.id)) }))
    .filter((g) => g.items.length > 0)
  const activeInToolbox = !primaryIds.has(activeView)
  const [toolboxOpen, setToolboxOpen] = useState(activeInToolbox)

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>墨舟 · 主导航</span>
        <span>{VIEW_COUNT}</span>
      </div>
      <nav aria-label="主导航">
        {PRIMARY_DOMAINS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={'nav-domain' + (d.id === activeView ? ' active' : '')}
            data-view={d.id}
            aria-current={d.id === activeView ? 'page' : undefined}
            onClick={() => onSelect(d.id)}
          >
            <i className="domain-ico"><NavGlyph name={d.icon} /></i>
            <span>{d.label}</span>
          </button>
        ))}
      </nav>
      <button
        type="button"
        className="nav-toolbox-toggle"
        aria-expanded={toolboxOpen}
        onClick={() => setToolboxOpen((v) => !v)}
        data-testid="nav-toolbox-toggle"
      >
        <span>工具箱（{toolboxGroups.reduce((a, g) => a + g.items.length, 0)} 项）</span>
        <span>{toolboxOpen ? '▴' : '▾'}</span>
      </button>
      {toolboxOpen && (
        <nav className="nav-toolbox-groups" aria-label="工具箱">
          {toolboxGroups.map(({ group, items }) => (
            <div className="nav-group" key={group}>
              <div className="nav-label">{group}</div>
              {items.map((item) => (
                <button
                  key={item.id}
                  className={'nav-item' + (item.id === activeView ? ' active' : '')}
                  data-view={item.id}
                  aria-current={item.id === activeView ? 'page' : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <i>{item.icon}</i>
                  <span>{item.label}</span>
                  {'badge' in item && item.badge === 'tasks' && taskCount > 0 ? (
                    <b className="count">{taskCount}</b>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
      )}
    </aside>
  )
}
