import React, { useState } from 'react';
import { useCanonGraphData, GraphNode } from './useCanonGraphData';
import { CanonNodeCard } from './CanonNodeCard';
import { CreateContractModal } from './CreateContractModal';
import { post } from '../lib/post';
import type { BookInfo } from '../shell/workbenchStorage';

export const CanonGraphView: React.FC<{ book?: BookInfo | null | undefined }> = ({ book }) => {
  const { nodes, links, isLive, isDemo, isEmpty, addLink } = useCanonGraphData(book?.root);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [contractTarget, setContractTarget] = useState<GraphNode | null>(null);

  const filteredNodes = nodes.filter((n) => (filterType === 'all' ? true : n.type === filterType));

  const handleStartContract = (source: GraphNode) => {
    const other = nodes.find((n) => n.id !== source.id);
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
  }) => {
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
      }).catch((e: unknown) => {
        console.error('Failed to sync contract to backend', e);
      });
    }
  };

  return (
    <div className="relative w-full h-full min-h-[600px] bg-zinc-950/90 border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl flex flex-col backdrop-blur-xl">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 bg-zinc-900/70 border-b border-white/[0.08] backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.8)]" />
          <h2 className="text-sm font-semibold text-zinc-100 tracking-wide">
            正典关系与因果拓扑图谱 {book ? `· 《${book.title}》` : ''}
          </h2>
          <span className="text-[11px] text-zinc-400 bg-white/[0.06] border border-white/[0.08] px-2.5 py-0.5 rounded-full font-mono">
            {nodes.length} 实体 · {links.length} 羁绊 {isLive ? (isEmpty ? '(空正典)' : '(实时正典)') : isDemo ? '(示例演示)' : ''}
          </span>
        </div>

        {/* Actions & Filter */}
        <div className="flex items-center gap-2.5">
          {selectedNode && (
            <button
              type="button"
              onClick={() => handleStartContract(selectedNode)}
              className="px-3 py-1.5 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white rounded-xl text-xs font-semibold shadow-lg shadow-amber-600/30 transition-all flex items-center gap-1.5 active:scale-[0.98]"
            >
              <span>✦</span>
              <span>与「{selectedNode.name}」建立契约</span>
            </button>
          )}

          <div className="flex items-center gap-1 bg-zinc-900/90 border border-white/[0.08] p-1 rounded-xl text-xs">
            {['all', 'character', 'faction', 'item'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilterType(t)}
                className={`px-3 py-1 rounded-lg transition-all ${
                  filterType === t
                    ? 'bg-indigo-600 text-white font-medium shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                }`}
              >
                {t === 'all' ? '全部' : t === 'character' ? '人物' : t === 'faction' ? '势力' : '道具'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Interactive SVG Canvas or Empty State */}
      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:24px_24px]">
          <div className="w-14 h-14 rounded-2xl bg-zinc-900/80 border border-white/[0.08] flex items-center justify-center text-zinc-400 mb-3 text-2xl shadow-xl">
            📜
          </div>
          <b className="text-sm text-zinc-200">《{book?.title ?? '当前作品'}》尚无正典实体卡</b>
          <p className="text-xs text-zinc-500 max-w-sm mt-1.5 leading-relaxed">
            当前书库未检测到人物、势力、地点或道具设定卡。可在工作台「Story Brain」或「设定/」目录中创建卡片，拓扑图谱将自动实时呈现实体关系与因果契约。
          </p>
        </div>
      ) : (
        <div className="relative flex-1 bg-[radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:24px_24px] overflow-hidden cursor-crosshair">
          <svg className="w-full h-full">
            <defs>
              <filter id="glow-gold" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="glow-indigo" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <linearGradient id="link-contract" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#d97706" stopOpacity="0.8" />
              </linearGradient>
              <linearGradient id="link-normal" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#818cf8" stopOpacity="0.5" />
              </linearGradient>
            </defs>

            {/* Render Links */}
            {links.map((link, idx) => {
              const sourceNode = nodes.find((n) => n.id === link.source);
              const targetNode = nodes.find((n) => n.id === link.target);
              if (!sourceNode || !targetNode) return null;

              const isContract = Boolean(link.contract);
              const midX = (sourceNode.x + targetNode.x) / 2;
              const midY = (sourceNode.y + targetNode.y) / 2;

              return (
                <g key={idx}>
                  <line
                    x1={sourceNode.x}
                    y1={sourceNode.y}
                    x2={targetNode.x}
                    y2={targetNode.y}
                    stroke={isContract ? 'url(#link-contract)' : 'url(#link-normal)'}
                    strokeWidth={isContract ? 2.5 : 1.4}
                    strokeDasharray={isContract ? '5 3' : undefined}
                    filter={isContract ? 'url(#glow-gold)' : undefined}
                  />
                  <rect
                    x={midX - 32}
                    y={midY - 14}
                    width={64}
                    height={18}
                    rx={5}
                    fill="#09090b"
                    stroke={isContract ? 'rgba(245, 158, 11, 0.4)' : 'rgba(255, 255, 255, 0.1)'}
                    strokeWidth={1}
                  />
                  <text
                    x={midX}
                    y={midY - 2}
                    fill={isContract ? '#fbbf24' : '#a1a1aa'}
                    fontSize="9.5"
                    textAnchor="middle"
                    className="select-none font-sans font-medium"
                  >
                    {link.relation}
                  </text>
                </g>
              );
            })}

            {/* Render Nodes */}
            {filteredNodes.map((node) => {
              const isSelected = selectedNode?.id === node.id;
              const nodeColor =
                node.type === 'character'
                  ? '#6366f1'
                  : node.type === 'faction'
                  ? '#10b981'
                  : node.type === 'location'
                  ? '#0ea5e9'
                  : '#f59e0b';

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() => setSelectedNode(node)}
                  className="cursor-pointer group"
                >
                  {/* Outer aura ring on select */}
                  {isSelected && (
                    <circle
                      r={34}
                      fill="none"
                      stroke={nodeColor}
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      opacity={0.7}
                      className="animate-spin origin-center duration-1000"
                    />
                  )}

                  {/* Base Circle */}
                  <circle
                    r={isSelected ? 26 : 22}
                    fill="#111216"
                    stroke={nodeColor}
                    strokeWidth={isSelected ? 3 : 2}
                    filter={isSelected ? 'url(#glow-indigo)' : undefined}
                    className="transition-all duration-200 group-hover:scale-110"
                  />
                  <circle
                    r={isSelected ? 20 : 16}
                    fill={nodeColor}
                    fillOpacity={0.25}
                    className="transition-all duration-200"
                  />
                  <text
                    textAnchor="middle"
                    dy="4"
                    fill="#f4f4f5"
                    fontSize="11"
                    fontWeight="600"
                    className="select-none pointer-events-none font-sans"
                  >
                    {node.name.slice(0, 3)}
                  </text>
                  <text
                    textAnchor="middle"
                    dy="40"
                    fill="#e4e4e7"
                    fontSize="11"
                    className="select-none pointer-events-none font-medium tracking-wide drop-shadow"
                  >
                    {node.name}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Selected Node Card Overlay */}
          {selectedNode && (
            <CanonNodeCard
              node={selectedNode}
              relatedLinks={links.filter(
                (l) => l.source === selectedNode.id || l.target === selectedNode.id,
              )}
              onClose={() => setSelectedNode(null)}
            />
          )}

          {/* Create Contract Modal */}
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
    </div>
  );
};
