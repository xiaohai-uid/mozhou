/**
 * 一级功能航道注册表（ADR-0027 · 实现票 T40）。
 * 五组 17 项，词表实测自 legacy app-shell-nav（spec #84 §3.1）；
 * 图标沿用原型 codex-ui-ink-orbit.html 的 mono 编码。
 */
export interface ViewItem {
  readonly id: string
  readonly label: string
  readonly icon: string
  /** 任务中心徽标：计数 > 0 时呈现（任务数据源未接入前恒为 0，不假装有后台任务）。 */
  readonly badge?: 'tasks'
}

interface NavGroupShape {
  readonly group: string
  readonly items: readonly ViewItem[]
}

export const NAV_GROUPS = [
  {
    group: '创作',
    items: [
      { id: 'workbench', label: '工作台', icon: '01' },
      { id: 'dialogue', label: '写作对话', icon: '02' },
      { id: 'works', label: '我的作品', icon: '03' },
      { id: 'style-distill', label: '风格蒸馏', icon: '04' },
      { id: 'novel-breakdown', label: '小说拆解', icon: '05' },
    ],
  },
  {
    group: '检视 · Novel OS',
    items: [
      { id: 'story-brain', label: 'Story Brain', icon: 'SB' },
      { id: 'context-receipt', label: '装配看板', icon: 'CR' },
      { id: 'change-matrix', label: '变更矩阵', icon: 'CM' },
      { id: 'quality-gate', label: '质量门', icon: 'QG' },
    ],
  },
  {
    group: '工作流',
    items: [{ id: 'tasks', label: '任务中心', icon: '10', badge: 'tasks' }],
  },
  {
    group: '资源',
    items: [
      { id: 'book-source', label: '书源搜索', icon: '11' },
      { id: 'book-shelf', label: '书源书架', icon: '12' },
      { id: 'capability-square', label: '技能广场', icon: '13' },
      { id: 'rank-scan', label: '网文扫榜', icon: '14' },
      { id: 'web-search', label: '联网搜索', icon: '15' },
      { id: 'cloud-sync', label: '云同步', icon: '16' },
    ],
  },
  {
    group: '账户',
    items: [{ id: 'membership', label: '会员中心', icon: '17' }],
  },
] as const satisfies readonly NavGroupShape[]

export type ViewId = (typeof NAV_GROUPS)[number]['items'][number]['id']

export const VIEW_IDS: readonly ViewId[] = NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => item.id),
)

export const VIEW_COUNT = VIEW_IDS.length

export function isViewId(value: unknown): value is ViewId {
  return typeof value === 'string' && (VIEW_IDS as readonly string[]).includes(value)
}

export function viewLabel(id: ViewId): string {
  for (const group of NAV_GROUPS) {
    const found = group.items.find((item) => item.id === id)
    if (found !== undefined) return found.label
  }
  return id
}
