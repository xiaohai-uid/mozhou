import { describe, expect, it } from 'vitest';
import { emptyCandidateCounts } from '@mozhou/pipeline';
import { runBenchmark, type BenchmarkCase } from './run.js';

/** 完整合成夹具：十步管线产物面的最小确定性实例。 */
function mkCase(caseId: string, overrides: Partial<BenchmarkCase> = {}): BenchmarkCase {
  const batch = emptyCandidateCounts();
  batch.temporalFact = 4;
  const base: BenchmarkCase = {
    caseId,
    chapterIndex: 6,
    gate: { verdict: 'pass', hardConflicts: [], advisory: [], checked: { batch, liveFacts: 2 } },
    activePromises: [],
    extractedBatch: {},
    canonKnowledge: [],
    receipt: {
      totalTokens: 900,
      entries: [{ stage: 'tracking', order: 1, identifier: 'p1', included: true }],
    },
    allocatedTokens: 1000,
    dependencyPins: [],
    modifiedEntities: [],
    staleFlaggedChapters: [],
  };
  return { ...base, ...overrides };
}

const FIXED_CLOCK = (): string => '2026-01-01T00:00:00.000Z';

describe('Benchmark 运行器（T20 #44）：六指标汇总 × 确定性', () => {
  it('正例：两章夹具跑出六指标聚合值（精确数值断言）', () => {
    const batchA = emptyCandidateCounts();
    batchA.temporalFact = 4;
    const batchB = emptyCandidateCounts();
    batchB.temporalFact = 5;
    const report = runBenchmark({
      nowUtc: FIXED_CLOCK,
      userEdit: { baselineEditCount: 10, currentEditCount: 7 },
      cases: [
        mkCase('CASE-0001', {
          chapterIndex: 5,
          gate: { verdict: 'pass', hardConflicts: [], advisory: [], checked: { batch: batchA, liveFacts: 1 } },
          activePromises: [
            { promiseId: 'p1', type: 'foreshadowing', description: '信', introducedChapter: 3, targetChapter: 3, status: 'due' },
          ],
          extractedBatch: { knowledgeState: [{ id: 'k1', factId: 'f1', holder: 'reader', knownSinceChapter: 1 }] },
          canonKnowledge: [{ id: 'knst_1', factId: 'f1', holder: 'reader', knownSinceChapter: 1 }],
        }),
        mkCase('CASE-0002', {
          chapterIndex: 6,
          gate: {
            verdict: 'hard_conflict',
            hardConflicts: [{ factId: 'tf_9', assertion: 'x', suggestion: 'y' }],
            advisory: [],
            checked: { batch: batchB, liveFacts: 0 },
          },
          receipt: {
            totalTokens: 1200,
            entries: [{ stage: 'tracking', order: 1, identifier: 'p1', included: true }],
          },
        }),
      ],
    });
    expect(report.benchmarkVersion).toBe('0.1.0');
    expect(Object.keys(report.metrics)).toEqual([
      'CANON_ACCURACY',
      'KNOWLEDGE_LEAK_RATE',
      'PROMISE_RECALL',
      'CHANGE_IMPACT_RECALL',
      'CONTEXT_BUDGET_OVERFLOW',
      'USER_EDIT_RATIO_REDUCTION',
    ]);
    expect(report.metrics.CANON_ACCURACY.value).toBe(0.9);
    // 门限联动反例：0.9 < ADR-0008 的 99% ⇒ 判红（聚合值与门限机械联动）
    expect(report.metrics.CANON_ACCURACY.passed).toBe(false);
    expect(report.metrics.KNOWLEDGE_LEAK_RATE.value).toBe(0);
    expect(report.metrics.PROMISE_RECALL.value).toBe(1);
    expect(report.metrics.CHANGE_IMPACT_RECALL.value).toBe(1);
    expect(report.metrics.CONTEXT_BUDGET_OVERFLOW.value).toBe(0.5);
    expect(report.metrics.CONTEXT_BUDGET_OVERFLOW.passed).toBe(false);
    expect(report.metrics.USER_EDIT_RATIO_REDUCTION.value).toBe(0.3);
    expect(report.metrics.USER_EDIT_RATIO_REDUCTION.passed).toBe(true);
    expect(report.cases.map((c) => c.caseId)).toEqual(['CASE-0001', 'CASE-0002']);
    expect(report.cases[0]?.readings).toHaveLength(5);
  });

  it('反例门限联动：超预算章把 CONTEXT_BUDGET_OVERFLOW 判红', () => {
    const report = runBenchmark({
      nowUtc: FIXED_CLOCK,
      userEdit: { baselineEditCount: 10, currentEditCount: 12 },
      cases: [mkCase('CASE-0003')],
    });
    expect(report.metrics.USER_EDIT_RATIO_REDUCTION.value).toBe(-0.2);
    expect(report.metrics.USER_EDIT_RATIO_REDUCTION.passed).toBe(false);
  });

  it('确定性：同输入两次运行同 JSON（注入时钟+手工行 id）', () => {
    const request = {
      nowUtc: FIXED_CLOCK,
      userEdit: { baselineEditCount: 8, currentEditCount: 8 },
      cases: [mkCase('CASE-DETERMINISM'), mkCase('CASE-DETERMINISM-B')],
    };
    const a = JSON.stringify(runBenchmark(request));
    const b = JSON.stringify(runBenchmark(request));
    expect(a).toBe(b);
    expect(a).toContain('"recordedAtUtc":"2026-01-01T00:00:00.000Z"');
  });

  it('时钟注入：换时钟只动时间戳，指标数值逐字段不变', () => {
    const cases = [mkCase('CASE-CLOCK')];
    const early = runBenchmark({ nowUtc: (): string => '2000-06-01T00:00:00.000Z', userEdit: { baselineEditCount: 4, currentEditCount: 4 }, cases });
    const late = runBenchmark({ nowUtc: (): string => '2099-12-31T23:59:59.000Z', userEdit: { baselineEditCount: 4, currentEditCount: 4 }, cases });
    expect(early.recordedAtUtc).toBe('2000-06-01T00:00:00.000Z');
    expect(late.recordedAtUtc).toBe('2099-12-31T23:59:59.000Z');
    expect(early.cases).toEqual(late.cases);
    expect(early.metrics).toEqual(late.metrics);
  });

  it('空夹具集即拒（宁败不造数值）', () => {
    expect(() => runBenchmark({ nowUtc: FIXED_CLOCK, userEdit: { baselineEditCount: 1, currentEditCount: 1 }, cases: [] })).toThrow();
  });
});
