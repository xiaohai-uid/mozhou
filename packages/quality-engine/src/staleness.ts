/**
 * 审查报告时效性（ADR-0025 决策 3）：报告锚定的 draft revision/hash 与当前
 * draft 身份逐字段精确相等才算 current；任一变化即 stale——拿旧 PASS 交付
 * 新正文在管线层被拒绝（fail closed），不信任调用方自觉。
 */
import type { QualityReviewReport } from './types.js';

export interface DraftIdentity {
  readonly draftRevision: number;
  readonly draftContentHash: string;
}

export function isQualityReviewCurrent(
  report: QualityReviewReport,
  draft: DraftIdentity,
): boolean {
  return report.anchor.draftRevision === draft.draftRevision
    && report.anchor.draftContentHash === draft.draftContentHash;
}
