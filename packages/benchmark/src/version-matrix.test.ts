import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PublishBus, RuntimeEngine, toGenerationStartedPayload } from '@mozhou/runtime';
import type { CapabilityRecipeDocument } from '@mozhou/runtime';
import { readPipelineLedger } from '@mozhou/pipeline';
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

describe('T21 全链路（#54 · t52:B1）：execute meta 桥接 → 账本白名单重建 → 矩阵行', () => {
  it('GenerationStarted 账本行的 recipeSnapshot 经嵌套路径进版本矩阵（engine→账本→消费端到端）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mozhou-t21-e2e-'));
    try {
      mkdirSync(join(root, '.mozhou'), { recursive: true });
      const engine = new RuntimeEngine({
        bus: new PublishBus(),
        ctx: { root },
        newTaskRef: () => 'gen_t21_e2e',
        nowMs: () => 0, // 零时钟：注入常数时钟，durationMs 恒 0（不碰 Date.now）
      });
      engine.registerCapability({
        taskType: 'CHAPTER_DRAFTING',
        providerId: 'deepseek',
        providerVersion: '1.0.0',
        failurePolicy: { timeoutMs: 120_000, fallbackProviderIds: [] },
      });
      engine.registerProviderBinding('deepseek', () => Promise.resolve('ok'));

      const doc = docWithVersion('3.1.4');
      const result = await engine.execute('CHAPTER_DRAFTING', {}, {
        parentTaskRef: 'tsk_session_t21',
        chapterIndex: 7,
        eventPayload: toGenerationStartedPayload(doc),
      });
      expect(result.taskRef).toBe('gen_t21_e2e'); // Q-E 回执与事件同源

      // 读侧 = pipeline 白名单重建面（learner/evaluator 未来同一读法）：
      // payload 层字段全链路可达，顶层只认 type/taskRef/chapterIndex/payload 四槽
      const rows = readPipelineLedger(root);
      const startedPayload = rows
        .flatMap((row) => (row.kind === 'task' && row.event.type === 'GenerationStarted' ? [row.event.payload] : []))
        .at(0);
      expect(startedPayload).toBeDefined();
      const input = {
        report: stubReport(),
        ...(startedPayload === undefined ? {} : { generationStarted: startedPayload }),
      };
      expect(matrixRowFor(input).recipeVersion).toBe('3.1.4'); // 三级嵌套路径

      // P3 同趟佐证：账本行 GenerationFinished 已盖 durationMs（注入常数时钟差值）
      const finished = rows
        .flatMap((row) => (row.kind === 'task' && row.event.type === 'GenerationFinished' ? [row.event] : []))
        .at(0)!;
      expect(finished.payload?.['durationMs']).toBe(0);
      expect(finished.payload?.['parentTaskRef']).toBe('tsk_session_t21');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
