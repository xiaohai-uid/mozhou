/**
 * 云同步（CloudSyncView）组件测试：
 * - 本地离线状态与存储指标必须真实渲染；
 * - Technical Preview 必须明确标注云备份未开放，且不得调用未实现的 backup API。
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

describe('CloudSyncView（云同步）', () => {
  it('渲染真实的本地状态，并明确云能力仍在规划中', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(MOCK_SYNC)))
    render(<CloudSyncView root="C:/tmp/book" />)

    await waitFor(() => {
      expect(screen.getByTestId('sync-status-section')).toBeInTheDocument()
    })

    expect(screen.getByRole('heading', { name: '云同步（规划中）' })).toBeInTheDocument()
    expect(screen.getByTestId('sync-status-section').textContent).toContain('15 份')
    expect(screen.getByTestId('sync-status-section').textContent).toContain('Local-First')
    expect(screen.getByTestId('sync-backup-section').textContent).toContain('规划中')
  })

  it('云备份未开放，且不会调用未实现的 backup API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(MOCK_SYNC))
    vi.stubGlobal('fetch', fetchMock)

    render(<CloudSyncView root="C:/tmp/book" />)
    await waitFor(() => {
      expect(screen.getByTestId('sync-backup-section')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: '云备份暂未开放' })).toBeDisabled()
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/cloud-sync.backup')).toBe(false)
  })
})
