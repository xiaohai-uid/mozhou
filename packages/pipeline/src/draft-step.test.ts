/**
 * T17 验收测试（#41）：Draft 步——
 * 流式写入正文文件 phase=draft / 断流 partial 标记与半稿保留（续写+重生成）/
 * M17 三级降级可见性各一例（一级静默 / 二级 attempt 事件 / 三级 failed_recoverable 上报）。
 * 零时钟零外部服务：假 provider 流夹具禁真网；taskRef 注入固定值；hermetic 临时书。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PublishBus, RuntimeEngine, readLedger } from '@mozhou/runtime';
import type { CapabilityRecipe, CapabilityRecipeDocument } from '@mozhou/runtime';
import { readPipelineLedger } from './ledger.js';
import type { ContextPacket } from '@mozhou/context-compiler';
import {
  LocalDataPlane,
  createBook,
  proseChapterPath,
  readManifest,
  readProseChapter,
  sha256FileHex,
} from '@mozhou/data-plane';
import {
  ProviderTransportError,
  makeDraftProviderBinding,
  readDraftState,
  runDraftStep,
} from './index.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows file lock tolerance
    }
  }
  roots = [];
});


function hermeticBook(): { root: string; plane: LocalDataPlane } {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-t17-draft-'));
  roots.push(dir);
  createBook({ dir, title: '降级之书' });
  const plane = LocalDataPlane.open(dir);
  plane.createChapterDraft({ chapterIndex: 7, title: '第七章' });
  return { root: dir, plane };
}

const PACKET: ContextPacket = {
  taskType: 'CHAPTER_DRAFTING',
  chapterIndex: 7,
  structural: [],
  settings: [],
  story: { text: '', tokens: 0, trimType: 'none' },
  text: '装配完成的生成输入',
  totalTokens: 9,
};

const RECIPE: CapabilityRecipe = {
  id: 'chapter-drafting',
  recipeVersion: '0.1.0',
  source: {
    repo: 'original',
    commit: '0'.repeat(40),
    license: 'original',
    refinedAt: '2026-08-25',
    refineNote: 'T17 测试夹具',
  },
  brief: {
    capability: '正文草稿流式生成',
    runtimeSemantics: '断流标 partial、半稿持久保留，可续写或重生成',
    triggers: ['draft'],
  },
  taskType: 'CHAPTER_DRAFTING',
  entry: { routerDoc: 'docs/router.md', phases: ['draft'], stopPoints: [] },
  references: [],
  artifacts: [
    {
      path: '正文/第一卷/第0007章.md',
      granularity: 'chapter',
      createdPhase: 'draft',
      readTiming: 'immediately',
      sizeBudget: { target: 2000, max: 4000 },
      failure: { policy: 'repair', repairAction: '重生成' },
    },
  ],
  prechecks: [],
  trackingGate: {
    authorityState: '正文/第一卷/第0007章.md',
    casField: 'revision',
    transactionModes: ['append'],
    derivedViews: [],
    budgets: { hotContextBytes: 8192, perChapterReads: [] },
    failureTaxonomy: 'validationFailed',
    hookPoint: 'postWrite',
  },
  contextBudget: { hotContextBytes: 8192, fixedSections: [], perChapterReads: [] },
};

/** 假流夹具：逐 delta 产出；可选在全部 delta 之后抛错模拟断流。 */
function fakeStream(chunks: readonly string[], terminalError?: Error) {
  return async function* () {
    // 显式微任务边界：真实流每个 delta 都跨异步边界到达
    await Promise.resolve();
    for (const chunk of chunks) {
      yield chunk;
    }
    if (terminalError !== undefined) {
      throw terminalError;
    }
  };
}

function makeEngine(root: string, opts?: { fallbacks?: readonly string[] }): RuntimeEngine {
  const engine = new RuntimeEngine({ bus: new PublishBus(), ctx: { root }, newTaskRef: () => 'gen_t17' });
  engine.registerCapability({
    taskType: 'CHAPTER_DRAFTING',
    providerId: 'deepseek',
    providerVersion: '1.0.0',
    failurePolicy: { timeoutMs: 5_000, fallbackProviderIds: [...(opts?.fallbacks ?? [])] },
  });
  return engine;
}

