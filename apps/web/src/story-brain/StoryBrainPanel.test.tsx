/**
 * Story Brain 三区面板组件测试（T41）：
 * - 契约快照：输入形状 = 包类型（CanonState/EntityCardScan/TemporalFact/
 *   KnowledgePerspectiveEntry/KnowledgeState），包类型漂移即 typecheck + 快照双报警；
 * - 实体点击过滤（再点取消）与「无关联事实」空态；
 * - ADR-0026 通道呈现：suspects/believes 只渲染 kernel 安全通道文本；
 * - 失败显式报错。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanonState, EntityCardScan } from '@mozhou/data-plane'
import type { FactId, KnowledgeState, TemporalFact } from '@mozhou/kernel'
import type { StoryBrainFactsResponse } from '../../server/api'
import { okJson } from '../test/http'
import { emptyCanonState } from '../test/fixtures'
import { StoryBrainPanel } from './StoryBrainPanel'

afterEach(() => {
  vi.unstubAllGlobals()
})

const STATE: CanonState = {
  ...emptyCanonState(),
  book: { ...emptyCanonState().book, title: '雾港失真' },
  outlineNodes: [
    { id: 'book_01JB00000000000000000001', nodeType: 'book', parentId: null, orderIndex: 0, revision: 0, status: 'drafted', title: '雾港失真' },
    { id: 'volume_01JB0000000000000000002', nodeType: 'volume', parentId: 'book_01JB00000000000000000001', orderIndex: 0, revision: 0, status: 'drafted', title: '卷一 · 失真的海岸' },
  ],
}

const T0 = '2026-08-24T00:00:00.000Z'

function fixtureFact(fields: {
  id: string
  subject: 'char:lin-wan' | 'char:gu-chen'
  predicate: string
  value: string
}): TemporalFact {
  return {
    id: fields.id as FactId,
    bookId: STATE.book.id,
    revision: 0,
    createdAt: T0,
    updatedAt: T0,
    subject: fields.subject,
    predicate: fields.predicate,
    value: fields.value,
    validFrom: 1,
    validUntil: null,
    importance: 'notable',
    riskClass: fields.predicate.startsWith('secret.') ? 'high' : 'low',
    source: { kind: 'chapter', chapterIndex: 1 },
    status: 'confirmed',
    compactedIntoVolumeId: null,
    provenance: { origin: 'ai', protectedUserContent: false },
  }
}

const FACT_A = fixtureFact({ id: 'fact_01JB0000000000000000000A', subject: 'char:lin-wan', predicate: 'located', value: '灰潮港' })
const FACT_B = fixtureFact({ id: 'fact_01JB0000000000000000000B', subject: 'char:gu-chen', predicate: 'secret.true_name', value: '绝密真名值X' })

const KNST_D: KnowledgeState = {
  id: 'knst_01JB0000000000000000000D' as KnowledgeState['id'],
  bookId: STATE.book.id,
  revision: 0,
  createdAt: T0,
  updatedAt: T0,
  factId: 'fact_01JB0000000000000000000D' as FactId,
  holder: 'protagonist',
  level: 'knows',
  knownSinceChapter: 1,
}

const CARDS: readonly EntityCardScan[] = [
  { ref: 'char:gu-chen', cardType: 'char', name: '顾沉', aiContext: 'detected', aliases: [], excludedPhrases: [], brief: null, tags: [], fileRel: '设定/人物/顾沉.md' },
  { ref: 'char:lin-wan', cardType: 'char', name: '林岚', aiContext: 'detected', aliases: [], excludedPhrases: [], brief: '主角', tags: [], fileRel: '设定/人物/林岚.md' },
  { ref: 'location:harbor', cardType: 'location', name: '灰潮港', aiContext: 'detected', aliases: [], excludedPhrases: [], brief: null, tags: [], fileRel: '设定/地点/灰潮港.md' },
]

const FACTS: StoryBrainFactsResponse = {
  ok: true,
  chapter: 2,
  currentChapterIndex: 2,
  chapters: [
    { chapterIndex: 1, phase: 'draft' },
    { chapterIndex: 2, phase: 'draft' },
  ],
  canon: [FACT_A, FACT_B],
  perspective: [
    {
      factId: 'fact_01JB0000000000000000000C' as FactId,
      level: 'suspects',
      holder: 'protagonist',
      presentation:
        'CHARACTER SUSPECTS: 存在未确证的隐秘事实（secret.whereabouts, ref fact_c）; do not narrate or act as confirmed knowledge.',
      subject: 'char:gu-chen',
    },
    {
      factId: 'fact_01JB0000000000000000000A' as FactId,
      level: 'believes',
      holder: 'char:lin-wan',
      presentation: 'CHARACTER BELIEVES: 港务局控制钟楼（如与正典冲突，以信念为准呈现）.',
      subject: 'char:lin-wan',
    },
  ],
  invalidated: [{ ...KNST_D, subject: 'char:lin-wan' }],
}

function stubStoryBrainFetch(facts: StoryBrainFactsResponse = FACTS): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((path: string) => {
      if (path === '/api/book.state') return okJson({ ok: true, state: STATE })
      if (path === '/api/story-brain.entities') return okJson({ ok: true, cards: CARDS })
      if (path === '/api/story-brain.facts') return okJson(facts)
      return okJson({ ok: false, error: 'unexpected path: ' + path })
    }),
  )
}

describe('StoryBrainPanel（T41）', () => {
  it('三区只读渲染：实体分栏 / 大纲树含章行与当前章高亮 / 认知三级事实行（契约快照）', async () => {
    stubStoryBrainFetch()
    const { container } = render(<StoryBrainPanel root="C:\\tmp\\book-a" />)
    await waitFor(() => {
      expect(screen.getByTestId('sb-facts')).toBeInTheDocument()
    })
    // 实体区：按 cardType 分栏，data-entity-ref 契约保留
    expect(document.querySelector('[data-entity-ref="char:lin-wan"]')?.textContent).toContain('林岚')
    expect(document.querySelector('[data-entity-ref="location:harbor"]')?.textContent).toContain('灰潮港')
    // 大纲树：总纲 / 卷 / 章行，当前章（2，最新草稿）高亮
    expect(screen.getByTestId('sb-outline').textContent).toContain('雾港失真')
    expect(screen.getByTestId('sb-outline').textContent).toContain('卷一 · 失真的海岸')
    expect(screen.getByTestId('sb-outline').textContent).toContain('第 2 章')
    const activeNode = document.querySelector('.tree .active-node')
    if (activeNode === null) throw new Error('missing active chapter node')
    expect(activeNode.textContent).toContain('第 2 章')
    // 事实区：canon / suspect / belief / invalid 四段标签齐备
    const levels = [...screen.getByTestId('sb-facts').querySelectorAll('[data-fact-level]')].map(
      (row) => row.getAttribute('data-fact-level'),
    )
    expect(levels).toEqual(['canon', 'canon', 'suspect', 'belief', 'invalid'])
    expect(screen.getByTestId('sb-facts').textContent).toContain('灰潮港')
    expect(screen.getByTestId('sb-fact-count').textContent).toContain('5 rows')
    expect(container.querySelector('[aria-label="story-brain-panel"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="story-brain-panel"]')).toMatchSnapshot()
  })

  it('点击实体过滤关联事实；再点同一实体取消过滤', async () => {
    stubStoryBrainFetch()
    render(<StoryBrainPanel root="C:\\tmp\\book-a" />)
    await waitFor(() => {
      expect(screen.getByTestId('sb-facts')).toBeInTheDocument()
    })
    // 全量：2 canon + 2 perspective + 1 invalid = 5 行
    expect(screen.getByTestId('sb-fact-count').textContent).toContain('5 rows')

    await userEvent.click(document.querySelector('[data-entity-ref="char:gu-chen"]') as HTMLElement)
    // 顾沉：canon 只剩秘密真名；suspect（subject=顾沉）保留；belief/invalid（林岚侧）隐藏
    expect(screen.getByTestId('sb-fact-count').textContent).toContain('2 rows')
    expect(screen.getByTestId('sb-facts').textContent).toContain('secret.true_name')
    expect(screen.getByTestId('sb-facts').textContent).not.toContain('港务局控制钟楼')
    expect(document.querySelector('[data-entity-ref="char:gu-chen"]')?.getAttribute('aria-pressed')).toBe('true')

    // 再点取消：恢复全量
    await userEvent.click(document.querySelector('[data-entity-ref="char:gu-chen"]') as HTMLElement)
    expect(screen.getByTestId('sb-fact-count').textContent).toContain('5 rows')
    expect(screen.getByTestId('sb-facts').textContent).toContain('港务局控制钟楼')
  })

  it('过滤后无关联事实时呈现显式空态「无关联事实」', async () => {
    stubStoryBrainFetch()
    render(<StoryBrainPanel root="C:\\tmp\\book-a" />)
    await waitFor(() => {
      expect(screen.getByTestId('sb-facts')).toBeInTheDocument()
    })
    await userEvent.click(document.querySelector('[data-entity-ref="location:harbor"]') as HTMLElement)
    expect(screen.getByTestId('facts-empty').textContent).toBe('无关联事实')
  })

  it('suspects/believes 只渲染 kernel 安全通道文本（秘密正典值不进 DOM）', async () => {
    stubStoryBrainFetch()
    render(<StoryBrainPanel root="C:\\tmp\\book-a" />)
    await waitFor(() => {
      expect(screen.getByTestId('sb-facts')).toBeInTheDocument()
    })
    const suspectRow = screen.getByTestId('sb-facts').querySelector('[data-fact-level="suspect"]')
    if (suspectRow === null) throw new Error('missing suspect row')
    expect(suspectRow.textContent).toBe(
      'suspect CHARACTER SUSPECTS: 存在未确证的隐秘事实（secret.whereabouts, ref fact_c）; do not narrate or act as confirmed knowledge.',
    )
    // 通道行不出现事实正典值渲染位：整份事实区不含秘密事实 B 的值以外的秘密值
    expect(screen.getByTestId('sb-facts').textContent).not.toContain('绝密行踪值Y')
  })

  it('读取失败显式报错（role=alert），不静默', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((path: string) => {
        if (path === '/api/story-brain.facts') {
          return new Response(JSON.stringify({ ok: false, error: 'canon 结构违例' }), { status: 500 })
        }
        return okJson({ ok: true, state: emptyCanonState() })
      }),
    )
    render(<StoryBrainPanel root="C:\\tmp\\book-a" />)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('canon 结构违例')
    })
  })

  it('空书三空态：暂无实体卡 / 大纲树仅总纲卷行 / 无关联事实', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((path: string) => {
        if (path === '/api/book.state') return okJson({ ok: true, state: emptyCanonState() })
        if (path === '/api/story-brain.entities') return okJson({ ok: true, cards: [] })
        if (path === '/api/story-brain.facts') {
          return okJson({
            ok: true,
            chapter: 1,
            currentChapterIndex: null,
            chapters: [],
            canon: [],
            perspective: [],
            invalidated: [],
          })
        }
        return okJson({ ok: false, error: 'unexpected path: ' + path })
      }),
    )
    render(<StoryBrainPanel root="C:\\tmp\\book-a" />)
    await waitFor(() => {
      expect(screen.getByTestId('facts-empty').textContent).toBe('无关联事实')
    })
    expect(screen.getByTestId('entities-empty').textContent).toBe('暂无实体卡')
    expect(screen.getByTestId('sb-outline').textContent).not.toContain('第 1 章')
  })
})
