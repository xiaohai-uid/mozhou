/**
 * T11 验收测试：execute 四态路径 + 解析快照 + fail-fast（规格 §1/§4，Q4/Q6/Q7）。
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PublishBus, readLedger } from './eventBus.js';
import { RecoverableError, RuntimeEngine } from './engine.js';
import { NoProviderError } from './types.js';

function makeEngine() {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-engine-'));
  mkdirSync(join(root, '.mozhou'), { recursive: true });
  const bus = new PublishBus();
  let n = 0;
  const engine = new RuntimeEngine({
    bus,
    ctx: { root },
    newTaskRef: () => `task_${String(++n).padStart(3, '0')}`,
  });
  return { root, bus, engine };
}

const CAP = {
  taskType: 'CHAPTER_DRAFTING',
  providerId: 'deepseek',
  providerVersion: '1.0.0' as const,
  failurePolicy: { timeoutMs: 120_000, fallbackProviderIds: ['glm'] },
};

describe('RuntimeEngine.execute', () => {
  it('成功路径：succeeded + 快照 + Started↔Finished 成对闭合', async () => {
    const { engine } = makeEngine();
    engine.registerCapability(CAP);
    engine.registerProviderBinding('deepseek', (p) => Promise.resolve({ echoed: p }));
    const result = await engine.execute('CHAPTER_DRAFTING', { beat: '开场' });
    expect(result.outcome).toBe('succeeded');
    expect(result.snapshot).toMatchObject({
      taskType: 'CHAPTER_DRAFTING',
      capability: 'CHAPTER_DRAFTING',
      providerId: 'deepseek',
      providerVersion: '1.0.0',
    });
    const trace = engine.replaySession();
    expect(trace.closedPairs).toBe(1);
    expect(trace.hangingPairKeys).toHaveLength(0);
  });

  it('未注册绑定 ⇒ failed_terminal 且配对仍闭合（防悬挂）', async () => {
    const { engine } = makeEngine();
    engine.registerCapability(CAP);
    const result = await engine.execute('CHAPTER_DRAFTING', {});
    expect(result.outcome).toBe('failed_terminal');
    expect(engine.replaySession().hangingPairKeys).toHaveLength(0);
  });

  it('RecoverableError ⇒ failed_recoverable 并携带 repairHint', async () => {
    const { engine } = makeEngine();
    engine.registerCapability(CAP);
    engine.registerProviderBinding('deepseek', () =>
      Promise.reject(new RecoverableError('schema 校验失败：title 缺失', { field: 'title' })),
    );
    const result = await engine.execute('CHAPTER_DRAFTING', {});
    expect(result.outcome).toBe('failed_recoverable');
    expect(result.repairHint).toEqual({ field: 'title' });
  });

  it('普通异常 ⇒ failed_terminal 不带 repairHint', async () => {
    const { engine } = makeEngine();
    engine.registerCapability(CAP);
    engine.registerProviderBinding('deepseek', () =>
      Promise.reject(new Error('boom')),
    );
    const result = await engine.execute('CHAPTER_DRAFTING', {});
    expect(result.outcome).toBe('failed_terminal');
    expect(result.repairHint).toBeUndefined();
  });

  it('NO_PROVIDER_TASK_TYPE 在任何事件发射前抛出（fail-fast，账本零写入）', async () => {
    const { root, engine } = makeEngine();
    const err: unknown = await engine.execute('UNHEARD_TYPE', {}).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NoProviderError);
    expect(readLedger({ root })).toHaveLength(0);
  });

  it('semver 非法在注册期即拒（Q7=A）', () => {
    const { engine } = makeEngine();
    expect(() =>
      engine.registerCapability({ ...CAP, providerVersion: '1.0' as never }),
    ).toThrowError(/semver/);
  });

  it('NO_PROVIDER 错误文本指向具体配置键路径（ANWA #28 教训）', async () => {
    const { engine } = makeEngine();
    const err: unknown = await engine.execute('UNHEARD_TYPE', {}).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NoProviderError);
    expect((err as NoProviderError).message).toContain('settings.yaml');
  });
});
