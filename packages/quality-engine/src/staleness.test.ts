import { describe, expect, it } from 'vitest';
import { isQualityReviewCurrent } from './staleness.js';
import type { QualityReviewReport } from './types.js';

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
});
