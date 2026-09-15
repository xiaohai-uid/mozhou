/**
 * S8 九边界崩溃恢复矩阵（T19 · #43；规格 §3 表逐行机械测试，一行一 it 组）：
 * Prepare 后幂等重跑 / Compile 后 receiptId 续 / Draft 中 partial 半稿持久 /
 * Review·Edit 缓冲即时落盘 / Extract 后可重跑提取 / Gate 后幂等重算 /
 * Proposal 后悬挂待决跨重启 / Commit 后按 T3 双向恢复语义（既有实现上补黑盒
 * 断言）/ Record 后 FlywheelRecorded 与 Commit 同事务序 + usage 异步可回灌。
 * 零时钟零外部服务：手工行 id + 注入时钟/凭证；恢复判定读盘两次独立运行逐字段相等。
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newUlid } from '@mozhou/kernel';
import type { BookId, ContextReceiptId, EntityRef } from '@mozhou/kernel';
import { PublishBus, RuntimeEngine } from '@mozhou/runtime';
import type { CapabilityRecipe } from '@mozhou/runtime';
import type { ContextPacket } from '@mozhou/context-compiler';
import {
  LocalDataPlane,
  RUNTIME_EVENTS_PATH,
  createBook,
  openDatabase,
  proseChapterPath,
  readManifest,
  readNarrativeSnapshot,
  readProseChapter,
  createEntityCard,
  recoverPendingCommit,
  scanEntityCards,
} from '@mozhou/data-plane';
import {
  ChapterProductionSession,
  ProposalPort,
  backfillDerivedUsage,
  createCanonProposal,
  listPendingProposalRefs,
  loadCanonProposal,
  loadDraftForReview,
  loadReceiptForResume,
  makeDraftProviderBinding,
  prepareChapterInputs,
  projectSession,
  readDraftCandidate,
  readDraftState,
  readPipelineLedger,
  readUsageProjection,
  recordUserEdit,
  runCompileStep,
  runContinuityGate,
  runFinalExtract,
  runFlywheelRecord,
  runDraftStep,
} from './index.js';
let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ } }
  roots = [];
});

const NOW = '2026-08-27T00:00:00.000Z';
const LIN = 'char:linwan' as EntityRef;
const charTok = { version: 'fake-char-v1', count: (text: string): number => text.length };
const RECEIPT_ID = 'rcpt_' + '7'.repeat(26) as unknown as ContextReceiptId;

function mk(prefix: string, withChapter = true): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  createBook({ dir, title: '九边界之书' });
  if (withChapter) LocalDataPlane.open(dir).createChapterDraft({ chapterIndex: 2, title: '第二章' });
  return dir;
}

function bookIdOf(root: string): BookId {
  return (JSON.parse(readFileSync(join(root, 'book.json'), 'utf8')) as { id: BookId }).id;
}

function head(prefix: string): Record<string, unknown> {
  return { id: prefix + '_' + newUlid(), bookId: 'book_' + newUlid(), revision: 0, createdAt: NOW, updatedAt: NOW };
}

/** Gate 全绿形状的候选行（沿 T18 夹具）：low 定位事实 + 引用它的本批时间线行。 */
function greenDelta(): Record<string, unknown[]> {
  const located: Record<string, unknown> = {
    ...head('fact'),
    subject: LIN,
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
    temporalFact: [located],
    timelineEvent: [
      {
        ...head('tle'),
        worldTimeLabel: '第三日拂晓',
        worldTimeOrder: 9,
        chapterIndex: 2,
        participants: [LIN],
        summary: '林晚登舟北上',
        impactFactIds: [located['id']],
      },
    ],
  };
}

/* 行 1｜Prepare 后：幂等重跑（纯查询） */
describe('S8 行1 Prepare 后：幂等重跑', () => {
  it('同输入重复折叠逐字段相等，且账本零增长（纯查询不落盘）', () => {
    const dir = mk('mozhou-nb1-');
    const first = prepareChapterInputs(dir, 2);
    const ledgerBefore = readPipelineLedger(dir).length;
    const second = prepareChapterInputs(dir, 2);
    expect(second).toEqual(first); // 幂等：两次独立运行逐字段相等
    expect(readPipelineLedger(dir)).toHaveLength(ledgerBefore); // 零副作用
  });
});