function registerDraftBinding(
  engine: RuntimeEngine,
  root: string,
  providerId: string,
  provider: 'deepseek' | 'glm' | 'claude',
  stream: ReturnType<typeof fakeStream>,
  mode: 'generate' | 'continue' = 'generate',
): void {
  engine.registerProviderBinding(
    providerId,
    makeDraftProviderBinding({ bookRoot: root, chapterIndex: 7, provider, mode, stream }),
  );
}

describe('流式写入正文文件 phase=draft', () => {
  it('多 delta 正文流逐段落盘，frontmatter 相位与身份保持，hash 基线刷新', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream(['夜雨敲窗，', '灯焰摇了三摇。', '他推门而入。']));

    const outcome = await runDraftStep({
      engine,
      bookRoot: root,
      chapterIndex: 7,
      packet: PACKET,
      recipe: RECIPE,
    });

    expect(outcome.outcome).toBe('succeeded');
    expect(outcome.partial).toBe(false);
    expect(outcome.text).toContain('灯焰摇了三摇。');

    const rel = proseChapterPath(7);
    const scan = readProseChapter(root, rel);
    expect(scan.phase).toBe('draft');
    expect(scan.commitId).toBeUndefined();
    expect(scan.body).toContain('夜雨敲窗，');
    expect(scan.body).toContain('他推门而入。');

    // 每章落盘即持久：状态文件 complete + 基线与盘上逐字节一致（后续 commit 写前校验可过）
    expect(readDraftState(root, 7)).toMatchObject({ status: 'complete', chars: scan.body.length });
    const manifest = readManifest(root);
    expect(manifest.files[rel]?.sha256).toBe(sha256FileHex(join(root, rel)));
  });

  it('payload 携带 packet 与 recipe 身份/预算字段（provider 输入契约）', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    let seenPayload: unknown;
    engine.registerProviderBinding('deepseek', async (payload) => {
      await Promise.resolve();
      seenPayload = payload;
      return '成稿';
    });

    await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });
    expect(seenPayload).toMatchObject({
      prompt: '装配完成的生成输入',
      hotContextBytes: 8192,
      mode: 'generate',
    });
    // t52:B1：业务 payload 删平铺 recipeId/recipeVersion 两键——唯一消费方
    // version-matrix.ts 只走 recipeSnapshot 嵌套路径，平铺身份=冗余投影
    expect(seenPayload).not.toHaveProperty('recipeId');
    expect(seenPayload).not.toHaveProperty('recipeVersion');
  });
});

describe('断流 partial 标记与半稿保留', () => {
  it('流中断后已收 delta 在盘上、状态标 partial、半稿可续写', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    registerDraftBinding(
      engine,
      root,
      'deepseek',
      'deepseek',
      fakeStream(['半稿上半。', '半稿下半。'], new ProviderTransportError({ status: 429 }, 'http 429')),
    );

    const failed = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });
    expect(failed.outcome).toBe('failed_recoverable'); // 单候选穷尽 ⇒ 三级上报位
    expect(failed.partial).toBe(true);

    // 半稿持久保留：两个已收 delta 都在正文文件里（phase=draft 天然可写）
    const halfScan = readProseChapter(root, proseChapterPath(7));
    expect(halfScan.phase).toBe('draft');
    expect(halfScan.body).toContain('半稿上半。');
    expect(halfScan.body).not.toContain('续写第一句。');

    const state = readDraftState(root, 7);
    expect(state).not.toBeNull();
    expect(state!.status).toBe('partial');
    expect(state!.reason).toMatch(/rate_limit/i); // T13 归一化：429 → rate_limit

    // 作者选续写：以盘上半稿为基底继续流
    const engine2 = makeEngine(root);
    registerDraftBinding(
      engine2,
      root,
      'deepseek',
      'deepseek',
      fakeStream(['续写第一句。']),
      'continue',
    );
    const resumed = await runDraftStep({ engine: engine2, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE, mode: 'continue' });
    expect(resumed.outcome).toBe('succeeded');
    const fullScan = readProseChapter(root, proseChapterPath(7));
    expect(fullScan.body).toContain('半稿上半。');
    expect(fullScan.body).toContain('续写第一句。');
    expect(readDraftState(root, 7)?.status).toBe('complete');
  });

  it('作者选重生成：mode=generate 全量重走，旧半稿不残留', async () => {
    const { root } = hermeticBook();
    const firstEngine = makeEngine(root);
    registerDraftBinding(firstEngine, root, 'deepseek', 'deepseek', fakeStream(['旧稿痕迹。'], new ProviderTransportError({ status: 502 })));

    await runDraftStep({ engine: firstEngine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });

    const secondEngine = makeEngine(root);
    registerDraftBinding(secondEngine, root, 'deepseek', 'deepseek', fakeStream(['全新开篇。']));
    const regenerated = await runDraftStep({ engine: secondEngine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE, mode: 'generate' });
    expect(regenerated.outcome).toBe('succeeded');
    const scan = readProseChapter(root, proseChapterPath(7));
    expect(scan.body).not.toContain('旧稿痕迹。');
    expect(scan.body).toContain('全新开篇。');
  });
});

