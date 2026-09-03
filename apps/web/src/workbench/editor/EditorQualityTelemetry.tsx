import React, { useMemo } from 'react';
import { runDeAiDiagnostics } from '@mozhou/quality-engine';

export interface EditorQualityTelemetryProps {
  content: string;
  whitelistWords?: readonly string[];
  className?: string;
}

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

    // Fast 4-gram repetition check (Chinese characters sliding window)
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

    // Comprehensive De-AI Industrial Diagnostics
    const deAiReport = runDeAiDiagnostics(text, whitelistWords);

    const isClean = repetitionCount === 0 && deAiReport.clean;

    return {
      charCount,
      wordCount,
      paragraphCount,
      repetitionCount,
      deAiReport,
      isClean,
    };
  }, [content, whitelistWords]);

  return (
    <div className={`flex items-center gap-4 text-xs font-mono text-zinc-400 bg-zinc-900/80 px-3 py-1.5 rounded-lg border border-zinc-800 ${className}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-zinc-500">字数:</span>
        <span className="text-zinc-200 font-medium">{telemetry.wordCount}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-zinc-500">段落:</span>
        <span className="text-zinc-200 font-medium">{telemetry.paragraphCount}</span>
      </div>
      <div className="h-3 w-px bg-zinc-700" />
      <div className="flex items-center gap-1.5">
        <span className="text-zinc-500">4-gram 复读:</span>
        <span className={telemetry.repetitionCount === 0 ? 'text-emerald-400' : 'text-amber-400 font-semibold'}>
          {telemetry.repetitionCount}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-zinc-500">Tier 1 必阻断:</span>
        <span className={telemetry.deAiReport.tier1Count === 0 ? 'text-emerald-400' : 'text-rose-400 font-semibold'}>
          {telemetry.deAiReport.tier1Count}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-zinc-500">Tier 2 聚集:</span>
        <span className={telemetry.deAiReport.tier2Count === 0 ? 'text-emerald-400' : 'text-amber-400 font-semibold'}>
          {telemetry.deAiReport.tier2Count}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <span className={`inline-block w-2 h-2 rounded-full ${telemetry.isClean ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'}`} />
        <span className={telemetry.isClean ? 'text-emerald-400 font-sans text-[11px]' : 'text-amber-400 font-sans text-[11px]'}>
          {telemetry.isClean ? `De-AI 正典纯净 (${telemetry.deAiReport.score}分)` : `AI 腔调待净化 (${telemetry.deAiReport.score}分)`}
        </span>
      </div>
    </div>
  );
};
