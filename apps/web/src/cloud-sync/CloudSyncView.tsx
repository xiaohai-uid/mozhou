/**
 * 云同步（CloudSyncView）视图：
 * - 当前 Technical Preview 只展示本地离线存储状态；
 * - 云同步与云备份尚未接入，不提供虚假的成功操作；
 * - 用户可通过复制完整作品目录进行冷备份与迁移。
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

  return (
    <section className="center solo" aria-label="cloud-sync-view">
      <div className="chapterbar">
        <h1>云同步（规划中）</h1>
        <span className="meta">本地离线优先 · 云同步与云备份尚未开放</span>
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

        <section className="wb-section" data-testid="sync-status-section">
          <h2>本地数据状态</h2>
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>Local-First 离线优先架构</b>
                <span className="tag">安全运行中</span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.6 }}>
                墨舟将创作数据存储在本地文件系统与 SQLite 中。当前版本不依赖云同步即可完成建书、写作、审查、恢复与 TXT 导出。
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
                    <div className="mono muted">本地待处理变动</div>
                    <b style={{ fontSize: 15, color: 'var(--success)' }}>
                      {data.pendingChangesCount} 处（数据已落盘）
                    </b>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="wb-section" data-testid="sync-backup-section">
          <h2>云备份（规划中）</h2>
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>云同步与在线快照尚未接入</b>
                <span className="mono muted">Technical Preview</span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.6 }}>
                当前版本不会伪装生成云端或单文件快照。需要备份时，请先停止墨舟进程，再完整复制当前作品目录到备份盘或您自行管理的私有存储；后续接入真实云服务后再开放这里的操作。
              </p>
              <div className="actions" style={{ marginTop: 10 }}>
                <button className="btn-primary" type="button" disabled>
                  云备份暂未开放
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="wb-section">
          <h2>隐私与数据边界</h2>
          <div className="card-shell">
            <div className="card">
              <div className="finding">
                <b>本地数据优先</b>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>
                  墨舟不会自行启用云同步。调用您配置的 BYOK 模型时，只会在您主动发起生成请求后向所选模型服务发送完成该请求所需的上下文。
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
