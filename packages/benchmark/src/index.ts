/** @mozhou/benchmark —— Benchmark 六指标 L1 评测运行器与测试夹具（T20 · #44；ADR-0008 / chapter-pipeline-spec S12）。
 *
 *  全链路纯机械：零时钟零外部服务零 LLM 调用；对十步管线产物类型面给出确定性数值。
 *
 *  W6 迁移终点（规划 §3.2/§7）：六指标词表、门限表与矩阵行已下沉 @mozhou/quality-engine
 *  （metrics-gates 出口），配方版本解析下沉 @mozhou/runtime（recipe-payload 出口）；
 *  本包旧实现转发层已删除，不再承载生产通用指标定义——生产代码禁止依赖本包。
 */

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

/** P0-2: L1 确定性连续性断言引擎与测试编译器。 */
export {
  evaluateContinuityPacket,
  exportPromptfooTestCaseFromCanon,
  generateContinuityAssertionsFromCanon,
} from './continuity-assertions.js';
export type {
  ContinuityAssertionOptions,
  ContinuityAssertionReport,
  ContinuityViolation,
  PromptfooGeneratedCase,
} from './continuity-assertions.js';


