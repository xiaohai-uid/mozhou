/**
 * 左侧功能导航（U01 重组）：主任务四域（作品/写作/分镜/素材）一级直达；
 * 其余航道收进「工具箱」可发现折叠组——全部旧入口可达，不把隐藏当删除。
 * 未实现页在切换后呈现显式占位（PlaceholderView），不假装可用。
 */
import { useState } from 'react'
import { NAV_GROUPS, VIEW_COUNT } from './views'
import type { ViewId } from './views'

/** 主任务四域（设计候选确认：作品/写作/分镜/素材）。 */
const PRIMARY_DOMAINS: readonly { id: ViewId; label: string; ico: string }[] = [
  { id: 'works', label: '作品', ico: '📚' },
  { id: 'workbench', label: '写作', ico: '✒️' },
  { id: 'storyboard', label: '分镜', ico: '🎬' },
  { id: 'book-source', label: '素材', ico: '🧰' },
]

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
            <i className="domain-ico">{d.ico}</i>
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
