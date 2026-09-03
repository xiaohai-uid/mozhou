/**
 * @mozhou/data-plane · reconciliation-paths.ts
 * 对账路径分类与条目命名的纯逻辑子模块（Candidate 4 深化）。
 * 零 IO、零 shell——纯字符串匹配与集合运算，自包含错误类型避免循环引用。
 */
import {
  AUTHOR_INTENT_PATH,
  BOOK_RECORD_PATH,
  CHAPTER_OUTLINE_DIR,
  ENTITY_CARD_DIR_BY_PREFIX,
  PROSE_DIR,
  STYLE_PROFILE_PATH,
  TRACKING_STREAMS,
  VOLUME_ONE_OUTLINE_PATH,
  ZONGGANG_PATH,
  type TrackingKind,
} from './layout.js'

export class ReconciliationError extends Error {
  override readonly name = 'ReconciliationError'
}

export type ReconciliationPathClass =
  | 'proseChapter'
  | 'trackingStream'
  | 'entityCard'
  | 'outlineNode'
  | 'planningArtifact'
  | 'bookRecord'
  | 'other'

export interface ItemIdsSummaryLike {
  readonly kind: string
  readonly changes?: readonly { readonly seq: number }[] | undefined
  readonly additions?: readonly { readonly seqOnDisk: number }[] | undefined
  readonly removals?: readonly { readonly seq: number }[] | undefined
}

/* ----------------------------------------------------------------------------
 * 路径分类（唯一真源）
 * ------------------------------------------------------------------------- */

const CARD_DIRS = Object.values(ENTITY_CARD_DIR_BY_PREFIX)

export function classifyReconciliationPath(relPosixPath: string): ReconciliationPathClass {
  if (relPosixPath === BOOK_RECORD_PATH) return 'bookRecord'
  if (TRACKING_STREAMS.some((stream) => stream.path === relPosixPath)) return 'trackingStream'
  if (CARD_DIRS.some((dir) => relPosixPath.startsWith(`${dir}/`)) && relPosixPath.endsWith('.md')) {
    return 'entityCard'
  }
  if (
    relPosixPath === ZONGGANG_PATH ||
    relPosixPath === VOLUME_ONE_OUTLINE_PATH ||
    relPosixPath.startsWith(`${CHAPTER_OUTLINE_DIR}/`)
  ) {
    return 'outlineNode'
  }
  if (relPosixPath === AUTHOR_INTENT_PATH || relPosixPath === STYLE_PROFILE_PATH) {
    return 'planningArtifact'
  }
  if (relPosixPath.startsWith(`${PROSE_DIR}/`) && relPosixPath.endsWith('.md')) return 'proseChapter'
  return 'other'
}

export function trackingKindOf(rel: string): TrackingKind {
  const stream = TRACKING_STREAMS.find((candidate) => candidate.path === rel)
  if (stream === undefined) {
    throw new ReconciliationError(`not a tracking stream path: ${rel}`)
  }
  return stream.kind
}

/* ----------------------------------------------------------------------------
 * 条目命名与抑制账本（纯集合运算）
 * ------------------------------------------------------------------------- */

/** 提案项词表（T18 · #42 ProposalPort 复用面）：对账提案的可决策条目 id 全集。 */
export function itemIdsOf(summary: ItemIdsSummaryLike): Set<string> {
  const ids = new Set<string>(['whole'])
  if (summary.kind === 'trackingStream') {
    for (const change of summary.changes ?? []) ids.add(`change:${change.seq}`)
    for (const addition of summary.additions ?? []) ids.add(`add:${addition.seqOnDisk}`)
    for (const removal of summary.removals ?? []) ids.add(`remove:${removal.seq}`)
  }
  return ids
}
