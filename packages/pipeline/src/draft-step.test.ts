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
  readDraftCandidate,
  readDraftState,
  runDraftStep,
  type DraftBindingOptions,
  type WriteBase,
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

let candidateSeq = 0;
/** C2 候选上下文：base 取自盘面现场（revision + 正文文件 sha256），模式映射 generate→replace。 */
function candidateContext(root: string, chapterIndex: number, mode: 'replace' | 'continue' = 'replace', seedText?: string): DraftBindingOptions['candidate'] {
  candidateSeq += 1;
  const id = 'a0000000-0000-4000-8000-' + String(candidateSeq).padStart(12, '0');
  const plane = LocalDataPlane.open(root);
  try {
    const scan = plane.getProseChapter(chapterIndex);
    const base: WriteBase = { revision: scan.revision, sha256: sha256FileHex(join(root, proseChapterPath(chapterIndex))) };
    return {
      id,
      operationId: 'op_t17_' + String(candidateSeq),
      bookId: plane.book.id,
      base,
      mode,
      ...(seedText === undefined ? {} : { seedText }),
    };
  } finally {
    plane.close();
  }
}

function readCandidateText(root: string, candidate: DraftBindingOptions['candidate']): string {
  const c = readDraftCandidate(root, candidate.id);
  return c === null ? '' : c.text;
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
  seedText?: string,
): { candidate: DraftBindingOptions['candidate'] } {
  const candidate = candidateContext(root, 7, mode === 'continue' ? 'continue' : 'replace', seedText);
  engine.registerProviderBinding(
    providerId,
    makeDraftProviderBinding({ bookRoot: root, chapterIndex: 7, provider, mode, stream, candidate }),
  );
  return { candidate };
}

