/**
 * Benchmark 运行器（T20 · #44）：对十步管线产物集合跑六指标，产出确定性报告。
 *
 * 确定性三锚：手工 case id（不生成不派生）+ 注入时钟（nowUtc 唯一时间来源）
 * + 纯函数聚合（无随机无 Date.now）。同输入两次运行 ⇒ 同 JSON。
 */
import type { ContextReceipt, DependencyManifestEntry } from '@mozhou/kernel';
import type { ActivePromiseView, CandidateDeltaBatch, ContinuityGateOutcome } from '@mozhou/pipeline';
import {
  judgeCanonAccuracy,
  judgeChangeImpactRecall,
  judgeContextBudgetOverflow,
  judgeKnowledgeLeakRate,
  judgePromiseRecall,
  judgeUserEditRatioReduction,
  readKnowledgeRowsFromBatch,
} from './metrics.js';
import type {
  CanonKnowledgeView,
  ChapterDependencyPinView,
  UserEditReductionInput,
} from './metrics.js';
import { BENCHMARK_VERSION, evaluateMetricGate } from './types.js';
import type { MetricId, MetricReading } from './types.js';

/** 单章基准夹具：字段一一对应十步管线产物类型面（缺面宁败不猜）。 */
export interface BenchmarkCase {
  /** 手工行 id（CASE-NNNN 沿 ADR-0008 §3 回归案词表）。 */
  readonly caseId: string;
  readonly chapterIndex: number;
  /** gate 步产物（CANON_ACCURACY）。 */
  readonly gate: ContinuityGateOutcome;
  /** prepare 步活跃承诺视图（PROMISE_RECALL）。 */
  readonly activePromises: readonly ActivePromiseView[];
  /** final extract 步候选批（KNOWLEDGE_LEAK_RATE）。 */
  readonly extractedBatch: CandidateDeltaBatch;
  /** 正典知情行（kernel KnowledgeState 投影）。 */
  readonly canonKnowledge: CanonKnowledgeView;
  /** compile 步 Receipt 编译面 + 实际占用量。 */
  readonly receipt: Pick<ContextReceipt, 'entries' | 'totalTokens'>;
  /** 配额轴：recipe.contextBudget 的 tokens 上限（版本矩阵钩子的 recipe 轴）。 */
  readonly allocatedTokens: number;
  /** CHANGE_IMPACT_RECALL 三元组。 */
  readonly dependencyPins: readonly ChapterDependencyPinView[];
  readonly modifiedEntities: readonly DependencyManifestEntry[];
  readonly staleFlaggedChapters: readonly number[];
}

/** 单章读数：五个章级指标（USER_EDIT_RATIO_REDUCTION 是运行级跨版本指标，见下）。 */
export interface BenchmarkCaseReport {
  readonly caseId: string;
  readonly chapterIndex: number;
  readonly readings: readonly MetricReading[];
}

/** 运行级报告：六指标聚合值 × 版本 × 注入时间戳。 */
export interface BenchmarkRunReport {
  readonly benchmarkVersion: typeof BENCHMARK_VERSION;
  readonly recordedAtUtc: string;
  readonly metrics: Readonly<Record<MetricId, MetricReading>>;
  readonly cases: readonly BenchmarkCaseReport[];
}

export interface RunBenchmarkRequest {
  readonly cases: readonly BenchmarkCase[];
  /** USER_EDIT_RATIO_REDUCTION 是「新 recipe 迭代 vs 基线」的跨章总量对比。 */
  readonly userEdit: UserEditReductionInput;
  /** 注入时钟：报告时间戳唯一来源（零真实时钟）。 */
  readonly nowUtc: () => string;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function readingsOf(kase: BenchmarkCase): readonly MetricReading[] {
  const canon = judgeCanonAccuracy(kase.gate);
  const leak = judgeKnowledgeLeakRate({
    chapterIndex: kase.chapterIndex,
    canonKnowledge: kase.canonKnowledge,
    extractedKnowledge: readKnowledgeRowsFromBatch(kase.extractedBatch),
  });
  const promise = judgePromiseRecall({
    chapterIndex: kase.chapterIndex,
    activePromises: kase.activePromises,
    compiledReceipt: kase.receipt,
  });
  const impact = judgeChangeImpactRecall({
    pins: kase.dependencyPins,
    modified: kase.modifiedEntities,
    staleFlaggedChapters: kase.staleFlaggedChapters,
  });
  const overflow = judgeContextBudgetOverflow({ allocatedTokens: kase.allocatedTokens, actualTokens: kase.receipt.totalTokens });
  const withGate = (metric: MetricId, value: number): MetricReading => ({ metric, value, passed: evaluateMetricGate(metric, value) });
  return [
    withGate('CANON_ACCURACY', canon),
    withGate('KNOWLEDGE_LEAK_RATE', leak),
    withGate('PROMISE_RECALL', promise),
    withGate('CHANGE_IMPACT_RECALL', impact),
    withGate('CONTEXT_BUDGET_OVERFLOW', overflow),
  ];
}

export function runBenchmark(request: RunBenchmarkRequest): BenchmarkRunReport {
  if (request.cases.length === 0) {
    throw new RangeError('benchmark 夹具集为空——宁败不造数值（L1 机械判定边界）');
  }
  const cases: BenchmarkCaseReport[] = request.cases.map((kase) => ({
    caseId: kase.caseId,
    chapterIndex: kase.chapterIndex,
    readings: readingsOf(kase),
  }));

  const aggregateAt = (index: number): number =>
    mean(cases.map((c) => {
      const reading = c.readings[index];
      if (reading === undefined) throw new RangeError('读数缺失——内部不变量破坏');
      return reading.value;
    }));
  const pairOf = (metric: MetricId, value: number): MetricReading => ({ metric, value, passed: evaluateMetricGate(metric, value) });

  const metrics: Record<MetricId, MetricReading> = {
    CANON_ACCURACY: pairOf('CANON_ACCURACY', aggregateAt(0)),
    KNOWLEDGE_LEAK_RATE: pairOf('KNOWLEDGE_LEAK_RATE', aggregateAt(1)),
    PROMISE_RECALL: pairOf('PROMISE_RECALL', aggregateAt(2)),
    CHANGE_IMPACT_RECALL: pairOf('CHANGE_IMPACT_RECALL', aggregateAt(3)),
    CONTEXT_BUDGET_OVERFLOW: pairOf('CONTEXT_BUDGET_OVERFLOW', aggregateAt(4)),
    USER_EDIT_RATIO_REDUCTION: pairOf('USER_EDIT_RATIO_REDUCTION', judgeUserEditRatioReduction(request.userEdit)),
  };

  return {
    benchmarkVersion: BENCHMARK_VERSION,
    recordedAtUtc: request.nowUtc(),
    metrics,
    cases,
  };
}
