/**
 * W6 质量门迁移收尾——新出口金标准回归。
 *
 * 历史（规划 §7 W6「先建新出口并跑等价性测试，再切调用方，最后删旧实现」）：
 * 1. W6-2 阶段：本文件曾是 quality-engine/runtime 新出口 × benchmark 旧实现的
 *    100% 等价性校验（门限字典逐键、判定边界值全集、7 类载荷版本解析、矩阵行结构）；
 * 2. 迁移终点（本次）：benchmark 兼容转发层（src/types.ts、src/version-matrix.ts）
 *    已删除，等价性比对失去对照物——等价性结论已由转发层同源绑定（re-export）固化；
 * 3. 本文件转为**自持金标准**测试：以 ADR-0008 §2 数值表与 M14 解析协议为独立
 *    期望值（不再对照旧实现），防 @mozhou/quality-engine metrics-gates 出口
 *    与 @mozhou/runtime recipe-payload 出口回归。
 */
import { describe, expect, it } from 'vitest';
import * as qualityEngine from './index.js';

// 注：quality-engine 不得依赖 @mozhou/runtime（§3.3 依赖图 Q→K，无 Q→R 边）。
// 测试面以动态相对路径加载 runtime 源（沿 W6-2 等价测试先例，不入包依赖图）。
const runtimeImport = async (): Promise<any> => await import('../../runtime/src/index.js' as any);

/** 各门限 op 的机械判定语义（独立期望，不复用 evaluateMetricGate 推导）。 */
function expectedByOp(
  op: 'gte' | 'gt' | 'lte' | 'eq',
  value: number,
  bound: number,
): boolean {
  if (op === 'gte') return value >= bound;
  if (op === 'gt') return value > bound;
  if (op === 'lte') return value <= bound;
  return value === bound;
}

