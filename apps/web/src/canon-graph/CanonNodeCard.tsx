import React from 'react';
import type { GraphNode, GraphLink } from './useCanonGraphData';

export interface CanonNodeCardProps {
  node: GraphNode;
  relatedLinks: GraphLink[];
  onClose: () => void;
}

export const CanonNodeCard: React.FC<CanonNodeCardProps> = ({ node, relatedLinks, onClose }) => {
  return (
    <div className="absolute top-5 right-5 z-20 w-84 bg-zinc-900/90 border border-white/[0.12] rounded-2xl p-5 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.8)] backdrop-blur-2xl text-xs space-y-4 animate-in fade-in zoom-in-95 duration-200">
      <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`w-3 h-3 rounded-full ${
              node.type === 'character'
                ? 'bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.8)]'
                : node.type === 'faction'
                ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]'
                : node.type === 'location'
                ? 'bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.8)]'
                : 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.8)]'
            }`}
          />
          <h4 className="font-semibold text-zinc-100 text-sm tracking-wide">{node.name}</h4>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-200 text-sm w-6 h-6 rounded-lg hover:bg-white/[0.08] flex items-center justify-center transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="bg-zinc-950/60 p-2.5 rounded-xl border border-white/[0.06]">
          <span className="text-zinc-500 block mb-0.5">实体类型</span>
          <span className="text-zinc-200 font-medium">
            {node.type === 'character'
              ? '人物 (Character)'
              : node.type === 'faction'
              ? '势力 (Faction)'
              : node.type === 'location'
              ? '地点 (Location)'
              : '道具 (Item)'}
          </span>
        </div>
        <div className="bg-zinc-950/60 p-2.5 rounded-xl border border-white/[0.06]">
          <span className="text-zinc-500 block mb-0.5">境界 / 设定</span>
          <span className="text-indigo-300 font-medium">{node.realm || '正典基线'}</span>
        </div>
        {node.role && (
          <div className="col-span-2 bg-zinc-950/60 p-2.5 rounded-xl border border-white/[0.06]">
            <span className="text-zinc-500 block mb-0.5">身份与角色定位</span>
            <span className="text-zinc-200 font-medium">{node.role}</span>
          </div>
        )}
      </div>

      {/* Causal Contracts & Relations */}
      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
          <span className="text-amber-400">⚡</span> 关联因果契约与羁绊 ({relatedLinks.length})
        </div>
        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
          {relatedLinks.length === 0 ? (
            <div className="text-[11px] text-zinc-500 p-2 text-center bg-zinc-950/40 rounded-lg">
              暂无关联因果契约
            </div>
          ) : (
            relatedLinks.map((link, idx) => (
              <div
                key={idx}
                className="p-2.5 bg-zinc-950/70 border border-white/[0.06] rounded-xl space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-indigo-300 font-medium text-xs">{link.relation}</span>
                  {link.contract && (
                    <span className="text-[9px] bg-amber-500/15 text-amber-300 px-1.5 py-0.5 rounded-full border border-amber-500/30 font-mono">
                      {link.contract.status}
                    </span>
                  )}
                </div>
                {link.contract && (
                  <div className="text-[10px] text-zinc-400 leading-relaxed">
                    <div>承诺：{link.contract.summary}</div>
                    {link.contract.deadline && (
                      <div className="text-zinc-500 mt-0.5">期限：{link.contract.deadline}</div>
                    )}
                    {link.contract.penalty && (
                      <div className="text-rose-400/90 mt-0.5">违约：{link.contract.penalty}</div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
