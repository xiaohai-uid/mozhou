import { describe, expect, it } from 'vitest'
import { generateRevisionBrief } from './revision-cascading.js'
import type { ImpactRecord } from '@mozhou/data-plane'

describe('revision-cascading 回炉重构任务书生成器测试', () => {
  it('正确根据受损 Traversal 记录生成段落级任务书', () => {
    const records: ImpactRecord[] = [
      {
        projectionVersion: 1,
        traversalId: 'trav_001',
        taskRef: 'task_001',
        trigger: { source: 'commit', ref: 'FACT_LU_XUAN_POWER' },
        affectedChapters: [2, 3],
        affectedFingerprint: 'fp_abc123',
        upstreamChanges: [
          {
            kind: 'temporalFact',
            id: 'character_lu_xuan',
            revision: 2,
          },
        ],
        recordedAt: '2026-09-02T10:00:00Z',
      },
    ]

    const briefCh2 = generateRevisionBrief(2, '县衙大堂', records)
    expect(briefCh2.chapterIndex).toBe(2)
    expect(briefCh2.conflictFacts.length).toBe(1)
    expect(briefCh2.conflictFacts[0]?.name).toBe('commit:FACT_LU_XUAN_POWER')
    expect(briefCh2.reworkGuidance).toContain('受上游 1 次 Traversal 变更波及')
    expect(briefCh2.suggestedReplacements.length).toBe(1)

    // 不受影响的章节
    const briefCh1 = generateRevisionBrief(1, '破庙装神', records)
    expect(briefCh1.conflictFacts.length).toBe(0)
    expect(briefCh1.reworkGuidance).toContain('无需重构')
  })
})
