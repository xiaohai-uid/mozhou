import React, { useMemo } from 'react';
import { runDeAiDiagnostics } from '@mozhou/quality-engine/de-ai';

export interface EditorQualityTelemetryProps {
  content: string;
  whitelistWords?: readonly string[];
  className?: string;
}

/**
 * 编辑器质量遥测条（Ink Realm · Evidence Row 语义）。
 * 浏览器安全：只经 @mozhou/quality-engine/de-ai 子路径取 De-AI 机检，
 * 该入口无 Node 依赖（包根经 policy.ts/staleness.ts 携 node:crypto/node:fs，
 * 禁止在渲染进程导入）。不变量由 packages/quality-engine/src/de-ai.browser-safe.test.ts
 * 与 apps/web 侧 EditorQualityTelemetry.test.tsx 双向守护。
 */
export const EditorQualityTelemetry: React.FC<EditorQualityTelemetryProps> = ({
  content,
  whitelistWords = [],
  className = '',
}) => {
  const telemetry = useMemo(() => {
    const text = content.trim();
    const charCount = text.length;
    const wordCount = (text.match(/[\u4e00-\u9fa5]|\b[a-zA-Z0-9_]+\b/g) || []).length;
    const paragraphCount = text ? text.split(/\n+/).filter(Boolean).length : 0;

    // 4-gram 中文滑窗复读
    const cleanChars = text.replace(/[^\u4e00-\u9fa5]/g, '');
    const ngrams = new Map<string, number>();
    let repetitionCount = 0;
    for (let i = 0; i <= cleanChars.length - 4; i++) {
      const gram = cleanChars.slice(i, i + 4);
      const count = (ngrams.get(gram) || 0) + 1;
      ngrams.set(gram, count);
      if (count > 2) {
        repetitionCount++;
      }
    }

    const deAiReport = runDeAiDiagnostics(text, whitelistWords);
    const isClean = repetitionCount === 0 && deAiReport.clean;

    return { charCount, wordCount, paragraphCount, repetitionCount, deAiReport, isClean };
  }, [content, whitelistWords]);

  const metricColor = (bad: boolean): string => (bad ? 'var(--danger)' : 'var(--success)');

  return (
    <div
      className={`row-evidence ${className}`}
      style={{ gap: 14, padding: '6px 10px', flexWrap: 'wrap' }}
      data-testid="editor-quality-telemetry"
    >
      <span><span style={{ color: 'var(--text-faint)' }}>字数 </span><span className="em">{telemetry.wordCount}</span></span>
      <span><span style={{ color: 'var(--text-faint)' }}>段落 </span><span className="em">{telemetry.paragraphCount}</span></span>
      <span><span style={{ color: 'var(--text-faint)' }}>4-gram 复读 </span><span className="em" style={{ color: metricColor(telemetry.repetitionCount > 0) }}>{telemetry.repetitionCount}</span></span>
      <span><span style={{ color: 'var(--text-faint)' }}>Tier 1 必阻断 </span><span className="em" style={{ color: metricColor(telemetry.deAiReport.tier1Count > 0) }}>{telemetry.deAiReport.tier1Count}</span></span>
      <span><span style={{ color: 'var(--text-faint)' }}>Tier 2 聚集 </span><span className="em" style={{ color: metricColor(telemetry.deAiReport.tier2Count > 0) }}>{telemetry.deAiReport.tier2Count}</span></span>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span className="badge" style={{ fontSize: 9, ...(telemetry.isClean
          ? { color: 'var(--success)', background: 'rgba(120,199,157,.12)', borderColor: 'rgba(120,199,157,.4)' }
          : { color: 'var(--warning)', background: 'rgba(211,167,101,.12)', borderColor: 'rgba(211,167,101,.4)' }) }}>
          {telemetry.isClean ? `De-AI 正典纯净 (${telemetry.deAiReport.score}分)` : `AI 腔调待净化 (${telemetry.deAiReport.score}分)`}
        </span>
      </span>
    </div>
  );
};
