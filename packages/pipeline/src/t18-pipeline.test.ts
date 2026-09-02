/**
 * T18 集成测试（#42）：Extract → Gate → Proposal → ProposalPort → Commit 挂进
 * ChapterProductionSession 十步步进机——五族候选提取、四项机械核检、riskClass
 * 分流、逐条确认收口、原子提交与成对约束闭合同账贯通。零时钟零外部服务。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newUlid } from '@mozhou/kernel';
import { PublishBus, readLedger } from '@mozhou/runtime';
import { LocalDataPlane, TRACKING_STREAMS, createBook } from '@mozhou/data-plane';
import {
  ChapterProductionSession,
  createCanonProposal,
  listPendingProposalRefs,
  loadDraftForReview,
  ProposalPort,
  recordUserEdit,
  runContinuityGate,
  runFinalExtract,
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


const NOW = '2026-08-25T00:00:00.000Z';
const FINAL_PROSE = '林晚踏上墨舟，甲板下压着一行谁也没读过的铭文——那是她的真名。\n\n风起，舟行北岸。';

function head(prefix: string): Record<string, unknown> {
  return { id: prefix + '_' + newUlid(), bookId: 'book_' + newUlid(), revision: 0, createdAt: NOW, updatedAt: NOW };
}

/** 五族候选夹具：秘密事实配 reader 披露行、时间线引用本批事实（Gate 全绿形状）。 */
function fixtureDelta(prose: string): Record<string, unknown[]> {
  void prose;
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
    knowledgeState: [
      {
        ...head('knst'),
        factId: secret['id'],
        holder: 'reader',
        knownSinceChapter: 2,
      },
    ],
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
    narrativePromise: [
      { id: 'prom_' + newUlid(), status: 'introduced', description: '铭文里的真名之秘' },
    ],
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

describe('T18 三步挂进十步状态机（Extract/Gate/Proposal × ProposalPort）', () => {
  it('终稿→提取→门禁→分流提案→逐条确认→原子提交：事件链同账闭合、追踪流入正典、提案收口', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-t18-flow-'));
    roots.push(dir);
    createBook({ dir, title: '集成之书' });
    const plane = LocalDataPlane.open(dir);
    plane.createChapterDraft({ chapterIndex: 2, title: '第二章' });

    const bus = new PublishBus();
    const session = ChapterProductionSession.start({
      bus,
      root: dir,
      chapterIndex: 2,
      newTaskRef: () => 'tsk_t18_flow',
    });
    session.advance('compile');
    session.advance('draft');

    // Review 步消费入口核对（draft 产物即核检输入）
    session.advance('review');
    expect(loadDraftForReview(dir, 2).body).toBeTruthy();
    session.recordQualityReview({ reportId: 'rpt_t18_pass', verdict: 'pass' });

    // 终稿落定（User Edit 步承载作者润色通道；正文文件即时持久）
    session.advance('user_edit');
    const editOutcome = recordUserEdit({
      bus,
      bookRoot: dir,
      taskRef: session.taskRef,
      chapterIndex: 2,
      level: 'selection',
      source: 'author',
      blocks: [{ op: 'replace', paragraphStart: 1, paragraphEnd: 1, replacementText: FINAL_PROSE }],
    });
    expect(editOutcome.revisionAfter).toBe(1);

    // Final Extract：终稿全文 → 五族候选（运行期驻留）
    let extractorSawProse = '';
    session.advance('final_extract');
    const extracted = runFinalExtract({
      bus,
      bookRoot: dir,
      taskRef: session.taskRef,
      chapterIndex: 2,
      extract: (input) => {
        extractorSawProse = input.prose;
        return fixtureDelta(input.prose);
      },
    });
    expect(extracted.status).toBe('extracted');
    expect(extractorSawProse).toContain('墨舟');
    expect(Object.values(extracted.counts).reduce((sum, count) => sum + count, 0)).toBe(6);

    // Continuity Gate：纯机械核检通过；Result 字段随步进事件进账
    const gated = runContinuityGate({
      bookRoot: dir,
      chapterIndex: 2,
      delta: extracted.batch ?? {},
      advisoryReviewer: () => [{ targetId: 'advisory:1', note: '建议复核披露时机' }],
    });
    expect(gated.verdict).toBe('pass');
    expect(gated.advisory).toHaveLength(1); // 旁路建议只透传
    session.advance('continuity_gate', { verdict: gated.verdict, hardConflicts: gated.hardConflicts });

    // Canon Proposal：三档分流——low 自动确认，medium/high 挂起
    session.advance('canon_proposal');
    const proposed = createCanonProposal({
      bus,
      bookRoot: dir,
      taskRef: session.taskRef,
      chapterIndex: 2,
      delta: extracted.batch ?? {},
    });
    // 分流明细：secret+knst(继承)双 high、关系+伏笔双 medium、located+时间线(引用 low)双 low
    expect(proposed.routed).toEqual({ low: 2, medium: 2, high: 2 });
    const pendingIds = proposed.items.filter((item) => item.state === 'pending').map((item) => item.itemId);
    expect(pendingIds).toEqual(['temporalFact#0', 'knowledgeState#0', 'relationshipState#0', 'narrativePromise#0']);

    // ProposalPort：high 显式确认、medium 程序化收口（headless 等价 panel）
    const port = new ProposalPort({ root: dir });
    const ref = { port: 'pipeline', proposalId: proposed.proposalId } as const;
    expect(listPendingProposalRefs({ root: dir })).toEqual([ref]);
    expect(port.confirm(ref, 'temporalFact#0').action).toBe('confirmed'); // high 秘密显式确认
    expect(port.confirm(ref, 'knowledgeState#0').finalized).toBe(false);
    expect(port.confirm(ref, 'relationshipState#0').finalized).toBe(false);
    expect(port.confirm(ref, 'narrativePromise#0').finalized).toBe(true);
    // 待决面清空（low 自动确认的两条从未进入待决面）；确认集整体喂 Commit
    expect(port.pendingItemsOf(ref)).toEqual([]);
    const appends = port.confirmedCanonicalRows(ref);
    expect(appends.temporalFact).toHaveLength(2);

    // Commit：唯一正典写入点——确认集整体追加 + 相位翻转 + 会话完成态
    // S10 步边界检查点：长持平面句柄在步边界重开，同步盘上最新基线（draft-step 编排方契约）
    const freshPlane = LocalDataPlane.open(dir);
    session.advance('commit');
    const result = freshPlane.commitChapter({
      chapterIndex: 2,
      summary: '第二章定稿',
      finalProse: FINAL_PROSE,
      appends,
    });
    session.markCommitted(result.commitId);

    // 提案收口 + Flywheel 收卷
    port.markConsumed(ref);
    session.advance('flywheel_record');
    session.finish();

    /* ---- 账面断言 ---- */
    const types = readLedger({ root: dir }).map((row) => row.event.type);
    expect(types).toEqual([
      'TaskStarted',
      'TaskStepTransitioned', // → compile
      'TaskStepTransitioned', // → draft
      'TaskStepTransitioned', // → review
      'QualityReviewCompleted', // ADR-0025：审查 pass 落账，放行前进口
      'TaskStepTransitioned', // → user_edit
      'UserEditRecorded',
      'TaskStepTransitioned', // → final_extract
      'CandidateDeltaExtracted',
      'TaskStepTransitioned', // → continuity_gate（携带 Result 字段）
      'TaskStepTransitioned', // → canon_proposal
      'CanonProposalCreated',
      'TaskStepTransitioned', // → commit
      'CanonCommitted',
      'TaskStepTransitioned', // → flywheel_record
      'TaskFinished',
    ]);

    // Gate Result 字段在账
    const gateEvent = readLedger({ root: dir })
      .map((row) => row.event)
      .find((event) => event.type === 'TaskStepTransitioned' && event.payload?.['to'] === 'continuity_gate');
    expect(gateEvent?.payload?.['verdict']).toBe('pass');

    // 成对约束全闭合（会话窗口/生成对/提案对无悬挂）
    expect(session.project().openHeads).toEqual([]);
    expect(session.isCompleted()).toBe(true);

    // 正典侧：五族增量已入追踪流，正文相位翻转
    expect(readFileSync(join(dir, TRACKING_STREAMS[0].path), 'utf8').trim().split('\n')).toHaveLength(2); // 两事实
    expect(readFileSync(join(dir, TRACKING_STREAMS[3].path), 'utf8').trim()).not.toBe(''); // 伏笔透传入流
    // 零泄漏读路径复核：秘密只对授权视角存在；protagonist 未获披露 ⇒ 与不存在不可区分
    const visibleToProtagonist = freshPlane
      .queryActiveFacts({ chapter: 2, pov: 'protagonist' })
      .map((fact) => fact.predicate);
    expect(visibleToProtagonist).toContain('located');
    expect(visibleToProtagonist).not.toContain('secret.true_name');

    // 提案仓：consumed 留档，恢复扫描不再报悬挂
    expect(listPendingProposalRefs({ root: dir })).toEqual([]);
  });

  it('Gate 硬冲突路径：hardConflicts[] 进 TaskStepTransitioned Result 字段（§1 表第 7 行）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-t18-conflict-'));
    roots.push(dir);
    createBook({ dir, title: '冲突之书' });
    LocalDataPlane.open(dir).createChapterDraft({ chapterIndex: 2, title: '第二章' });

    const bus = new PublishBus();
    const session = ChapterProductionSession.start({
      bus,
      root: dir,
      chapterIndex: 2,
      newTaskRef: () => 'tsk_t18_conflict',
    });
    for (const step of ['compile', 'draft', 'review', 'user_edit', 'final_extract'] as const) {
      if (step === 'user_edit') session.recordQualityReview({ reportId: 'rpt_t18_conflict', verdict: 'pass' });
      session.advance(step);
    }

    const orphanSecret = {
      ...head('fact'),
      subject: 'char:linwan',
      predicate: 'secret.unpaired',
      value: '无人知晓',
      validFrom: 2,
      validUntil: null,
      importance: 'critical',
      riskClass: 'high',
      source: { kind: 'chapter', chapterIndex: 2 },
      status: 'candidate',
      compactedIntoVolumeId: null,
      provenance: { origin: 'ai', protectedUserContent: false },
    };
    const gated = runContinuityGate({
      bookRoot: dir,
      chapterIndex: 2,
      delta: { temporalFact: [orphanSecret] },
      prose: FINAL_PROSE,
    });
    expect(gated.verdict).toBe('hard_conflict');
    expect(gated.hardConflicts[0]?.assertion).toContain('secret.unpaired');

    // 冲突清单随步进事件 Result 字段进账（回炉重走由作者显式驱动，V1 只记账）
    session.advance('continuity_gate', { verdict: gated.verdict, hardConflicts: gated.hardConflicts });
    const transition = readLedger({ root: dir })
      .map((row) => row.event)
      .filter((event) => event.type === 'TaskStepTransitioned')
      .at(-1);
    expect(transition?.payload?.['verdict']).toBe('hard_conflict');
    expect(Array.isArray(transition?.payload?.['hardConflicts'])).toBe(true);
  });
});
