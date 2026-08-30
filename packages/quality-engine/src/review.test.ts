import { describe, expect, it } from 'vitest';
import { PARA_001_ID, REV_001_ID } from './deterministic.js';
import { defaultPlatformRules } from './policy.js';
import { hashProse, runQualityReview } from './review.js';
import type { SemanticQualityEvaluator } from './semantic.js';
import type {
  QualityPolicy,
  QualityReviewAnchor,
  QualityRuleEvaluation,
  QualityRuleDefinition,
  ReviewerBinding,
} from './types.js';

const REVIEWER: ReviewerBinding = {
  providerId: 'test-provider',
  model: 'test-model',
  recipeVersion: '1.0.0',
};

function anchorFor(prose: string, overrides: Partial<QualityReviewAnchor> = {}): QualityReviewAnchor {
  return {
    chapterIndex: 3,
    draftRevision: 7,
    draftContentHash: hashProse(prose),
    receiptId: 'receipt-0001',
    ruleSetDigest: 'digest-0001',
    ...overrides,
  };
}

function policy(rules: QualityRuleDefinition[]): QualityPolicy {
  return { schemaVersion: 1, projectId: 'book-a', rules, maxAutomaticReworks: 2 };
}

function semanticRule(id: string, severity: 'blocking' | 'advisory' = 'advisory'): QualityRuleDefinition {
  return {
    id,
    version: '1.0.0',
    scope: 'platform',
    kind: 'semantic',
    severity,
    description: 'semantic rule ' + id,
    evidenceRequired: true,
    enabled: true,
  };
}

function evaluatorReturning(
  map: Readonly<Record<string, { verdict: QualityRuleEvaluation['verdict']; evidenceCount?: number }>>,
): SemanticQualityEvaluator {
  return {
    evaluate: async ({ rules }) =>
      rules
        .filter((r) => map[r.id])
        .map((r) => ({
          ruleId: r.id,
          ruleVersion: r.version,
          verdict: map[r.id]!.verdict,
          evidence:
            map[r.id]!.verdict === 'fail' && (map[r.id]!.evidenceCount ?? 0) > 0
              ? [{ ruleId: r.id, note: 'evidence note' }]
              : [],
        })),
  };
}

