/**
 * 壳层遥测推导（ADR-0028 · 管线六态真实绑定 + 检视摘要轨）。
 * 纪律：状态只能来自真实数据面证据（works 章节相位 / receipts 装配凭证 /
 * quality 审查时效 / matrix 影响矩阵）；无证据的阶段保持未标记——
 * 被点击 ≠ 执行成功，无证据 ≠ done。纯函数，无副作用，可单测。
 */
import type { WorksChapterSummary, ReceiptListItem } from '../../server/api'
import type { PipelineStageId, PipelineStageState } from './PipelineStrip'

export type { PipelineStageState }

export interface QualityStatusLite {
  readonly status: 'no_review' | 'current' | 'stale'
  readonly current: boolean
  readonly report: { readonly verdict: 'pass' | 'blocking_fail' | 'refused' } | null
}

export interface MatrixRowsLite {
  readonly rows: readonly { readonly staleCount: number }[]
}

export interface StageDeriveInput {
  readonly bookExists: boolean
  readonly chapterIndex: number
  readonly works: { readonly chapters: readonly WorksChapterSummary[] } | null
  readonly receipts: readonly ReceiptListItem[]
  readonly quality: QualityStatusLite | null
}

const STAGE_IDS: readonly PipelineStageId[] = [
  'prepare', 'compile', 'draft', 'review', 'extract', 'continuity', 'proposal', 'commit',
]

/** 8 阶段 × 六态（done/blocked/...）推导；缺证据的键不输出（渲染为待定）。 */
export function deriveStageStates(input: StageDeriveInput): Partial<Record<PipelineStageId, PipelineStageState>> {
  if (!input.bookExists) {
    return Object.fromEntries(STAGE_IDS.map((id) => [id, 'unavailable' as const]))
  }

  const chapter = input.works?.chapters.find((ch) => ch.chapterIndex === input.chapterIndex)
  if (chapter !== undefined && chapter.phase === 'committed') {
    // 已定稿章节：八个阶段全部有真实完成证据。
    return Object.fromEntries(STAGE_IDS.map((id) => [id, 'done' as const]))
  }

  const states: Partial<Record<PipelineStageId, PipelineStageState>> = { prepare: 'done' }
  if (input.receipts.some((receipt) => receipt.chapterIndex === input.chapterIndex)) {
    states.compile = 'done'
  }
  if (chapter !== undefined && chapter.phase === 'draft') {
    states.draft = 'done'
  }
  const quality = input.quality
  if (quality !== null && quality.report?.verdict === 'refused') {
    // 显式 REFUSED = 语义前提缺失（Gate 3）——blocked，而非失败。
    states.review = 'blocked'
  } else if (quality !== null && quality.status === 'current') {
    states.review = 'done'
  }
  // extract / continuity / proposal / commit：当前无逐阶段证据读面，不标记（诚实待定）。
  return states
}

export interface InspectorSummary {
  readonly chapter: string
  readonly quality: string
  readonly canon: string
  readonly context: string
  readonly changeImpact: string
  readonly tokens: string
}

export interface SummaryDeriveInput {
  readonly bookExists: boolean
  readonly chapterIndex: number
  readonly works: { readonly chapters: readonly WorksChapterSummary[] } | null
  readonly receipts: readonly ReceiptListItem[]
  readonly quality: QualityStatusLite | null
  readonly matrixRows: MatrixRowsLite['rows'] | null
}

const QUALITY_LABEL: Record<string, string> = {
  pass: 'PASS',
  blocking_fail: 'NEEDS REWORK',
  refused: 'REFUSED',
}

/** 检视摘要轨（规格 §14）：每个数字必须有真实来源；没有则 '— / 未载入'。 */
export function deriveSummary(input: SummaryDeriveInput): InspectorSummary {
  const chapter = input.works?.chapters.find((ch) => ch.chapterIndex === input.chapterIndex)
  const receipt = input.receipts.find((r) => r.chapterIndex === input.chapterIndex)

  let quality = '—'
  if (input.quality !== null && input.quality.status !== 'no_review') {
    if (input.quality.status === 'stale') {
      quality = 'STALE'
    } else if (input.quality.report != null) {
      quality = QUALITY_LABEL[input.quality.report.verdict] ?? '—'
    }
  }

  const totalStale = input.matrixRows?.reduce((n, row) => n + row.staleCount, 0)

  return {
    chapter: !input.bookExists
      ? '—'
      : chapter !== undefined
        ? `${input.chapterIndex} · ${chapter.title}`
        : String(input.chapterIndex),
    quality,
    // canon 时效读面（book.state 之外无独立 currency 指标）——诚实 '—'。
    canon: '—',
    context: receipt === undefined ? '—' : receipt.hashMatch ? 'HASH MATCH' : 'MISMATCH',
    changeImpact: totalStale === undefined ? '—' : String(totalStale),
    tokens: receipt === undefined ? '—' : receipt.totalTokens.toLocaleString('en-US'),
  }
}
