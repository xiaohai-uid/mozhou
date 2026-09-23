import { describe, expect, it } from 'vitest';
import { isQualityReviewCurrent, queryChapterQualityStatus } from './staleness.js';
import type { QualityReviewReport } from './types.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fakeReport(overrides: {
  draftRevision?: number;
  draftContentHash?: string;
  verdict?: QualityReviewReport['verdict'];
}): QualityReviewReport {
  return {
    schemaVersion: 1,
    reportId: 'report-0001',
    anchor: {
      chapterIndex: 3,
      draftRevision: overrides.draftRevision ?? 7,
      draftContentHash: overrides.draftContentHash ?? 'aaa',
      receiptId: 'receipt-0001',
      ruleSetDigest: 'digest-0001',
    },
    reviewer: { providerId: 'test-provider', model: 'test-model', recipeVersion: '1.0.0' },
    evaluations: [],
    verdict: overrides.verdict ?? 'pass',
  };
}

describe('isQualityReviewCurrent', () => {
  it('invalidates a pass when draft hash changes', () => {
    const report = fakeReport({ draftRevision: 7, draftContentHash: 'aaa' });
    expect(isQualityReviewCurrent(report, { draftRevision: 8, draftContentHash: 'bbb' })).toBe(false);
  });

  it('keeps a pass current when revision and hash both match', () => {
    const report = fakeReport({ draftRevision: 7, draftContentHash: 'aaa' });
    expect(isQualityReviewCurrent(report, { draftRevision: 7, draftContentHash: 'aaa' })).toBe(true);
  });

  it('invalidates when only the hash changes at the same revision', () => {
    const report = fakeReport({ draftRevision: 7, draftContentHash: 'aaa' });
    expect(isQualityReviewCurrent(report, { draftRevision: 7, draftContentHash: 'aab' })).toBe(false);
  });

  it('invalidates when only the revision changes', () => {
    const report = fakeReport({ draftRevision: 7, draftContentHash: 'aaa' });
    expect(isQualityReviewCurrent(report, { draftRevision: 8, draftContentHash: 'aaa' })).toBe(false);
  });

  it('queryChapterQualityStatus 封装报告查询与时效性评定', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozhou-staleness-test-'));
    try {
      // 1. 无目录 => no_review
      expect(queryChapterQualityStatus(root, 1, { draftRevision: 1, draftContentHash: 'h1' })).toEqual({
        status: 'no_review',
        report: null,
        current: false,
      });

      // 2. 写入匹配报告 => current
      const reviewsDir = join(root, '.mozhou', 'quality-reviews', 'chapter_1');
      mkdirSync(reviewsDir, { recursive: true });
      const report = fakeReport({ draftRevision: 1, draftContentHash: 'h1' });
      writeFileSync(join(reviewsDir, 'report_20260904_120000.json'), JSON.stringify(report), 'utf8');

      const resCurrent = queryChapterQualityStatus(root, 1, { draftRevision: 1, draftContentHash: 'h1' });
      expect(resCurrent.status).toBe('current');
      expect(resCurrent.current).toBe(true);
      expect(resCurrent.report?.reportId).toBe('report-0001');

      // 3. 正文哈希变化 => stale
      const resStale = queryChapterQualityStatus(root, 1, { draftRevision: 1, draftContentHash: 'h2_changed' });
      expect(resStale.status).toBe('stale');
      expect(resStale.current).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
