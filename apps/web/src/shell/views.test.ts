/**
 * 视图注册表契约测试（实现票 T40）：17 项 / 五组 / id 唯一 /
 * 任务徽标唯一（账面纪律，改动即测试失败）。
 */
import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, isViewId, viewLabel, VIEW_COUNT, VIEW_IDS } from './views'

describe('views 注册表契约', () => {
  it('五组共 17 项，id 全局唯一，徽标仅任务中心持有', () => {
    expect(NAV_GROUPS).toHaveLength(5)
    expect(VIEW_COUNT).toBe(17)
    expect(new Set(VIEW_IDS).size).toBe(17)
    const badgeItems = NAV_GROUPS.flatMap((group) =>
      group.items.filter((item) => 'badge' in item && item.badge === 'tasks'),
    )
    expect(badgeItems).toHaveLength(1)
    expect(badgeItems[0]?.id).toBe('tasks')
  })

  it('isViewId 对非法值显式拒绝；viewLabel 可反查', () => {
    expect(isViewId('workbench')).toBe(true)
    expect(isViewId('no-such-view')).toBe(false)
    expect(isViewId(42)).toBe(false)
    expect(viewLabel('context-receipt')).toBe('装配看板')
  })
})
