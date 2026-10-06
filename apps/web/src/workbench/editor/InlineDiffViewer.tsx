import React from 'react';

export interface InlineDiffQualityHint {
  /** De-AI 机检 + 4-gram 复读全绿 ⇒ clean；否则黄标提示采纳前复核（FR-3.3）。 */
  clean: boolean;
  tier1: number;
  tier2: number;
  repetitions: number;
}

export interface InlineDiffViewerProps {
  originalText: string;
  proposedText: string;
  onAccept: () => void;
  onReject: () => void;
  actionLabel?: string;
  /** 候选仍在流式生成中：按钮禁用、只读展示（绝不半途可采纳）。 */
  loading?: boolean;
  /** 采纳前质量遥测（FR-3.3）：绿=纯净可采纳；黄=有 AI 腔调/复读，提示复核。 */
  quality?: InlineDiffQualityHint | undefined;
}

/** 双栏 Inline Diff（Ink Realm · 三重编码：结构 + −/+ 符号 + 语义色；采纳=Gold 作者主权）。 */
export const InlineDiffViewer: React.FC<InlineDiffViewerProps> = ({
  originalText,
  proposedText,
  onAccept,
  onReject,
  actionLabel = 'AI 调优结果',
  loading = false,
  quality = undefined,
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
          {quality !== undefined && (
            <span
              className="badge"
              data-testid="inline-diff-quality"
              title={`4-gram 复读 ${quality.repetitions} · Tier1 ${quality.tier1} · Tier2 ${quality.tier2}`}
              style={{
                fontSize: 9,
                ...(quality.clean
                  ? { color: 'var(--success)', background: 'rgba(120,199,157,.12)', borderColor: 'rgba(120,199,157,.4)' }
                  : { color: 'var(--warning)', background: 'rgba(211,167,101,.12)', borderColor: 'rgba(211,167,101,.4)' }),
              }}
            >
              {quality.clean ? '采纳前质检 · 纯净' : '采纳前质检 · 待复核'}
            </span>
          )}
          <button type="button" onClick={onReject} className="btn btn-sm" disabled={loading}>
            放弃 (Esc)
          </button>
          <button type="button" onClick={onAccept} className="btn btn-author btn-sm" disabled={loading} data-testid="inline-diff-accept">
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

      {loading && (
        <div className="kicker" style={{ color: 'var(--jade)', textAlign: 'center' }} data-testid="inline-diff-streaming">
          候选生成中…（完成后由你决断采纳/放弃——正文不会被自动覆盖）
        </div>
      )}

      <p className="note" style={{ margin: 0 }}>
        采纳 = Accepted（作者主权，Gold）；durable 持久化以 Chapter Commit 为准——Accepted ≠ Committed。
      </p>
    </div>
  );
};
