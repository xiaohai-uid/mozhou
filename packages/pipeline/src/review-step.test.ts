/**
 * T17 验收测试（#41）：Review 步——draft 产物可被机械核检入口消费。
 * 门本体归 T18，本票只测消费入口的确定性读取与相位守卫。零时钟零外部服务。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { PublishBus, RuntimeEngine } from '@mozhou/runtime';
import type { CapabilityRecipe } from '@mozhou/runtime';
import type { ContextPacket } from '@mozhou/context-compiler';
import {
  ChapterPhaseError,
  LocalDataPlane,
  createBook,
  proseChapterPath,
  readProseChapter,
} from '@mozhou/data-plane';
import { defaultPlatformRules, hashProse, isQualityReviewCurrent } from '@mozhou/quality-engine';
import type { QualityPolicy } from '@mozhou/quality-engine';
import {
  ChapterProductionSession,
  ChapterReviewCancelledError,
  ChapterReviewTimeoutError,
  NoCompiledReceiptAnchorError,
  acceptDraft,
  defaultReviewCapabilityExecutor,
  executeChapterReview,
  loadDraftForReview,
  makeDraftProviderBinding,
  recordUserEdit,
  runDraftStep,
  runReviewStep,
  type ReviewCapabilityCompletedResponse,
  type ReviewCapabilityExecutor,
  type ReviewCapabilityRequest,
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
  source: { repo: 'original', commit: '0'.repeat(40), license: 'original', refinedAt: '2026-08-25', refineNote: '夹具' },
  brief: { capability: '正文草稿流式生成', runtimeSemantics: '断流 partial 半稿保留', triggers: ['draft'] },
  taskType: 'CHAPTER_DRAFTING',
  entry: { routerDoc: 'docs/router.md', phases: ['draft'], stopPoints: [] },
  references: [],
  artifacts: [
    {
      path: '正文/第一卷/第0007章.md',
      granularity: 'chapter',
      createdPhase: 'draft',
      readTiming: 'immediately',
      sizeBudget: { target: 100, max: 200 },
      failure: { policy: 'repair', repairAction: '重生成' },
    },
  ],
  prechecks: [],
  trackingGate: {
    authorityState: '正文/第一卷/第0007章.md',
    casField: 'revision',
    transactionModes: ['append'],
    derivedViews: [],
    budgets: { hotContextBytes: 1024, perChapterReads: [] },
    failureTaxonomy: 'validationFailed',
    hookPoint: 'postWrite',
  },
  contextBudget: { hotContextBytes: 1024, fixedSections: [], perChapterReads: [] },
};

function hermeticBook(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-t17-review-'));
  roots.push(dir);
  createBook({ dir, title: '核检之书' });
  const plane = LocalDataPlane.open(dir);
  plane.createChapterDraft({ chapterIndex: 3, title: '第三章' });
  plane.close();
  return dir;
}


let reviewCandidateSeq = 0;
function draftEngine(root: string, chunks: readonly string[]): { engine: RuntimeEngine; candidate: { id: string; operationId: string; bookId: string; base: WriteBase; mode: 'replace' } } {
  const engine = new RuntimeEngine({ bus: new PublishBus(), ctx: { root }, newTaskRef: () => 'gen_review' });
  engine.registerCapability({
    taskType: 'CHAPTER_DRAFTING',
    providerId: 'deepseek',
    providerVersion: '1.0.0',
    failurePolicy: { timeoutMs: 5_000, fallbackProviderIds: [] },
  });
  async function* stream() {
    // 显式微任务边界：真实流每个 delta 都跨异步边界到达
    await Promise.resolve();
    for (const chunk of chunks) yield chunk;
  }
  reviewCandidateSeq += 1;
  const id = 'd0000000-0000-4000-8000-' + String(reviewCandidateSeq).padStart(12, '0');
  const plane = LocalDataPlane.open(root);
  let candidate: { id: string; operationId: string; bookId: string; base: WriteBase; mode: 'replace' };
  try {
    const scan = plane.getProseChapter(3);
    candidate = {
      id,
      operationId: 'op_review_' + String(reviewCandidateSeq),
      bookId: plane.book.id,
      base: { revision: scan.revision, sha256: createHash('sha256').update(readFileSync(join(root, proseChapterPath(3)))).digest('hex') },
      mode: 'replace',
    };
  } finally {
    plane.close();
  }
  engine.registerProviderBinding(
    'deepseek',
    makeDraftProviderBinding({ bookRoot: root, chapterIndex: 3, provider: 'deepseek', mode: 'generate', stream: () => stream(), candidate }),
  );
  return { engine, candidate };
}

/** 受控管线：draft 后显式采纳候选落盘（C2；正文只能经 accept 写入）。 */
function acceptDraftOf(root: string, ctx: { candidate: { id: string; base: WriteBase } }): void {
  acceptDraft({ bookRoot: root, candidateId: ctx.candidate.id, base: ctx.candidate.base, idempotencyKey: 'accept_review_' + ctx.candidate.id });
}