describe('M17 三级降级可见性接线', () => {
  it('一级静默：主候选一次成功只落 GenerationStarted/Finished 一对，无任何 attempt/档位事件', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream(['一次成型。']));

    await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });

    const events = readLedger({ root }).map((row) => row.event);
    expect(events.map((event) => event.type)).toEqual(['GenerationStarted', 'GenerationFinished']);
    expect(events[1]!.payload).toMatchObject({ outcome: 'succeeded', providerId: 'deepseek' });
  });

  it('二级定向重生：主候选 retryable 失败 ⇒ fallback 每次 attempt 记 TaskAttemptRegistered', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root, { fallbacks: ['glm'] });
    registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream(['残句。'], new ProviderTransportError({ status: 429 })));
    registerDraftBinding(engine, root, 'glm', 'glm', fakeStream(['备用渠道成稿。']));

    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });
    expect(outcome.outcome).toBe('succeeded');

    const events = readLedger({ root }).map((row) => row.event);
    const attempts = events.filter((event) => event.type === 'TaskAttemptRegistered');
    expect(attempts).toHaveLength(1); // 尝试次数=事件数：只有 fallback 那次
    expect(attempts[0]!.payload).toMatchObject({ providerId: 'glm' });
    expect(String(attempts[0]!.payload?.['reason'])).toMatch(/rate_limit/i);
    expect(events.at(-1)).toMatchObject({ type: 'GenerationFinished' });
    expect(events.at(-1)!.payload).toMatchObject({ outcome: 'succeeded', providerId: 'glm' });

    // 盘面真相 = 成功那次的全量重写（fallback 绑定同缝落盘）
    expect(readProseChapter(root, proseChapterPath(7)).body).toContain('备用渠道成稿。');
    expect(outcome.text).toContain('备用渠道成稿。');
  });

  it('三级人工模板兜底：全候选穷尽必须上报 failed_recoverable + triedProviders 轨迹', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root, { fallbacks: ['glm'] });
    registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream(['主渠道半截。'], new ProviderTransportError({ status: 429 })));
    registerDraftBinding(engine, root, 'glm', 'glm', fakeStream(['备渠道半截。'], new ProviderTransportError({ code: 1113 })));

    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });

    // 上报给调用方渲染人工模板（绝不静默吞掉）
    expect(outcome.outcome).toBe('failed_recoverable');
    expect(outcome.triedProviders).toEqual(['deepseek', 'glm']);
    expect(outcome.reason).toBeDefined();

    // 账本侧：GenerationFinished(failed_recoverable) 留痕
    const finished = readLedger({ root }).map((row) => row.event).at(-1)!;
    expect(finished.type).toBe('GenerationFinished');
    expect(finished.payload).toMatchObject({ outcome: 'failed_recoverable' });

    // 最后一次 attempt 的半稿持久保留且标 partial
    const scan = readProseChapter(root, proseChapterPath(7));
    expect(scan.phase).toBe('draft');
    expect(scan.body).toContain('备渠道半截。');
    expect(readDraftState(root, 7)?.status).toBe('partial');
  });

  it('非 retryable 错误直通 failed_terminal，不烧候选不记 attempt', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root, { fallbacks: ['glm'] });
    registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream([], new ProviderTransportError({ status: 401 })));
    let glmCalled = false;
    engine.registerProviderBinding('glm', async () => {
      await Promise.resolve();
      glmCalled = true;
      return '不应被调用';
    });

    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });
    expect(outcome.outcome).toBe('failed_terminal');
    expect(glmCalled).toBe(false);
    const types = readLedger({ root }).map((row) => row.event.type);
    expect(types).toEqual(['GenerationStarted', 'GenerationFinished']);
  });

  it('committed 章拒绝流式写入（phase 守卫宁败不脏）', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream(['不应落盘。']));
    // 先造一份合法草稿再提交翻转相位；步边界重开 data-plane（编排方契约：
    // draft 步直接刷新盘上 manifest，长持句柄须在步边界重开以同步 ctx 基线）
    await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });
    const reopenedPlane = LocalDataPlane.open(root);
    reopenedPlane.commitChapter({ chapterIndex: 7, summary: '翻相位夹具' });

    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });
    expect(outcome.outcome).toBe('failed_terminal');
    expect(outcome.reason).toContain('phase=draft');
  });
});

