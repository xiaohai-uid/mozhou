/**
 * @mozhou/pipeline · 回炉级联重构任务书生成器 (Revision Cascading Engine)
 * 移植自 storyrepo/revision.py 并适配墨舟 ChangeMatrix 与 Traversal 影响审计。
 */
import type { ImpactRecord } from '@mozhou/data-plane'

export interface ConflictFactItem {
  readonly id: string
  readonly name: string
  readonly beforeValue?: string | undefined
  readonly afterValue?: string | undefined
}

export interface RevisionTaskBrief {
  readonly chapterIndex: number
  readonly title: string
  readonly triggeredBy: string
  readonly conflictFacts: readonly ConflictFactItem[]
  readonly reworkGuidance: string
  readonly suggestedReplacements: readonly {
    readonly original: string
    readonly replacement: string
    readonly reason: string
  }[]
}

/**
 * 根据受损 Traversal 记录与上游设定变更，
 * 为受影响的章节自动生成段落级《回炉重构任务书》。
 */
export function generateRevisionBrief(
  chapterIndex: number,
  chapterTitle: string,
  impactRecords: readonly ImpactRecord[],
): RevisionTaskBrief {
  const matchingRecords = impactRecords.filter((r) =>
    r.affectedChapters.some((ch) => ch === chapterIndex),
  )

  const conflictFacts: ConflictFactItem[] = []
  const suggestedReplacements: { original: string; replacement: string; reason: string }[] = []

  for (const record of matchingRecords) {
    const triggerRef = `${record.trigger.source}:${record.trigger.ref}`
    conflictFacts.push({
      id: record.traversalId,
      name: triggerRef,
      beforeValue: `受影响指纹: ${record.affectedFingerprint}`,
    })

    for (const change of record.upstreamChanges) {
      suggestedReplacements.push({
        original: `涉及上游实体 [${change.kind}:${change.id}] 的旧描述`,
        replacement: `根据最新正典 (修订版本 Rev.${change.revision}) 修正对应段落`,
        reason: `上游 ${change.kind} 变更导致第 ${chapterIndex} 章受损`,
      })
    }
  }

  const guidance =
    matchingRecords.length > 0
      ? `第 ${chapterIndex} 章受上游 ${matchingRecords.length} 次 Traversal 变更波及，请重点核对并替换受影响段落中的道具/能力/关系描写，避免出现时间线与战力崩坏。`
      : `第 ${chapterIndex} 章设定与当前正典一致，无需重构。`

  return {
    chapterIndex,
    title: chapterTitle,
    triggeredBy:
      matchingRecords.map((r) => `${r.trigger.source}:${r.trigger.ref}`).join('、') || '无上游冲突',
    conflictFacts,
    reworkGuidance: guidance,
    suggestedReplacements,
  }
}
