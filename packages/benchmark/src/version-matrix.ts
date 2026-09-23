/**
 * M14 Recipe↔Benchmark 版本矩阵钩子——消费侧（T20 · #44）。
 *
 * T15 产出：toGenerationStartedPayload(doc) 把配方解析快照挂进 GenerationStarted
 * 事件载荷（{ recipeSnapshot: CapabilityRecipeDocument }）。本模块是它的消费面：
 * 从载荷机械读出 recipeVersion，与 benchmarkVersion 组成矩阵行——同一份运行读数
 * 按配方版本分列，迭代对比有据可查。纯函数零时钟零 LLM；行时间戳继承报告的
 * 注入时钟值。
 */
import { BENCHMARK_VERSION } from './types.js';
import type { MetricId, MetricReading } from './types.js';
import type { BenchmarkRunReport } from './run.js';

/** M14 约定键：GenerationStarted 载荷上解析快照的挂载点（T15 loader.ts 同源）。 */
export const RECIPE_SNAPSHOT_KEY = 'recipeSnapshot';

/**
 * 机械读版本：payload[recipeSnapshot].recipe.recipeVersion 三级路径逐级收窄，
 * 任一级缺面/坏形 ⇒ null（显式缺面不猜版本）。载荷形状 = Readonly<Record<string,
 * unknown>>（T15 产出签名原样），不要求调用方先过完整 schema 校验。
 */
export function readRecipeVersionFromPayload(payload: Readonly<Record<string, unknown>>): string | null {
  const snapshot: unknown = payload[RECIPE_SNAPSHOT_KEY];
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return null;
  const recipe: unknown = (snapshot as Record<string, unknown>)['recipe'];
  if (typeof recipe !== 'object' || recipe === null || Array.isArray(recipe)) return null;
  const version: unknown = (recipe as Record<string, unknown>)['recipeVersion'];
  return typeof version === 'string' && version.length > 0 ? version : null;
}

/** 版本矩阵行：recipeVersion × benchmarkVersion 一行，携带整份运行读数。 */
export interface VersionMatrixRow {
  readonly recipeVersion: string | null;
  readonly benchmarkVersion: typeof BENCHMARK_VERSION;
  /** 继承自运行报告的注入时钟值（本模块不再有时钟输入面）。 */
  readonly recordedAtUtc: string;
  readonly metrics: Readonly<Record<MetricId, MetricReading>>;
}

export interface MatrixRowInput {
  readonly report: BenchmarkRunReport;
  /** GenerationStarted 载荷（T15 产出）；缺省视为无配方快照。 */
  readonly generationStarted?: Readonly<Record<string, unknown>>;
}

/** 报告 × 配方快照 ⇒ 矩阵行。门限判定随读数原样继承，不二次计算。 */
export function matrixRowFor(input: MatrixRowInput): VersionMatrixRow {
  return {
    recipeVersion: input.generationStarted === undefined ? null : readRecipeVersionFromPayload(input.generationStarted),
    benchmarkVersion: input.report.benchmarkVersion,
    recordedAtUtc: input.report.recordedAtUtc,
    metrics: input.report.metrics,
  };
}
