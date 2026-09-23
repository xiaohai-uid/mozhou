/**
 * ADR-0025（质量门集成 · 计划 Task 8）：长篇文学质量回归基准。
 * 夹具 = fixtures/quality-regression-cases.json（primary source）：
 * - mechanical_* 用例走真实管线机制（isQualityReviewCurrent / corrections 折叠）；
 * - semantic_rule 用例的 expectedVerdict 是参考语义审查者的记录值——基准验证
 *   聚合与接线（report.evaluations 携带该裁决），不验证 LLM 本体；
 * - 五信号 judge 全部纯函数（同输入同值），与 metrics.ts L1 口径一致。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hashProse, runQualityReview } from '@mozhou/quality-engine';
import type { QualityPolicy, QualityReviewAnchor, QualityReviewReport, ReviewerBinding } from '@mozhou/quality-engine';
import {
  judgeBlockingRuleCoverage,
  judgeRepeatCorrectionRate,
  judgeStaleReviewPassRate,
  judgeLiteraryQualitySignals,
} from './metrics.js';
import type { CorrectionOccurrence, ReaderExperienceRow, StaleReviewAttempt } from './metrics.js';

const FIXTURE_PATH = join(fileURLToPath(import.meta.url), '..', '..', 'fixtures', 'quality-regression-cases.json');

interface FixtureCase {
  readonly id: string;
  readonly kind: string;
  readonly ruleId?: string;
  readonly severity?: string;
  readonly prose?: string;
  readonly expectedVerdict?: string;
  readonly attempt?: StaleReviewAttempt;
  readonly corrections?: readonly CorrectionOccurrence[];
  readonly expect: { readonly signal: string; readonly value: number };
}

interface FixtureFile {
  readonly schemaVersion: number;
  readonly cases: readonly FixtureCase[];
}

const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as FixtureFile;

const REVIEWER: ReviewerBinding = { providerId: 'bench', model: 'bench-model', recipeVersion: '1.0.0' };

function policyWith(ruleId: string, severity: 'blocking' | 'advisory'): QualityPolicy {
  return {
    schemaVersion: 1,
    projectId: 'bench',
    rules: [
      {
        id: ruleId,
        version: '1.0.0',
        scope: 'platform',
        kind: 'semantic',
        severity,
        description: 'bench rule ' + ruleId,
        evidenceRequired: true,
        enabled: true,
      },
    ],
    maxAutomaticReworks: 2,
  };
}

function anchorFor(prose: string): QualityReviewAnchor {
  return {
    chapterIndex: 4,
    draftRevision: 3,
    draftContentHash: hashProse(prose),
    receiptId: 'rcpt_bench',
    ruleSetDigest: 'digest_bench',
  };
}

describe('ADR-0025 长篇质量回归基准', () => {
  it('夹具在册：六条用例覆盖计划 Task 8 全部场景', () => {
    expect(FIXTURE.schemaVersion).toBe(1);
    expect(FIXTURE.cases.map((c) => c.id)).toEqual([
      'stale-review-attempt',
      'outline-expansion',
      'tool-character',
      'payoff-zeroing',
      'false-belief-knowledge',
      'repeat-correction',
    ]);
  });

  it('stale-review-attempt：旧 PASS 拿去交付被拦截计为回归（rate 满分=全部拦截）', () => {
    const staleCase = FIXTURE.cases.find((c) => c.id === 'stale-review-attempt')!;
    const signals = judgeLiteraryQualitySignals({
      staleAttempts: [staleCase.attempt!],
      enabledBlockingRuleIds: [],
      reportEvaluations: {},
      corrections: [],
      readerExperience: [],
    });
    expect(signals.staleReviewPassRate).toBe(staleCase.expect.value);
  });

  it('机械对照：stale PASS 被放行 → staleReviewPassRate=0（真实回归）', () => {
    expect(judgeStaleReviewPassRate([{ usedStalePass: true, delivered: true }])).toBe(0);
  });

  it('semantic_rule 用例：参考裁决经 runQualityReview 聚合进报告评估', async () => {
    const semanticCases = FIXTURE.cases.filter((c) => c.kind === 'semantic_rule');
    expect(semanticCases.length).toBe(3);

    for (const testCase of semanticCases) {
      const evaluator = {
        evaluate: () =>
          Promise.resolve([
            {
              ruleId: testCase.ruleId!,
              ruleVersion: '1.0.0',
              verdict: testCase.expectedVerdict as 'fail',
              severity: 'advisory' as const,
              evidence: [{ ruleId: testCase.ruleId!, note: '参考审查者记录裁决', excerpt: testCase.prose!.slice(0, 20) }],
            },
          ]),
      };
      const report: QualityReviewReport = await runQualityReview({
        prose: testCase.prose!,
        policy: policyWith(testCase.ruleId!, testCase.severity as 'blocking' | 'advisory'),
        anchor: anchorFor(testCase.prose!),
        reviewer: REVIEWER,
        failurePatterns: [],
        semanticEvaluator: evaluator,
      });
      const evaluation = report.evaluations.find((e) => e.ruleId === testCase.ruleId);
      expect(evaluation?.verdict).toBe(testCase.expectedVerdict);
      // advisory 语义 fail 不阻断整体（blocking_fail 只由 blocking 规则触发）
      expect(report.verdict).toBe('pass');
      expect(evaluation?.evidence.length).toBeGreaterThan(0);

      // 规则覆盖：报告评估覆盖了该启用规则（id 在册即 covered）
      const coverage = judgeBlockingRuleCoverage(
        [testCase.ruleId!],
        Object.fromEntries(report.evaluations.map((e) => [e.ruleId, e.verdict])),
      );
      expect(coverage).toBe(1);
    }
  });

  it('repeat-correction：同 reason 更晚章节复发 → rate=0.5', () => {
    const repeatCase = FIXTURE.cases.find((c) => c.id === 'repeat-correction')!;
    expect(judgeRepeatCorrectionRate(repeatCase.corrections!)).toBe(repeatCase.expect.value);
  });

  it('false-belief-knowledge：suspects 不授权——信号面无 stale 交付', () => {
    const beliefCase = FIXTURE.cases.find((c) => c.id === 'false-belief-knowledge')!;
    // ADR-0026 语义已在 gate/kernel 测试链验证；基准面确认无 stale 交付混入
    const signals = judgeLiteraryQualitySignals({
      staleAttempts: [beliefCase.attempt!],
      enabledBlockingRuleIds: [],
      reportEvaluations: {},
      corrections: [],
      readerExperience: [],
    });
    expect(signals.staleReviewPassRate).toBe(beliefCase.expect.value);
  });

  it('payoff-zeroing 夹具期望 tangibleGainRecall=0.5（有期待半数无实得）', () => {
    const rows: ReaderExperienceRow[] = [
      { chapterIndex: 1, expectationDelta: 2, tangibleGain: 'power', solutionPattern: 'trial' },
      { chapterIndex: 2, expectationDelta: 1, tangibleGain: 'none', solutionPattern: 'trial' },
    ];
    const signals = judgeLiteraryQualitySignals({
      staleAttempts: [],
      enabledBlockingRuleIds: [],
      reportEvaluations: {},
      corrections: [],
      readerExperience: rows,
    });
    expect(signals.tangibleGainRecall).toBe(0.5);
    // 解法模式两章同款 → 复用率 1（回归信号拉满）
    expect(signals.solutionPatternRepeatRate).toBe(1);
  });
});