describe('T21 事件供给面增补（#54 · t52 B1/Q-E）', () => {
  /** 配方原档夹具：RECIPE 本就是全字段 CapabilityRecipe，直接升档成文档。 */
  const RECIPE_DOC: CapabilityRecipeDocument = {
    schemaVersion: 1,
    compatibilityPolicy: 'none',
    versioning: { schemaVersionRule: 'incompatible-change-requires-major-reject', retiredPaths: [] },
    recipe: RECIPE,
  };

  it('P1 桥接端到端：taskRef+recipeDoc ⇒ chapterIndex/parentTaskRef/recipeSnapshot 全链路入账', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream(['桥接成稿。']));

    const outcome = await runDraftStep({
      engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE,
      taskRef: 'tsk_session_t21',
      recipeDoc: RECIPE_DOC,
    });
    expect(outcome.outcome).toBe('succeeded');

    // 读侧走 pipeline 白名单重建面：payload 层新字段全链路可达（engine→账本→读回）
    const events = readPipelineLedger(root).flatMap((row) => (row.kind === 'task' ? [row.event] : []));
    const started = events.find((event) => event.type === 'GenerationStarted')!;
    expect(started.chapterIndex).toBe(7); // 顶层既有槽
    expect(started.payload?.['recipeSnapshot']).toEqual(RECIPE_DOC); // M14 形状整档入账
    const snapshot = started.payload?.['recipeSnapshot'] as { recipe: { recipeVersion: string } };
    expect(snapshot.recipe.recipeVersion).toBe('0.1.0'); // 三级嵌套收窄（version-matrix 同款路径）

    const finished = events.find((event) => event.type === 'GenerationFinished')!;
    expect(finished.chapterIndex).toBe(7);
    expect(finished.payload).toMatchObject({ parentTaskRef: 'tsk_session_t21' });
  });

  it('缺省零回归：不传 taskRef/recipeDoc ⇒ 无 parentTaskRef 键、无 recipeSnapshot 键', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream(['素跑成稿。']));
    await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });
    for (const event of readLedger({ root }).map((row) => row.event)) {
      // chapterIndex 恒桥接（步内已知章序，t52:B1 定案值）；parentTaskRef/recipeSnapshot
      // 仅在调用方显式给出 taskRef/recipeDoc 时才入账
      expect(event.chapterIndex).toBe(7);
      expect(event.payload?.['parentTaskRef']).toBeUndefined();
      expect(event.payload?.['recipeSnapshot']).toBeUndefined();
    }
  });

  it('Q-E 精确折叠：失败原因取自本次执行的 GenerationFinished，而非邻接最近行', async () => {
    const { root } = hermeticBook();
    // 预置一条异窗口旧失败行（S11 单飞解除后的交错场景缩影）：旧启发式「最近一条」
    // 在本行之后还有别的写入时即错位，精确折叠按本次 taskRef 收敛。
    const seedBus = new PublishBus();
    seedBus.publish({ root }, { type: 'GenerationStarted', taskRef: 'gen_stale_window', payload: {} });
    seedBus.publish({ root }, { type: 'GenerationFinished', taskRef: 'gen_stale_window', payload: { outcome: 'failed_terminal', reason: 'STALE-REASON-FROM-OLD-WINDOW' } });

    const engine = makeEngine(root); // 不注册绑定 ⇒ ProviderBindingMissingError 直通 terminal
    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });
    expect(outcome.outcome).toBe('failed_terminal');
    expect(outcome.reason).toContain('PROVIDER_BINDING_MISSING');
    expect(outcome.reason).not.toContain('STALE-REASON-FROM-OLD-WINDOW');
  });
});
