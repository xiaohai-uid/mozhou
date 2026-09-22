/**
 * Story Brain 三区面板（实现票 T41）：实体卡网格 / 章大纲树 / 事实列表，
 * 全只读 + 实体点击过滤（再点取消）。
 *
 * 数据面（/api 中间件直出，组件 type-only 直引契约形状，零 any）：
 * - /api/book.state           → readCanonState（大纲树基底）
 * - /api/story-brain.entities → scanEntityCards（实体卡）
 * - /api/story-brain.facts    → 认知三级通道：canon（knows 授权可见）/
 *   suspects-believes（ADR-0026 安全通道文本，秘密正典值零泄漏）/ invalidated
 *
 * 呈现纪律：suspects/believes 行只输出 kernel 通道文本，不拼接任何事实值；
 * POV 固定主角（与装配器同门禁，与「秘密不存在」不可区分）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CanonState, EntityCardScan, EntityRefPrefix } from '@mozhou/data-plane'
import type { StoryBrainFactsResponse } from '../../server/api'
import { post } from '../lib/post'
import { CreateEntityModal } from './CreateEntityModal'

const CARD_TYPE_LABEL: Record<EntityRefPrefix, string> = {
  char: '人物',
  item: '物品',
  location: '地点',
  faction: '势力',
  concept: '概念',
}

const PHASE_LABEL: Record<'draft' | 'committed', string> = {
  draft: '草稿',
  committed: '已提交',
}

export function StoryBrainPanel({ root }: { root: string }): JSX.Element {
  const [state, setState] = useState<CanonState | null>(null)
  const [cards, setCards] = useState<readonly EntityCardScan[]>([])
  const [facts, setFacts] = useState<StoryBrainFactsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedRef, setSelectedRef] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)

  const handleSaveEntity = async (entity: {
    cardType: 'char' | 'location' | 'item' | 'faction' | 'concept'
    name: string
    brief: string
    details: string
  }): Promise<void> => {
    await post('/api/story-brain.entity.save', {
      root,
      ...entity,
    })
    await load()
  }

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const [stateRes, cardsRes, factsRes] = await Promise.all([
        post<{ state: CanonState }>('/api/book.state', { root }),
        post<{ cards: readonly EntityCardScan[] }>('/api/story-brain.entities', { root }),
        post<StoryBrainFactsResponse>('/api/story-brain.facts', { root }),
      ])
      setState(stateRes.state)
      setCards(cardsRes.cards)
      setFacts(factsRes)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }, [root])

  useEffect(() => { void load() }, [load])

  const entityGroups = useMemo(() => {
    const groups = new Map<EntityRefPrefix, EntityCardScan[]>()
    for (const card of cards) {
      const group = groups.get(card.cardType)
      if (group === undefined) {
        groups.set(card.cardType, [card])
      } else {
        group.push(card)
      }
    }
    return groups
  }, [cards])

  const canonRows = useMemo(
    () => (facts?.canon ?? []).filter((fact) => selectedRef === null || fact.subject === selectedRef),
    [facts, selectedRef],
  )
  const suspectRows = useMemo(
    () => (facts?.perspective ?? []).filter(
      (entry) => entry.level === 'suspects' && (selectedRef === null || entry.subject === selectedRef),
    ),
    [facts, selectedRef],
  )
  const beliefRows = useMemo(
    () => (facts?.perspective ?? []).filter(
      (entry) => entry.level === 'believes' && (selectedRef === null || entry.subject === selectedRef),
    ),
    [facts, selectedRef],
  )
  const invalidRows = useMemo(
    () => (facts?.invalidated ?? []).filter((row) => selectedRef === null || row.subject === selectedRef),
    [facts, selectedRef],
  )
  const totalRows = canonRows.length + suspectRows.length + beliefRows.length + invalidRows.length

  const selectedName =
    selectedRef === null ? null : (cards.find((card) => card.ref === selectedRef)?.name ?? selectedRef)

  const bookNode = state?.outlineNodes[0]
  const volumeNodes = state?.outlineNodes.filter((node) => node.nodeType === 'volume') ?? []
  const chapters = facts?.chapters ?? []

  return (
    <section aria-label="story-brain-panel">
      <div className="panel-head">
        <div>
          <h2>Story Brain</h2>
          <p>实体卡 · 大纲树 · 事实列表</p>
        </div>
        <span className="tag">{cards.length} entities</span>
      </div>

      <div className="actions" style={{ marginTop: 0, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn" onClick={() => { void load() }} disabled={busy}>
            {busy ? '读取中…' : '刷新'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setCreateModalOpen(true)}
            style={{ padding: '4px 10px', fontSize: 12 }}
          >
            + 新建设定卡
          </button>
        </div>
        <span className="mono muted" style={{ alignSelf: 'center' }}>
          canon 按主角 POV · 认知通道 ADR-0026
        </span>
      </div>
      {error !== null && (
        <p role="alert" className="wb-error">
          错误：{error}
        </p>
      )}

      <div className="card-shell" data-testid="sb-entities">
        <div className="card">
          <div className="card-title">
            <b>实体卡</b>
            <span className="muted">点击筛选事实</span>
          </div>
          {!busy && cards.length === 0 && (
            <p className="muted" data-testid="entities-empty" style={{ margin: 0 }}>
              暂无实体卡
            </p>
          )}
          {[...entityGroups.entries()].map(([cardType, groupCards]) => (
            <div key={cardType} style={{ marginTop: 10 }}>
              <div className="mono muted" style={{ marginBottom: 6 }}>
                {CARD_TYPE_LABEL[cardType] ?? cardType}
              </div>
              <div className="entity-grid">
                {groupCards.map((card) => (
                  <button
                    key={card.ref}
                    type="button"
                    className="entity"
                    data-entity-ref={card.ref}
                    aria-pressed={selectedRef === card.ref}
                    onClick={() => setSelectedRef((prev) => (prev === card.ref ? null : card.ref))}
                  >
                    <small>{CARD_TYPE_LABEL[card.cardType] ?? card.cardType}</small>
                    {card.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card-shell">
        <div className="card">
          <div className="card-title">
            <b>章大纲树</b>
            {facts?.chapter !== undefined && (
              <span className="mono muted">fact anchor ch{facts.chapter}</span>
            )}
          </div>
          <div className="tree" data-testid="sb-outline">
            {bookNode !== undefined && (
              <div className="tree-row" style={{ paddingLeft: 0 }}>
                ▾ 总纲 · {bookNode.title}
              </div>
            )}
            {volumeNodes.map((volume) => (
              <div key={volume.id} className="tree-row" style={{ paddingLeft: 14 }}>
                ▾ {volume.title}
              </div>
            ))}
            {chapters.map((chapter, index) => {
              const isCurrent = chapter.chapterIndex === facts?.currentChapterIndex
              const branch = index === chapters.length - 1 ? '└' : '├'
              return (
                <div
                  key={chapter.chapterIndex}
                  className={'tree-row' + (isCurrent ? ' active-node' : '')}
                  style={{ paddingLeft: 28 }}
                >
                  {branch} 第 {chapter.chapterIndex} 章 · {PHASE_LABEL[chapter.phase] ?? chapter.phase}
                </div>
              )
            })}
            {chapters.length === 0 && !busy && (
              <div className="tree-row" style={{ paddingLeft: 14 }}>（尚无正文章）</div>
            )}
          </div>
        </div>
      </div>

      <div className="card-shell">
        <div className="card">
          <div className="card-title">
            <b>关联事实</b>
            <span className="mono muted" data-testid="sb-fact-count">
              {totalRows} rows{selectedRef !== null ? ' · 已过滤' : ''}
            </span>
          </div>
          {selectedRef !== null && selectedName !== null && (
            <p className="mono muted" style={{ margin: '4px 0 0' }}>
              筛选：{selectedName}（再点实体卡取消）
            </p>
          )}
          {totalRows === 0 && !busy && (
            <p className="muted" data-testid="facts-empty" style={{ margin: '6px 0 0' }}>
              无关联事实
            </p>
          )}
          {totalRows > 0 && (
            <div data-testid="sb-facts" style={{ marginTop: 6 }}>
              {canonRows.map((fact) => (
                <div className="fact" key={fact.id} data-fact-level="canon">
                  <i className="cog canon" />
                  <span>
                    <b>canon</b> {fact.subject} · {fact.predicate}: {String(fact.value)}
                  </span>
                </div>
              ))}
              {suspectRows.map((entry) => (
                <div className="fact" key={entry.factId} data-fact-level="suspect">
                  <i className="cog suspect" />
                  <span>
                    <b>suspect</b> {entry.presentation}
                  </span>
                </div>
              ))}
              {beliefRows.map((entry) => (
                <div className="fact" key={entry.factId} data-fact-level="belief">
                  <i className="cog belief" />
                  <span>
                    <b>belief</b> {entry.presentation}
                  </span>
                </div>
              ))}
              {invalidRows.length > 0 && (
                <>
                  <h4 className="mono muted" style={{ margin: '10px 0 2px' }}>
                    失效认知 · 引用已否决事实
                  </h4>
                  {invalidRows.map((row) => (
                    <div className="fact" key={row.id} data-fact-level="invalid">
                      <i className="cog" style={{ background: 'var(--text-faint)' }} />
                      <span>
                        <b>invalid</b> {row.holder} · {row.level} · {row.factId}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <CreateEntityModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSave={handleSaveEntity}
      />
    </section>
  )
}
