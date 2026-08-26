/**
 * 变更影响编排钩子（Phase 5 接线完整性；t65 D02/D19/D20 + t66 D26）。
 *
 * D20 终裁：数据面公共落定出口最简形态 = ReconciliationOptions.onSettled 回调，
 * 由「Phase5 编排」自行装配 runTraversal——本模块即那份开箱即用编排：
 *
 *   const rec = plane.reconciliation({ onSettled: impactOrchestrator({...}) })
 *
 * 职责：对账任意终态（applied/partially_applied/dismissed）→ 触发一次 runTraversal
 * （TraversalStarted/Finished 成对 + impact 投影 + 幂等指纹）；幂等键 = 提案
 * proposalId（同提案重复回调零重复遍历，由调用方去重或本模块内存去重兜底）。
 *
 * 预算按 T25 scanBatchLimit 由调用方配置；上游变更来源 = 调用方注入的 resolver
 * （对账 summary 的确定性变更摘要 → DependencyManifestEntry 列表；V1 常驻
 * invariant：对账变更条目无法映射为 manifest entry 时传空表——影响面保守为空，
 * 宁缺不误标）。
 *
 * 纯机械零 LLM；不改写 canon；返回遍历结果供调用方续接（T28/29 语义层选路）。
 */
import { runTraversal } from './impact.js'
import type { TraversalOutcome } from './impact.js'
import type { ReconciliationSettledPayload } from './reconciliation.js'
import type { DependencyManifestEntry } from '@mozhou/kernel'

export interface ImpactOrchestratorOptions {
  readonly root: string
  /** 上游变更解析：对账落定载荷 → manifest entry 列表（确定性面；可注入测试夹具）。 */
  readonly resolveUpstreamChanges: (payload: ReconciliationSettledPayload) => readonly DependencyManifestEntry[]
  /** 遍历 id 铸造（测试确定性注入；缺省 = 'trv_' + proposalId 去桥）。 */
  readonly newTraversalId?: ((payload: ReconciliationSettledPayload) => string) | undefined
  /** 固定 taskRef 前缀（缺省 'impact'）。 */
  readonly taskRefPrefix?: string | undefined
  /** ISO 时钟（注入保证确定性；缺省 = 系统时钟）。 */
  readonly nowIso?: (() => string) | undefined
}

export interface ImpactOrchestrator {
  readonly onSettled: (payload: ReconciliationSettledPayload) => TraversalOutcome | null
  /** 最近一次遍历结果（测试观察；null = 未触发或上游变化为空）。 */
  readonly lastOutcome: () => TraversalOutcome | null
}

/**
 * 构造编排钩子：返回 { onSettled } 供 ReconciliationOptions 注入。
 * 上游变化为空 → 跳过遍历（零影响面不产噪声）；同 proposalId 重复回调 → 跳过
 * （内存幂等兜底，与 T25 proposalId 幂等键同源）。
 */
export function createImpactOrchestrator(options: ImpactOrchestratorOptions): ImpactOrchestrator {
  const seen = new Set<string>()
  let last: TraversalOutcome | null = null

  const onSettled = (payload: ReconciliationSettledPayload): TraversalOutcome | null => {
    if (seen.has(payload.proposalId)) return null
    seen.add(payload.proposalId)

    const upstreamChanges = options.resolveUpstreamChanges(payload)
    if (upstreamChanges.length === 0) return null

    const traversalId =
      options.newTraversalId?.(payload) ?? 'trv_' + payload.proposalId.replace(/[^A-Za-z0-9_-]/g, '')
    const root = options.root
    const outcome = runTraversal({
      root,
      taskRef: (options.taskRefPrefix ?? 'impact') + ':' + payload.proposalId,
      traversalId,
      trigger: { source: 'reconciliation', ref: payload.proposalId },
      upstreamChanges,
      recordedAt: options.nowIso?.() ?? new Date().toISOString(),
    })
    last = outcome
    return outcome
  }

  return { onSettled, lastOutcome: () => last }
}
