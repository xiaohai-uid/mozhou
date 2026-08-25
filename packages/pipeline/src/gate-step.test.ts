/**
 * Continuity Gate 步黑盒（T18 · #42）：四项机械核检各有触发用例 /
 * hardConflicts 形状断言 / 旁路建议不入判定不入账 / Gate Result 随步进事件进账。
 * 全部为既有实现的调用组合验证；零时钟零外部服务。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newUlid } from '@mozhou/kernel';
import { PublishBus, readLedger } from '@mozhou/runtime';
import { LocalDataPlane, createBook } from '@mozhou/data-plane';
import type { CandidateDeltaBatch } from './extract-step.js';
import { runContinuityGate } from './gate-step.js';
import { ChapterProductionSession } from './session.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

const NOW = '2026-08-25T00:00:00.000Z';

function head(prefix: string): Record<string, unknown> {
  return { id: prefix + '_' + newUlid(), bookId: 'book_' + newUlid(), revision: 0, createdAt: NOW, updatedAt: NOW };
}

function factRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

function ksRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...head('knst'), factId: 'fact_' + newUlid(), holder: 'reader', knownSinceChapter: 2, ...overrides };
}

function relsRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...head('rels'),
    entityA: 'char:linwan',
    entityB: 'char:ahei',
    relationshipType: '盟友',
    affinityScore: 20,
    validFrom: 2,
    validUntil: null,
    sourceChapterIndex: 2,
    ...overrides,
  };
}

function tleRow(order: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...head('tle'),
    worldTimeLabel: '第三日',
    worldTimeOrder: order,
    chapterIndex: 2,
    participants: ['char:linwan'],
    summary: '启程',
    impactFactIds: [],
    ...overrides,
  };
}

function greenBatch(): CandidateDeltaBatch {
  const fact = factRow();
  return {
    temporalFact: [fact],
    knowledgeState: [ksRow({ factId: fact.id as string })],
    relationshipState: [relsRow()],
    narrativePromise: [{ id: 'prom_' + newUlid(), status: 'introduced' }],
    timelineEvent: [tleRow(3, { impactFactIds: [fact.id as string] })],
  };
}

function newBook(chapterIndexes: number[] = [2]): { root: string; plane: LocalDataPlane } {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-t18-gate-'));
  roots.push(dir);
  createBook({ dir, title: '门禁之书' });
  const plane = LocalDataPlane.open(dir);
  for (const index of chapterIndexes) {
    plane.createChapterDraft({ chapterIndex: index, title: '第' + index + '章' });
  }
  return { root: dir, plane };
}

describe('Continuity Gate 步', () => {
  it('全绿批：五族候选过四项核检零冲突（pass）', () => {
    const { root } = newBook();
    const outcome = runContinuityGate({ bookRoot: root, chapterIndex: 2, delta: greenBatch() });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.hardConflicts).toEqual([]);
    expect(outcome.checked.batch.temporalFact).toBe(1);
    expect(outcome.checked.liveFacts).toBe(0);
  });

  it('四族行校验触发：secret.* ∧ riskClass≠high 同现律违例被收集，hardConflicts 形状冻结', () => {
    const { root } = newBook();
    const badFact = factRow({ predicate: 'secret.identity', riskClass: 'low' });
    const outcome = runContinuityGate({
      bookRoot: root,
      chapterIndex: 2,
      delta: { temporalFact: [badFact] },
    });
    expect(outcome.verdict).toBe('hard_conflict');
    expect(outcome.hardConflicts).toHaveLength(1);
    const conflict = outcome.hardConflicts[0];
    if (!conflict) throw new Error('expected a conflict');
    // 冻结形状：{factId, assertion, suggestion} 三字段全 string
    expect(Object.keys(conflict).sort()).toEqual(['assertion', 'factId', 'suggestion']);
    expect(typeof conflict.factId).toBe('string');
    expect(typeof conflict.assertion).toBe('string');
    expect(typeof conflict.suggestion).toBe('string');
    expect(conflict.factId).toBe(badFact['id']);
    expect(conflict.assertion).toContain("riskClass");
  });

  it('无 id 的形状坏行以 <family>#<index> 兜底定位（宁败不猜 id）', () => {
    const { root } = newBook();
    const outcome = runContinuityGate({
      bookRoot: root,
      chapterIndex: 2,
      delta: { relationshipState: [{ entityA: 'char:x' }] },
    });
    expect(outcome.hardConflicts[0]?.factId).toBe('relationshipState#0');
  });

  it('dependency 引用完整性：认知行悬空 factId 与时间线悬空 impactFactIds 各记一冲突', () => {
    const { root } = newBook();
    const danglingKs = ksRow({ factId: 'fact_' + newUlid() });
    const danglingTle = tleRow(1, { impactFactIds: ['fact_' + newUlid()] });
    const outcome = runContinuityGate({
      bookRoot: root,
      chapterIndex: 2,
      delta: { knowledgeState: [danglingKs], timelineEvent: [danglingTle] },
    });
    expect(outcome.verdict).toBe('hard_conflict');
    expect(outcome.hardConflicts.map((conflict) => conflict.factId)).toEqual([danglingKs['id'], danglingTle['id']]);
  });

  it('M2 时间线单调：新序数不严格大于存量活跃最大值即冲突（含批内乱序）', () => {
    const { root, plane } = newBook([1, 2]);
    plane.commitChapter({
      chapterIndex: 1,
      summary: 'seed',
      finalProse: '# 第一章\n\n定稿。\n',
      appends: { timelineEvent: [tleRow(5)] },
    });
    const equalMax = runContinuityGate({
      bookRoot: root,
      chapterIndex: 2,
      delta: { timelineEvent: [tleRow(5)] },
    });
    expect(equalMax.hardConflicts[0]?.assertion).toContain('strictly increasing');

    const intraBatchDisorder = runContinuityGate({
      bookRoot: root,
      chapterIndex: 2,
      delta: { timelineEvent: [tleRow(7), tleRow(6)] },
    });
    expect(intraBatchDisorder.hardConflicts.length).toBeGreaterThanOrEqual(1);

    const increasing = runContinuityGate({
      bookRoot: root,
      chapterIndex: 2,
      delta: { timelineEvent: [tleRow(6), tleRow(7)] },
    });
    expect(increasing.verdict).toBe('pass');
  });

  it('POV 秘密零泄漏：无授权认知行的候选秘密即冲突；reader/char 授权行配对后 pass', () => {
    const { root } = newBook();

    const orphaned = runContinuityGate({
      bookRoot: root,
      chapterIndex: 2,
      delta: { temporalFact: [factRow({ predicate: 'secret.identity', riskClass: 'high' })] },
    });
    expect(orphaned.verdict).toBe('hard_conflict');
    expect(orphaned.hardConflicts[0]?.assertion).toContain('secret');

    const readerPaired = factRow({ predicate: 'secret.identity', riskClass: 'high' });
    const viaReader = runContinuityGate({
      bookRoot: root,
      chapterIndex: 2,
      delta: {
        temporalFact: [readerPaired],
        knowledgeState: [ksRow({ factId: readerPaired['id'] as string, holder: 'reader', knownSinceChapter: 2 })],
      },
    });
    expect(viaReader.verdict).toBe('pass');

    const charPaired = factRow({ predicate: 'secret.bloodline', riskClass: 'high' });
    const viaChar = runContinuityGate({
      bookRoot: root,
      chapterIndex: 2,
      delta: {
        temporalFact: [charPaired],
        knowledgeState: [
          ksRow({ factId: charPaired['id'] as string, holder: 'char:ahei', knownSinceChapter: 2 }),
        ],
      },
    });
    expect(viaChar.verdict).toBe('pass');

    const lateDisclosure = factRow({ predicate: 'secret.origin', riskClass: 'high' });
    const futureKs = runContinuityGate({
      bookRoot: root,
      chapterIndex: 2,
      delta: {
        temporalFact: [lateDisclosure],
        knowledgeState: [ksRow({ factId: lateDisclosure['id'] as string, knownSinceChapter: 3 })],
      },
    });
    expect(futureKs.verdict).toBe('hard_conflict');
  });

  it('LLM 审查只许旁路建议：不改判定、不落账（死事件无通道）', () => {
    const { root } = newBook();
    const before = readLedger({ root }).length;
    const outcome = runContinuityGate({
      bookRoot: root,
      chapterIndex: 2,
      delta: { temporalFact: [factRow({ predicate: 'secret.identity', riskClass: 'low' })] },
      advisoryReviewer: ({ delta }) => [
        { targetId: String(delta.temporalFact?.[0] && (delta.temporalFact[0] as Record<string, unknown>)['id']), note: '建议复核该秘密的披露时机' },
      ],
    });
    // 旁路结论原样透传……
    expect(outcome.advisory).toHaveLength(1);
    expect(outcome.advisory[0]?.note).toContain('披露时机');
    // ……但绝不入判定：机械冲突照旧 hard_conflict
    expect(outcome.verdict).toBe('hard_conflict');
    expect(outcome.hardConflicts).toHaveLength(1);
    // 且绝不落账：账本零新增行
    expect(readLedger({ root }).length).toBe(before);
  });

  it('Gate Result 字段随 TaskStepTransitioned(gate) 进账（§1 表第 7 行）', () => {
    const { root } = newBook();
    const session = ChapterProductionSession.start({
      bus: new PublishBus(),
      root,
      chapterIndex: 2,
      newTaskRef: () => 'tsk_t18_gate',
    });
    session.advance('compile');
    session.advance('draft');
    session.advance('review');
    session.advance('user_edit');
    session.advance('final_extract');

    const gateOutcome = runContinuityGate({
      bookRoot: root,
      chapterIndex: 2,
      delta: greenBatch(),
    });
    session.advance('continuity_gate', {
      verdict: gateOutcome.verdict,
      hardConflicts: gateOutcome.hardConflicts,
    });

    const transition = readLedger({ root })
      .map((row) => row.event)
      .filter((event) => event.type === 'TaskStepTransitioned')
      .at(-1);
    expect(transition?.payload?.['to']).toBe('continuity_gate');
    expect(transition?.payload?.['verdict']).toBe('pass');
    expect(transition?.payload?.['hardConflicts']).toEqual([]);
    expect(session.currentStep).toBe('continuity_gate');
  });
});