describe('流式写入候选（C2：正文只能经 accept 落盘）', () => {
  it('多 delta 只进候选：正文/相位/hash 基线零变化，候选文本完整、状态 complete', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    const { candidate } = registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream(['夜雨敲窗，', '灯焰摇了三摇。', '他推门而入。']));

    const beforeHash = sha256FileHex(join(root, proseChapterPath(7)));

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

    // C2/I01：正文不被生成触碰——原文保持、hash 基线不变
    const rel = proseChapterPath(7);
    const scan = readProseChapter(root, rel);
    expect(scan.phase).toBe('draft');
    expect(scan.commitId).toBeUndefined();
    expect(scan.body).not.toContain('夜雨敲窗，');
    expect(scan.body).not.toContain('他推门而入。');
    expect(sha256FileHex(join(root, rel))).toBe(beforeHash);

    // 候选是唯一持久生成区：文本完整 + 状态 complete + 与状态文件关联
    const candidateOnDisk = readDraftCandidate(root, candidate.id);
    expect(candidateOnDisk?.status).toBe('ready');
    expect(candidateOnDisk?.text).toContain('夜雨敲窗，');
    expect(candidateOnDisk?.text).toContain('他推门而入。');
    expect(readCandidateText(root, candidate)).toBe(outcome.text);
    expect(readDraftState(root, 7)).toMatchObject({ status: 'complete', candidateId: candidate.id });
    // 正文 hash 基线未被刷新（manifest 与盘面仍一致）
    const manifest = readManifest(root);
    expect(manifest.files[rel]?.sha256).toBe(beforeHash);
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

describe('断流 partial 标记与半稿保留（候选语义）', () => {
  it('流中断后已收 delta 在候选里、状态标 partial、候选半稿可续写', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    const { candidate } = registerDraftBinding(
      engine,
      root,
      'deepseek',
      'deepseek',
      fakeStream(['半稿上半。', '半稿下半。'], new ProviderTransportError({ status: 429 }, 'http 429')),
    );

    const failed = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });
    expect(failed.outcome).toBe('failed_recoverable'); // 单候选穷尽 ⇒ 三级上报位
    expect(failed.partial).toBe(true);

    // 半稿持久保留在候选里；正文保持原文（C2/I01）
    const halfScan = readProseChapter(root, proseChapterPath(7));
    expect(halfScan.phase).toBe('draft');
    expect(halfScan.body).not.toContain('半稿上半。');
    const halfCandidate = readDraftCandidate(root, candidate.id);
    expect(halfCandidate?.status).toBe('partial');
    expect(halfCandidate?.text).toContain('半稿上半。');
    expect(halfCandidate?.text).toContain('半稿下半。');

    const state = readDraftState(root, 7);
    expect(state).not.toBeNull();
    expect(state!.status).toBe('partial');
    expect(state!.candidateId).toBe(candidate.id);
    expect(state!.reason).toMatch(/rate_limit/i); // T13 归一化：429 → rate_limit

    // 作者选续写：以候选半稿为基底（seedText）继续流
    const engine2 = makeEngine(root);
    const { candidate: resumedCandidate } = registerDraftBinding(
      engine2,
      root,
      'deepseek',
      'deepseek',
      fakeStream(['续写第一句。']),
      'continue',
      halfCandidate?.text, // 调用方从旧候选读取半稿文本作为续写 seed
    );
    const resumed = await runDraftStep({
      engine: engine2,
      bookRoot: root,
      chapterIndex: 7,
      packet: PACKET,
      recipe: RECIPE,
      mode: 'continue',
    });
    expect(resumed.outcome).toBe('succeeded');
    const fullCandidate = readDraftCandidate(root, resumedCandidate.id);
    expect(fullCandidate?.mode).toBe('continue');
    expect(fullCandidate?.text).toContain('半稿上半。');
    expect(fullCandidate?.text).toContain('续写第一句。');
    // 正文仍未被动过
    expect(readProseChapter(root, proseChapterPath(7)).body).not.toContain('半稿上半。');
    expect(readDraftState(root, 7)?.status).toBe('complete');
  });

  it('作者选重生成：mode=generate 全量重走，新候选不残留旧半稿文本', async () => {
    const { root } = hermeticBook();
    const firstEngine = makeEngine(root);
    const { candidate: firstCandidate } = registerDraftBinding(firstEngine, root, 'deepseek', 'deepseek', fakeStream(['旧稿痕迹。'], new ProviderTransportError({ status: 502 })));

    await runDraftStep({ engine: firstEngine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });
    expect(readDraftCandidate(root, firstCandidate.id)?.status).toBe('partial');

    const secondEngine = makeEngine(root);
    const { candidate: secondCandidate } = registerDraftBinding(secondEngine, root, 'deepseek', 'deepseek', fakeStream(['全新开篇。']));
    const regenerated = await runDraftStep({ engine: secondEngine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE, mode: 'generate' });
    expect(regenerated.outcome).toBe('succeeded');
    const freshCandidate = readDraftCandidate(root, secondCandidate.id);
    expect(freshCandidate?.mode).toBe('replace');
    expect(freshCandidate?.text).not.toContain('旧稿痕迹。');
    expect(freshCandidate?.text).toContain('全新开篇。');
    // 正文仍未被生成触碰
    expect(readProseChapter(root, proseChapterPath(7)).body).not.toContain('全新开篇。');
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

    // C2 真相 = fallback 候选成稿；正文仍未被生成触碰（I01）
    expect(readProseChapter(root, proseChapterPath(7)).body).not.toContain('备用渠道成稿。');
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

    // 最后一次 attempt 的半稿持久保留在候选且标 partial；正文仍原样
    const scan = readProseChapter(root, proseChapterPath(7));
    expect(scan.phase).toBe('draft');
    expect(scan.body).not.toContain('备渠道半截。');
    const partialCandidate = readDraftCandidate(root, readDraftState(root, 7)?.candidateId ?? '');
    expect(partialCandidate).not.toBeNull();
    expect(partialCandidate?.status).toBe('partial');
    expect(partialCandidate?.text).toContain('备渠道半截。');
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

/**
 * 空流不得当成功（商业化阻断 1）。
 *
 * 缺陷：makeDraftProviderBinding 在流「正常结束但零 delta」时无条件
 * finishCandidate(...,'ready') + status='complete'，runDraftStep 遂返回
 * outcome:'succeeded', chars:0。真实上游把错误塞进 HTTP 200 的 SSE 流时
 * （commit 0693776 自述「零 delta 的静默空输出」），作者会看到「生成完成、
 * 已定稿入账」，而正文是空的、叙事五族零增长。
 *
 * 契约：零增量 ⇒ 抛 RecoverableError ⇒ 引擎走 fallback 链；穷尽后
 * failed_recoverable + 归一原因，候选不落 ready。
 */
describe('空流不得当成功（上游 200 但零 delta）', () => {
  it('generate 模式零 delta：判 failed_recoverable + 归一原因，候选不落 ready', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    const { candidate } = registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream([]));

    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });

    // 核心断言：空流不得被当成成功
    expect(outcome.outcome).toBe('failed_recoverable');
    expect(outcome.chars).toBe(0);
    // 原因可读、可归一（不是裸 undefined）
    expect(outcome.reason).toContain('EMPTY_STREAM');
    // 候选不得被终态化成 ready——否则作者会拿到「已成稿」的空候选
    expect(readDraftCandidate(root, candidate.id)?.status).not.toBe('ready');
  });

  it('零长度 delta（上游发空帧）等价于零增量：同样判失败', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream(['', '']));

    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });

    expect(outcome.outcome).toBe('failed_recoverable');
    expect(outcome.reason).toContain('EMPTY_STREAM');
  });

  it('continue 模式零 delta：续写基底保留并标 partial，但仍判失败', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    const { candidate } = registerDraftBinding(
      engine, root, 'deepseek', 'deepseek', fakeStream([]),
      'continue', '这是上一次留下的半稿基底。',
    );

    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });

    // 有基底文本不代表「续写成功」——本次流零增量即失败
    expect(outcome.outcome).toBe('failed_recoverable');
    expect(outcome.reason).toContain('EMPTY_STREAM');
    // 基底不丢：候选保留半稿可再续，状态标 partial
    expect(readDraftCandidate(root, candidate.id)?.status).toBe('partial');
    expect(readDraftCandidate(root, candidate.id)?.text).toContain('半稿基底');
    // draft 状态文件标 partial，作者看得到
    expect(readDraftState(root, 7)?.status).toBe('partial');
  });

  it('空流可重试：首选 provider 空流后引擎回落备用 provider 并成功', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root, { fallbacks: ['glm'] });
    registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream([]));
    registerDraftBinding(engine, root, 'glm', 'glm', fakeStream(['备用厂商的成稿。']));

    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });

    expect(outcome.outcome).toBe('succeeded');
    expect(outcome.text).toBe('备用厂商的成稿。');
  });

  it('零回归：非空流仍走 succeeded/ready 原路径（不得误伤正常生成）', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    const { candidate } = registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream(['正常成稿。']));

    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });

    expect(outcome.outcome).toBe('succeeded');
    expect(outcome.chars).toBeGreaterThan(0);
    expect(outcome.partial).toBe(false);
    expect(outcome.produced).toBe(true);
    expect(readDraftCandidate(root, candidate.id)?.status).toBe('ready');
  });
});

