/**
 * T11 验收测试：execute 四态路径 + 解析快照 + fail-fast（规格 §1/§4，Q4/Q6/Q7）。
 * T21 增补（#54）：meta 桥接三槽（P1）/ nowMs 注入统一盖 durationMs（P3）/ taskRef 回执（Q-E）。
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

  it('RecoverableError 单候选穷尽 ⇒ failed_recoverable 并携带原始 repairHint', async () => {
    const { engine } = makeEngine();
    engine.registerCapability({
      ...CAP,
      failurePolicy: { timeoutMs: 120_000, fallbackProviderIds: [] }, // 真正单候选
    });
    engine.registerProviderBinding('deepseek', () =>
      Promise.reject(new RecoverableError('schema 校验失败：title 缺失', { field: 'title' })),
    );
    const result = await engine.execute('CHAPTER_DRAFTING', {});
    expect(result.outcome).toBe('failed_recoverable');
    expect(result.repairHint).toEqual({ field: 'title', triedProviders: ['deepseek'] });
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

describe('T12 timeout+fallback 降级链', () => {
  const CAP_FB = {
    ...CAP,
    failurePolicy: { timeoutMs: 5, fallbackProviderIds: ['glm'] },
  };

  it('超时触发降级：主 provider 永挂 → glm 成功', async () => {
    const { engine } = makeEngine();
    engine.registerCapability(CAP_FB);
    engine.registerProviderBinding('deepseek', () => new Promise(() => {}));
    engine.registerProviderBinding('glm', () => Promise.resolve({ ok: true }));
    const r = await engine.execute('CHAPTER_DRAFTING', {});
    expect(r.outcome).toBe('succeeded');
    expect(r.snapshot.providerId).toBe('glm');
    // 纪律声明：attempt 事件只记「降级切换」，首试由 GenerationStarted+快照覆盖
    const attempts = engine
      .replaySession()
      .events.filter((e) => e.event.type === 'TaskAttemptRegistered');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.event.payload).toMatchObject({ providerId: 'glm' });
  });

  it('候选全灭 ⇒ failed_recoverable + triedProviders 列表', async () => {
    const { engine } = makeEngine();
    engine.registerCapability(CAP_FB);
    engine.registerProviderBinding('deepseek', () => new Promise(() => {}));
    engine.registerProviderBinding('glm', () =>
      Promise.reject(new RecoverableError('glm 也挂了')),
    );
    const r = await engine.execute('CHAPTER_DRAFTING', {});
    expect(r.outcome).toBe('failed_recoverable');
    expect(r.repairHint).toEqual({ triedProviders: ['deepseek', 'glm'] });
  });

  it('普通异常直通 failed_terminal：不烧 fallback、无 attempt 事件', async () => {
    const { engine } = makeEngine();
    engine.registerCapability(CAP_FB);
    engine.registerProviderBinding('deepseek', () => Promise.reject(new Error('boom')));
    const r = await engine.execute('CHAPTER_DRAFTING', {});
    expect(r.outcome).toBe('failed_terminal');
    const attempts = engine
      .replaySession()
      .events.filter((e) => e.event.type === 'TaskAttemptRegistered');
    expect(attempts).toHaveLength(0);
  });
});

describe('T21 事件供给面增补（#54 · t52 B1/B3/Q-E）', () => {
  /** 注入时钟夹具：按序吐 ticks，耗尽后驻留末值（零时钟纪律：不碰 Date.now）。 */
  function timedEngine(ticks: readonly number[]) {
    const root = mkdtempSync(join(tmpdir(), 'mozhou-engine-t21-'));
    mkdirSync(join(root, '.mozhou'), { recursive: true });
    let i = 0;
    const engine = new RuntimeEngine({
      bus: new PublishBus(),
      ctx: { root },
      newTaskRef: () => 'gen_t21',
      nowMs: () => ticks[Math.min(i++, ticks.length - 1)] ?? 0,
    });
    return { root, engine };
  }

  const eventsOf = (engine: RuntimeEngine) =>
    engine.replaySession().events.map((row) => row.event);

  it('P1 meta 桥接：chapterIndex 上顶层槽、parentTaskRef 进 payload、eventPayload 并入 Started', async () => {
    const { engine } = timedEngine([1000, 1375]);
    engine.registerCapability(CAP);
    engine.registerProviderBinding('deepseek', () => Promise.resolve('ok'));
    const result = await engine.execute('CHAPTER_DRAFTING', { beat: '开场' }, {
      parentTaskRef: 'tsk_session_ch7',
      chapterIndex: 7,
      eventPayload: { recipeSnapshot: { recipe: { recipeVersion: '2.5.0' } } },
    });

    expect(result.taskRef).toBe('gen_t21'); // Q-E：只读回执
    const events = eventsOf(engine);
    const started = events.find((e) => e.type === 'GenerationStarted')!;
    expect(started.taskRef).toBe(result.taskRef);
    expect(started.chapterIndex).toBe(7);
    // snapshot 与 M14 形状 eventPayload 同槽共存；recipeSnapshot 三级嵌套原样入账
    expect(started.payload).toMatchObject({
      snapshot: { providerId: 'deepseek' },
      recipeSnapshot: { recipe: { recipeVersion: '2.5.0' } },
    });

    const finished = events.find((e) => e.type === 'GenerationFinished')!;
    expect(finished.chapterIndex).toBe(7);
    expect(finished.payload).toMatchObject({
      outcome: 'succeeded',
      providerId: 'deepseek',
      parentTaskRef: 'tsk_session_ch7',
      durationMs: 375, // 注入时钟差值：1375-1000
    });
  });

  it('P1：fallback attempt 与穷尽出口同样携 chapterIndex+parentTaskRef+durationMs', async () => {
    const { engine } = timedEngine([100, 400]);
    engine.registerCapability({
      ...CAP,
      failurePolicy: { timeoutMs: 120_000, fallbackProviderIds: ['glm'] },
    });
    engine.registerProviderBinding('deepseek', () =>
      Promise.reject(new RecoverableError('主渠道挂了')),
    );
    engine.registerProviderBinding('glm', () =>
      Promise.reject(new RecoverableError('glm 也挂了')),
    );
    const r = await engine.execute('CHAPTER_DRAFTING', {}, {
      parentTaskRef: 'tsk_session_fb',
      chapterIndex: 3,
    });
    expect(r.outcome).toBe('failed_recoverable');

    const events = eventsOf(engine);
    const attempt = events.find((e) => e.type === 'TaskAttemptRegistered')!;
    expect(attempt.chapterIndex).toBe(3);
    expect(attempt.payload).toMatchObject({ providerId: 'glm', parentTaskRef: 'tsk_session_fb' });
    const finished = events.find((e) => e.type === 'GenerationFinished')!;
    expect(finished.chapterIndex).toBe(3);
    expect(finished.payload).toMatchObject({
      outcome: 'failed_recoverable',
      durationMs: 300, // 入口 100 → 穷尽出口 400
      parentTaskRef: 'tsk_session_fb',
    });
  });

  it('P3：terminal 出口统一盖 durationMs；taskRef 回执与事件同源', async () => {
    const { engine } = timedEngine([1000, 1250]);
    engine.registerCapability(CAP);
    engine.registerProviderBinding('deepseek', () => Promise.reject(new Error('boom')));
    const r = await engine.execute('CHAPTER_DRAFTING', {});
    expect(r.outcome).toBe('failed_terminal');
    expect(r.taskRef).toBe('gen_t21');
    const finished = eventsOf(engine).find((e) => e.type === 'GenerationFinished')!;
    expect(finished.payload).toMatchObject({ outcome: 'failed_terminal', reason: 'boom', durationMs: 250 });
  });

  it('缺省行为零回归：无 meta ⇒ 事件无 chapterIndex 键、payload 无桥接键', async () => {
    const { engine } = timedEngine([]);
    engine.registerCapability(CAP);
    engine.registerProviderBinding('deepseek', () => Promise.resolve('ok'));
    await engine.execute('CHAPTER_DRAFTING', {});
    for (const event of eventsOf(engine)) {
      expect('chapterIndex' in event).toBe(false);
      expect(event.payload?.['recipeSnapshot']).toBeUndefined();
      expect(event.payload?.['parentTaskRef']).toBeUndefined();
    }
  });
});
