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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-[var(--hairline-strong)] bg-[var(--surface-raised)] p-6 shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--gold-bright)]" />
            <h3 className="text-sm font-semibold text-[var(--foreground)]">建立因果契约 (CausalContract)</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-[var(--hairline)] bg-[var(--surface-sunken)] p-3 text-xs">
          <span className="font-medium text-[var(--jade)]">{sourceName}</span>
          <span className="text-[var(--text-faint)]">━━ 建立羁绊 ━━►</span>
          <span className="font-medium text-[var(--gold-bright)]">{targetName}</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label className="mb-1 block text-[var(--text-muted)]">关系类型：</label>
            <select
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
              className="w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-sunken)] px-3 py-2 text-[var(--foreground)] focus:border-[var(--gold-line)] focus:outline-none"
            >
              <option value="生死盟约">生死盟约</option>
              <option value="师徒传道">师徒传道</option>
              <option value="宿命仇敌">宿命仇敌</option>
              <option value="庇护救赎">庇护救赎</option>
              <option value="利益交易">利益交易</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[var(--text-muted)]">因果承诺内容：</label>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="如：立誓三月内替对方找齐三味续命主药"
              className="w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-sunken)] px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--text-faint)] focus:border-[var(--gold-line)] focus:outline-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[var(--text-muted)]">履约截止期限：</label>
              <input
                type="text"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-sunken)] px-3 py-2 text-[var(--foreground)] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[var(--text-muted)]">违约惩罚断言：</label>
              <input
                type="text"
                value={penalty}
                onChange={(e) => setPenalty(e.target.value)}
                className="w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-sunken)] px-3 py-2 text-[var(--foreground)] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--hairline)] pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-2)] px-4 py-2 text-[var(--text-muted)] hover:text-[var(--foreground)]"
            >
              取消
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[var(--gold-bright)] px-4 py-2 font-medium text-[var(--background)] hover:bg-[var(--gold)]"
            >
              确认入典
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
