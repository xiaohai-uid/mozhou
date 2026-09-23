import { useMemo, useState } from 'react'
import graph from './codeGraphData.json'
import { CODE_GRAPH_SNAPSHOT } from './codeGraphSnapshot'

const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
const names = new Map([
  ...graph.nodes.map((node) => [node.id, node.name] as const),
  ...CODE_GRAPH_SNAPSHOT.communities.map((node) => [node.id, node.label] as const),
  ...CODE_GRAPH_SNAPSHOT.processes.map((node) => [node.id, node.label] as const),
])
const kinds = [...new Set(graph.nodes.map((node) => node.kind))].sort()
const relationTypes = [...new Set(graph.relations.map((edge) => edge.type))].sort()

export function CodeNodeExplorer(): JSX.Element {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [relationType, setRelationType] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [limit, setLimit] = useState(40)
  const [relationLimit, setRelationLimit] = useState(40)
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase()
    return graph.nodes.filter((node) =>
      (kind === '' || node.kind === kind) &&
      [node.name, node.id, node.filePath].join(' ').toLowerCase().includes(search),
    )
  }, [query, kind])
  const selected = selectedId === null ? undefined : nodeById.get(selectedId)
  const relations = useMemo(() => graph.relations.filter((edge) =>
    (edge.source === selectedId || edge.target === selectedId) &&
    (relationType === '' || edge.type === relationType),
  ), [selectedId, relationType])
  const selectNode = (id: string): void => {
    setSelectedId(id)
    setRelationLimit(40)
  }

  return (
    <section className="code-node-explorer" aria-label="代码节点与关系">
      <div className="code-node-filters">
        <label>代码名称或路径
          <input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(40) }} placeholder="搜索函数、类、文件路径" />
        </label>
        <label>节点类型
          <select aria-label="节点类型" value={kind} onChange={(event) => { setKind(event.target.value); setLimit(40) }}>
            <option value="">全部类型</option>
            {kinds.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <div className="code-node-columns">
        <div className="code-node-list" aria-label="代码节点列表">
          <p role="status">{filtered.length} 个匹配节点 · 显示 {Math.min(limit, filtered.length)} 个</p>
          {filtered.length === 0 ? <p>没有匹配节点，请调整搜索或类型筛选。</p> : null}
          {filtered.slice(0, limit).map((node) => (
            <button key={node.id} type="button" aria-pressed={selectedId === node.id} onClick={() => selectNode(node.id)}>
              <b>{node.name}</b><small>{node.kind} · {node.filePath}{node.line > 0 ? ':' + node.line : ''}</small>
            </button>
          ))}
          {filtered.length > limit ? <button type="button" onClick={() => setLimit(limit + 40)}>显示更多节点</button> : null}
        </div>
        <div className="code-node-detail" aria-label="代码节点详情">
          {selected === undefined ? <p>选择代码节点，查看源文件位置和索引中的有向关系。</p> : (
            <>
              <h2>{selected.name}</h2>
              <p>{selected.kind} · {selected.filePath}{selected.line > 0 ? ':' + selected.line : ''}</p>
              <small>{selected.id}</small>
              <label>关系类型
                <select aria-label="关系类型" value={relationType} onChange={(event) => { setRelationType(event.target.value); setRelationLimit(40) }}>
                  <option value="">全部关系</option>
                  {relationTypes.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <p role="status">{relations.length} 条关系 · 箭头表示索引方向</p>
              {relations.length === 0 ? <p>当前筛选下没有关系。</p> : null}
              <ul className="code-node-relations">
                {relations.slice(0, relationLimit).map((edge, index) => {
                  const outgoing = edge.source === selectedId
                  const peer = outgoing ? edge.target : edge.source
                  return <li key={edge.source + edge.target + edge.type + index}>
                    <span>{outgoing ? '→' : '←'} {edge.type}</span>
                    {nodeById.has(peer)
                      ? <button type="button" onClick={() => selectNode(peer)}>{names.get(peer) ?? peer}</button>
                      : <b>{names.get(peer) ?? peer}</b>}
                    <small>{peer}</small>
                  </li>
                })}
              </ul>
              {relations.length > relationLimit ? <button type="button" onClick={() => setRelationLimit(relationLimit + 40)}>显示更多关系</button> : null}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
