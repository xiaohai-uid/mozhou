import { lazy, Suspense, useMemo, useState } from 'react'
import { CODE_GRAPH_SNAPSHOT } from './codeGraphSnapshot'

const LazyCodeNodeExplorer = lazy(async () => {
  const module = await import('./CodeNodeExplorer')
  return { default: module.CodeNodeExplorer }
})

type Community = (typeof CODE_GRAPH_SNAPSHOT.communities)[number]
type Process = (typeof CODE_GRAPH_SNAPSHOT.processes)[number]

interface PositionedCommunity extends Community {
  x: number
  y: number
  radius: number
}

interface GraphEdge {
  source: string
  target: string
  weight: number
  processIds: string[]
}

function normalizeLabel(label: string): string {
  const cluster = /^Cluster_(\d+)$/i.exec(label)
  if (cluster !== null) return `Cluster ${cluster[1]}`
  return label
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function processTitle(process: Process): string {
  return process.label.replace(/ → /g, ' → ')
}

function communityMatches(community: Community, query: string): boolean {
  const haystack = [
    community.id,
    community.label,
    community.heuristicLabel,
    community.description,
  ].join(' ').toLowerCase()
  return haystack.includes(query)
}

function processMatches(process: Process, query: string): boolean {
  const haystack = [
    process.id,
    process.label,
    process.heuristicLabel,
    process.processType,
    ...process.communities,
  ].join(' ').toLowerCase()
  return haystack.includes(query)
}

export function CodeGraphView(): JSX.Element {
  const [mode, setMode] = useState<'architecture' | 'nodes'>('architecture')
  const [query, setQuery] = useState('')
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null)
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null)

  const communityById = useMemo(
    () => new Map(CODE_GRAPH_SNAPSHOT.communities.map((community) => [community.id, community])),
    [],
  )
  const normalizedQuery = query.trim().toLowerCase()

  const matchingCommunities = useMemo(() => {
    if (normalizedQuery.length === 0) return CODE_GRAPH_SNAPSHOT.communities
    return CODE_GRAPH_SNAPSHOT.communities
      .filter((community) => communityMatches(community, normalizedQuery))
  }, [normalizedQuery])

  const matchingProcesses = useMemo(() => {
    if (normalizedQuery.length === 0) return CODE_GRAPH_SNAPSHOT.processes
    return CODE_GRAPH_SNAPSHOT.processes
      .filter((process) => processMatches(process, normalizedQuery))
  }, [normalizedQuery])

  const graphCommunities = useMemo(() => {
    const ordered = new Map<string, Community>()

    if (selectedProcessId !== null) {
      const process = CODE_GRAPH_SNAPSHOT.processes.find((item) => item.id === selectedProcessId)
      for (const id of process?.communities ?? []) {
        const community = communityById.get(id)
        if (community !== undefined) ordered.set(id, community)
      }
    }

    if (selectedCommunityId !== null) {
      const community = communityById.get(selectedCommunityId)
      if (community !== undefined) ordered.set(community.id, community)
    }

    for (const community of matchingCommunities) ordered.set(community.id, community)
    return [...ordered.values()].slice(0, 24)
  }, [communityById, matchingCommunities, selectedCommunityId, selectedProcessId])

  const positioned = useMemo<PositionedCommunity[]>(() => {
    const count = Math.max(graphCommunities.length, 1)
    return graphCommunities.map((community, index) => {
      const outer = index >= Math.min(8, count)
      const ringIndex = outer ? index - 8 : index
      const ringCount = outer ? Math.max(count - 8, 1) : Math.min(count, 8)
      const angle = (ringIndex / ringCount) * Math.PI * 2 - Math.PI / 2
      const radiusX = outer ? 338 : 212
      const radiusY = outer ? 220 : 138
      return {
        ...community,
        x: 430 + Math.cos(angle) * radiusX,
        y: 275 + Math.sin(angle) * radiusY,
        radius: Math.max(21, Math.min(34, 18 + Math.sqrt(community.symbolCount) * 1.55)),
      }
    })
  }, [graphCommunities])

  const visibleIds = useMemo(() => new Set(positioned.map((community) => community.id)), [positioned])

  const edges = useMemo<GraphEdge[]>(() => {
    const pairMap = new Map<string, GraphEdge>()
    for (const process of CODE_GRAPH_SNAPSHOT.processes) {
      const ids = process.communities.filter((id) => visibleIds.has(id))
      if (ids.length < 2) continue
      for (let index = 1; index < ids.length; index += 1) {
        const source = ids[0]
        const target = ids[index]
        if (source === undefined || target === undefined || source === target) continue
        const pair = [source, target].sort()
        const key = pair.join('|')
        const existing = pairMap.get(key)
        if (existing === undefined) {
          pairMap.set(key, {
            source: pair[0]!,
            target: pair[1]!,
            weight: 1,
            processIds: [process.id],
          })
        } else {
          existing.weight += 1
          existing.processIds.push(process.id)
        }
      }
    }
    return [...pairMap.values()].sort((a, b) => b.weight - a.weight).slice(0, 48)
  }, [visibleIds])

  const positionedById = useMemo(
    () => new Map(positioned.map((community) => [community.id, community])),
    [positioned],
  )

  const selectedCommunity =
    selectedCommunityId === null ? null : communityById.get(selectedCommunityId) ?? null
  const selectedProcess =
    selectedProcessId === null
      ? null
      : CODE_GRAPH_SNAPSHOT.processes.find((process) => process.id === selectedProcessId) ?? null

  const connectedProcesses = useMemo(() => {
    if (selectedCommunity === null) return []
    return CODE_GRAPH_SNAPSHOT.processes
      .filter((process) => process.communities.includes(selectedCommunity.id))
      .sort((a, b) => b.stepCount - a.stepCount)
  }, [selectedCommunity])

  const selectedProcessCommunities = useMemo(() => {
    if (selectedProcess === null) return []
    return selectedProcess.communities
      .map((id) => communityById.get(id))
      .filter((community): community is Community => community !== undefined)
  }, [communityById, selectedProcess])

  const selectedProcessSet = useMemo(
    () => new Set(selectedProcess?.communities ?? []),
    [selectedProcess],
  )

  const selectCommunity = (community: Community): void => {
    setSelectedCommunityId(community.id)
    setSelectedProcessId(null)
  }

  const selectProcess = (process: Process): void => {
    setSelectedProcessId(process.id)
    setSelectedCommunityId(null)
  }

  return (
    <section className="code-graph-view" aria-labelledby="code-graph-title">
      <header className="code-graph-head">
        <div>
          <span className="code-graph-kicker">LOCAL DEV · GITNEXUS SNAPSHOT</span>
          <h1 id="code-graph-title">墨舟代码图谱</h1>
          <p>
            本机 GitNexus 的只读快照，非实时连接。浏览架构域、执行流、代码节点及索引关系。
          </p>
        </div>
        <div className="code-graph-freshness" title={CODE_GRAPH_SNAPSHOT.indexedAt}>
          <span className="code-graph-live-dot" aria-hidden="true" />
          <div>
            <b>只读快照 {CODE_GRAPH_SNAPSHOT.commit}{CODE_GRAPH_SNAPSHOT.worktreeDirty ? ' · WORKTREE' : ''}</b>
            <small>{formatTime(CODE_GRAPH_SNAPSHOT.indexedAt)} · {CODE_GRAPH_SNAPSHOT.branch}</small>
          </div>
        </div>
      </header>

      <div className="code-graph-metrics" aria-label="代码图谱统计">
        <div><span>FILES</span><b>{CODE_GRAPH_SNAPSHOT.stats.files.toLocaleString('zh-CN')}</b></div>
        <div><span>NODES</span><b>{CODE_GRAPH_SNAPSHOT.stats.nodes.toLocaleString('zh-CN')}</b></div>
        <div><span>RELATIONS</span><b>{CODE_GRAPH_SNAPSHOT.stats.edges.toLocaleString('zh-CN')}</b></div>
        <div><span>COMMUNITIES</span><b>{CODE_GRAPH_SNAPSHOT.communities.length.toLocaleString('zh-CN')}</b></div>
        <div><span>PROCESSES</span><b>{CODE_GRAPH_SNAPSHOT.stats.processes.toLocaleString('zh-CN')}</b></div>
        <div>
          <span>INDEX GRAPH / FTS</span>
          <b>{CODE_GRAPH_SNAPSHOT.capabilities.graph.status === 'available' ? 'READY' : 'OFF'} · {CODE_GRAPH_SNAPSHOT.capabilities.fts.status === 'available' ? 'READY' : 'OFF'}</b>
        </div>
      </div>

      <div className="code-graph-tabs" aria-label="图谱视图">
        <button type="button" aria-pressed={mode === 'architecture'} onClick={() => setMode('architecture')}>架构与执行流</button>
        <button type="button" aria-pressed={mode === 'nodes'} onClick={() => setMode('nodes')}>代码节点与关系</button>
        <small>快照导出：{formatTime(CODE_GRAPH_SNAPSHOT.generatedAt)} · 更新需重新生成本地快照</small>
      </div>
      {mode === 'nodes' ? (
        <Suspense fallback={<div className="code-graph-loading" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>正在载入全量节点数据…</div>}>
          <LazyCodeNodeExplorer />
        </Suspense>
      ) : <div className="code-graph-layout">
        <div className="code-graph-stage">
          <div className="code-graph-stage-head">
            <div>
              <span>ARCHITECTURE MAP</span>
              <b>{positioned.length} 个可见架构域 · {edges.length} 条聚合执行关系</b>
            </div>
            <p>节点大小表示符号量；连线是共同参与执行流的聚合关系，不代表直接调用。图中最多显示 24 个域、48 条关系。</p>
          </div>

          <div className="code-graph-svg-wrap">
            <svg viewBox="0 0 860 550" role="group" aria-label="GitNexus 架构域关系图">
              <g className="code-graph-grid" aria-hidden="true">
                <circle cx="430" cy="275" r="214" />
                <circle cx="430" cy="275" r="350" />
                <line x1="70" y1="275" x2="790" y2="275" />
                <line x1="430" y1="45" x2="430" y2="505" />
              </g>

              <g className="code-graph-edges">
                {edges.map((edge) => {
                  const source = positionedById.get(edge.source)
                  const target = positionedById.get(edge.target)
                  if (source === undefined || target === undefined) return null
                  const selected =
                    selectedCommunityId === edge.source ||
                    selectedCommunityId === edge.target ||
                    (selectedProcess !== null && edge.processIds.includes(selectedProcess.id))
                  return (
                    <line
                      key={edge.source + edge.target}
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      className={selected ? 'is-selected' : undefined}
                      strokeWidth={Math.min(4.4, 0.75 + edge.weight * 0.32)}
                    ><title>{normalizeLabel(source.label)} ↔ {normalizeLabel(target.label)}：{edge.weight} 条共同执行流</title></line>
                  )
                })}
              </g>

              <g className="code-graph-nodes">
                {positioned.map((community) => {
                  const selected = selectedCommunityId === community.id
                  const processLinked = selectedProcessSet.has(community.id)
                  return (
                    <g
                      key={community.id}
                      transform={`translate(${community.x} ${community.y})`}
                      role="button"
                      tabIndex={0}
                      aria-label={`选择架构域 ${normalizeLabel(community.label)}，${community.symbolCount} 个符号`}
                      onClick={() => selectCommunity(community)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          selectCommunity(community)
                        }
                      }}
                      className={'code-graph-node' + (selected ? ' is-selected' : '') + (processLinked ? ' is-process-linked' : '')}
                    >
                      <circle r={community.radius + (selected ? 5 : 0)} className="code-graph-node-halo" />
                      <circle r={community.radius} className="code-graph-node-core" />
                      <text y="-2" textAnchor="middle" className="code-graph-node-label">
                        {normalizeLabel(community.label).slice(0, 13)}
                      </text>
                      <text y="12" textAnchor="middle" className="code-graph-node-meta">
                        {community.symbolCount} symbols
                      </text>
                    </g>
                  )
                })}
              </g>
            </svg>
            {positioned.length === 0 ? (
              <div className="code-graph-empty">没有匹配的架构域。可以搜索执行流名称、模块名或 GitNexus ID。</div>
            ) : null}
          </div>

          <footer className="code-graph-kind-strip" aria-label="节点类型分布">
            {CODE_GRAPH_SNAPSHOT.nodeKinds.slice(0, 8).map((kind) => (
              <span key={kind.label}>
                <b>{kind.label}</b>
                {kind.count.toLocaleString('zh-CN')}
              </span>
            ))}
          </footer>
        </div>

        <aside className="code-graph-explorer" aria-label="代码图谱浏览器">
          <label className="code-graph-search">
            <span>搜索图谱</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如 Workbench / Auth / App → SendJson"
            />
            {query.length > 0 ? (
              <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">×</button>
            ) : null}
          </label>

          <div className="code-graph-detail">
            {selectedCommunity !== null ? (
              <>
                <div className="code-graph-detail-head">
                  <span>COMMUNITY</span>
                  <h2>{normalizeLabel(selectedCommunity.label)}</h2>
                  <p>{selectedCommunity.id}</p>
                </div>
                <dl className="code-graph-detail-metrics">
                  <div><dt>符号</dt><dd>{selectedCommunity.symbolCount}</dd></div>
                  <div><dt>内聚度</dt><dd>{selectedCommunity.cohesion.toFixed(3)}</dd></div>
                  <div><dt>关联执行流</dt><dd>{connectedProcesses.length}</dd></div>
                </dl>
                <div className="code-graph-related">
                  <span>CONNECTED PROCESSES</span>
                  {connectedProcesses.length === 0 ? (
                    <p>当前快照没有捕获到关联执行流。</p>
                  ) : connectedProcesses.map((process) => (
                    <button key={process.id} type="button" onClick={() => selectProcess(process)}>
                      <b>{processTitle(process)}</b>
                      <small>{process.stepCount} steps · {process.processType}</small>
                    </button>
                  ))}
                </div>
              </>
            ) : selectedProcess !== null ? (
              <>
                <div className="code-graph-detail-head">
                  <span>EXECUTION FLOW</span>
                  <h2>{processTitle(selectedProcess)}</h2>
                  <p>{selectedProcess.id}</p>
                </div>
                <dl className="code-graph-detail-metrics">
                  <div><dt>步骤</dt><dd>{selectedProcess.stepCount}</dd></div>
                  <div><dt>类型</dt><dd>{selectedProcess.processType === 'cross_community' ? '跨域' : '域内'}</dd></div>
                  <div><dt>架构域</dt><dd>{selectedProcessCommunities.length}</dd></div>
                </dl>
                <div className="code-graph-related">
                  <span>TOUCHES</span>
                  {selectedProcessCommunities.map((community) => (
                    <button key={community.id} type="button" onClick={() => selectCommunity(community)}>
                      <b>{normalizeLabel(community.label)}</b>
                      <small>{community.symbolCount} symbols · cohesion {community.cohesion.toFixed(3)}</small>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="code-graph-detail-empty">
                <span>GRAPH READY</span>
                <h2>选择节点或执行流</h2>
                <p>用这张图快速确认一个 UI、路由或核心流程属于哪个代码域，以及它跨过哪些模块。</p>
                <small>当前 UI 内置 {CODE_GRAPH_SNAPSHOT.communities.length} 个 Community 节点与 {CODE_GRAPH_SNAPSHOT.processes.length} 条执行流快照。</small>
              </div>
            )}
          </div>

          <div className="code-graph-results">
            <div className="code-graph-results-section">
              <div className="code-graph-results-title">
                <span>架构域</span>
                <b>{matchingCommunities.length}</b>
              </div>
              {matchingCommunities.map((community) => (
                <button key={community.id} type="button" onClick={() => selectCommunity(community)}>
                  <span>{normalizeLabel(community.label)}</span>
                  <small>{community.symbolCount}</small>
                </button>
              ))}
            </div>
            <div className="code-graph-results-section">
              <div className="code-graph-results-title">
                <span>执行流</span>
                <b>{matchingProcesses.length}</b>
              </div>
              {matchingProcesses.map((process) => (
                <button key={process.id} type="button" onClick={() => selectProcess(process)}>
                  <span>{processTitle(process)}</span>
                  <small>{process.stepCount} steps</small>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>}
    </section>
  )
}
