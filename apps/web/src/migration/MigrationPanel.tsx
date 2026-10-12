/**
 * 迁移入口面板（P1-panel · 迁移合同 §3.1）。
 *
 * 两个入口合一个组件：
 * - **导出**：在**旧浏览器页面**内读取 §1.4 白名单键，产出迁移包；
 *   并提供「复制控制台片段」——用户可在旧页面控制台直接粘贴运行，无需本面板。
 * - **导入**：在新壳内校验迁移包、生成可审阅的导入计划并落地（匹配写回、冲突/待认领隔离）。
 *
 * 挂载方式：**非导航入口**（`#migration` 触发），不新增 `shell/views.ts` 的 NAV_GROUPS 项
 * （views.test.ts 断言 6 组 23 项且 id 唯一，是回归约束）。
 *
 * E01 补强（合同 §3.1「计划绑定 / 应用时重查 / 可恢复提交」）：
 * - 面板持一个**视图代次**：改包文本、切换目标作品、重新生成计划都会前进。
 * - 计划记下建立时的代次；异步探针返回后**再核一次代次**，旧结果直接丢弃，不激活应用。
 * - 「应用导入」用**当前**现场重跑冲突判定（`applyImport` 的 `recheck`）——预览后作者继续
 *   写作时，旧计划不会盖掉新稿，而是把包内版本放进隔离槽。
 * - 失败条目留恢复日志：界面展示逐条归宿与「部分写入」提示，并提供回滚按钮。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { exportLocalStorage, DRAFT_BASELINE_PREFIX } from './exportLocalStorage'
import { validateMigrationPackage } from './packageFormat'
import type { MigrationPackageV1, MigrationValidationFailure } from './packageFormat'
import { buildImportPlan, identityKeyOf } from './importPlan'
import type { ImportPlan, LocalChapterSnapshot, ServerChapterSnapshot } from './importPlan'
import { applyImport, readAppliedKeys, restoreFromJournal } from './applyImport'
import type { ApplyResult } from './applyImport'
import { createServerStateProbe } from './serverStateProbe'
import type { ServerStateProbe } from './serverStateProbe'
import { BROWSER_EXPORT_SNIPPET } from './browserExportSnippet'
import {
  candidateDraftKey,
  chapterDraftKey,
  loadCandidateCache,
  loadDraftCache,
  loadEditorProjection,
} from '../shell/workbenchStorage'
import type { BookInfo } from '../shell/workbenchStorage'

export interface MigrationPanelProps {
  readonly onClose: () => void
  readonly targetBook?: BookInfo | null
  readonly probe?: ServerStateProbe
}

const panelStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(5, 8, 12, 0.72)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 60,
}
const cardStyle: CSSProperties = {
  width: 'min(720px, 92vw)',
  maxHeight: '86vh',
  overflow: 'auto',
  background: '#0d1117',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 10,
  padding: 20,
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  fontSize: 14,
}
const buttonStyle: CSSProperties = {
  padding: '6px 14px',
  cursor: 'pointer',
  borderRadius: 6,
  border: '1px solid #30363d',
  background: '#21262d',
  color: '#c9d1d9',
  fontSize: 13,
}
const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 120,
  background: '#010409',
  color: '#c9d1d9',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: 8,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

function download(filename: string, text: string): boolean {
  try {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}

/** 目标作品标识（用于检测「切书」；null 表示尚未确定目标）。 */
function targetIdentityOf(targetBook: BookInfo | null | undefined): string {
  if (targetBook === undefined || targetBook === null) return ''
  return `${targetBook.root}::${targetBook.bookId}`
}

