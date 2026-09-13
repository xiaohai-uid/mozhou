/**
 * 云同步与备份（CloudSyncView）组件测试（实现票 T54）：
 * - 契约快照：输入形状 = server/api 导出类型（CloudSyncResponse），
 *   包类型漂移即 typecheck + 快照双报警；
 * - 离线优先状态、存储指标与快照创建交互；
 * - 隐私声明卡片展示。
 */
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloudSyncResponse } from '../../server/api'
import { okJson } from '../test/http'
import { CloudSyncView } from './CloudSyncView'

afterEach(() => {
  vi.unstubAllGlobals()
})

const MOCK_SYNC: CloudSyncResponse = {
  ok: true,
  localReady: true,
  syncStatus: 'offline_ready',
  lastLocalSnapshotAt: '2026-08-31T12:00:00.000Z',
  pendingChangesCount: 0,
  storageUsage: {
    localCanonFiles: 15,
    databaseBytes: 1024 * 64,
  },
}

describe('CloudSyncView（云同步与备份）', () => {
  it('状态监控与存储指标渲染；契约快照', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_SYNC)))
    const { container } = render(<CloudSyncView root="C:/tmp/book" />)

    await waitFor(() => {
      expect(screen.getByTestId('sync-status-section')).toBeInTheDocument()
    })

    expect(screen.getByTestId('sync-status-section').textContent).toContain('15 份')
    expect(screen.getByTestId('sync-status-section').textContent).toContain('Local-First')

    const view = container.querySelector('[aria-label="cloud-sync-view"]')
    if (view === null) throw new Error('missing cloud-sync-view')
    expect(view).toMatchSnapshot()
  })

  it('快照备份：真实归档能力未上线——不提供任何可执行备份动作，只呈现诚实 unavailable', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/cloud-sync') return Promise.resolve(okJson(MOCK_SYNC))
      return Promise.resolve({ ok: false, status: 501, json: async () => ({ ok: false, code: 'BACKUP_NOT_IMPLEMENTED', error: '未创建任何文件' }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<CloudSyncView root="C:/tmp/book" />)
    await waitFor(() => {
      expect(screen.getByTestId('sync-backup-section')).toBeInTheDocument()
    })

    // 不存在可执行的备份按钮（Truthfulness：未实现能力不得包装成操作）
    expect(screen.queryByRole('button', { name: /创建作品快照备份/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /打包快照中/ })).not.toBeInTheDocument()
    // 显式 unavailable 卡：说明不可用与真实原因
    expect(screen.getByTestId('sync-backup-unavailable').textContent).toContain('尚未提供')
    expect(screen.getByTestId('sync-backup-unavailable').textContent).toContain('不会出现「创建备份」按钮')
    // 不应发起备份请求
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/cloud-sync.backup')).toBe(false)
  })
})
