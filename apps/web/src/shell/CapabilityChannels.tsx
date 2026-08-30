/**
 * 左侧五组功能航道（实现票 T40）：17 项一级功能全部常驻可见可达
 * （spec #84 US3）。点击切换视图状态；未实现页在切换后呈现显式占位
 * （PlaceholderView），不假装可用。
 */
import { NAV_GROUPS, VIEW_COUNT } from './views'
import type { ViewId } from './views'

export function CapabilityChannels({
  activeView,
  onSelect,
  taskCount,
}: {
  activeView: ViewId
  onSelect: (view: ViewId) => void
  taskCount: number
}): JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>CAPABILITY INDEX</span>
        <span>{VIEW_COUNT}</span>
      </div>
      <nav aria-label="完整功能导航">
        {NAV_GROUPS.map(({ group, items }) => (
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
    </aside>
  )
}
