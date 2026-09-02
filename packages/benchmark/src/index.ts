/** @mozhou/benchmark —— Benchmark 六指标 L1 机械判定器（T20 · #44；ADR-0008 / chapter-pipeline-spec S12）。
 *
 *  全链路纯机械：零时钟零外部服务零 LLM 调用；对十步管线产物类型面给出确定性数值。
 */

/** 六指标词表 + ADR-0008 门限表。 */
export {
  BENCHMARK_VERSION,
  METRIC_GATES,
  METRIC_IDS,
  evaluateMetricGate,
} from './types.js';
export type { MetricId, MetricReading, MetricThreshold } from './types.js';

/** 六指标纯函数判定器（ContinuityGateOutcome/Receipt/KnowledgeState 等真实结构上的确定性数值）。 */
export {
  judgeCanonAccuracy,
  judgeChangeImpactRecall,
  judgeContextBudgetOverflow,
  judgeKnowledgeLeakRate,
  judgePromiseRecall,
  judgeUserEditRatioReduction,
  readKnowledgeRowsFromBatch,
} from './metrics.js';
export type {
  BudgetOverflowInput,
  CanonKnowledgeView,
  ChapterDependencyPinView,
  ChangeImpactRecallInput,
  ExtractedKnowledgeRow,
  KnowledgeLeakInput,
  PromiseRecallInput,
  UserEditReductionInput,
} from './metrics.js';

/** 运行器：十步管线产物夹具 → 六指标聚合报告（注入时钟+手工行 id 确定性）。 */
export { runBenchmark } from './run.js';
export type {
  BenchmarkCase,
  BenchmarkCaseReport,
  BenchmarkRunReport,
  RunBenchmarkRequest,
} from './run.js';

/** M14 Recipe↔Benchmark 版本矩阵钩子（T15 GenerationStarted 解析快照的消费侧）。 */
export { RECIPE_SNAPSHOT_KEY, matrixRowFor, readRecipeVersionFromPayload } from './version-matrix.js';
export type { MatrixRowInput, VersionMatrixRow } from './version-matrix.js';

/** P0-2: L1 确定性连续性断言引擎。 */
export { evaluateContinuityPacket } from './continuity-assertions.js';
export type {
  ContinuityAssertionOptions,
  ContinuityAssertionReport,
  ContinuityViolation,
} from './continuity-assertions.js';

