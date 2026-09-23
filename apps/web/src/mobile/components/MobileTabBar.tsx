import { EditIcon, InspectIcon, BookIcon, GlobeIcon, SettingsIcon } from './MobileIcons'

export type MobileHubId = 'workbench' | 'inspector' | 'works' | 'resources' | 'system'

export interface MobileTabBarProps {
  activeHub: MobileHubId
  onSelectHub: (hub: MobileHubId) => void
}

export function MobileTabBar({ activeHub, onSelectHub }: MobileTabBarProps): JSX.Element {
  return (
    <nav className="mobile-tabbar" aria-label="移动端核心导航">
      <button
        type="button"
        data-hub="workbench"
        className={`mobile-tabbar-item ${activeHub === 'workbench' ? 'active' : ''}`}
        onClick={() => onSelectHub('workbench')}
      >
        <EditIcon className="svg-icon" />
        <span className="mobile-tabbar-label">创作</span>
      </button>

      <button
        type="button"
        data-hub="inspector"
        className={`mobile-tabbar-item ${activeHub === 'inspector' ? 'active' : ''}`}
        onClick={() => onSelectHub('inspector')}
      >
        <InspectIcon className="svg-icon" />
        <span className="mobile-tabbar-label">检视</span>
      </button>

      <button
        type="button"
        data-hub="works"
        className={`mobile-tabbar-item ${activeHub === 'works' ? 'active' : ''}`}
        onClick={() => onSelectHub('works')}
      >
        <BookIcon className="svg-icon" />
        <span className="mobile-tabbar-label">作品</span>
      </button>

      <button
        type="button"
        data-hub="resources"
        className={`mobile-tabbar-item ${activeHub === 'resources' ? 'active' : ''}`}
        onClick={() => onSelectHub('resources')}
      >
        <GlobeIcon className="svg-icon" />
        <span className="mobile-tabbar-label">书源</span>
      </button>

      <button
        type="button"
        data-hub="system"
        data-testid="tab-system"
        className={`mobile-tabbar-item ${activeHub === 'system' ? 'active' : ''}`}
        onClick={() => onSelectHub('system')}
      >
        <SettingsIcon className="svg-icon" />
        <span className="mobile-tabbar-label">设置</span>
      </button>
    </nav>
  )
}
