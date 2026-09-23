import React from 'react';
import type { GraphLink, GraphNode } from './useCanonGraphData';

export interface CanonNodeCardProps {
  node: GraphNode;
  relatedLinks: GraphLink[];
  onClose: () => void;
}

function typeLabel(type: GraphNode['type']): string {
  switch (type) {
    case 'character':
      return '人物';
    case 'faction':
      return '势力';
    case 'location':
      return '地点';
    case 'item':
      return '道具';
  }
}

export const CanonNodeCard: React.FC<CanonNodeCardProps> = ({ node, relatedLinks, onClose }) => {
  return (
    <aside className="absolute right-5 top-5 z-20 w-[340px] space-y-4 rounded-xl border border-[var(--hairline-strong)] bg-[var(--surface-raised)] p-5 text-xs shadow-[0_18px_42px_rgba(0,0,0,0.38)]" aria-label={`${node.name} 实体详情`}>
      <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-2.5 w-2.5 flex-none rounded-full bg-[var(--accent)]" aria-hidden="true" />
          <div className="min-w-0">
            <h4 className="m-0 truncate text-sm font-semibold text-[var(--foreground)]">{node.name}</h4>
            <span className="text-[10px] text-[var(--text-faint)]">{typeLabel(node.type)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭实体详情"
          className="grid h-10 w-10 place-items-center rounded-lg text-base text-[var(--text-muted)] transition-[background-color,color,transform] duration-150 hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] active:scale-[0.96]"
        >
          ×
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg bg-[var(--surface-2)] p-2.5">
          <dt className="text-[var(--text-faint)]">实体类型</dt>
          <dd className="mt-0.5 font-medium text-[var(--foreground)]">{typeLabel(node.type)}</dd>
        </div>
        <div className="rounded-lg bg-[var(--surface-2)] p-2.5">
          <dt className="text-[var(--text-faint)]">境界 / 设定</dt>
          <dd className="mt-0.5 font-medium text-[var(--accent-strong)]">{node.realm || '正典基线'}</dd>
        </div>
        {node.faction && (
          <div className="col-span-2 rounded-lg bg-[var(--surface-2)] p-2.5">
            <dt className="text-[var(--text-faint)]">所属势力</dt>
            <dd className="mt-0.5 font-medium text-[var(--foreground)]">{node.faction}</dd>
          </div>
        )}
        {node.role && (
          <div className="col-span-2 rounded-lg bg-[var(--surface-2)] p-2.5">
            <dt className="text-[var(--text-faint)]">身份与角色定位</dt>
            <dd className="mt-0.5 font-medium leading-5 text-[var(--foreground)]">{node.role}</dd>
          </div>
        )}
      </dl>

      <section aria-labelledby="canon-node-relations-title">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h5 id="canon-node-relations-title" className="m-0 text-[11px] font-semibold text-[var(--text-muted)]">
            关联因果契约与羁绊
          </h5>
          <span className="rounded-md bg-[var(--gold-soft)] px-2 py-1 font-mono text-[9px] text-[var(--gold-bright)]">
            {relatedLinks.length} 条
          </span>
        </div>
        <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
          {relatedLinks.length === 0 ? (
            <div className="rounded-lg bg-[var(--surface-2)] p-3 text-center text-[11px] text-[var(--text-faint)]">
              暂无关联因果契约
            </div>
          ) : (
            relatedLinks.map((link, index) => (
              <div key={index} className="space-y-1 rounded-lg bg-[var(--surface-2)] p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[var(--accent-strong)]">{link.relation}</span>
                  {link.contract && (
                    <span className="rounded-md bg-[var(--gold-soft)] px-1.5 py-1 font-mono text-[9px] text-[var(--gold-bright)]">
                      {link.contract.status}
                    </span>
                  )}
                </div>
                {link.contract && (
                  <div className="space-y-0.5 text-[10px] leading-4 text-[var(--text-muted)]">
                    <div>承诺：{link.contract.summary}</div>
                    {link.contract.deadline && <div className="text-[var(--text-faint)]">期限：{link.contract.deadline}</div>}
                    {link.contract.penalty && <div className="text-[var(--danger)]">违约：{link.contract.penalty}</div>}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </aside>
  );
};
