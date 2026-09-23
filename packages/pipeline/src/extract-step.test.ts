/**
 * Final Extract 步黑盒（T18 · #42）：五族提取夹具各 ≥1 / 提取失败 failed_recoverable
 * 可重试 / 候选运行期驻留不落正典（追踪流零字节触碰）。零时钟零外部服务。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newUlid } from '@mozhou/kernel';
import { PublishBus, readLedger } from '@mozhou/runtime';
import { LocalDataPlane, TRACKING_STREAMS, createBook } from '@mozhou/data-plane';
import { ChapterPhaseError } from '@mozhou/data-plane';
import { runFinalExtract } from './extract-step.js';
import type { CandidateDeltaBatch } from './extract-step.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ } }
  roots = [];
});

function newBook(chapterIndex = 2): { root: string; plane: LocalDataPlane } {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-t18-extract-'));
  roots.push(dir);
  createBook({ dir, title: '提取之书' });
  const plane = LocalDataPlane.open(dir);
  plane.createChapterDraft({ chapterIndex, title: '第' + chapterIndex + '章' });
  return { root: dir, plane };
}

function factRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = '2026-08-25T00:00:00.000Z';
  return {
    id: 'fact_' + newUlid(),
    bookId: 'book_' + newUlid(),
    revision: 0,
    createdAt: now,
    updatedAt: now,
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

function fiveFamilyBatch(): CandidateDeltaBatch {
  return {
    temporalFact: [factRow()],
    knowledgeState: [{ id: 'knst_' + newUlid(), factId: 'fact_x', holder: 'reader', knownSinceChapter: 2 }],
    relationshipState: [{ id: 'rels_' + newUlid(), entityA: 'char:a', entityB: 'char:b', affinityScore: 10 }],
    narrativePromise: [{ id: 'prom_' + newUlid(), status: 'introduced' }],
    timelineEvent: [{ id: 'tle_' + newUlid(), worldTimeOrder: 1 }],
  };
}

type LedgerEvent = ReturnType<typeof readLedger>[number]['event'];

function eventsOf(root: string): LedgerEvent[] {
  return readLedger({ root }).map((row) => row.event);
}

describe('Final Extract 步', () => {
  it('五族夹具各 ≥1：候选运行期驻留返回、计数入账、追踪流零字节触碰', () => {
    const { root } = newBook();
    const outcome = runFinalExtract({
      bus: new PublishBus(),
      bookRoot: root,
      taskRef: 'tsk_t18_extract',
      chapterIndex: 2,
      extract: () => fiveFamilyBatch(),
    });

    expect(outcome.status).toBe('extracted');
    expect(outcome.batch).not.toBeNull();
    expect(Object.keys(outcome.batch ?? {})).toHaveLength(5);
    for (const family of ['temporalFact', 'knowledgeState', 'relationshipState', 'narrativePromise', 'timelineEvent'] as const) {
      expect(outcome.counts[family]).toBe(1);
    }

    const event = eventsOf(root).find((event) => event.type === 'CandidateDeltaExtracted');
    expect(event).toBeDefined();
    expect(event?.taskRef).toBe('tsk_t18_extract');
    expect(event?.payload?.['outcome']).toBe('extracted');
    expect(event?.payload?.['counts']).toEqual(outcome.counts);

    // 运行期驻留不落正典：五族追踪流保持 createBook 的空流原样
    for (const stream of TRACKING_STREAMS) {
      expect(readFileSync(join(root, stream.path), 'utf8')).toBe('');
    }
  });

  it('提取缝抛错 = failed_recoverable 上报，重跑同一步即重试成功', () => {
    const { root } = newBook();
    let attempts = 0;
    const failingThenOk = (): CandidateDeltaBatch => {
      attempts += 1;
      if (attempts === 1) throw new Error('provider unavailable (fixture)');
      return fiveFamilyBatch();
    };

    const first = runFinalExtract({
      bus: new PublishBus(),
      bookRoot: root,
      taskRef: 'tsk_t18_extract',
      chapterIndex: 2,
      extract: failingThenOk,
    });
    expect(first.status).toBe('failed_recoverable');
    expect(first.batch).toBeNull();
    expect(first.errorDetail).toContain('provider unavailable');
    expect(eventsOf(root).at(-1)?.payload?.['outcome']).toBe('failed_recoverable');

    const retried = runFinalExtract({
      bus: new PublishBus(),
      bookRoot: root,
      taskRef: 'tsk_t18_extract',
      chapterIndex: 2,
      extract: failingThenOk,
    });
    expect(retried.status).toBe('extracted');
    expect(attempts).toBe(2);
  });

  it('批形状违例（行不是对象）= 提取失败 failed_recoverable，宁败不猜', () => {
    const { root } = newBook();
    const outcome = runFinalExtract({
      bus: new PublishBus(),
      bookRoot: root,
      taskRef: 'tsk_t18_extract',
      chapterIndex: 2,
      extract: () => ({ temporalFact: ['not-an-object'] }),
    });
    expect(outcome.status).toBe('failed_recoverable');
    expect(outcome.errorDetail).toContain('row #0 must be a JSON object');
  });

  it('已提交相位的章不是本步输入（ChapterPhaseError 宁败不猜）', () => {
    const { root, plane } = newBook(3);
    plane.commitChapter({ chapterIndex: 3, summary: '定稿' });
    expect(() =>
      runFinalExtract({
        bus: new PublishBus(),
        bookRoot: root,
        taskRef: 'tsk_t18_extract',
        chapterIndex: 3,
        extract: () => fiveFamilyBatch(),
      }),
    ).toThrow(ChapterPhaseError);
  });
});