describe('Review 步：draft 产物可被机械核检入口消费', () => {
  it('读 draft 正文为确定性输入记录（身份/相位/字数）', async () => {
    const root = hermeticBook();
    const draftCtx = draftEngine(root, ['第一段。\n', '第二段。']);
    const outcome = await runDraftStep({
      engine: draftCtx.engine,
      bookRoot: root,
      chapterIndex: 3,
      packet: PACKET,
      recipe: RECIPE,
    });
    acceptDraftOf(root, draftCtx);

    const input = loadDraftForReview(root, 3);
    expect(input.phase).toBe('draft');
    expect(input.chapterIndex).toBe(3);
    expect(input.mozhouId).toBe(readProseChapterId(root));
// C2：accept 落盘正文 = 候选文本 + 规范尾换行；与核检入口逐字节一致
    expect(input.body).toBe(outcome.text.endsWith('\n') ? outcome.text : outcome.text + '\n');
    expect(input.charCount).toBe(input.body.length);
    expect(input.proseRelPath).toContain('第0003章.md');
  });

  it('committed 章不是 Review 输入（ChapterPhaseError 宁败不猜）', () => {
    const root = hermeticBook();
    const plane = LocalDataPlane.open(root);
    plane.commitChapter({ chapterIndex: 3, summary: '相位翻转夹具' });
    expect(() => loadDraftForReview(root, 3)).toThrowError(ChapterPhaseError);
  });
});

function readProseChapterId(root: string): string {
  // 章一体两面：正文 frontmatter mozhouId 即章大纲节点 id
  const scan = loadDraftForReview(root, 3);
  return scan.mozhouId;
}

/* -------------------------------------------------------------------------
 * ADR-0025（质量门集成）：runReviewStep——版本绑定审查报告与 stale 判定
 * ------------------------------------------------------------------------- */

const REVIEWER = { providerId: 'deepseek', model: 'deepseek-chat', recipeVersion: '0.1.0' };

/** 只含确定性规则的策略：语义规则默认启用会让无提供方的审查变 refused。 */
function deterministicOnlyPolicy(): QualityPolicy {
  return {
    schemaVersion: 1,
    projectId: '核检之书',
    rules: defaultPlatformRules().filter((r) => r.kind === 'deterministic'),
    maxAutomaticReworks: 2,
  };
}