/**
 * produced 语义：它回答「本次 attempt 有没有真的给出正文」，而不是「outcome 是不是 succeeded」。
 *
 * 路由（apps/web/server/routes/pipelineRoutes.ts 的 draft.stream 末帧）据此选帧：
 *   - produced=false ⇒ error 帧（空流：不能拿一个空候选告诉作者「生成完成」）；
 *   - produced=true  ⇒ 维持既有 done(partial)（断流但半稿已落盘、可续可采纳）。
 * 若把判据写成 outcome !== 'succeeded'，断流的 300 字半稿会被判成失败而无人能救。
 */
describe('produced：本次是否真的产出正文（末帧选型的判据）', () => {
  it('断流但已落盘半稿 ⇒ produced=true（半稿不得被当失败）', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    registerDraftBinding(
      engine,
      root,
      'deepseek',
      'deepseek',
      fakeStream(['半稿上半。', '半稿下半。'], new ProviderTransportError({ status: 429 }, 'http 429')),
    );

    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });

    expect(outcome.outcome).toBe('failed_recoverable');
    expect(outcome.partial).toBe(true);
    expect(outcome.produced).toBe(true);
  });

  // 回归守卫：produced 必须跨 attempt 累加，不能只看最后一次。
  // 第一次 attempt 写了半稿后断流，引擎定向重生的第二次 attempt 静默空输出——
  // 那半稿是真内容、真落盘、可采纳。若 produced=false，作者拿到 error 帧，
  // 半稿被判定为「什么都没生成」而困死（error 分支只给「再来一轮」）。
  // 形状对齐出货路径：makeStreamEngine 每次只注册一个绑定，跨 attempt 复用同一闭包。
  it('重生 attempt 的空输出不得抹掉前一 attempt 已落盘的半稿', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root, { fallbacks: ['deepseek'] });
    let attempt = 0;
    const stream = () => {
      attempt += 1;
      return attempt === 1
        ? fakeStream(['第一个 attempt 已经写出来的半稿。'], new ProviderTransportError({ status: 429 }, 'http 429'))()
        : fakeStream([])();
    };
    const candidate = candidateContext(root, 7, 'replace', undefined);
    engine.registerProviderBinding(
      'deepseek',
      makeDraftProviderBinding({ bookRoot: root, chapterIndex: 7, provider: 'deepseek', mode: 'generate', stream, candidate }),
    );

    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });

    expect(attempt).toBe(2); // 确实走到了第二次 attempt，否则本用例没测到东西
    expect(outcome.outcome).toBe('failed_recoverable');
    expect(outcome.produced).toBe(true);
  });

  it('空流 ⇒ produced=false（作者必须看到失败）', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream([]));

    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });

    expect(outcome.outcome).toBe('failed_recoverable');
    expect(outcome.produced).toBe(false);
  });

  it('continue 模式空流 ⇒ produced=false（基底不算本次产出）', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream([]), 'continue', '这是上一次留下的半稿基底。');

    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });

    expect(outcome.outcome).toBe('failed_recoverable');
    // chars 因基底而 > 0，但 produced 必须为 false：本次一个字都没续出来
    expect(outcome.chars).toBeGreaterThan(0);
    expect(outcome.produced).toBe(false);
  });

  it('纯空白增量流 ⇒ produced=false（空白不构成可采纳正文）', async () => {
    const { root } = hermeticBook();
    const engine = makeEngine(root);
    registerDraftBinding(engine, root, 'deepseek', 'deepseek', fakeStream(['  ', '   ', ' ']));

    const outcome = await runDraftStep({ engine, bookRoot: root, chapterIndex: 7, packet: PACKET, recipe: RECIPE });

    expect(outcome.outcome).toBe('failed_recoverable');
    expect(outcome.produced).toBe(false);
  });
});

