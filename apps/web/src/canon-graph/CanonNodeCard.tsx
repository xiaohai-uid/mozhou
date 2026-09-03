import React from 'react';
import { GraphNode, GraphLink } from './useCanonGraphData';

export interface CanonNodeCardProps {
  node: GraphNode;
  relatedLinks: GraphLink[];
  onClose: () => void;
}

export const CanonNodeCard: React.FC<CanonNodeCardProps> = ({ node, relatedLinks, onClose }) => {
  return (
    <div className="absolute top-4 right-4 z-20 w-80 bg-zinc-900/95 border border-zinc-700/80 rounded-xl p-4 shadow-2xl backdrop-blur-md text-xs space-y-3 animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
          <h4 className="font-semibold text-zinc-100 text-sm">{node.name}</h4>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-200 text-sm px-1.5 py-0.5 rounded hover:bg-zinc-800"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="bg-zinc-800/40 p-2 rounded border border-zinc-800">
          <span className="text-zinc-500 block">实体类型</span>
          <span className="text-zinc-200 font-medium">{node.type}</span>
        </div>
        <div className="bg-zinc-800/40 p-2 rounded border border-zinc-800">
          <span className="text-zinc-500 block">境界 / 等级</span>
          <span className="text-indigo-300 font-medium">{node.realm || '未标明'}</span>
        </div>
        {node.faction && (
          <div className="col-span-2 bg-zinc-800/40 p-2 rounded border border-zinc-800">
            <span className="text-zinc-500 block">所属势力</span>
            <span className="text-zinc-200 font-medium">{node.faction}</span>
          </div>
        )}
      </div>

      {/* Causal Contracts & Relations */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">关联因果契约与羁绊</div>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {relatedLinks.map((link, idx) => (
            <div key={idx} className="p-2 bg-zinc-950/70 border border-zinc-800 rounded-lg space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-indigo-400 font-medium">{link.relation}</span>
                {link.contract && (
                  <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 py-0.5 rounded border border-amber-500/30">
                    {link.contract.status}
                  </span>
                )}
              </div>
              {link.contract && (
                <div className="text-[10px] text-zinc-400 italic">
                  承诺: {link.contract.summary}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
