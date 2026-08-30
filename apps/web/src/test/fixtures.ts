/**
 * 组件测试共享 fixture（T41）：空书的 CanonState（readCanonState 冻结形状，
 * 建书种子 = 总纲 + 第一卷两节点、五族追踪流空）。漂移即 typecheck 报警。
 */
import type { CanonState } from '@mozhou/data-plane'

export function emptyCanonState(): CanonState {
  return {
    book: {
      id: 'book_01JB00000000000000000000' as CanonState['book']['id'],
      title: '测试之书',
      revision: 0,
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    },
    outlineNodes: [
      { id: 'book_01JB00000000000000000001', nodeType: 'book', parentId: null, orderIndex: 0, revision: 0, status: 'drafted', title: '测试之书' },
      { id: 'volume_01JB0000000000000000002', nodeType: 'volume', parentId: 'book_01JB00000000000000000001', orderIndex: 0, revision: 0, status: 'drafted', title: '第一卷' },
    ],
    planningArtifacts: [],
    trackingLines: {
      temporalFact: [],
      knowledgeState: [],
      relationshipState: [],
      narrativePromise: [],
      timelineEvent: [],
    },
    entityCards: [],
  }
}
