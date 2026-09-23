/**
 * 审查报告时效性（ADR-0025 决策 3）：报告锚定的 draft revision/hash 与当前
 * draft 身份逐字段精确相等才算 current；任一变化即 stale——拿旧 PASS 交付
 * 新正文在管线层被拒绝（fail closed），不信任调用方自觉。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QualityReviewReport } from './types.js';

export interface DraftIdentity {
  readonly draftRevision: number;
  readonly draftContentHash: string;
}

export interface ChapterQualityStatus {
  readonly status: 'current' | 'stale' | 'no_review';
  readonly report: QualityReviewReport | null;
  readonly current: boolean;
}

export function isQualityReviewCurrent(
  report: QualityReviewReport,
  draft: DraftIdentity,
): boolean {
  return report.anchor.draftRevision === draft.draftRevision
    && report.anchor.draftContentHash === draft.draftContentHash;
}

/**
 * 仓储查询深模块：
 * 封装 .mozhou/quality-reviews/ 目录遍历、报告解析与当前正文哈希时效性比对。
 * 彻底隔离物理文件系统路径命名细节与上层 HTTP 传输层。
 */
export function queryChapterQualityStatus(
  root: string,
  chapterIndex: number,
  currentDraft: DraftIdentity,
): ChapterQualityStatus {
  const reviewsDir = join(root, '.mozhou', 'quality-reviews', `chapter_${chapterIndex}`);
  if (!existsSync(reviewsDir)) {
    return { status: 'no_review', report: null, current: false };
  }

  let files: string[] = [];
  try {
    files = readdirSync(reviewsDir)
      .filter((f) => f.startsWith('report_') && f.endsWith('.json'))
      .sort();
  } catch {
    return { status: 'no_review', report: null, current: false };
  }

  if (files.length === 0) {
    return { status: 'no_review', report: null, current: false };
  }

  const latestFile = files[files.length - 1]!;
  try {
    const report = JSON.parse(readFileSync(join(reviewsDir, latestFile), 'utf8')) as QualityReviewReport;
    const current = isQualityReviewCurrent(report, currentDraft);
    return {
      status: current ? 'current' : 'stale',
      report,
      current,
    };
  } catch {
    return { status: 'no_review', report: null, current: false };
  }
}
