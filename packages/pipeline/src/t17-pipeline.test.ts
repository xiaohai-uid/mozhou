/**
 * T17 集成测试（#41）：Draft/Review/User Edit 三步挂进 ChapterProductionSession
 * 十步步进机——步函数在对应步光标内执行，事件族（任务窗口 × 生成配对 × 编辑落账）
 * 同账共存、投影可恢复。零时钟零外部服务。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PublishBus, RuntimeEngine, readLedger } from '@mozhou/runtime';
import type { CapabilityRecipe } from '@mozhou/runtime';
import type { ContextPacket } from '@mozhou/context-compiler';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LocalDataPlane, createBook, proseChapterPath } from '@mozhou/data-plane';
import {
  ChapterProductionSession,
  acceptDraft,
  loadDraftForReview,
  makeDraftProviderBinding,
  presentCandidates,
  recordCandidateDecision,
  recordUserEdit,
  runDraftStep,
  type WriteBase,
} from './index.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ } }
  roots = [];
});

const PACKET: ContextPacket = {
  taskType: 'CHAPTER_DRAFTING',
  chapterIndex: 2,
  structural: [],
  settings: [],
  story: { text: '', tokens: 0, trimType: 'none' },
  text: '生成输入',
  totalTokens: 4,
};

const RECIPE: CapabilityRecipe = {
  id: 'chapter-drafting',
  recipeVersion: '0.1.0',
  source: { repo: 'original', commit: '0'.repeat(40), license: 'original', refinedAt: '2026-08-25', refineNote: '集成夹具' },
  brief: { capability: '正文草稿流式生成', runtimeSemantics: '断流 partial 半稿保留', triggers: ['draft'] },
  taskType: 'CHAPTER_DRAFTING',
  entry: { routerDoc: 'docs/router.md', phases: ['draft'], stopPoints: [] },
  references: [],
  artifacts: [
    {
      path: '正文/第一卷/第0002章.md',
      granularity: 'chapter',
      createdPhase: 'draft',
      readTiming: 'immediately',
      sizeBudget: { target: 50, max: 100 },
      failure: { policy: 'repair', repairAction: '重生成' },
    },
  ],
  prechecks: [],
  trackingGate: {
    authorityState: '正文/第一卷/第0002章.md',
    casField: 'revision',
    transactionModes: ['append'],
    derivedViews: [],
    budgets: { hotContextBytes: 512, perChapterReads: [] },
    failureTaxonomy: 'validationFailed',
    hookPoint: 'postWrite',
  },
  contextBudget: { hotContextBytes: 512, fixedSections: [], perChapterReads: [] },
};

function draftEngine(root: string): { engine: RuntimeEngine; candidate: { id: string; operationId: string; bookId: string; base: WriteBase; mode: 'replace' } } {
  const engine = new RuntimeEngine({ bus: new PublishBus(), ctx: { root }, newTaskRef: () => 'gen_t17_int' });
  engine.registerCapability({
    taskType: 'CHAPTER_DRAFTING',
    providerId: 'deepseek',
    providerVersion: '1.0.0',
    failurePolicy: { timeoutMs: 5_000, fallbackProviderIds: [] },
  });
  async function* stream() {
    // 显式微任务边界：真实流每个 delta 都跨异步边界到达
    await Promise.resolve();
    yield '集成正文第一段。';
    yield '集成正文第二段。';
  }
  const plane = LocalDataPlane.open(root);
  let candidate: { id: string; operationId: string; bookId: string; base: WriteBase; mode: 'replace' };
  try {
    const scan = plane.getProseChapter(2);
    candidate = {
      id: 'e0000000-0000-4000-8000-000000000001',
      operationId: 'op_t17_int',
      bookId: 'book-t17',
      base: { revision: scan.revision, sha256: createHash('sha256').update(readFileSync(join(root, proseChapterPath(2)))).digest('hex') },
      mode: 'replace',
    };
  } finally {
    plane.close();
  }
  engine.registerProviderBinding(
    'deepseek',
    makeDraftProviderBinding({ bookRoot: root, chapterIndex: 2, provider: 'deepseek', mode: 'generate', stream: () => stream(), candidate }),
  );
  return { engine, candidate };
}

describe('T17 三步挂进十步状态机', () => {
  it('prepare→compile→draft(流式)→review(核检入口)→user_edit(操作块) 事件族同账共存', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-t17-flow-'));
    roots.push(dir);
    createBook({ dir, title: '集成之书' });
    LocalDataPlane.open(dir).createChapterDraft({ chapterIndex: 2, title: '第二章' });

    const session = ChapterProductionSession.start({
      bus: new PublishBus(),
      root: dir,
      chapterIndex: 2,
      newTaskRef: () => 'tsk_t17_flow',
    });
    session.advance('compile');
    session.advance('draft');
    expect(session.currentStep).toBe('draft');

    // Draft 步：engine 事件族（GenerationStarted/Finished）与 session 窗口事件族同账并存
    const t17Ctx = draftEngine(dir);
    const outcome = await runDraftStep({
      engine: t17Ctx.engine,
      bookRoot: dir,
      chapterIndex: 2,
      packet: PACKET,
      recipe: RECIPE,
    });
    expect(outcome.outcome).toBe('succeeded');
    acceptDraft({
      bookRoot: dir,
      candidateId: t17Ctx.candidate.id,
      base: t17Ctx.candidate.base,
      idempotencyKey: 'accept_t17_flow',
    });

    // Review 步：核检入口消费 Draft 步产物（逐字节一致）
    session.advance('review');
    const reviewInput = loadDraftForReview(dir, 2);
// C2：accept 落盘正文 = 候选文本 + 规范尾换行
    expect(reviewInput.body).toBe(outcome.text.endsWith('\n') ? outcome.text : outcome.text + '\n');
    expect(reviewInput.charCount).toBe(reviewInput.body.length);

    // Review 步落账（ADR-0025）：审查事件随会话窗口进账，pass 才放行前进口
    session.recordQualityReview({ reportId: 'rpt_t17_pass', verdict: 'pass' });

    // User Edit 步：结构化操作块即时落盘并落账（挂会话 taskRef）
    session.advance('user_edit');
    const editOutcome = recordUserEdit({
      bus: new PublishBus(),
      bookRoot: dir,
      taskRef: session.taskRef,
      chapterIndex: 2,
      level: 'selection',
      source: 'author',
      blocks: [{ op: 'replace', paragraphStart: 1, paragraphEnd: 1, replacementText: '作者润色后的首段。' }],
    });
    // C2：draft accept 已占一次修订（r0→r1），user edit 为下一次
    expect(editOutcome.revisionAfter).toBe(2);

    // 多候选择优挂在同一会话窗口上（光标级分支，双路落账）
    const candDeps = { bus: new PublishBus(), bookRoot: dir, taskRef: session.taskRef, chapterIndex: 2 };
    presentCandidates(candDeps, {
      level: 'cursor',
      options: [
        { candidateId: 'int_a', text: '候选甲' },
        { candidateId: 'int_b', text: '候选乙' },
      ],
    });
    const decision = recordCandidateDecision(candDeps, {
      level: 'cursor',
      acceptedOptionIds: ['int_b'],
      rejectedOptionIds: ['int_a'],
    });
    expect(decision.acceptedOptionIds).toEqual(['int_b']);

    // 投影侧：步光标正确；唯一悬挂 head 是会话窗口自身（TaskStarted 待收卷），
    // Generation 配对与编辑/候选事件均无悬挂
    const projection = session.project();
    expect(projection.currentStep).toBe('user_edit');
    expect(projection.sessionOpen).toBe(true);
    expect(projection.openHeads).toEqual(['TaskStarted#tsk_t17_flow']);

    const types = readLedger({ root: dir }).map((row) => row.event.type);
    expect(types).toContain('TaskStarted');
    expect(types).toContain('GenerationStarted');
    expect(types).toContain('GenerationFinished');
    expect(types).toContain('QualityReviewCompleted');
    expect(types).toContain('UserEditRecorded');
    expect(types).toContain('CandidateCreated');
  });
});
