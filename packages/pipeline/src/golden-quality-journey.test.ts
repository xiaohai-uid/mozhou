/**
 * ADR-0025（质量门集成）Task 10 验收：黄金章级旅程——
 *   建书 → prepare → compile(cursor) → draft(假 provider 流式) → literary review
 *   → user edit → final extract → continuity gate → canon proposal → commit
 *   → reload → 验证（正文/五族 delta/报告锚定）。
 * 三连跑全过；两条负路径：stale PASS 交付拦截 / 第三次回炉拒绝。
 * 零时钟零外部服务：LLM 缝以假 provider/假 extractor 注入；taskRef 固定注入。
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newUlid } from '@mozhou/kernel';
import { PublishBus, RuntimeEngine } from '@mozhou/runtime';
import type { ContextPacket } from '@mozhou/context-compiler';
import type { CapabilityRecipe } from '@mozhou/runtime';
import { LocalDataPlane, createBook } from '@mozhou/data-plane';
import { hashProse, isQualityReviewCurrent } from '@mozhou/quality-engine';
import {
  ChapterProductionSession,
  ProposalPort,
  QualityReviewNotPassError,
  QualityReworkLimitExceededError,
  makeDraftProviderBinding,
  createCanonProposal,
  readPipelineLedger,
  recordUserEdit,
  runContinuityGate,
  runDraftStep,
  runFinalExtract,
  runReviewStep,
} from './index.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch {} }
  roots = [];
});

const NOW = '2026-08-30T00:00:00.000Z';
const INITIAL_PROSE = '林晚登上墨舟，甲板微微一沉。\n\n她回头看了一眼渡口。\n\n风从北面吹来，雾气漫过船舷。';
const FINAL_PROSE = '林晚登上墨舟，甲板微微一沉，她扶着船舷站稳，袖中铭文微微发烫。\n\n风起，舟行北岸，渡口的灯火在雾里散成一片。';

function head(prefix: string): Record<string, unknown> {
  return { id: prefix + '_' + newUlid(), bookId: 'book_' + newUlid(), revision: 0, createdAt: NOW, updatedAt: NOW };
}

const PACKET: ContextPacket = {
  taskType: 'CHAPTER_DRAFTING',
  chapterIndex: 2,
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
      path: '正文/第一卷/第0002章.md',
      granularity: 'chapter',
      createdPhase: 'draft',
      readTiming: 'immediately',
      sizeBudget: { target: 100, max: 200 },
      failure: { policy: 'repair', repairAction: '重生成' },
    },
  ],
  prechecks: [],
  trackingGate: {
    authorityState: '正文/第一卷/第0002章.md',
    casField: 'revision',
    transactionModes: ['append'],
    derivedViews: [],
    budgets: { hotContextBytes: 1024, perChapterReads: [] },
    failureTaxonomy: 'validationFailed',
    hookPoint: 'postWrite',
  },
  contextBudget: { hotContextBytes: 1024, fixedSections: [], perChapterReads: [] },
};

/** 假草稿 provider：跨异步边界逐块流式吐出 INITIAL_PROSE（零 LLM）。 */
function makeDraftEngine(root: string, bus: PublishBus): RuntimeEngine {
  const engine = new RuntimeEngine({ bus, ctx: { root }, newTaskRef: () => 'gen_golden' });
  engine.registerCapability({
    taskType: 'CHAPTER_DRAFTING',
    providerId: 'deepseek',
    providerVersion: '1.0.0',
    failurePolicy: { timeoutMs: 5_000, fallbackProviderIds: [] },
  });
  async function* stream(): AsyncGenerator<string> {
    await Promise.resolve();
    for (const chunk of INITIAL_PROSE.match(/.{1,8}/gu) ?? []) yield chunk;
  }
  engine.registerProviderBinding(
    'deepseek',
    makeDraftProviderBinding({ bookRoot: root, chapterIndex: 2, provider: 'deepseek', mode: 'generate', stream }),
  );
  return engine;
}

