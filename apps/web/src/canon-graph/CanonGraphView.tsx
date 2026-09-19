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
    <div className="relative w-full h-full min-h-[600px] bg-zinc-950/80 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-5 py-3 bg-zinc-900/60 border-b border-zinc-800/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.6)]" />
          <h2 className="text-sm font-semibold text-zinc-100 tracking-wide">
            正典关系与因果拓扑图谱 {book ? `· 《${book.title}》` : ''}
          </h2>
          <span className="text-xs text-zinc-500 bg-zinc-800/60 px-2 py-0.5 rounded-full">
            {nodes.length} 实体 / {links.length} 关系边 {isLive ? (isEmpty ? '(空正典)' : '(实时正典)') : isDemo ? '(示例演示)' : ''}
          </span>
        </div>

        {/* Actions & Filter */}
        <div className="flex items-center gap-2">
          {selectedNode && (
            <button
              type="button"
              onClick={() => handleStartContract(selectedNode)}
              className="px-2.5 py-1 bg-amber-600/80 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold shadow transition-all"
            >
              + 与「{selectedNode.name}」建立契约
            </button>
          )}

          <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 p-1 rounded-lg text-xs">
            {['all', 'character', 'faction', 'item'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilterType(t)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  filterType === t
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
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
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:16px_16px]">
          <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 mb-3 text-lg">
            📜
          </div>
          <b className="text-sm text-zinc-300">《{book?.title ?? '当前作品'}》尚无正典实体卡</b>
          <p className="text-xs text-zinc-500 max-w-sm mt-1 leading-relaxed">
            当前书库未检测到人物、势力、地点或道具设定卡。可在工作台「Story Brain」或「设定/」目录中创建卡片，拓扑图谱将自动实时呈现实体关系与因果契约。
          </p>
        </div>
      ) : (
        <div className="relative flex-1 bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:16px_16px] overflow-hidden cursor-crosshair">
        <svg className="w-full h-full">
          {/* Render Links */}
          {links.map((link, idx) => {
            const sourceNode = nodes.find((n) => n.id === link.source);
            const targetNode = nodes.find((n) => n.id === link.target);
            if (!sourceNode || !targetNode) return null;

            return (
              <g key={idx}>
                <line
                  x1={sourceNode.x}
                  y1={sourceNode.y}
                  x2={targetNode.x}
                  y2={targetNode.y}
                  stroke={link.contract ? '#f59e0b' : '#4f46e5'}
                  strokeWidth={link.contract ? 2 : 1.2}
                  strokeDasharray={link.contract ? '4 2' : undefined}
                  opacity={0.65}
                />
                <text
                  x={(sourceNode.x + targetNode.x) / 2}
                  y={(sourceNode.y + targetNode.y) / 2 - 6}
                  fill="#a1a1aa"
                  fontSize="10"
                  textAnchor="middle"
                  className="select-none font-sans"
                >
                  {link.relation}
                </text>
              </g>
            );
          })}

          {/* Render Nodes */}
          {filteredNodes.map((node) => {
            const isSelected = selectedNode?.id === node.id;
            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onClick={() => setSelectedNode(node)}
                className="cursor-pointer group"
              >
                <circle
                  r={isSelected ? 26 : 22}
                  fill={
                    node.type === 'character'
                      ? '#4f46e5'
                      : node.type === 'faction'
                      ? '#059669'
                      : '#d97706'
                  }
                  fillOpacity={0.85}
                  stroke={isSelected ? '#ffffff' : '#27272a'}
                  strokeWidth={isSelected ? 3 : 2}
                  className="transition-all duration-150 group-hover:scale-110"
                />
                <text
                  textAnchor="middle"
                  dy="4"
                  fill="#ffffff"
                  fontSize="11"
                  fontWeight="bold"
                  className="select-none pointer-events-none"
                >
                  {node.name.slice(0, 3)}
                </text>
                <text
                  textAnchor="middle"
                  dy="38"
                  fill="#d4d4d8"
                  fontSize="11"
                  className="select-none pointer-events-none font-medium"
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
              (l) => l.source === selectedNode.id || l.target === selectedNode.id
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
