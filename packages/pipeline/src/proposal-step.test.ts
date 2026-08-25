/**
 * Canon Proposal 步黑盒（T18 · #42）：riskClass 三档分流各一路 / 分流判据数据化
 * （继承/恒档/最高位）各一用例 / 提案记录落盘可回读（跨重启凭据）/
 * CanonProposalCreated 落账。零时钟零外部服务。
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newUlid } from '@mozhou/kernel';
import { PublishBus, readLedger } from '@mozhou/runtime';
import { LocalDataPlane, RUNTIME_PROPOSALS_DIR, createBook } from '@mozhou/data-plane';
import { createCanonProposal, loadCanonProposal, listCanonProposals } from './proposal-step.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

const NOW = '2026-08-25T00:00:00.000Z';

function factRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'fact_' + newUlid(),
    bookId: 'book_' + newUlid(),
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
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
  return {
    id: 'knst_' + newUlid(),
    bookId: 'book_' + newUlid(),
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    factId: 'fact_' + newUlid(),
    holder: 'reader',
    knownSinceChapter: 2,
    ...overrides,
  };
}

function relsRow(): Record<string, unknown> {
  return {
    id: 'rels_' + newUlid(),
    bookId: 'book_' + newUlid(),
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    entityA: 'char:linwan',
    entityB: 'char:ahei',
    relationshipType: '盟友',
    affinityScore: 20,
    validFrom: 2,
    validUntil: null,
    sourceChapterIndex: 2,
  };
}

function tleRow(order: number, impactFactIds: string[]): Record<string, unknown> {
  return {
    id: 'tle_' + newUlid(),
    bookId: 'book_' + newUlid(),
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    worldTimeLabel: '第三日',
    worldTimeOrder: order,
    chapterIndex: 2,
    participants: ['char:linwan'],
    summary: '启程',
    impactFactIds,
  };
}

function promiseRow(status: string): Record<string, unknown> {
  return { id: 'prom_' + newUlid(), status, description: '三日后比武' };
}

function newBook(): { root: string; plane: LocalDataPlane } {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-t18-proposal-'));
  roots.push(dir);
  createBook({ dir, title: '提案之书' });
  const plane = LocalDataPlane.open(dir);
  plane.createChapterDraft({ chapterIndex: 2, title: '第二章' });
  return { root: dir, plane };
}

describe('Canon Proposal 步', () => {
  it('riskClass 三档分流各一路：low 自动确认，medium/high 挂起待决', () => {
    const { root } = newBook();
    const secret = factRow({ predicate: 'secret.identity', riskClass: 'high' });
    const outcome = createCanonProposal({
      bus: new PublishBus(),
      bookRoot: root,
      taskRef: 'tsk_t18_proposal',
      chapterIndex: 2,
      delta: {
        temporalFact: [factRow({ riskClass: 'low' }), secret],
        relationshipState: [relsRow()],
      },
    });

    expect(outcome.routed).toEqual({ low: 1, medium: 1, high: 1 });

    const lowItem = outcome.items.find((item) => item.family === 'temporalFact' && item.riskClass === 'low');
    expect(lowItem?.state).toBe('confirmed'); // low 自动落 canon（入场即确认）
    expect(lowItem?.routingBasis).toContain('自带档位');

    const mediumItem = outcome.items.find((item) => item.family === 'relationshipState');
    expect(mediumItem?.state).toBe('pending');
    expect(mediumItem?.routingBasis).toContain('关系变动');

    const highItem = outcome.items.find((item) => item.riskClass === 'high');
    expect(highItem?.state).toBe('pending'); // high 必须显式确认方可进入 Commit
    expect(highItem?.itemId).toBe('temporalFact#1');
  });

  it('继承判据：knowledgeState 继承被引事实档位；timelineEvent 取引用最高位；无引用即 low', () => {
    const { root } = newBook();
    const lowFact = factRow({ riskClass: 'low' });
    const highSecret = factRow({ predicate: 'secret.origin', riskClass: 'high' });
    const outcome = createCanonProposal({
      bus: new PublishBus(),
      bookRoot: root,
      taskRef: 'tsk_t18_proposal',
      chapterIndex: 2,
      delta: {
        temporalFact: [lowFact, highSecret],
        knowledgeState: [ksRow({ factId: highSecret['id'] as string })],
        timelineEvent: [tleRow(3, [highSecret['id'] as string]), tleRow(4, [])],
      },
    });

    const ksItem = outcome.items.find((item) => item.family === 'knowledgeState');
    expect(ksItem?.riskClass).toBe('high');
    expect(ksItem?.state).toBe('pending');

    const tleHigh = outcome.items.find((item) => item.itemId === 'timelineEvent#0');
    expect(tleHigh?.riskClass).toBe('high');

    const tleNoRefs = outcome.items.find((item) => item.itemId === 'timelineEvent#1');
    expect(tleNoRefs?.riskClass).toBe('low');
    expect(tleNoRefs?.state).toBe('confirmed'); // 无引用时间线自动落 canon
  });

  it('narrativePromise：paid_off 即 high，introduced 与状态不可读一律 medium', () => {
    const { root } = newBook();
    const outcome = createCanonProposal({
      bus: new PublishBus(),
      bookRoot: root,
      taskRef: 'tsk_t18_proposal',
      chapterIndex: 2,
      delta: {
        narrativePromise: [promiseRow('paid_off'), promiseRow('introduced'), { note: '字节透传行没有 status' }],
      },
    });
    expect(outcome.routed).toEqual({ low: 0, medium: 2, high: 1 });
    const paidOff = outcome.items.find((item) => item.itemId === 'narrativePromise#0');
    expect(paidOff?.routingBasis).toContain('兑现');
    const opaque = outcome.items.find((item) => item.itemId === 'narrativePromise#2');
    expect(opaque?.riskClass).toBe('medium');
  });

  it('提案记录持久化于 .mozhou/proposals/ 且可回读逐字段一致（跨重启凭据）', () => {
    const { root } = newBook();
    const outcome = createCanonProposal({
      bus: new PublishBus(),
      bookRoot: root,
      taskRef: 'tsk_t18_proposal',
      chapterIndex: 2,
      delta: { temporalFact: [factRow()], narrativePromise: [promiseRow('due')] },
    });

    expect(existsSync(join(root, RUNTIME_PROPOSALS_DIR))).toBe(true);
    expect(readdirSync(join(root, RUNTIME_PROPOSALS_DIR))).toHaveLength(1);

    const reloaded = loadCanonProposal(root, outcome.proposalId);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.proposalVersion).toBe(1);
    expect(reloaded?.taskRef).toBe('tsk_t18_proposal');
    expect(reloaded?.items).toEqual(outcome.items); // 候选行随记录落盘——重启后确认仍拿得到全量载荷
    expect(listCanonProposals(root)).toHaveLength(1);
  });

  it('CanonProposalCreated 落账携带 proposalId 与分流计数（成对头待 Commit 闭合）', () => {
    const { root } = newBook();
    const outcome = createCanonProposal({
      bus: new PublishBus(),
      bookRoot: root,
      taskRef: 'tsk_t18_proposal',
      chapterIndex: 2,
      delta: { temporalFact: [factRow()] },
    });
    const event = readLedger({ root })
      .map((row) => row.event)
      .find((event) => event.type === 'CanonProposalCreated');
    expect(event?.taskRef).toBe('tsk_t18_proposal');
    expect(event?.payload?.['proposalId']).toBe(outcome.proposalId);
    expect(event?.payload?.['routed']).toEqual({ low: 1, medium: 0, high: 0 });
    expect(event?.payload?.['pendingItems']).toBe(0);
  });

  it('分流判据数据缺失宁败不猜：fact 行 riskClass 非法即抛 ProposalRoutingError', () => {
    const { root } = newBook();
    expect(() =>
      createCanonProposal({
        bus: new PublishBus(),
        bookRoot: root,
        taskRef: 'tsk_t18_proposal',
        chapterIndex: 2,
        delta: { temporalFact: [{ id: 'fact_x', riskClass: 'urgent' }] },
      }),
    ).toThrow(/riskClass/);
    // 抛错前零盘面残留
    expect(existsSync(join(root, RUNTIME_PROPOSALS_DIR))).toBe(false);
  });
});