/** 确定性-only 策略（语义面由 bench 与 API 契约覆盖）。 */
const JOURNEY_POLICY = {
  schemaVersion: 1 as const,
  projectId: '黄金旅程之书',
  rules: [
    { id: 'PARA-001', version: '1.0.0', scope: 'platform' as const, kind: 'deterministic' as const, severity: 'blocking' as const, description: '段落瀑布', evidenceRequired: true, enabled: true },
    { id: 'REV-001', version: '1.0.0', scope: 'platform' as const, kind: 'deterministic' as const, severity: 'blocking' as const, description: '锚点一致', evidenceRequired: true, enabled: true },
  ],
  maxAutomaticReworks: 2 as const,
};

/** 报告目录列表（缺席=空）。 */
function listReports(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** 五族候选：秘密+reader 披露行+关系+承诺+时间线（Gate 全绿形状）。 */
function fixtureDelta(): Record<string, unknown[]> {
  const secret: Record<string, unknown> = {
    ...head('fact'),
    subject: 'char:linwan',
    predicate: 'secret.true_name',
    value: '墨隐',
    validFrom: 2,
    validUntil: null,
    importance: 'critical',
    riskClass: 'high',
    source: { kind: 'chapter', chapterIndex: 2 },
    status: 'candidate',
    compactedIntoVolumeId: null,
    provenance: { origin: 'ai', protectedUserContent: false },
  };
  const located: Record<string, unknown> = {
    ...head('fact'),
    subject: 'char:linwan',
    predicate: 'located',
    value: '墨舟',
    validFrom: 2,
    validUntil: null,
    importance: 'notable',
    riskClass: 'low',
    source: { kind: 'chapter', chapterIndex: 2 },
    status: 'candidate',
    compactedIntoVolumeId: null,
    provenance: { origin: 'ai', protectedUserContent: false },
  };
  return {
    temporalFact: [secret, located],
    knowledgeState: [{ ...head('knst'), factId: secret['id'], holder: 'reader', knownSinceChapter: 2 }],
    relationshipState: [
      {
        ...head('rels'),
        entityA: 'char:linwan',
        entityB: 'char:ahei',
        relationshipType: '同舟',
        affinityScore: 15,
        validFrom: 2,
        validUntil: null,
        sourceChapterIndex: 2,
      },
    ],
    narrativePromise: [{ id: 'prom_' + newUlid(), status: 'introduced', description: '真名之秘' }],
    timelineEvent: [
      {
        ...head('tle'),
        worldTimeLabel: '第三日拂晓',
        worldTimeOrder: 9,
        chapterIndex: 2,
        participants: ['char:linwan'],
        summary: '林晚登舟北上',
        impactFactIds: [located['id']],
      },
    ],
  };
}

interface JourneyResult {
  readonly root: string;
  readonly commitId: string;
  readonly reportId: string;
  readonly verdict: string;
  readonly finalRevision: number;
}

/** 一次黄金旅程：十步全走 + 提交 + reload 验证。 */
async function runGoldenJourney(runId: number): Promise<JourneyResult> {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-t25-golden-' + String(runId) + '-'));
  roots.push(dir);
  createBook({ dir, title: '黄金旅程之书 ' + String(runId) });
  LocalDataPlane.open(dir).createChapterDraft({ chapterIndex: 2, title: '第二章' });

  const bus = new PublishBus();
  const session = ChapterProductionSession.start({ bus, root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_golden' });

  // prepare（纯查询，零写入）已在各步间被消费；compile/draft 在此为占位游标——
  // 真实 compile/extract 缝在其他票的集成测试覆盖；本旅程用假 provider 补齐 draft 产物。
  session.advance('compile');
  session.advance('draft');
  const draftOutcome = await runDraftStep({
    engine: makeDraftEngine(dir, bus),
    bookRoot: dir,
    chapterIndex: 2,
    packet: PACKET,
    recipe: RECIPE,
  });
  expect(draftOutcome.outcome).toBe('succeeded');
  expect(draftOutcome.text).toContain('林晚登上墨舟');

  // literary review：版本绑定报告落 .mozhou/quality-reviews/，事件落账
  session.advance('review');
  const review = await runReviewStep({
    bookRoot: dir,
    chapterIndex: 2,
    receiptId: 'rcpt_golden_' + String(runId),
    reviewer: { providerId: 'bench', model: 'journey', recipeVersion: '0.1.0' },
    policy: JOURNEY_POLICY,
  });
  expect(review.report.verdict).toBe('pass');
  session.recordQualityReview({
    reportId: review.report.reportId,
    verdict: review.report.verdict,
    reportPath: review.reportRelPath,
    draftRevision: review.input.revision,
    draftContentHash: review.report.anchor.draftContentHash,
    receiptId: 'rcpt_golden_' + String(runId),
  });

  // user edit：终稿落定（revision+1，正文文件持久）
  session.advance('user_edit');
  const edit = recordUserEdit({
    bus,
    bookRoot: dir,
    taskRef: session.taskRef,
    chapterIndex: 2,
    level: 'selection',
    source: 'author',
    blocks: [{ op: 'replace', paragraphStart: 1, paragraphEnd: 1, replacementText: FINAL_PROSE.split('\n\n')[0] ?? '' }],
  });
  expect(edit.revisionAfter).toBe(1);

  // final extract → continuity gate → canon proposal → 确认 → commit
  session.advance('final_extract');
  const extracted = runFinalExtract({
    bus,
    bookRoot: dir,
    taskRef: session.taskRef,
    chapterIndex: 2,
    extract: () => fixtureDelta(),
  });
  expect(extracted.status).toBe('extracted');

  const gated = runContinuityGate({ bookRoot: dir, chapterIndex: 2, delta: extracted.batch ?? {} });
  expect(gated.verdict).toBe('pass');
  session.advance('continuity_gate', { verdict: gated.verdict, hardConflicts: gated.hardConflicts });

  session.advance('canon_proposal');
  const proposed = createCanonProposal({
    bus,
    bookRoot: dir,
    taskRef: session.taskRef,
    chapterIndex: 2,
    delta: extracted.batch ?? {},
  });
  const port = new ProposalPort({ root: dir });
  const ref = { port: 'pipeline', proposalId: proposed.proposalId } as const;
  for (const itemId of ['temporalFact#0', 'knowledgeState#0', 'relationshipState#0', 'narrativePromise#0']) {
    port.confirm(ref, itemId);
  }
  const appends = port.confirmedCanonicalRows(ref);

  const freshPlane = LocalDataPlane.open(dir);
  session.advance('commit');
  const committed = freshPlane.commitChapter({
    chapterIndex: 2,
    summary: '第二章定稿',
    finalProse: FINAL_PROSE,
    appends,
  });
  session.markCommitted(committed.commitId);
  session.advance('flywheel_record');
  session.finish();

  // reload：会话窗口闭合（完成态=CanonCommitted 存在性）；报告锚与旧 PASS 失效
  expect(ChapterProductionSession.resume({ bus: new PublishBus(), root: dir, chapterIndex: 2 })).toBeNull();
  expect(isQualityReviewCurrent(review.report, { draftRevision: edit.revisionAfter, draftContentHash: hashProse(FINAL_PROSE) })).toBe(false);

  return {
    root: dir,
    commitId: committed.commitId,
    reportId: review.report.reportId,
    verdict: review.report.verdict,
    finalRevision: edit.revisionAfter,
  };
}

describe('ADR-0025 Task 10 黄金章级旅程', () => {
  it('三连跑：全十步 + 提交 + reload 无人工修态', async () => {
    for (let runId = 1; runId <= 3; runId += 1) {
      const result = await runGoldenJourney(runId);
      expect(result.verdict).toBe('pass');
      expect(result.finalRevision).toBe(1);
      // 提交后：报告文件在册（.mozhou/quality-reviews/chapter_2/）
      const reportDir = join(result.root, '.mozhou', 'quality-reviews', 'chapter_2');
      const reports = listReports(reportDir);
      expect(reports.length).toBe(1);
      expect(result.commitId).toBeTruthy();
      expect(result.reportId).toBeTruthy();
      // 事件链闭合：TaskStarted/Finished 成对 + CanonCommitted 在账
      const types = readPipelineLedger(result.root).map((row) => (row.kind === 'task' ? row.event?.type : (row.row['type'] as string | undefined))).filter((t): t is string => typeof t === 'string');
      expect(types).toContain('CanonCommitted');
      expect(types).toContain('QualityReviewCompleted');
      expect(types).toContain('TaskFinished');
    }
  });

  it('负路径：stale PASS 交付拦截——终稿后旧报告失效，重审必 BLOCKING（REV-001/正文变化）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-t25-stale-'));
    roots.push(dir);
    createBook({ dir, title: '失效之书' });
    LocalDataPlane.open(dir).createChapterDraft({ chapterIndex: 2, title: '第二章' });
    const session = ChapterProductionSession.start({ bus: new PublishBus(), root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_stale' });
    session.advance('compile');
    session.advance('draft');
    const draft = await runDraftStep({
      engine: makeDraftEngine(dir, new PublishBus()),
      bookRoot: dir,
      chapterIndex: 2,
      packet: PACKET,
      recipe: RECIPE,
    });
    void draft;
    session.advance('review');
    const review = await runReviewStep({
      bookRoot: dir,
      chapterIndex: 2,
      receiptId: 'rcpt_stale',
      reviewer: { providerId: 'bench', model: 'journey', recipeVersion: '0.1.0' },
      policy: JOURNEY_POLICY,
    });
    session.recordQualityReview({ reportId: review.report.reportId, verdict: review.report.verdict });

    // 正文变化（既有编辑路径）→ 旧 PASS stale；重审因 REV-001/瀑布 → blocking_fail
    recordUserEdit({
      bus: new PublishBus(),
      bookRoot: dir,
      taskRef: 'tsk_stale',
      chapterIndex: 2,
      level: 'cursor',
      source: 'author',
      blocks: [{ op: 'insert', paragraphStart: 2, paragraphEnd: 2, replacementText: '他抬头。\n\n门开了。\n\n风进来了。\n\n陈缺没有动。' }],
    });
    const stale = await runReviewStep({
      bookRoot: dir,
      chapterIndex: 2,
      receiptId: 'rcpt_stale',
      reviewer: { providerId: 'bench', model: 'journey', recipeVersion: '0.1.0' },
      policy: JOURNEY_POLICY,
    });
    expect(stale.report.verdict).toBe('blocking_fail');
    // 重审结果落账后，旧 PASS 的前进通道关闭
    session.recordQualityReview({ reportId: stale.report.reportId, verdict: stale.report.verdict });
    expect(() => session.advance('user_edit')).toThrowError(QualityReviewNotPassError);
  });

  it('负路径：两次回炉后第三次拒绝（QualityReworkLimitExceeded）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-t25-limit-'));
    roots.push(dir);
    createBook({ dir, title: '上限之书' });
    LocalDataPlane.open(dir).createChapterDraft({ chapterIndex: 2, title: '第二章' });
    const session = ChapterProductionSession.start({ bus: new PublishBus(), root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_limit' });
    session.advance('compile');
    session.advance('draft');
    void (await runDraftStep({
      engine: makeDraftEngine(dir, new PublishBus()),
      bookRoot: dir,
      chapterIndex: 2,
      packet: PACKET,
      recipe: RECIPE,
    }));
    session.advance('review');
    recordUserEdit({
      bus: new PublishBus(),
      bookRoot: dir,
      taskRef: 'tsk_limit',
      chapterIndex: 2,
      level: 'cursor',
      source: 'author',
      blocks: [{ op: 'insert', paragraphStart: 2, paragraphEnd: 2, replacementText: '他抬头。\n\n门开了。\n\n风进来了。\n\n陈缺没有动。' }],
    });

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const review = await runReviewStep({
        bookRoot: dir,
        chapterIndex: 2,
        receiptId: 'rcpt_limit',
        reviewer: { providerId: 'bench', model: 'journey', recipeVersion: '0.1.0' },
        policy: JOURNEY_POLICY,
      });
      expect(review.report.verdict).toBe('blocking_fail');
      session.recordQualityReview({ reportId: review.report.reportId, verdict: review.report.verdict });
      session.requestQualityRework();
      session.advance('review');
    }
    const third = await runReviewStep({
      bookRoot: dir,
      chapterIndex: 2,
      receiptId: 'rcpt_limit',
      reviewer: { providerId: 'bench', model: 'journey', recipeVersion: '0.1.0' },
      policy: JOURNEY_POLICY,
    });
    session.recordQualityReview({ reportId: third.report.reportId, verdict: third.report.verdict });
    expect(() => session.requestQualityRework()).toThrowError(QualityReworkLimitExceededError);
  });
});
