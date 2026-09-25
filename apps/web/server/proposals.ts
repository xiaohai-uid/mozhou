/**
 * 正典提案视图与未决扫描（步 8 接线 · chapter-pipeline-spec §1 表第 8 行 / S6）。
 *
 * 提案记录（.mozhou/proposals/prp_*.json）的读取面在此统一产出：提交路由
 * （proseRoutes）挂起时给出待决条目，提案队列路由（pipelineRoutes）给出队列视图。
 * 两处形状必须同源，否则「提交挂起时作者看到的待决面」与「队列确认面」会漂移。
 *
 * 行载荷原样带出（row 不做裁剪）：editAccept 的 patch 是顶层字段浅合并，作者必须
 * 看到候选行全字段才能改；裁剪视图会把「作者改的字段」变成盲改。
 */
import { listCanonProposals } from '@mozhou/pipeline'
import type { CanonProposalItem, CanonProposalRecord } from '@mozhou/pipeline'

/** 提案条目作者可见面（逐条确认粒度：itemId 是 decide 的定位键）。 */
export interface CanonProposalItemView {
  readonly itemId: string
  readonly family: string
  readonly riskClass: 'low' | 'medium' | 'high'
  readonly state: 'pending' | 'confirmed' | 'rejected' | 'edit_accepted'
  /** 分流依据（为什么这一条落在这档——作者据此判断该确认还是该改文）。 */
  readonly routingBasis: string
  readonly row: Readonly<Record<string, unknown>>
}

export interface CanonProposalRoutedCounts {
  readonly low: number
  readonly medium: number
  readonly high: number
}

export interface CanonProposalView {
  readonly proposalId: string
  readonly taskRef: string
  readonly chapterIndex: number
  readonly createdAt: string
  readonly state: 'open' | 'consumed'
  readonly consumedAt?: string
  readonly routed: CanonProposalRoutedCounts
  /** 未决条目数（>0 ⇒ 提案挂起中，Commit 拒收）。 */
  readonly pendingCount: number
  readonly items: readonly CanonProposalItemView[]
}

function itemView(item: CanonProposalItem): CanonProposalItemView {
  return {
    itemId: item.itemId,
    family: item.family,
    riskClass: item.riskClass,
    state: item.state,
    routingBasis: item.routingBasis,
    row: item.row,
  }
}

export function routedCountsOf(record: CanonProposalRecord): CanonProposalRoutedCounts {
  return {
    low: record.items.filter((item) => item.riskClass === 'low').length,
    medium: record.items.filter((item) => item.riskClass === 'medium').length,
    high: record.items.filter((item) => item.riskClass === 'high').length,
  }
}

export function canonProposalView(record: CanonProposalRecord): CanonProposalView {
  return {
    proposalId: record.proposalId,
    taskRef: record.taskRef,
    chapterIndex: record.chapterIndex,
    createdAt: record.createdAt,
    state: record.state,
    ...(record.consumedAt === undefined ? {} : { consumedAt: record.consumedAt }),
    routed: routedCountsOf(record),
    pendingCount: record.items.filter((item) => item.state === 'pending').length,
    items: record.items.map(itemView),
  }
}

/** 未决条目视图（挂起响应与队列共用；空数组 = 全部决毕可进 Commit）。 */
export function pendingItemViewsOf(record: CanonProposalRecord): CanonProposalItemView[] {
  return record.items.filter((item) => item.state === 'pending').map(itemView)
}

/** 同 taskRef 的未决提案（提交重试的续接锚：同一正文 revision 的提案唯一）。 */
export function openProposalForTask(root: string, taskRef: string): CanonProposalRecord | null {
  return (
    listCanonProposals(root).find(
      (record) => record.state === 'open' && record.taskRef === taskRef,
    ) ?? null
  )
}

/** 本章未收口的提案（正文已改 ⇒ 盘上提案描述的是旧正文，路由据此显式拒绝而非静默丢弃）。 */
export function openProposalsOfChapter(root: string, chapterIndex: number): CanonProposalRecord[] {
  return listCanonProposals(root).filter(
    (record) => record.state === 'open' && record.chapterIndex === chapterIndex,
  )
}