describe('ADR-0025 runReviewStep：版本绑定审查报告', () => {
  it('产出报告并落盘 .mozhou/quality-reviews/（锚定哈希=精确待审正文 SHA-256）', async () => {
    const root = hermeticBook();
    const draftCtx = draftEngine(root, ['陈缺推门进来，把伞收了靠在墙边。']);
    await runDraftStep({
      engine: draftCtx.engine,
      bookRoot: root,
      chapterIndex: 3,
      packet: PACKET,
      recipe: RECIPE,
    });
    acceptDraftOf(root, draftCtx);

    const outcome = await runReviewStep({
      bookRoot: root,
      chapterIndex: 3,
      receiptId: 'rcpt_t25_1',
      reviewer: REVIEWER,
      policy: deterministicOnlyPolicy(),
    });

    expect(outcome.report.verdict).toBe('pass');
    expect(outcome.report.anchor.receiptId).toBe('rcpt_t25_1');
    expect(outcome.report.anchor.draftContentHash).toBe(hashProse(outcome.input.body));
    expect(outcome.report.anchor.draftRevision).toBe(outcome.input.revision);

    // 报告持久化于 .mozhou/quality-reviews/chapter_3/（非 Canon 审计证据）
    const dir = join(root, '.mozhou', 'quality-reviews', 'chapter_3');
    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    const persisted = JSON.parse(readFileSync(join(dir, files[0]!), 'utf8')) as {
      reportId: string;
      verdict: string;
    };
    expect(persisted.reportId).toBe(outcome.report.reportId);
    expect(persisted.verdict).toBe('pass');
    expect(outcome.reportRelPath).toContain('chapter_3');
  });

  it('段落瀑布正文 → blocking_fail（PARA-001 机械证据）', async () => {
    const root = hermeticBook();
    const waterfallCtx = draftEngine(root, ['他抬头。\n', '\n门开了。\n', '\n风进来了。\n', '\n陈缺没有动。']);
    await runDraftStep({
      engine: waterfallCtx.engine,
      bookRoot: root,
      chapterIndex: 3,
      packet: PACKET,
      recipe: RECIPE,
    });
    acceptDraftOf(root, waterfallCtx);

    const outcome = await runReviewStep({
      bookRoot: root,
      chapterIndex: 3,
      receiptId: 'rcpt_t25_2',
      reviewer: REVIEWER,
      policy: deterministicOnlyPolicy(),
    });
    expect(outcome.report.verdict).toBe('blocking_fail');
    const para = outcome.report.evaluations.find((e) => e.ruleId === 'PARA-001');
    expect(para?.verdict).toBe('fail');
    expect(para?.evidence.length).toBeGreaterThan(0);
  });

  it('审查后正文经既有编辑路径再改 → 旧 PASS 立即 stale（fail closed）', async () => {
    const root = hermeticBook();
    const bus = new PublishBus();
    const staleCtx = draftEngine(root, ['陈缺推门进来，把伞收了靠在墙边。\n', '\n窗外雨还在下。']);
    await runDraftStep({
      engine: staleCtx.engine,
      bookRoot: root,
      chapterIndex: 3,
      packet: PACKET,
      recipe: RECIPE,
    });
    acceptDraftOf(root, staleCtx);

    const first = await runReviewStep({
      bookRoot: root,
      chapterIndex: 3,
      receiptId: 'rcpt_t25_3',
      reviewer: REVIEWER,
      policy: deterministicOnlyPolicy(),
    });
    expect(first.report.verdict).toBe('pass');

    // 既有 draft 编辑路径（User Edit 步同款）：revision+1、正文变化、基线刷新
    const edit = recordUserEdit({
      bus,
      bookRoot: root,
      taskRef: 'tsk_review_mutation',
      chapterIndex: 3,
      level: 'selection',
      source: 'author',
      blocks: [{ op: 'replace', paragraphStart: 1, paragraphEnd: 1, replacementText: '作者润色后的正文，与审查时逐字节不同。' }],
    });

    const scan = readProseChapter(root, proseChapterPath(3));
    expect(isQualityReviewCurrent(first.report, {
      draftRevision: edit.revisionAfter,
      draftContentHash: hashProse(scan.body),
    })).toBe(false);
  });

  it('executeChapterReview: 深度审查统摄机检、金句收割与会话记录', async () => {
    const root = hermeticBook();
    const bus = new PublishBus();
    const session = ChapterProductionSession.start({
      bus,
      root,
      chapterIndex: 3,
      newTaskRef: () => 'tsk_deep_review',
    });
    session.advance('compile');
    session.advance('draft');

    const deepCtx = draftEngine(root, [
      '天下大势，分久必合。陈缺推门而入，看着案几上摆放的一纸文书，神色凝重地坐下，端起茶盏轻轻吹开浮沫。\n\n',
      '窗外的夜雨淅淅沥沥地下着，将廊下的青苔洗得发亮，远处隐隐传来打更之声。\n\n',
      '长生久视不过是虚妄。',
    ]);
    await runDraftStep({
      engine: deepCtx.engine,
      bookRoot: root,
      chapterIndex: 3,
      packet: PACKET,
      recipe: RECIPE,
    });
    acceptDraftOf(root, deepCtx);

    const outcome = await executeChapterReview({
      bookRoot: root,
      chapterIndex: 3,
      session,
      // 显式给锚点：本用例考的是统摄机检/金句收割/会话记录，不是锚点解析。
      // 此前此处不传，靠 `rcpt_rev_3` 占位兜底才跑得通（同文件另外三处用例本就显式传）。
      receiptId: 'rcpt_t25_deep',
      policy: deterministicOnlyPolicy(),
      reviewer: REVIEWER,
      mechanicalOptions: { minWords: 0 },
      autoHarvestQuotes: true,
      autoAbsorbCounterexamples: true,
    });


    expect(outcome.report.verdict).toBe('pass');
    expect(outcome.mechanicalGate.passed).toBe(true);
    expect(outcome.harvestedQuotesCount).toBeGreaterThanOrEqual(1);
    expect(session.currentStep).toBe('review');
    expect(session.project().lastQualityVerdict).toBe('pass')
  });

  it('D10：没有编译凭证锚点时拒答，绝不编造 receiptId 落盘', async () => {
    const root = hermeticBook()
    const ctx = draftEngine(root, ['山高水长，此去经年。\n\n'])
    await runDraftStep({
      engine: ctx.engine,
      bookRoot: root,
      chapterIndex: 7,
      packet: PACKET,
      recipe: RECIPE,
    })
    acceptDraftOf(root, ctx)

    // 既不传 receiptId，也不给 session（⇒ 旧实现 `rcpt_rev_7` 兜底的命中点）
    await expect(
      executeChapterReview({
        bookRoot: root,
        chapterIndex: 7,
        policy: deterministicOnlyPolicy(),
        reviewer: REVIEWER,
        mechanicalOptions: { minWords: 0 },
      }),
    ).rejects.toBeInstanceOf(NoCompiledReceiptAnchorError)

    // 且不得有任何报告文件被写出来
    expect(existsSync(join(root, '.mozhou', 'quality-reviews', 'chapter_7'))).toBe(false)
  })

  it('超时支持与迟到保护：timeoutMs 触发时抛出超时错误且报告绝不落盘、会话绝不推进', async () => {
    const root = hermeticBook();
    const bus = new PublishBus();
    const session = ChapterProductionSession.start({
      bus,
      root,
      chapterIndex: 3,
      newTaskRef: () => 'tsk_timeout_test',
    });
    session.advance('compile');
    session.advance('draft');

    const ctx = draftEngine(root, ['正文内容第一句。\n\n']);
    await runDraftStep({
      engine: ctx.engine,
      bookRoot: root,
      chapterIndex: 3,
      packet: PACKET,
      recipe: RECIPE,
    });
    acceptDraftOf(root, ctx);

    // 模拟迟到执行器：在 150ms 后返回成功结果，但超时设定为 50ms
    const slowExecutor: ReviewCapabilityExecutor = async (req: ReviewCapabilityRequest): Promise<ReviewCapabilityCompletedResponse> => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        schemaVersion: 1,
        requestId: req.requestId,
        status: 'completed',
        report: {
          schemaVersion: 1,
          reportId: 'rep_late',
          reviewer: req.reviewer,
          anchor: {
            chapterIndex: req.draft.chapterIndex,
            draftRevision: req.draft.revision,
            draftContentHash: req.draft.contentHash,
            receiptId: req.receiptId,
            ruleSetDigest: req.ruleSetDigest,
          },
          evaluations: [],
          verdict: 'pass',
        },
        mechanicalGate: {
          passed: true,
          checks: [],
          fails: [],
          oks: [],
        },
      };
    };

    await expect(
      executeChapterReview({
        bookRoot: root,
        chapterIndex: 3,
        session,
        receiptId: 'rcpt_timeout_anchor',
        policy: deterministicOnlyPolicy(),
        reviewer: REVIEWER,
        timeoutMs: 50,
        capabilityExecutor: slowExecutor,
      }),
    ).rejects.toBeInstanceOf(ChapterReviewTimeoutError);

    // 迟到保护验证：任何迟到的执行结果决不再落盘、推进会话账本
    expect(existsSync(join(root, '.mozhou', 'quality-reviews', 'chapter_3'))).toBe(false);
    expect(session.currentStep).toBe('draft');
  });

  it('取消支持与迟到保护：AbortSignal 中止时抛出取消错误且报告绝不落盘', async () => {
    const root = hermeticBook();
    const bus = new PublishBus();
    const session = ChapterProductionSession.start({
      bus,
      root,
      chapterIndex: 3,
      newTaskRef: () => 'tsk_cancel_test',
    });
    session.advance('compile');
    session.advance('draft');

    const ctx = draftEngine(root, ['正文内容。\n\n']);
    await runDraftStep({
      engine: ctx.engine,
      bookRoot: root,
      chapterIndex: 3,
      packet: PACKET,
      recipe: RECIPE,
    });
    acceptDraftOf(root, ctx);

    const abortController = new AbortController();
    abortController.abort('用户主动取消审查');

    await expect(
      executeChapterReview({
        bookRoot: root,
        chapterIndex: 3,
        session,
        receiptId: 'rcpt_cancel_anchor',
        policy: deterministicOnlyPolicy(),
        reviewer: REVIEWER,
        signal: abortController.signal,
      }),
    ).rejects.toBeInstanceOf(ChapterReviewCancelledError);

    expect(existsSync(join(root, '.mozhou', 'quality-reviews', 'chapter_3'))).toBe(false);
    expect(session.currentStep).toBe('draft');
  });

  it('纯净通信契约：传输数据为纯净可序列化 JSON，不含 session 与 bookRoot', async () => {
    const root = hermeticBook();
    const ctx = draftEngine(root, ['陈缺推门而入。\n\n']);
    await runDraftStep({
      engine: ctx.engine,
      bookRoot: root,
      chapterIndex: 3,
      packet: PACKET,
      recipe: RECIPE,
    });
    acceptDraftOf(root, ctx);

    let capturedRequest: ReviewCapabilityRequest | null = null;
    const inspectExecutor: ReviewCapabilityExecutor = async (req, opts) => {
      capturedRequest = req;
      return defaultReviewCapabilityExecutor(req, opts);
    };

    await executeChapterReview({
      bookRoot: root,
      chapterIndex: 3,
      receiptId: 'rcpt_pure_contract',
      policy: deterministicOnlyPolicy(),
      reviewer: REVIEWER,
      capabilityExecutor: inspectExecutor,
    });

    expect(capturedRequest).toBeDefined();
    // 纯净通信契约核检：严禁包含 session、bookRoot、回调等字段
    const rawReq = capturedRequest as unknown as Record<string, unknown>;
    expect(rawReq['session']).toBeUndefined();
    expect(rawReq['bookRoot']).toBeUndefined();
    expect(rawReq['root']).toBeUndefined();
    expect(rawReq['semanticEvaluator']).toBeUndefined();
    // 纯 JSON 序列化无损验证
    const jsonStr = JSON.stringify(capturedRequest);
    expect(JSON.parse(jsonStr)).toEqual(capturedRequest);
  });
});

