/**
 * 云同步与备份（CloudSyncView）视图（实现票 T54）：
 * 本地离线优先（Local-First）状态监测、本地快照备份导出、
 * 存储指标与端到端隐私安全看板。
 *
 * 数据面（/api/cloud-sync 与 /api/cloud-sync.backup 中间件）：
 * - POST /api/cloud-sync {root?} → CloudSyncResponse
 * - POST /api/cloud-sync.backup {root} → BackupExportResponse
 */
import { useCallback, useEffect, useState } from 'react'
import type { CloudSyncResponse, BackupExportResponse } from '../../server/api'
import { post } from '../lib/post'

export function CloudSyncView({
  root,
}: {
  /** 当前书根（可选）。 */
  root: string | null
}): JSX.Element {
  const [data, setData] = useState<CloudSyncResponse | null>(null)
  const [backup, setBackup] = useState<BackupExportResponse | null>(null)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const res = await post<CloudSyncResponse>('/api/cloud-sync', { root: root ?? undefined })
      setData(res)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [root])

  useEffect(() => {
    void load()
  }, [load])

  const handleExportBackup = async (): Promise<void> => {
    if (root === null) return
    setExporting(true)
    setError(null)
    try {
      const res = await post<BackupExportResponse>('/api/cloud-sync.backup', { root })
      setBackup(res)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="center solo" aria-label="cloud-sync-view">
      <div className="chapterbar">
        <h1>云同步与备份</h1>
        <span className="meta">本地离线优先 · 增量快照备份</span>
        <div className="save">
          <span className="cap-badge native">● 本地离线就绪</span>
        </div>
      </div>

      <div className="conversation">
        {error !== null && (
          <p className="wb-error" role="alert" data-testid="sync-error">
            错误：{error}
          </p>
        )}

        {/* 离线优先与状态监控看板 */}
        <section className="wb-section" data-testid="sync-status-section">
          <h2>数据存储与同步状态</h2>
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>Local-First 离线优先架构</b>
                <span className="tag">安全运行中</span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.6 }}>
                墨舟将您的所有创作数据（大纲、章节、实体卡、文风画像）完整存储在本地文件系统与 SQLite 中，断网或无服务时可 100% 正常创作、审查与装配。
              </p>

              {data !== null && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: 10,
                    marginTop: 12,
                    padding: '10px 0 0',
                    borderTop: '1px solid var(--hairline)',
                  }}
                >
                  <div>
                    <div className="mono muted">本地正典文件</div>
                    <b style={{ fontSize: 15 }}>{data.storageUsage.localCanonFiles} 份</b>
                  </div>
                  <div>
                    <div className="mono muted">本地数据库体积</div>
                    <b style={{ fontSize: 15 }}>{Math.round(data.storageUsage.databaseBytes / 1024)} KB</b>
                  </div>
                  <div>
                    <div className="mono muted">未同步变动</div>
                    <b style={{ fontSize: 15, color: 'var(--success)' }}>
                      {data.pendingChangesCount} 处（已全量落盘）
                    </b>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 本地快照导出与备份 */}
        <section className="wb-section" data-testid="sync-backup-section">
          <h2>作品快照备份</h2>
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>生成当前作品独立快照</b>
                <span className="mono muted">单文件导出 · 便携迁移</span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                为当前作品生成包含全量正典文件与元数据指纹的完整离线快照，方便备份至外部移动硬盘或个人私有云盘。
              </p>
              <div className="actions" style={{ marginTop: 10 }}>
                <button
                  className="btn-primary"
                  onClick={() => { void handleExportBackup() }}
                  disabled={exporting || root === null}
                >
                  {exporting ? '打包快照中…' : '创建作品快照备份'}
                </button>
                {root === null && (
                  <span className="mono muted" style={{ alignSelf: 'center' }}>
                    （需先建立或打开作品）
                  </span>
                )}
              </div>

              {backup !== null && (
                <div className="banner" style={{ marginTop: 12 }} data-testid="sync-backup-result">
                  <b>快照创建成功：</b>
                  <div className="mono" style={{ marginTop: 4 }}>
                    ID: {backup.snapshotId} · 文件数: {backup.fileCount} · 签名: {backup.manifestDigest}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 隐私与安全规范 */}
        <section className="wb-section">
          <h2>隐私与合规保证</h2>
          <div className="card-shell">
            <div className="card">
              <div className="finding">
                <b>零数据上传</b>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>
                  墨舟绝不未经授权上传您的作品小说文本、大纲或角色设定，您的著作权归您完全所有。
                </p>
              </div>
              <div className="finding">
                <b>透明明文存储</b>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>
                  正文采用标准 Markdown 与 Frontmatter 存储，随时可使用 VS Code、Obsidian 或任何文本编辑器打开与迁移。
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}
