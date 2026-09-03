import React, { useState } from 'react';
import { useCanonGraphData, GraphNode } from './useCanonGraphData';
import { CanonNodeCard } from './CanonNodeCard';

export const CanonGraphView: React.FC = () => {
  const { nodes, links } = useCanonGraphData();
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [filterType, setFilterType] = useState<string>('all');

  const filteredNodes = nodes.filter((n) => (filterType === 'all' ? true : n.type === filterType));

  return (
    <div className="relative w-full h-full min-h-[600px] bg-zinc-950/80 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-5 py-3 bg-zinc-900/60 border-b border-zinc-800/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.6)]" />
          <h2 className="text-sm font-semibold text-zinc-100 tracking-wide">正典关系与因果拓扑图谱</h2>
          <span className="text-xs text-zinc-500 bg-zinc-800/60 px-2 py-0.5 rounded-full">
            {nodes.length} 实体 / {links.length} 关系边
          </span>
        </div>

        {/* Filter */}
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

      {/* Interactive SVG Canvas */}
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
      </div>
    </div>
  );
};
