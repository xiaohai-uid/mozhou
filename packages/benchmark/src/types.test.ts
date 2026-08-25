import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_VERSION,
  METRIC_GATES,
  METRIC_IDS,
  evaluateMetricGate,
} from './types.js';

describe('benchmark 六指标词表与 ADR-0008 门限', () => {
  it('词表恰好六个指标（沿 Long Novel Benchmark 命名）', () => {
    expect([...METRIC_IDS]).toEqual([
'CANON_ACCURACY',
'KNOWLEDGE_LEAK_RATE',
'PROMISE_RECALL',
'CHANGE_IMPACT_RECALL',
'CONTEXT_BUDGET_OVERFLOW',
'USER_EDIT_RATIO_REDUCTION',
    ]);
  });

  it('门限表逐项对齐 ADR-0008 数值', () => {
expect(METRIC_GATES.CANON_ACCURACY).toEqual({ op: 'gte', bound: 0.99 });
expect(METRIC_GATES.KNOWLEDGE_LEAK_RATE).toEqual({ op: 'lte', bound: 0 });
expect(METRIC_GATES.PROMISE_RECALL).toEqual({ op: 'gte', bound: 1 });
expect(METRIC_GATES.CHANGE_IMPACT_RECALL).toEqual({ op: 'gte', bound: 1 });
expect(METRIC_GATES.CONTEXT_BUDGET_OVERFLOW).toEqual({ op: 'lte', bound: 0 });
expect(METRIC_GATES.USER_EDIT_RATIO_REDUCTION).toEqual({ op: 'gt', bound: 0 });
  });

  it('evaluateMetricGate：边界值机械判定（正例过线/反例不过线）', () => {
expect(evaluateMetricGate('CANON_ACCURACY', 0.99)).toBe(true);
expect(evaluateMetricGate('CANON_ACCURACY', 0.98)).toBe(false);
expect(evaluateMetricGate('KNOWLEDGE_LEAK_RATE', 0)).toBe(true);
expect(evaluateMetricGate('KNOWLEDGE_LEAK_RATE', 0.25)).toBe(false);
expect(evaluateMetricGate('USER_EDIT_RATIO_REDUCTION', 0.5)).toBe(true);
expect(evaluateMetricGate('USER_EDIT_RATIO_REDUCTION', 0)).toBe(false);
  });

  it('基准版本常量为 semver 字面量（版本矩阵行用）', () => {
expect(BENCHMARK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
