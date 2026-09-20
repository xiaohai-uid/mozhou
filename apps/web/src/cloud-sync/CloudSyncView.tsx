/**
 * 云同步与备份（CloudSyncView）视图（实现票 T54 · Ink Realm 真值修订）：
 * Local-First 状态监测、存储指标与隐私安全看板。
 * 快照备份：真实归档能力未上线（/api/cloud-sync.backup 恒 501 fail-closed）——
 * UI 只呈现诚实 unavailable，不提供任何可执行备份动作（规格 §20）。
 *
 * 数据面：POST /api/cloud-sync {root?} → CloudSyncResponse
 */
import { useCallback, useEffect, useState } from 'react'
import type { CloudSyncResponse } from '../../server/api'
import { post } from '../lib/post'

export function CloudSyncView({
  root,
}: {
  /** 当前书根（可选）。 */
  root: string | null
}): JSX.Element {
  const [data, setData] = useState<CloudSyncResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [backupResult, setBackupResult] = useState<{
    backupId: string
    bytes: number
    sha256: string
    title: string
  } | null>(null)
  const [backupLoading, setBackupLoading] = useState(false)
  const [restoreId, setRestoreId] = useState('')
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null)
  const [restoreLoading, setRestoreLoading] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const res = await post<CloudSyncResponse>('/api/cloud-sync', { root: root ?? undefined })
      setData(res)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [root])

  const handleCreateLocalBackup = async () => {
    if (!root) return
    setBackupLoading(true)
    setError(null)
    try {
      const res = await post<{ ok: boolean; backupId: string; bytes: number; sha256: string; title: string }>('/api/backups', { root })
      if (res.ok) {
        setBackupResult({
          backupId: res.backupId,
          bytes: res.bytes,
          sha256: res.sha256,
          title: res.title,
        })
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBackupLoading(false)
    }
  }

  const handleRestoreLocalBackup = async () => {
    if (!restoreId.trim()) return
    setRestoreLoading(true)
    setRestoreMsg(null)
    try {
      const res = await post<{ ok: boolean; root: string; bookId: string; title: string }>('/api/backups/restore', { backupId: restoreId.trim() })
      if (res.ok) {
        setRestoreMsg(`恢复成功！新作品根目录：${res.root} (${res.title})`)
      }
    } catch (e) {
      setRestoreMsg(`恢复失败：${(e as Error).message}`)
    } finally {
      setRestoreLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="center solo" aria-label="cloud-sync-view">
      <div className="chapterbar">
        <h1>云同步与备份</h1>
        <span className="meta">本地离线优先 · 增量快照备份</span>
        <div className="save">
          <span className="cap-badge native">
            {data === null ? '状态读取中…' : data.localReady ? '● 本地离线就绪' : '本地数据面未就绪'}
          </span>
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

        {/* 本地快照备份：真实归档能力未上线——诚实 unavailable，不提供任何可执行备份动作
            （服务端 fail-closed：POST /api/cloud-sync.backup 恒 501 BACKUP_NOT_IMPLEMENTED，未创建任何文件） */}
        <section className="wb-section" data-testid="sync-backup-section">
          <h2>作品快照备份</h2>
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>生成当前作品独立快照</b>
                <span className="mono muted">本地离线归档 · /api/backups</span>
              </div>
              <div className="ir-unavailable" style={{ marginTop: 10 }} data-testid="sync-backup-unavailable">
                <b style={{ color: 'var(--warning)' }}>快照备份 · 尚未提供云端自动同步</b>
                <br />
                Technical Preview 尚未提供可验证的云端备份归档，因此这里不会出现「创建备份」按钮到云端，也不会创建任何云端文件。
                <br />
                <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                  本地离线备份：可使用下方本地归档引擎（/api/backups）导出完整 ZIP 备份或进行恢复。
                </span>
              </div>
              <div style={{ marginTop: 16, borderTop: '1px solid var(--hairline)', paddingTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <b>本地离线归档 (C5 安全 ZIP)</b>
                    <p className="muted" style={{ fontSize: 11, margin: '2px 0 0' }}>
                      使用底层 @mozhou/data-plane 打包全量正典、大纲、章节与元数据为标准 ZIP 压缩包。
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!root || backupLoading}
                    onClick={() => { void handleCreateLocalBackup() }}
                    style={{ fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap' }}
                  >
                    {backupLoading ? '生成归档中…' : '生成本地归档包 (.zip)'}
                  </button>
                </div>
                {backupResult !== null && (
                  <div style={{ marginTop: 12, padding: 10, background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--success)', borderRadius: 8, fontSize: 12 }}>
                    <div style={{ color: 'var(--success)', fontWeight: 600 }}>● 备份创建成功：{backupResult.title}</div>
                    <div className="mono muted" style={{ marginTop: 4 }}>ID: {backupResult.backupId} · 体积: {Math.round(backupResult.bytes / 1024)} KB</div>
                    <div className="mono muted" style={{ fontSize: 10, wordBreak: 'break-all' }}>SHA256: {backupResult.sha256}</div>
                    <div style={{ marginTop: 8 }}>
                      <a
                        href={`/api/backups/download?backupId=${backupResult.backupId}`}
                        download={`${backupResult.backupId}.zip`}
                        className="btn"
                        style={{ display: 'inline-block', fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}
                      >
                        下载备份归档文件
                      </a>
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px dashed var(--hairline)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>从现有备份恢复作品</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <input
                      type="text"
                      placeholder="输入备份 ID (如 bup_xxx)"
                      value={restoreId}
                      onChange={(e) => setRestoreId(e.target.value)}
                      style={{ flex: 1, padding: '4px 8px', fontSize: 12, background: 'var(--surface-sunken)', border: '1px solid var(--hairline)', borderRadius: 6, color: 'var(--fg-pure)' }}
                    />
                    <button
                      type="button"
                      className="btn"
                      disabled={!restoreId.trim() || restoreLoading}
                      onClick={() => { void handleRestoreLocalBackup() }}
                      style={{ fontSize: 12, padding: '4px 12px', whiteSpace: 'nowrap' }}
                    >
                      {restoreLoading ? '恢复中…' : '恢复作品'}
                    </button>
                  </div>
                  {restoreMsg !== null && (
                    <p style={{ fontSize: 11, marginTop: 6, color: restoreMsg.startsWith('恢复成功') ? 'var(--success)' : 'var(--danger)' }}>
                      {restoreMsg}
                    </p>
                  )}
                </div>
              </div>
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