export function MigrationPanel({ onClose, targetBook, probe }: MigrationPanelProps): JSX.Element {
  const [tab, setTab] = useState<'export' | 'import'>('export')
  const [exported, setExported] = useState<MigrationPackageV1 | null>(null)
  const [copied, setCopied] = useState(false)
  const [packageText, setPackageText] = useState('')
  const [rejection, setRejection] = useState<MigrationValidationFailure | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [serverBookExists, setServerBookExists] = useState<boolean | null>(null)
  const [viewGeneration, setViewGeneration] = useState(0)
  const viewGenerationRef = useRef(0)

  const resolvedProbe = probe ?? createServerStateProbe()

  /** 前进视图代次并作废既有计划：输入包 / 目标作品变化时旧计划不再有效。 */
  const invalidatePlan = useCallback((): void => {
    viewGenerationRef.current += 1
    setViewGeneration(viewGenerationRef.current)
    setPlan(null)
    setApplyResult(null)
  }, [])

  // 切书（targetBook 变化）→ 旧计划立即失效，不能拿 A 书的计划应用到 B 书。
  const targetIdentity = targetIdentityOf(targetBook)
  const lastTargetRef = useRef(targetIdentity)
  useEffect(() => {
    if (lastTargetRef.current === targetIdentity) return
    lastTargetRef.current = targetIdentity
    invalidatePlan()
  }, [targetIdentity, invalidatePlan])

  const handleExport = (): void => {
    setExported(exportLocalStorage(window.localStorage))
    setCopied(false)
  }

  const handleCopySnippet = (): void => {
    const clipboard = navigator.clipboard
    if (clipboard === undefined) {
      setCopied(false)
      return
    }
    clipboard.writeText(BROWSER_EXPORT_SNIPPET).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }

  const localSnapshot = (identity: BookInfo, chapterIndex: number): LocalChapterSnapshot | null => {
    const key = chapterDraftKey(identity, chapterIndex)
    const candKey = candidateDraftKey(identity, chapterIndex)
    if (key === null || candKey === null) return null
    const draft = loadDraftCache(key)
    let baseline: string | null = null
    try {
      baseline = window.localStorage.getItem(`${DRAFT_BASELINE_PREFIX}${key}`)
    } catch {
      baseline = null
    }
    // 本地既有 AI 候选与编辑器投影同样进快照：它们是冲突判据的一部分
    // （只比草稿会让 matched 覆盖壳内既有候选/投影，违反不变量 1）。
    const candidate = loadCandidateCache(candKey)
    return {
      draftText: draft === '' ? null : draft,
      baselineSha256: baseline,
      candidate:
        candidate === null
          ? null
          : {
              candidateId: candidate.candidateId,
              base: candidate.base,
              mode: candidate.mode,
              draftText: candidate.draftText,
              phase: candidate.phase,
              partial: candidate.partial === true,
            },
      editorProjection: loadEditorProjection(key),
    }
  }

  const handleBuildPlan = async (): Promise<void> => {
    setApplyResult(null)
    const generation = viewGenerationRef.current
    let parsed: unknown
    try {
      parsed = JSON.parse(packageText)
    } catch {
      setRejection({ ok: false, code: 'NOT_OBJECT', message: '无法解析为 JSON', path: '' })
      setPlan(null)
      return
    }
    const validated = validateMigrationPackage(parsed)
    if (!validated.ok) {
      setRejection(validated)
      setPlan(null)
      return
    }
    setRejection(null)
    setBusy(true)
    try {
      const pkg = validated.value
      const target = targetBook === undefined || targetBook === null ? null : targetBook
      const snapshots = new Map<string, ServerChapterSnapshot>()
      if (target !== null) {
        const bookState = await resolvedProbe.queryBook({ root: target.root, bookId: target.bookId })
        setServerBookExists(bookState.reachable && bookState.exists)
        // 逐章探针必须用**目标作品根**（壳内实际作品），而非包内记录的 root：
        // 包内 root 与目标 root 不一致时，用包内 root 会查到另一个（可能不存在的）路径，
        // 与 queryBook 的结论自相矛盾，冲突判据被架空。非目标作品的条目一律 unclaimed，
        // 不参与冲突判定，无需探针。
        const targetKey = identityKeyOf(target)
        for (const book of pkg.books) {
          if (identityKeyOf(book.identity) !== targetKey) continue
          for (const chapter of book.chapters) {
            // 探针是异步的：期间切书 / 改包文本就让这份计划作废，不再白跑后续请求。
            if (viewGenerationRef.current !== generation) return
            const state = await resolvedProbe.queryChapter(
              { root: target.root, bookId: target.bookId },
              chapter.chapterIndex,
            )
            snapshots.set(`${targetKey}#${chapter.chapterIndex}`, state)
          }
        }
      } else {
        setServerBookExists(null)
      }
      // 探针完成后**再核一次代次**：旧结果不能激活应用（E01 合同）。
      if (viewGenerationRef.current !== generation) return
      setPlan(
        buildImportPlan({
          pkg,
          targetIdentity: target,
          local: localSnapshot,
          server: (identity, chapterIndex) => snapshots.get(`${identityKeyOf(identity)}#${chapterIndex}`) ?? null,
          appliedKeys: readAppliedKeys(),
          viewGeneration: generation,
        }),
      )
    } finally {
      setBusy(false)
    }
  }

  const handleApply = async (): Promise<void> => {
    if (plan === null) return
    // 应用时重查：计划里的 verdict 只是预览结论，不是写入许可。用当前现场重跑判定，
    // 作者在预览后继续写作时改落隔离槽，绝不覆盖新稿。
    const probeRef = plan.targetIdentity === null ? null : { root: plan.targetIdentity.root, bookId: plan.targetIdentity.bookId }
    const snapshots = new Map<string, ServerChapterSnapshot>()
    setBusy(true)
    try {
      if (probeRef !== null && plan.targetIdentitySuffix !== null) {
        const targetKey = plan.targetIdentitySuffix
        for (const item of plan.items) {
          if (identityKeyOf(item.identity) !== targetKey) continue
          const state = await resolvedProbe.queryChapter(probeRef, item.chapterIndex)
          snapshots.set(`${targetKey}#${item.chapterIndex}`, state)
        }
      }
      setApplyResult(
        applyImport(plan, {
          recheck: {
            local: localSnapshot,
            server: (identity, chapterIndex) => snapshots.get(`${identityKeyOf(identity)}#${chapterIndex}`) ?? null,
          },
        }),
      )
    } finally {
      setBusy(false)
    }
  }

  const handleRollback = (): void => {
    if (applyResult === null) return
    for (const entry of applyResult.recoverable) restoreFromJournal(entry)
    setApplyResult(null)
  }

  // 计划只对建立它的那个视图代次有效（改包文本 / 切书 / 重新生成都会让代次前进）。
  const planStale = plan !== null && plan.binding.viewGeneration !== viewGeneration
  const recheckQuarantined = applyResult === null ? 0 : applyResult.outcomes.filter((o) => o.action === 'recheck-quarantined').length

  return (
    <div style={panelStyle} data-testid="migration-panel-overlay">
      <div style={cardStyle} role="dialog" aria-modal="true" aria-label="浏览器数据迁移">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: 16 }}>浏览器数据迁移</strong>
          <button type="button" style={buttonStyle} onClick={onClose} aria-label="关闭迁移面板">
            关闭
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            style={{ ...buttonStyle, background: tab === 'export' ? '#1f6feb' : '#21262d' }}
            onClick={() => setTab('export')}
          >
            导出（旧页面）
          </button>
          <button
            type="button"
            style={{ ...buttonStyle, background: tab === 'import' ? '#1f6feb' : '#21262d' }}
            onClick={() => setTab('import')}
          >
            导入（新壳）
          </button>
        </div>

        {tab === 'export' ? (
          <section aria-label="导出">
            <p style={{ color: '#8b949e', fontSize: 12 }}>
              只读取 §1.4 白名单键；白名单外键与旧版无归属键 <code>ch_&lt;N&gt;</code> 不进包。源端不被修改或清空。
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={buttonStyle} onClick={handleExport}>
                生成迁移包
              </button>
              <button type="button" style={buttonStyle} onClick={handleCopySnippet}>
                复制控制台片段
              </button>
              <button
                type="button"
                style={buttonStyle}
                disabled={exported === null}
                onClick={() => {
                  if (exported !== null) download(`mozhou-migration-${Date.now()}.json`, JSON.stringify(exported, null, 2))
                }}
              >
                下载 JSON
              </button>
            </div>
            {copied && <p data-testid="snippet-copied" style={{ color: '#3fb950', fontSize: 12 }}>已复制控制台片段</p>}
            {exported !== null && (
              <div data-testid="export-summary" style={{ marginTop: 12, fontSize: 12 }}>
                <div>作品数：{exported.books.length}</div>
                <div>章条目数：{exported.books.reduce((sum, book) => sum + book.chapters.length, 0)}</div>
                <div>待认领条目：{exported.unclaimed.length}</div>
                <div style={{ wordBreak: 'break-all' }}>内容摘要：{exported.digest}</div>
              </div>
            )}
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>控制台片段（可直接粘贴到旧页面控制台运行）</summary>
              <textarea readOnly aria-label="控制台导出片段" style={{ ...textareaStyle, minHeight: 100, marginTop: 8 }} value={BROWSER_EXPORT_SNIPPET} />
            </details>
          </section>
        ) : (
          <section aria-label="导入">
            <p style={{ color: '#8b949e', fontSize: 12 }}>
              粘贴迁移包 JSON。冲突保留双份、身份不明进待认领区、重复导入幂等、失败不清空源端。
              应用时会按当前现场重新核对，预览后继续写作不会被旧计划覆盖。
            </p>
            <textarea
              aria-label="迁移包 JSON"
              style={textareaStyle}
              value={packageText}
              onChange={(event) => {
                setPackageText(event.target.value)
                // 输入包变了：既有计划（含其隔离槽标识与代次）立即作废。
                invalidatePlan()
              }}
              placeholder='{"formatVersion":1, ...}'
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void handleBuildPlan() }}>
                校验并生成导入计划
              </button>
              <button type="button" style={buttonStyle} disabled={plan === null || planStale || busy} onClick={() => { void handleApply() }}>
                应用导入
              </button>
              {applyResult !== null && applyResult.recoverable.length > 0 && (
                <button type="button" style={buttonStyle} data-testid="apply-rollback" onClick={handleRollback}>
                  回滚未完成项（{applyResult.recoverable.length}）
                </button>
              )}
            </div>

            {rejection !== null && (
              <p data-testid="import-rejection" style={{ color: '#f85149', fontSize: 12, marginTop: 12 }}>
                拒绝：{rejection.code}（{rejection.path || '—'}）—— {rejection.message}
              </p>
            )}

            {planStale && (
              <p data-testid="plan-stale" style={{ color: '#d29922', fontSize: 12, marginTop: 8 }}>
                计划已失效：输入包或目标作品在生成计划后发生了变化，请重新生成。
              </p>
            )}

            {serverBookExists === false && (
              <p style={{ color: '#d29922', fontSize: 12, marginTop: 8 }}>
                注意：目标作品在服务端不存在，探针将无法确认现状——相关章会保守判为冲突（保留双份）。
              </p>
            )}

            {plan !== null && (
              <div data-testid="import-plan" style={{ marginTop: 12, fontSize: 12 }}>
                <div>
                  计划：匹配 {plan.counts.matched} · 冲突 {plan.counts.conflict} · 待认领 {plan.counts.unclaimed + plan.unclaimed.length} · 重复 {plan.counts.duplicate}
                </div>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {plan.items.map((item) => (
                    <li key={item.slotTag}>
                      [{item.verdict}] 第 {item.chapterIndex} 章 — {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {applyResult !== null && (
              <div data-testid="apply-result" style={{ marginTop: 12, fontSize: 12 }}>
                <div>写入 {applyResult.written.length} · 隔离 {applyResult.quarantined.length} · 跳过 {applyResult.skipped.length} · 无内容 {applyResult.noop.length} · 失败 {applyResult.failed.length}</div>
                <div>已迁移标记：{applyResult.markedMigrated ? '是' : '否'}</div>
                {recheckQuarantined > 0 && (
                  <div data-testid="apply-recheck" style={{ color: '#d29922' }}>
                    其中 {recheckQuarantined} 项因应用时现场已变（草稿/服务端状态）改落隔离槽：包内版本保留在隔离槽，未覆盖当前内容。
                  </div>
                )}
                {applyResult.partial && (
                  <div data-testid="apply-partial" style={{ color: '#d29922' }}>
                    部分写入：{applyResult.recoverable.length} 项已有槽位被改动但未全部确认，可用「回滚未完成项」恢复到写入前状态。
                  </div>
                )}
                <ul data-testid="apply-outcomes" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {applyResult.outcomes.map((outcome) => (
                    <li key={`${outcome.action}:${outcome.idempotencyKey}:${outcome.slotTag}`}>
                      [{outcome.action}] {outcome.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
