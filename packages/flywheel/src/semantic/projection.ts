/**
 * semantic_analysis 派生投影（T29 · #70；t66 D14/E5）。
 *
 * 裁决 D14/E5：投影可弃重建 = 扫报告目录（V1 不落 SQLite——重建等价面即
 * 目录扫描；SQLite 化留到需要跨书查询时再做，工程守则 2：最简实现）。
 * 行形状对齐 E5 schema：report_id PK / receipt_id / chapter_index / created_at /
 * verdict / finding_count / provider / model? / input_tokens / output_tokens。
 * 只读视图：真源是报告文件，本投影永不可写。
 */
import { readSemanticReports } from './report-store.js';

export interface SemanticAnalysisRow {
  readonly report_id: string;
  readonly receipt_id: string;
  readonly chapter_index: number | null;
  readonly created_at: string;
  readonly verdict: string;
  readonly finding_count: number;
  readonly provider: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
}

/** 扫目录重建投影行（排序稳定：created_at 升序）。 */
export function selectSemanticAnalysisRows(bookRoot: string): readonly SemanticAnalysisRow[] {
  return readSemanticReports(bookRoot)
    .map((report) => ({
      report_id: report.reportId,
      receipt_id: report.anchor.receiptId,
      chapter_index: report.anchor.chapterIndex ?? null,
      created_at: report.recordedAt,
      verdict: report.verdict,
      finding_count: report.findings.length,
      provider: report.provider,
      input_tokens: report.inputStats.inputTokens,
      output_tokens: report.inputStats.outputTokens,
    }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
