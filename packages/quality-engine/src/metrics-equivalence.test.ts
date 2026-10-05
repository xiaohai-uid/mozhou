/**
 * W6-2 生产指标下沉与数值 100% 等价性校验。
 *
 * 验证：
 * 1. 六指标门限 (METRIC_GATES) 与 evaluateMetricGate 判定结果在 quality-engine 与 benchmark 之间 100% 等价；
 * 2. 配方版本解析器 (readRecipeVersionFromPayload) 在 7 类典型/畸形载荷下在 runtime 与 benchmark 之间 100% 等价；
 * 3. 矩阵行合成函数 (matrixRowFor) 产出结构完全一致。
 */
import { describe, expect, it } from 'vitest';
import * as qualityEngine from './index.js';

describe('W6-2 数值与行为 100% 等价性测试', () => {
  it('1. 六指标门限字典 (METRIC_GATES) 逐键与操作符严格深等价', async () => {
    // 动态加载避免 composite 循环解析 dist 声明
    const benchmark: any = await import('../../benchmark/src/index.js' as any);

    expect(qualityEngine.METRIC_IDS).toEqual(benchmark.METRIC_IDS);
    expect(qualityEngine.BENCHMARK_VERSION).toBe(benchmark.BENCHMARK_VERSION);
    expect(qualityEngine.METRIC_GATES).toStrictEqual(benchmark.METRIC_GATES);
  });

  it('2. 六指标门限判定 (evaluateMetricGate) 在边界值全集穷尽比对下 100% 等价', async () => {
    const benchmark: any = await import('../../benchmark/src/index.js' as any);

    for (const metric of qualityEngine.METRIC_IDS) {
      const gate = qualityEngine.METRIC_GATES[metric];
      const testValues = [
        gate.bound - 10,
        gate.bound - 0.01,
        gate.bound,
        gate.bound + 0.01,
        gate.bound + 10,
        0,
        -1,
        1,
      ];

      for (const val of testValues) {
        const qeResult = qualityEngine.evaluateMetricGate(metric, val);
        const bmResult = benchmark.evaluateMetricGate(metric, val);
        expect(qeResult).toBe(bmResult);
      }
    }
  });

  it('3. 配方版本读取器 (readRecipeVersionFromPayload) 在 7 类载荷下 100% 行为等价', async () => {
    const runtime: any = await import('../../runtime/src/index.js' as any);
    const benchmark: any = await import('../../benchmark/src/index.js' as any);

    const payloads: Readonly<Record<string, unknown>>[] = [
      // 1. 标准有效快照
      {
        recipeSnapshot: {
          recipe: {
            recipeVersion: '1.2.3',
          },
        },
      },
      // 2. 空载荷
      {},
      // 3. 快照为 null
      {
        recipeSnapshot: null,
      },
      // 4. 快照为数组畸形
      {
        recipeSnapshot: [],
      },
      // 5. recipe 缺失
      {
        recipeSnapshot: {},
      },
      // 6. recipeVersion 为空字符串
      {
        recipeSnapshot: {
          recipe: {
            recipeVersion: '',
          },
        },
      },
      // 7. recipeVersion 为非字符串（数字或对象）
      {
        recipeSnapshot: {
          recipe: {
            recipeVersion: 42,
          },
        },
      },
    ];

    expect(payloads).toHaveLength(7);

    for (const payload of payloads) {
      const rtResult = runtime.readRecipeVersionFromPayload(payload);
      const bmResult = benchmark.readRecipeVersionFromPayload(payload);
      expect(rtResult).toBe(bmResult);
    }
  });

  it('4. 矩阵行合成函数 (matrixRowFor) 输出结构完全一致', async () => {
    const benchmark: any = await import('../../benchmark/src/index.js' as any);

    const mockReport = {
      benchmarkVersion: '0.1.0' as const,
      recordedAtUtc: '2026-10-04T00:00:00.000Z',
      metrics: {
        CANON_ACCURACY: { metric: 'CANON_ACCURACY' as const, value: 0.995, passed: true },
        KNOWLEDGE_LEAK_RATE: { metric: 'KNOWLEDGE_LEAK_RATE' as const, value: 0, passed: true },
        PROMISE_RECALL: { metric: 'PROMISE_RECALL' as const, value: 1, passed: true },
        CHANGE_IMPACT_RECALL: { metric: 'CHANGE_IMPACT_RECALL' as const, value: 1, passed: true },
        CONTEXT_BUDGET_OVERFLOW: { metric: 'CONTEXT_BUDGET_OVERFLOW' as const, value: 0, passed: true },
        USER_EDIT_RATIO_REDUCTION: { metric: 'USER_EDIT_RATIO_REDUCTION' as const, value: 0.15, passed: true },
      },
    };

    const payload = {
      recipeSnapshot: {
        recipe: {
          recipeVersion: '2.0.0',
        },
      },
    };

    const qeRow = qualityEngine.matrixRowFor({ report: mockReport, generationStarted: payload });
    const bmRow = benchmark.matrixRowFor({ report: mockReport as any, generationStarted: payload });

    expect(qeRow).toStrictEqual(bmRow);
    expect(qeRow.recipeVersion).toBe('2.0.0');
    expect(qeRow.benchmarkVersion).toBe('0.1.0');
    expect(qeRow.metrics.CANON_ACCURACY.passed).toBe(true);
  });
});
