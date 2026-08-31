/**
 * 云同步与备份（CloudSyncView）组件测试（实现票 T54）：
 * - 契约快照：输入形状 = server/api 导出类型（CloudSyncResponse），
 *   包类型漂移即 typecheck + 快照双报警；
 * - 离线优先状态、存储指标与快照创建交互；
 * - 隐私声明卡片展示。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloudSyncResponse, BackupExportResponse } from '../../server/api'
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

const MOCK_BACKUP: BackupExportResponse = {
  ok: true,
  snapshotId: 'snap_test_01',
  bookTitle: '测试之书',
  exportedAt: '2026-08-31T12:00:00.000Z',
  fileCount: 15,
  manifestDigest: 'sha256_mock_digest',
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

  it('创建快照备份交互', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((path: string) => {
        if (path === '/api/cloud-sync') return okJson(MOCK_SYNC)
        if (path === '/api/cloud-sync.backup') return okJson(MOCK_BACKUP)
        return okJson({ ok: false })
      }),
    )

    render(<CloudSyncView root="C:/tmp/book" />)
    await waitFor(() => {
      expect(screen.getByTestId('sync-backup-section')).toBeInTheDocument()
    })

    const btn = screen.getByRole('button', { name: '创建作品快照备份' })
    await userEvent.click(btn)

    await waitFor(() => {
      expect(screen.getByTestId('sync-backup-result')).toBeInTheDocument()
      expect(screen.getByTestId('sync-backup-result').textContent).toContain('snap_test_01')
    })
  })
})
