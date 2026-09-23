import React, { useState } from 'react';
import { useCanonGraphData } from './useCanonGraphData';
import type { GraphNode } from './useCanonGraphData';
import { CanonNodeCard } from './CanonNodeCard';
import { CreateContractModal } from './CreateContractModal';
import { CreateEntityModal } from '../story-brain/CreateEntityModal';
import { post } from '../lib/post';
import type { BookInfo } from '../shell/workbenchStorage';

const FILTERS = [
  ['all', '全部'],
  ['character', '人物'],
  ['faction', '势力'],
  ['location', '地点'],
  ['item', '道具'],
] as const;

function nodeTone(type: GraphNode['type']): string {
  switch (type) {
    case 'character':
      return 'var(--jade)';
    case 'faction':
      return 'var(--success)';
    case 'location':
      return 'var(--text-muted)';
    case 'item':
      return 'var(--gold)';
  }
}

export const CanonGraphView: React.FC<{ book?: BookInfo | null | undefined }> = ({ book }) => {
  const { nodes, links, isLive, isDemo, isEmpty, addLink, reload } = useCanonGraphData(book?.root);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [contractTarget, setContractTarget] = useState<GraphNode | null>(null);
  const [entityModalOpen, setEntityModalOpen] = useState(false);

  const handleSaveEntity = async (entity: {
    cardType: 'char' | 'location' | 'item' | 'faction' | 'concept';
    name: string;
    brief: string;
    details: string;
  }): Promise<void> => {
    if (book?.root) {
      await post('/api/story-brain.entity.save', {
        root: book.root,
        ...entity,
      });
      reload();
    }
  };

  const filteredNodes = nodes.filter((node) => (filterType === 'all' ? true : node.type === filterType));

  const handleStartContract = (source: GraphNode): void => {
    const other = nodes.find((node) => node.id !== source.id);
    if (other) {
      setContractTarget(other);
      setModalOpen(true);
    }
  };

  const handleCreateContract = (contract: {
    relation: string;
    summary: string;
    deadline?: string;
    penalty?: string;
  }): void => {
    if (!selectedNode || !contractTarget) return;
    addLink({
      source: selectedNode.id,
      target: contractTarget.id,
      relation: contract.relation,
      contract: {
        summary: contract.summary,
        status: 'ACTIVE',
        deadline: contract.deadline,
        penalty: contract.penalty,
      },
    });
    if (book?.root) {
      void post('/api/story-brain.contract', {
        root: book.root,
        sourceName: selectedNode.name,
        targetName: contractTarget.name,
        relation: contract.relation,
        summary: contract.summary,
        deadline: contract.deadline,
        penalty: contract.penalty,
      }).catch((error: unknown) => {
        console.error('Failed to sync contract to backend', error);
      });
    }
  };

  const statusLabel = isLive ? (isEmpty ? '空正典' : '实时正典') : isDemo ? '示例演示' : '未连接';

  return (
    <section className="flex h-full min-h-[600px] w-full flex-col overflow-hidden border border-[var(--hairline-strong)] bg-[var(--surface-sunken)]" aria-labelledby="canon-graph-title">
      <header className="flex flex-col gap-3 border-b border-[var(--hairline)] bg-[var(--surface)] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
            <h2 id="canon-graph-title" className="m-0 text-sm font-semibold text-[var(--foreground)]">
              正典关系与因果拓扑 {book ? `· 《${book.title}》` : ''}
            </h2>
            <span className="rounded-md bg-[var(--surface-2)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)]">
              {nodes.length} 实体 · {links.length} 关系 · {statusLabel}
            </span>
          </div>
          <p className="mt-1.5 max-w-2xl text-[11.5px] leading-5 text-[var(--text-faint)]">
            展示人物、势力、地点与道具之间的正典关系。契约属于作者裁决层，创建后同步到 Story Brain。
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {selectedNode && (
            <button
              type="button"
              onClick={() => handleStartContract(selectedNode)}
              className="min-h-10 rounded-lg bg-[var(--gold-bright)] px-3.5 text-xs font-semibold text-[var(--background)] transition-[background-color,transform] duration-150 hover:bg-[var(--gold)] active:scale-[0.96]"
            >
              与「{selectedNode.name}」建立契约
            </button>
          )}
          <button
            type="button"
            onClick={() => setEntityModalOpen(true)}
            className="min-h-8 rounded-md bg-[var(--gold-soft)] px-3 text-[11px] font-medium text-[var(--gold-bright)] shadow-[inset_0_0_0_1px_var(--gold-line-soft)] hover:bg-[var(--gold-line-soft)] active:scale-[0.96]"
          >
            + 新建设定卡
          </button>
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[var(--surface-2)] p-1" aria-label="实体类型筛选">
            {FILTERS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filterType === id}
                onClick={() => setFilterType(id)}
                className={`min-h-8 rounded-md px-2.5 text-[11px] transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
                  filterType === id
                    ? 'bg-[var(--gold-soft)] font-medium text-[var(--gold-bright)] shadow-[inset_0_0_0_1px_var(--gold-line-soft)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center bg-[var(--surface-raised)] p-8 text-center">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-[var(--jade-soft)] font-serif text-lg font-semibold text-[var(--accent-strong)] shadow-[inset_0_0_0_1px_var(--jade-line-soft)]" aria-hidden="true">
            典
          </div>
          <b className="text-sm text-[var(--foreground)]">《{book?.title ?? '当前作品'}》尚无正典实体卡</b>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-[var(--text-muted)]">
            当前书库未检测到人物、势力、地点或道具设定卡。可以直接在下方点击创建卡片，图谱会按真实数据更新。
          </p>
          <button
            type="button"
            onClick={() => setEntityModalOpen(true)}
            className="mt-4 rounded-md bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--background)] shadow-sm hover:bg-[var(--accent-strong)] active:scale-[0.96]"
          >
            立即创建第一张设定卡
          </button>
        </div>
      ) : (
        <div className="relative flex-1 overflow-hidden bg-[var(--surface-raised)]">
          <svg className="h-full w-full" viewBox="0 0 760 520" preserveAspectRatio="xMidYMid meet" aria-label="正典实体关系图">
            {links.map((link, index) => {
              const sourceNode = nodes.find((node) => node.id === link.source);
              const targetNode = nodes.find((node) => node.id === link.target);
              if (!sourceNode || !targetNode) return null;

              const isContract = Boolean(link.contract);
              const midX = (sourceNode.x + targetNode.x) / 2;
              const midY = (sourceNode.y + targetNode.y) / 2;

              return (
                <g key={index}>
                  <line
                    x1={sourceNode.x}
                    y1={sourceNode.y}
                    x2={targetNode.x}
                    y2={targetNode.y}
                    stroke={isContract ? 'var(--gold)' : 'var(--text-faint)'}
                    strokeWidth={isContract ? 2 : 1.3}
                    strokeDasharray={isContract ? '5 4' : undefined}
                    opacity={0.8}
                  />
                  <rect
                    x={midX - 34}
                    y={midY - 14}
                    width={68}
                    height={18}
                    rx={5}
                    fill="var(--surface)"
                    stroke={isContract ? 'var(--gold-line-soft)' : 'var(--hairline-strong)'}
                  />
                  <text
                    x={midX}
                    y={midY - 2}
                    fill={isContract ? 'var(--gold-bright)' : 'var(--text-muted)'}
                    fontSize="9.5"
                    textAnchor="middle"
                    className="pointer-events-none select-none"
                  >
                    {link.relation}
                  </text>
                </g>
              );
            })}

            {filteredNodes.map((node) => {
              const isSelected = selectedNode?.id === node.id;
              const tone = nodeTone(node.type);

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() => setSelectedNode(node)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedNode(node);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`选择实体：${node.name}`}
                  className="cursor-pointer outline-none"
                >
                  {isSelected && (
                    <circle
                      r={33}
                      fill="none"
                      stroke={tone}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      opacity={0.75}
                    />
                  )}
                  <circle
                    r={isSelected ? 26 : 23}
                    fill="var(--surface)"
                    stroke={tone}
                    strokeWidth={isSelected ? 3 : 2}
                  />
                  <circle r={isSelected ? 19 : 16} fill={tone} fillOpacity={0.13} />
                  <text
                    textAnchor="middle"
                    dy="4"
                    fill="var(--foreground)"
                    fontSize="10.5"
                    fontWeight="600"
                    className="pointer-events-none select-none"
                  >
                    {node.name.slice(0, 3)}
                  </text>
                  <text
                    textAnchor="middle"
                    dy="40"
                    fill="var(--text-muted)"
                    fontSize="10.5"
                    fontWeight="500"
                    className="pointer-events-none select-none"
                  >
                    {node.name}
                  </text>
                </g>
              );
            })}
          </svg>

          {selectedNode && (
            <CanonNodeCard
              node={selectedNode}
              relatedLinks={links.filter(
                (link) => link.source === selectedNode.id || link.target === selectedNode.id,
              )}
              onClose={() => setSelectedNode(null)}
            />
          )}

          {selectedNode && contractTarget && (
            <CreateContractModal
              isOpen={modalOpen}
              onClose={() => setModalOpen(false)}
              sourceName={selectedNode.name}
              targetName={contractTarget.name}
              onCreateContract={handleCreateContract}
            />
          )}
        </div>
      )}

      <CreateEntityModal
        isOpen={entityModalOpen}
        onClose={() => setEntityModalOpen(false)}
        onSave={handleSaveEntity}
      />
    </section>
  );
};