describe('runQualityReview 裁决', () => {
  it('确定性规则全过 → pass', async () => {
    const prose = '陈缺推门进来，把伞收了靠在墙边，水顺着伞骨在地上积成一小滩。';
    const report = await runQualityReview({
      prose,
      policy: policy([defaultPlatformRules().find((r) => r.id === PARA_001_ID)!]),
      anchor: anchorFor(prose),
      reviewer: REVIEWER,
      failurePatterns: [],
    });
    expect(report.verdict).toBe('pass');
  });

  it('PARA-001 fail（blocking）→ blocking_fail', async () => {
    const prose = '他抬头。\n\n门开了。\n\n风进来了。\n\n陈缺没有动。';
    const report = await runQualityReview({
      prose,
      policy: policy([defaultPlatformRules().find((r) => r.id === PARA_001_ID)!]),
      anchor: anchorFor(prose),
      reviewer: REVIEWER,
      failurePatterns: [],
    });
    expect(report.verdict).toBe('blocking_fail');
  });

  it('锚点哈希与正文不一致（REV-001）→ blocking_fail，即使其余全过', async () => {
    const prose = '陈缺推门进来，把伞收了靠在墙边，水顺着伞骨在地上积成一小滩。';
    const report = await runQualityReview({
      prose,
      policy: policy([]),
      anchor: anchorFor('另一份旧正文。'),
      reviewer: REVIEWER,
      failurePatterns: [],
    });
    expect(report.verdict).toBe('blocking_fail');
    const rev = report.evaluations.find((e) => e.ruleId === REV_001_ID);
    expect(rev?.verdict).toBe('fail');
  });

  it('策略含启用语义规则但无提供方 → refused（不静默放行）', async () => {
    const prose = '陈缺推门进来，把伞收了靠在墙边，水顺着伞骨在地上积成一小滩。';
    const report = await runQualityReview({
      prose,
      policy: policy([semanticRule('NARR-001')]),
      anchor: anchorFor(prose),
      reviewer: REVIEWER,
      failurePatterns: [],
    });
    expect(report.verdict).toBe('refused');
    expect(report.evaluations.find((e) => e.ruleId === 'NARR-001')?.verdict).toBe('unknown');
  });

  it('提供方抛异常 → refused 且附原因', async () => {
    const prose = '陈缺推门进来，把伞收了靠在墙边，水顺着伞骨在地上积成一小滩。';
    const broken: SemanticQualityEvaluator = {
      evaluate: async () => {
        throw new Error('provider outage');
      },
    };
    const report = await runQualityReview({
      prose,
      policy: policy([semanticRule('NARR-001')]),
      anchor: anchorFor(prose),
      reviewer: REVIEWER,
      failurePatterns: [],
      semanticEvaluator: broken,
    });
    expect(report.verdict).toBe('refused');
    expect(report.evaluations.find((e) => e.ruleId === 'NARR-001')?.evidence[0]?.note).toContain(
      'provider outage',
    );
  });

  it('blocking 语义规则 fail（有证据）→ blocking_fail', async () => {
    const prose = '陈缺推门进来，把伞收了靠在墙边，水顺着伞骨在地上积成一小滩。';
    const report = await runQualityReview({
      prose,
      policy: policy([semanticRule('CHAR-001', 'blocking')]),
      anchor: anchorFor(prose),
      reviewer: REVIEWER,
      failurePatterns: [],
      semanticEvaluator: evaluatorReturning({ 'CHAR-001': { verdict: 'fail', evidenceCount: 1 } }),
    });
    expect(report.verdict).toBe('blocking_fail');
  });

  it('advisory 语义规则 fail → 整体仍 pass（评估留痕）', async () => {
    const prose = '陈缺推门进来，把伞收了靠在墙边，水顺着伞骨在地上积成一小滩。';
    const report = await runQualityReview({
      prose,
      policy: policy([semanticRule('NARR-001', 'advisory')]),
      anchor: anchorFor(prose),
      reviewer: REVIEWER,
      failurePatterns: [],
      semanticEvaluator: evaluatorReturning({ 'NARR-001': { verdict: 'fail', evidenceCount: 1 } }),
    });
    expect(report.verdict).toBe('pass');
    expect(report.evaluations.find((e) => e.ruleId === 'NARR-001')?.verdict).toBe('fail');
  });

  it('提供方漏评某条启用规则 → unknown → refused', async () => {
    const prose = '陈缺推门进来，把伞收了靠在墙边，水顺着伞骨在地上积成一小滩。';
    const report = await runQualityReview({
      prose,
      policy: policy([semanticRule('NARR-001'), semanticRule('CHAR-001')]),
      anchor: anchorFor(prose),
      reviewer: REVIEWER,
      failurePatterns: [],
      semanticEvaluator: evaluatorReturning({ 'NARR-001': { verdict: 'pass' } }),
    });
    expect(report.verdict).toBe('refused');
    expect(report.evaluations.find((e) => e.ruleId === 'CHAR-001')?.verdict).toBe('unknown');
  });

  it('fail 无证据（evidenceRequired）按 unknown 处理 → refused', async () => {
    const prose = '陈缺推门进来，把伞收了靠在墙边，水顺着伞骨在地上积成一小滩。';
    const report = await runQualityReview({
      prose,
      policy: policy([semanticRule('NARR-001', 'blocking')]),
      anchor: anchorFor(prose),
      reviewer: REVIEWER,
      failurePatterns: [],
      semanticEvaluator: evaluatorReturning({ 'NARR-001': { verdict: 'fail' } }),
    });
    expect(report.verdict).toBe('refused');
  });
});
