import React, { useState } from 'react';

export interface CreateContractModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceName: string;
  targetName: string;
  onCreateContract: (contract: {
    relation: string;
    summary: string;
    deadline?: string;
    penalty?: string;
  }) => void;
}

export const CreateContractModal: React.FC<CreateContractModalProps> = ({
  isOpen,
  onClose,
  sourceName,
  targetName,
  onCreateContract,
}) => {
  const [relation, setRelation] = useState('生死契约');
  const [summary, setSummary] = useState('');
  const [deadline, setDeadline] = useState('第 020 章之前');
  const [penalty, setPenalty] = useState('道心崩塌，遭受天道雷劫');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) return;
    onCreateContract({
      relation,
      summary: summary.trim(),
      deadline,
      penalty,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl p-6 shadow-2xl max-w-md w-full space-y-4">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-amber-500 animate-pulse" />
            <h3 className="text-sm font-semibold text-zinc-100">建立因果契约 (CausalContract)</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 text-sm px-2 py-1 rounded hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <div className="p-3 bg-zinc-950/80 rounded-xl border border-zinc-800 text-xs flex items-center justify-between">
          <span className="text-indigo-400 font-medium">{sourceName}</span>
          <span className="text-zinc-500">━━ 建立羁绊 ━━►</span>
          <span className="text-emerald-400 font-medium">{targetName}</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block text-zinc-400 mb-1">关系类型：</label>
            <select
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="生死盟约">生死盟约</option>
              <option value="师徒传道">师徒传道</option>
              <option value="宿命仇敌">宿命仇敌</option>
              <option value="庇护救赎">庇护救赎</option>
              <option value="利益交易">利益交易</option>
            </select>
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">因果承诺内容：</label>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="如：立誓三月内替对方找齐三味续命主药"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-zinc-400 mb-1">履约截止期限：</label>
              <input
                type="text"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-zinc-400 mb-1">违约惩罚断言：</label>
              <input
                type="text"
                value={penalty}
                onChange={(e) => setPenalty(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-zinc-400 hover:text-zinc-200 bg-zinc-800 rounded-lg"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium shadow-md"
            >
              确认入典
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