/* 行 2｜Compile 后：按 receiptId 续（Receipt 已落盘，INV-R1/R2） */
describe('S8 行2 Compile 后：receiptId 续跑', () => {
  it('指针在即凭证在：崩溃后 resume 光标回 compile，loadReceiptForResume 两次独立取回逐字段相等且不重编译', async () => {
    const dir = mk('mozhou-nb2-');
    // 一张实体卡喂召回通道（空召回被 compile 拒绝——宁败不静默，T10a AC3）
    const ctx = { root: dir, db: openDatabase({ path: join(dir, '.mozhou', 'runtime.sqlite') }), manifest: readManifest(dir) };
    createEntityCard(ctx, LIN, {
      name: '林晚',
      aiContext: 'detected',
      aliases: [{ text: '枫儿', kind: 'exact' }], // 别名命中 draftText 关键词通道
      brief: '墨舟主人',
    });
    ctx.db.close();
    const bus = new PublishBus();
    const session = ChapterProductionSession.start({ bus, root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_nb2' });
    session.advance('compile');

    const outcome = await runCompileStep(prepareChapterInputs(dir, 2), {
      bookRoot: dir,
      bookId: bookIdOf(dir),
      draftText: '枫儿练剑。',
      cards: scanEntityCards(dir),
      snapshot: readNarrativeSnapshot(dir),
      scope: { chapterIndex: 2, pov: 'protagonist' },
      modelProfile: { id: 'nb-model', contextWindow: 4096 },
      tokenizer: charTok,
      receiptId: RECEIPT_ID,
      nowIso: NOW,
    });

    // 投影窗口内指针已记录（先证后指针 ⇒ 指针存在即凭证必在盘上）
    expect(projectSession(readPipelineLedger(dir), 2).lastReceiptId).toBe(RECEIPT_ID);

    // 崩溃恢复：折叠账本重建内存态会话，光标停在 compile；按 receiptId 从盘取回产物
    const resumed = ChapterProductionSession.resume({ bus, root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_nb2b' });
    expect(resumed?.currentStep).toBe('compile');
    const firstLoad = loadReceiptForResume(dir, RECEIPT_ID);
    const secondLoad = loadReceiptForResume(dir, RECEIPT_ID);
    expect(firstLoad).toEqual(outcome.receipt); // 不重编译、产物一致
    expect(secondLoad).toEqual(firstLoad); // 两次独立运行逐字段相等

    resumed?.advance('draft'); // 续走后继步
    expect(resumed?.currentStep).toBe('draft');
  });
});

/* 行 3｜Draft 中：partial 半稿持久保留（每章落盘即持久） */
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
  source: { repo: 'original', commit: '0'.repeat(40), license: 'original', refinedAt: '2026-08-25', refineNote: '九边界夹具' },
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

function failingStreamEngine(root: string): { engine: RuntimeEngine; candidateId: string } {
  const engine = new RuntimeEngine({ bus: new PublishBus(), ctx: { root }, newTaskRef: () => 'gen_nb3' });
  engine.registerCapability({
    taskType: 'CHAPTER_DRAFTING',
    providerId: 'deepseek',
    providerVersion: '1.0.0',
    failurePolicy: { timeoutMs: 5000, fallbackProviderIds: [] },
  });
  async function* stream(): AsyncIterable<string> {
    await Promise.resolve();
    yield '半稿第一段。';
    throw new Error('传输中断（模拟断流）');
  }
  const candidateId = 'c0000000-0000-4000-8000-000000000001';
  const plane = LocalDataPlane.open(root);
  try {
    const scan = plane.getProseChapter(2);
    const candidate = {
      id: candidateId,
      operationId: 'op_nb3',
      bookId: 'book-nb3',
      base: {
        revision: scan.revision,
        sha256: createHash('sha256').update(readFileSync(join(root, proseChapterPath(2)))).digest('hex'),
      },
      mode: 'replace' as const,
    };
    engine.registerProviderBinding(
      'deepseek',
      makeDraftProviderBinding({ bookRoot: root, chapterIndex: 2, provider: 'deepseek', mode: 'generate', stream: () => stream(), candidate }),
    );
    return { engine, candidateId };
  } finally {
    plane.close();
  }
}

describe('S8 行3 Draft 中：partial 半稿持久（候选语义）', () => {
  it('断流后半稿留在候选文件、状态文件标 partial；跨重启重读两次独立运行逐字段相等', async () => {
    const dir = mk('mozhou-nb3-');
    const ctx = failingStreamEngine(dir);
    const outcome = await runDraftStep({
      engine: ctx.engine,
      bookRoot: dir,
      chapterIndex: 2,
      packet: PACKET,
      recipe: RECIPE,
    });
    // 断流经 T13 归一化 + fallback 链收口为 failed_terminal 结果对象（半稿已落候选）
    expect(outcome.outcome).toBe('failed_terminal');
    expect(outcome.partial).toBe(true);
    expect(outcome.reason).toContain('传输中断');

    // 半稿持久保留于候选文件；正文保持原样（C2/I01）
    expect(readFileSync(join(dir, proseChapterPath(2)), 'utf8')).not.toContain('半稿第一段。');
    const halfCandidate = readDraftCandidate(dir, ctx.candidateId);
    expect(halfCandidate?.status).toBe('partial');
    expect(halfCandidate?.text).toContain('半稿第一段。');
    // 运行态文件标 partial（无时间戳，零时钟纪律）
    const state = readDraftState(dir, 2);
    expect(state?.status).toBe('partial');
    // 「重启」= 全新读盘：两次独立运行逐字段相等
    expect(readDraftState(dir, 2)).toEqual(state);
  });
});

/* 行 4｜Review/Edit 中：编辑缓冲即时落正文文件 */
describe('S8 行4 Review·Edit 中：缓冲即时落盘', () => {
  it('recordUserEdit 返回即已落盘：正文文件与 Review 读路径看到同一份最新真相', () => {
    const dir = mk('mozhou-nb4-');
    const outcome = recordUserEdit({
      bus: new PublishBus(),
      bookRoot: dir,
      taskRef: 'tsk_nb4',
      chapterIndex: 2,
      level: 'selection',
      source: 'author',
      blocks: [{ op: 'replace', paragraphStart: 1, paragraphEnd: 1, replacementText: '作者润色后的定稿段。' }],
    });
    expect(outcome.revisionAfter).toBe(1);
    // 无任何后续步骤参与——缓冲此刻已在盘上
    expect(readFileSync(join(dir, proseChapterPath(2)), 'utf8')).toContain('作者润色后的定稿段。');
    expect(loadDraftForReview(dir, 2).body).toContain('作者润色后的定稿段。');
  });
});

/* 行 5｜Extract 后：候选丢失可接受——重跑提取 */
describe('S8 行5 Extract 后：可重跑提取', () => {
  it('同一提取缝连跑两次皆成功、计数相等，CandidateDeltaExtracted 两度进账（重跑合法）', () => {
    const dir = mk('mozhou-nb5-');
    let calls = 0;
    const runOnce = (): { status: string; counts: unknown } => {
      const outcome = runFinalExtract({
        bus: new PublishBus(),
        bookRoot: dir,
        taskRef: 'tsk_nb5',
        chapterIndex: 2,
        extract: () => {
          calls += 1;
          return greenDelta();
        },
      });
      return { status: outcome.status, counts: outcome.counts };
    };
    const firstRun = runOnce();
    const secondRun = runOnce();
    expect(firstRun.status).toBe('extracted');
    expect(secondRun.status).toBe('extracted');
    expect(secondRun.counts).toEqual(firstRun.counts); // 确定性重算
    expect(calls).toBe(2); // 重跑真的再次调用了提取缝
    const extractEvents = readPipelineLedger(dir)
      .map((row) => (row.kind === 'task' ? row.event.type : (row.row['type'] as string)))
      .filter((type) => type === 'CandidateDeltaExtracted');
    expect(extractEvents).toHaveLength(2); // 运行期驻留丢失可接受：重跑即重建
  });
});

/* 行 6｜Gate 后：确定性核检幂等重算 */
describe('S8 行6 Gate 后：幂等重算', () => {
  it('同输入两次核检 verdict/冲突清单/旁路建议/计数逐字段相等', () => {
    const dir = mk('mozhou-nb6-');
    const delta = greenDelta();
    const advisory = (): { targetId: string; note: string }[] => [{ targetId: 'advisory:nb6', note: '建议复核披露时机' }];
    const firstPass = runContinuityGate({ bookRoot: dir, chapterIndex: 2, delta, advisoryReviewer: advisory });
    const secondPass = runContinuityGate({ bookRoot: dir, chapterIndex: 2, delta, advisoryReviewer: advisory });
    expect(secondPass.verdict).toBe(firstPass.verdict);
    expect(secondPass.hardConflicts).toEqual(firstPass.hardConflicts);
    expect(secondPass.advisory).toEqual(firstPass.advisory);
    expect(secondPass.checked).toEqual(firstPass.checked);
    expect(firstPass.verdict).toBe('pass');
  });
});

/* 行 7｜Proposal 后：未确认提案悬挂标记跨重启保持待决 */
describe('S8 行7 Proposal 后：悬挂待决跨重启', () => {
  it('medium/high 待决项经「重启」仍被 listPendingProposalRefs 扫出；显式收口后面清空', () => {
    const dir = mk('mozhou-nb7-');
    const secret: Record<string, unknown> = {
      ...head('fact'),
      subject: LIN,
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
    const proposed = createCanonProposal({
      bus: new PublishBus(),
      bookRoot: dir,
      taskRef: 'tsk_nb7',
      chapterIndex: 2,
      delta: { temporalFact: [secret] },
    });
    expect(proposed.items.map((item) => item.state)).toEqual(['pending']); // high 挂起

    const ref = { port: 'pipeline', proposalId: proposed.proposalId } as const;
    expect(listPendingProposalRefs({ root: dir })).toEqual([ref]);
    // 「重启」：全新 deps 对象再扫——提案仓在盘上，状态机无内存依赖
    expect(listPendingProposalRefs({ root: dir })).toEqual([ref]);
    expect(loadCanonProposal(dir, proposed.proposalId)?.state).toBe('open');

    // 作者显式收口：待决面清空（恢复扫描不再报悬挂）
    new ProposalPort({ root: dir }).confirm(ref, 'temporalFact#0');
    expect(listPendingProposalRefs({ root: dir })).toEqual([]);
  });
});

/* 行 8｜Commit 后：T3 pending-commit 双向恢复（既有实现，不改——黑盒断言） */
describe('S8 行8 Commit 后：T3 双向恢复', () => {
  it('翻转前中断回滚（相位保持 draft、零正典痕迹）；翻转后中断前滚（正典化收尾）；两向终点日志清零', () => {
    // —— 向后：线性化点（prose-flip）之前崩 ⇒ 回滚 ——
    const backwardDir = mk('mozhou-nb8a-');
    try {
      LocalDataPlane.open(backwardDir).commitChapter({
        chapterIndex: 2,
        summary: '回滚向',
        finalProse: '回滚向正文。',
        onStage: (stage) => {
          if (stage === 'stream-append') throw new Error('模拟崩溃：翻转前');
        },
      });
    } catch {
      /* 崩溃注入即预期路径 */
    }
    recoverPendingCommit(backwardDir);
    expect(readProseChapter(backwardDir, proseChapterPath(2)).phase).toBe('draft'); // 相位未被翻转
    expect(readFileSync(join(backwardDir, RUNTIME_EVENTS_PATH), 'utf8')).not.toContain('"ChapterCommitted"');
    expect(() => LocalDataPlane.open(backwardDir)).not.toThrow(); // 日志已清，open 幂等

    // —— 向前：线性化点之后崩 ⇒ 前滚收尾 ——
    const forwardDir = mk('mozhou-nb8b-');
    try {
      LocalDataPlane.open(forwardDir).commitChapter({
        chapterIndex: 2,
        summary: '前滚向',
        finalProse: '前滚向正文。',
        onStage: (stage) => {
          if (stage === 'projection') throw new Error('模拟崩溃：翻转后');
        },
      });
    } catch {
      /* 崩溃注入即预期路径 */
    }
    recoverPendingCommit(forwardDir);
    const committed = readProseChapter(forwardDir, proseChapterPath(2));
    expect(committed.phase).toBe('committed'); // 正典化收尾完成
    expect(committed.commitId).toBeDefined();
    expect(committed.body).toContain('前滚向正文。');
    expect(readFileSync(join(forwardDir, RUNTIME_EVENTS_PATH), 'utf8')).toContain('"ChapterCommitted"');
    expect(() => recoverPendingCommit(forwardDir)).not.toThrow(); // 两向终点都删日志：幂等
    expect(() => LocalDataPlane.open(forwardDir)).not.toThrow();
  });
});

/* 行 9｜Record 后：与 Commit 同事务序 append；派生记账异步回灌 */
describe('S8 行9 Record 后：同事务序 + usage 可回灌', () => {
  it('FlywheelRecorded 紧随 CanonCommitted 同窗顺排进账；同步行落表，派生行凭 derivedFrom 异步回灌', () => {
    const dir = mk('mozhou-nb9-');
    const bus = new PublishBus();
    const session = ChapterProductionSession.start({ bus, root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_nb9' });
    for (const step of ['compile', 'draft', 'review', 'user_edit', 'final_extract', 'continuity_gate', 'canon_proposal'] as const) {
      if (step === 'user_edit') session.recordQualityReview({ reportId: 'rpt_nb9_pass', verdict: 'pass' });
      session.advance(step);
    }
    session.recordProposal({ proposalId: 'prp_nb9' }); // 成对头：CanonCommitted 的闭合前提
    session.advance('commit');
    session.markCommitted('cmt_nb9_1');
    session.advance('flywheel_record');
    const outcome = runFlywheelRecord({
      bus,
      bookRoot: dir,
      taskRef: 'tsk_nb9',
      chapterIndex: 2,
      commitId: 'cmt_nb9_1',
      usage: [{ kind: 'usage', provider: 'deepseek', model: 'nb-model', inputTokens: 11, outputTokens: 7 }],
      newEntryId: () => 'usg_nb9_sync',
      nowIso: NOW,
    });
    expect(outcome.status).toBe('succeeded');
    session.finish();

    // 同事务序：CanonCommitted → FlywheelRecorded → TaskFinished 同窗顺排（append-only 账面顺序）
    const types = readPipelineLedger(dir)
      .map((row) => (row.kind === 'task' ? row.event.type : (row.row['type'] as string)));
    expect(types.indexOf('CanonCommitted')).toBeLessThan(types.indexOf('FlywheelRecorded'));
    expect(types.indexOf('FlywheelRecorded')).toBeLessThan(types.indexOf('TaskFinished'));
    const projection = projectSession(readPipelineLedger(dir), 2);
    expect(projection.finished).toBe(true);
    expect(projection.openHeads).toEqual([]); // 成对约束全闭合

    // 同步侧 usage 已落投影表（entryId 先到先得去重的读侧）
    const sync = readUsageProjection(dir).find((row) => row.entryId === 'usg_nb9_sync');
    expect(sync).toMatchObject({ taskRef: 'tsk_nb9', commitId: 'cmt_nb9_1', kind: 'usage', derived: false, inputTokens: 11 });

    // §J.4 边界内：usage/cost 类派生记账异步回灌（derived 行必须带 derivedFrom）
    backfillDerivedUsage(dir, [
      {
        entryId: 'usg_nb9_derived',
        taskRef: 'tsk_nb9',
        chapterIndex: 2,
        commitId: 'cmt_nb9_1',
        kind: 'cost',
        derived: true,
        derivedFrom: 'usg_nb9_sync',
        costMicros: 3,
      },
    ]);
    const after = readUsageProjection(dir);
    expect(after.find((row) => row.entryId === 'usg_nb9_derived')).toMatchObject({ derived: true, derivedFrom: 'usg_nb9_sync' });
    expect(after.find((row) => row.entryId === 'usg_nb9_sync')).toBeDefined(); // 同步行原样在册（append-only）
  });
});