describe('W6 收尾：六指标门限出口（metrics-gates）金标准', () => {
  it('1. METRIC_IDS 恰好六个指标且命名沿 Long Novel Benchmark / ADR-0008 §2', () => {
    expect([...qualityEngine.METRIC_IDS]).toEqual([
      'CANON_ACCURACY',
      'KNOWLEDGE_LEAK_RATE',
      'PROMISE_RECALL',
      'CHANGE_IMPACT_RECALL',
      'CONTEXT_BUDGET_OVERFLOW',
      'USER_EDIT_RATIO_REDUCTION',
    ]);
  });

  it('2. BENCHMARK_VERSION 为 semver 字面量（版本矩阵行第二轴）', () => {
    expect(qualityEngine.BENCHMARK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('3. 门限表逐项对齐 ADR-0008 §2 数值（金标准字面量）', () => {
    expect(qualityEngine.METRIC_GATES.CANON_ACCURACY).toEqual({ op: 'gte', bound: 0.99 });
    expect(qualityEngine.METRIC_GATES.KNOWLEDGE_LEAK_RATE).toEqual({ op: 'lte', bound: 0 });
    expect(qualityEngine.METRIC_GATES.PROMISE_RECALL).toEqual({ op: 'gte', bound: 1 });
    expect(qualityEngine.METRIC_GATES.CHANGE_IMPACT_RECALL).toEqual({ op: 'gte', bound: 1 });
    expect(qualityEngine.METRIC_GATES.CONTEXT_BUDGET_OVERFLOW).toEqual({ op: 'lte', bound: 0 });
    expect(qualityEngine.METRIC_GATES.USER_EDIT_RATIO_REDUCTION).toEqual({ op: 'gt', bound: 0 });
  });

  it('4. evaluateMetricGate 边界值全集：判定与各 op 机械语义一致', () => {
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
        expect(qualityEngine.evaluateMetricGate(metric, val)).toBe(
          expectedByOp(gate.op, val, gate.bound),
        );
      }
    }
  });

  it('5. 代表性边界样例（原 W6-2 等价测试样例集原样保留）', () => {
    expect(qualityEngine.evaluateMetricGate('CANON_ACCURACY', 0.99)).toBe(true);
    expect(qualityEngine.evaluateMetricGate('CANON_ACCURACY', 0.98)).toBe(false);
    expect(qualityEngine.evaluateMetricGate('KNOWLEDGE_LEAK_RATE', 0)).toBe(true);
    expect(qualityEngine.evaluateMetricGate('KNOWLEDGE_LEAK_RATE', 0.25)).toBe(false);
    expect(qualityEngine.evaluateMetricGate('USER_EDIT_RATIO_REDUCTION', 0.5)).toBe(true);
    expect(qualityEngine.evaluateMetricGate('USER_EDIT_RATIO_REDUCTION', 0)).toBe(false);
  });
});

describe('W6 收尾：配方版本解析出口（runtime recipe-payload）金标准', () => {
  it('6. M14 约定键挂载点为 recipeSnapshot', async () => {
    const runtime = await runtimeImport();
    expect(runtime.RECIPE_SNAPSHOT_KEY).toBe('recipeSnapshot');
  });

  it('7. readRecipeVersionFromPayload 在 7 类典型/畸形载荷下显式缺面不猜版本', async () => {
    const runtime = await runtimeImport();
    const payloads: ReadonlyArray<{
      readonly name: string;
      readonly payload: Readonly<Record<string, unknown>>;
      readonly expected: string | null;
    }> = [
      // 1. 标准有效快照
      {
        name: '标准有效快照',
        payload: { recipeSnapshot: { recipe: { recipeVersion: '1.2.3' } } },
        expected: '1.2.3',
      },
      // 2. 空载荷
      { name: '空载荷', payload: {}, expected: null },
      // 3. 快照为 null
      { name: '快照为 null', payload: { recipeSnapshot: null }, expected: null },
      // 4. 快照为数组畸形
      { name: '快照为数组畸形', payload: { recipeSnapshot: [] }, expected: null },
      // 5. recipe 缺失
      { name: 'recipe 缺失', payload: { recipeSnapshot: {} }, expected: null },
      // 6. recipeVersion 为空字符串
      {
        name: 'recipeVersion 为空字符串',
        payload: { recipeSnapshot: { recipe: { recipeVersion: '' } } },
        expected: null,
      },
      // 7. recipeVersion 为非字符串（数字或对象）
      {
        name: 'recipeVersion 为非字符串',
        payload: { recipeSnapshot: { recipe: { recipeVersion: 42 } } },
        expected: null,
      },
    ];

    expect(payloads).toHaveLength(7);

    for (const { name, payload, expected } of payloads) {
      expect(runtime.readRecipeVersionFromPayload(payload), name).toBe(expected);
    }
  });
});

describe('W6 收尾：矩阵行合成（matrixRowFor）金标准', () => {
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

  it('8. 有 GenerationStarted 载荷 ⇒ 三级路径取 recipeVersion，读数与版本原样继承', () => {
    const payload = { recipeSnapshot: { recipe: { recipeVersion: '2.0.0' } } };

    const row = qualityEngine.matrixRowFor({ report: mockReport, generationStarted: payload });

    expect(row.recipeVersion).toBe('2.0.0');
    expect(row.benchmarkVersion).toBe('0.1.0');
    expect(row.recordedAtUtc).toBe('2026-10-04T00:00:00.000Z');
    expect(row.metrics.CANON_ACCURACY.passed).toBe(true);
    expect(Object.keys(row.metrics)).toHaveLength(6);
  });

  it('9. 载荷缺省/缺版本 ⇒ 显式 null（不猜版本）', () => {
    expect(
      qualityEngine.matrixRowFor({ report: mockReport }).recipeVersion,
    ).toBeNull();
    expect(
      qualityEngine.matrixRowFor({ report: mockReport, generationStarted: {} }).recipeVersion,
    ).toBeNull();
  });

  it('10. 确定性：同输入两次合成逐字节一致', () => {
    const input = { report: mockReport, generationStarted: { recipeSnapshot: { recipe: { recipeVersion: '9.9.9' } } } };
    expect(JSON.stringify(qualityEngine.matrixRowFor(input))).toBe(
      JSON.stringify(qualityEngine.matrixRowFor(input)),
    );
  });
});
