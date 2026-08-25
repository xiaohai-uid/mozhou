/**
 * Benchmark 六指标词表与 ADR-0008 门限表（T20 · #44）。
 *
 * 纯常量 + 纯函数：零时钟零 IO 零 LLM 调用——L1 机械判定边界（S12/ADR-0008）。
 */

/** 本基准套件版本（版本矩阵行的第二轴；recipeVersion × benchmarkVersion）。 */
export const BENCHMARK_VERSION = '0.1.0' as const;

/** 六指标词表：命名沿 Long Novel Benchmark / ADR-0008 §2。 */
export const METRIC_IDS = [
  'CANON_ACCURACY',
  'KNOWLEDGE_LEAK_RATE',
  'PROMISE_RECALL',
  'CHANGE_IMPACT_RECALL',
  'CONTEXT_BUDGET_OVERFLOW',
  'USER_EDIT_RATIO_REDUCTION',
] as const;

export type MetricId = (typeof METRIC_IDS)[number];

/** 门限谓词：value 相对 bound 的机械通过方向。 */
export interface MetricThreshold {
  readonly op: 'gte' | 'gt' | 'lte' | 'eq';
  readonly bound: number;
}

/**
 * ADR-0008 §2 数值门。CANON_ACCURACY ≥ 99%；泄漏/溢出恒 0；两类召回恒 100%；
 * USER_EDIT_RATIO_REDUCTION 度量新迭代是否降低人工改写量 ⇒ 严格大于 0。
 */
export const METRIC_GATES: Readonly<Record<MetricId, MetricThreshold>> = {
  CANON_ACCURACY: { op: 'gte', bound: 0.99 },
  KNOWLEDGE_LEAK_RATE: { op: 'lte', bound: 0 },
  PROMISE_RECALL: { op: 'gte', bound: 1 },
  CHANGE_IMPACT_RECALL: { op: 'gte', bound: 1 },
  CONTEXT_BUDGET_OVERFLOW: { op: 'lte', bound: 0 },
  USER_EDIT_RATIO_REDUCTION: { op: 'gt', bound: 0 },
};

/** 机械比较：词表键在类型层穷尽，无缺省分支可藏。 */
export function evaluateMetricGate(metric: MetricId, value: number): boolean {
  const gate: MetricThreshold = METRIC_GATES[metric];
  if (gate.op === 'gte') return value >= gate.bound;
  if (gate.op === 'gt') return value > gate.bound;
  if (gate.op === 'lte') return value <= gate.bound;
  return value === gate.bound;
}

/** 单指标读数（judge 汇总行用）；passed = evaluateMetricGate 的结论原样携带。 */
export interface MetricReading {
  readonly metric: MetricId;
  readonly value: number;
  readonly passed: boolean;
}
