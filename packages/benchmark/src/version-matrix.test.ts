import { describe, expect, it } from 'vitest';
import { toGenerationStartedPayload } from '@mozhou/runtime';
import type { CapabilityRecipeDocument } from '@mozhou/runtime';
import type { BenchmarkRunReport } from './run.js';
import { BENCHMARK_VERSION } from './types.js';
import type { MetricId, MetricReading } from './types.js';
import { matrixRowFor, readRecipeVersionFromPayload } from './version-matrix.js';

/** 报告桩：数值全 1 全过——本文件只验版本钩子联动与行形状。 */
function stubReport(): BenchmarkRunReport {
  const reading = (metric: MetricId): MetricReading => ({ metric, value: 1, passed: true });
  return {
    benchmarkVersion: BENCHMARK_VERSION,
    recordedAtUtc: '2026-02-03T04:05:06.000Z',
    metrics: {
      CANON_ACCURACY: reading('CANON_ACCURACY'),
      KNOWLEDGE_LEAK_RATE: reading('KNOWLEDGE_LEAK_RATE'),
      PROMISE_RECALL: reading('PROMISE_RECALL'),
      CHANGE_IMPACT_RECALL: reading('CHANGE_IMPACT_RECALL'),
      CONTEXT_BUDGET_OVERFLOW: reading('CONTEXT_BUDGET_OVERFLOW'),
      USER_EDIT_RATIO_REDUCTION: reading('USER_EDIT_RATIO_REDUCTION'),
    },
    cases: [],
  };
}

/** 最小配方文档：消费面只走 recipeSnapshot.recipe.recipeVersion 一条路径；
 *  完整 schema 校验归 runtime 装载器自己的测试管辖（不在此重复造平行世界）。 */
function docWithVersion(recipeVersion: string): CapabilityRecipeDocument {
  return {
    schemaVersion: 1,
    compatibilityPolicy: 'none',
    versioning: { schemaVersionRule: 'incompatible-change-requires-major-reject', retiredPaths: [] },
    recipe: { id: 'chapter-drafting', recipeVersion },
  } as unknown as CapabilityRecipeDocument;
}

describe('M14 Recipe↔Benchmark 版本矩阵钩子（T15 产出 × T20 消费）', () => {
  it('联动正例：GenerationStarted 载荷里的解析快照版本进矩阵行', () => {
    const doc = docWithVersion('1.4.2');
    const payload = toGenerationStartedPayload(doc);
    const row = matrixRowFor({ report: stubReport(), generationStarted: payload });
    expect(row.recipeVersion).toBe('1.4.2');
    expect(row.benchmarkVersion).toBe('0.1.0');
    expect(row.recordedAtUtc).toBe('2026-02-03T04:05:06.000Z');
    expect(Object.keys(row.metrics)).toHaveLength(6);
  });

  it('反例：载荷缺快照/快照缺版本 ⇒ 显式 null（不猜版本）', () => {
    expect(readRecipeVersionFromPayload({})).toBeNull();
    expect(readRecipeVersionFromPayload({ recipeSnapshot: { recipe: {} } })).toBeNull();
    expect(readRecipeVersionFromPayload({ recipeSnapshot: 'not-an-object' })).toBeNull();
    const row = matrixRowFor({ report: stubReport(), generationStarted: {} });
    expect(row.recipeVersion).toBeNull();
  });

  it('版本矩阵：两个配方版本各占一行，行序稳定且共享同一次运行读数', () => {
    const report = stubReport();
    const rows = [
      matrixRowFor({ report, generationStarted: toGenerationStartedPayload(docWithVersion('1.4.2')) }),
      matrixRowFor({ report, generationStarted: toGenerationStartedPayload(docWithVersion('2.0.0-rc.1')) }),
    ];
    expect(rows.map((r) => r.recipeVersion)).toEqual(['1.4.2', '2.0.0-rc.1']);
    expect(rows[0]?.metrics).toEqual(rows[1]?.metrics);
    expect(rows.every((r) => r.benchmarkVersion === '0.1.0')).toBe(true);
  });

  it('确定性：同输入两次序列化逐字节一致', () => {
    const input = { report: stubReport(), generationStarted: toGenerationStartedPayload(docWithVersion('9.9.9')) };
    expect(JSON.stringify(matrixRowFor(input))).toBe(JSON.stringify(matrixRowFor(input)));
  });
});
