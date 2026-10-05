/**
 * Benchmark 六指标词表与 ADR-0008 门限表（T20 · #44）。
 *
 * W6 依赖解耦：生产指标与门限判定已下沉至 @mozhou/quality-engine；本文件为兼容转发薄层。
 */

export {
  BENCHMARK_VERSION,
  METRIC_GATES,
  METRIC_IDS,
  evaluateMetricGate,
} from '@mozhou/quality-engine';

export type {
  LiteraryQualitySignals,
  MetricId,
  MetricReading,
  MetricThreshold,
} from '@mozhou/quality-engine';
