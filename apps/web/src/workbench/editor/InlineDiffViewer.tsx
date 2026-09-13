import React from 'react';

export interface InlineDiffViewerProps {
  originalText: string;
  proposedText: string;
  onAccept: () => void;
  onReject: () => void;
  actionLabel?: string;
}

/** 双栏 Inline Diff（Ink Realm · 三重编码：结构 + −/+ 符号 + 语义色；采纳=Gold 作者主权）。 */
export const InlineDiffViewer: React.FC<InlineDiffViewerProps> = ({
  originalText,
  proposedText,
  onAccept,
  onReject,
  actionLabel = 'AI 调优结果',
}) => {
  return (
    <div
      className="mat-ink-glass"
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
      data-testid="inline-diff-viewer"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: 8,
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge b-jade">AI CANDIDATE</span>
          <span className="kicker">{actionLabel} · 对比</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={onReject} className="btn btn-sm">
            放弃 (Esc)
          </button>
          <button type="button" onClick={onAccept} className="btn btn-author btn-sm">
            采纳替换 (Enter)
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div
          style={{
            padding: 12,
            borderRadius: 9,
            background: 'rgba(217, 131, 131, 0.07)',
            border: '1px solid rgba(217, 131, 131, 0.3)',
          }}
        >
          <div className="kicker" style={{ color: 'var(--danger)', marginBottom: 6 }}>
            − REMOVED · 原始片段
          </div>
          <div
            style={{
              fontFamily: 'var(--serif)',
              fontSize: 13.5,
              lineHeight: 1.8,
              color: 'var(--danger)',
              textDecoration: 'line-through',
              opacity: 0.85,
              whiteSpace: 'pre-wrap',
            }}
          >
            {originalText}
          </div>
        </div>

        <div
          style={{
            padding: 12,
            borderRadius: 9,
            background: 'rgba(120, 199, 157, 0.06)',
            border: '1px solid rgba(120, 199, 157, 0.3)',
          }}
        >
          <div className="kicker" style={{ color: 'var(--success)', marginBottom: 6 }}>
            + PROPOSED · 采纳后重构
          </div>
          <div
            style={{
              fontFamily: 'var(--serif)',
              fontSize: 13.5,
              lineHeight: 1.8,
              color: 'var(--foreground)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {proposedText}
          </div>
        </div>
      </div>

      <p className="note" style={{ margin: 0 }}>
        采纳 = Accepted（作者主权，Gold）；durable 持久化以 Chapter Commit 为准——Accepted ≠ Committed。
      </p>
    </div>
  );
};
