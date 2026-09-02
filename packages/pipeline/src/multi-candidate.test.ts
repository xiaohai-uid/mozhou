/**
 * T17 验收测试（#41）：多候选择优——accepted/rejected 双路落账方为有效飞轮信号
 * （ADR-0013）。零时钟零外部服务，hermetic 临时书。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PublishBus, readLedger } from '@mozhou/runtime';
import { createBook } from '@mozhou/data-plane';
import { EditActionLevelError, presentCandidates, recordCandidateDecision } from './index.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch {} }
  roots = [];
});

function hermeticBook(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-t17-cand-'));
  roots.push(dir);
  createBook({ dir, title: '择优之书' });
  return dir;
}

function makeDeps(root: string) {
  return {
    bus: new PublishBus(),
    bookRoot: root,
    taskRef: 'tsk_t17_cand',
    chapterIndex: 9,
  };
}

describe('多候选择优：双路落账', () => {
  it('候选呈现逐条落 CandidateCreated；择优选 accepted+rejected 同账一行', () => {
    const root = hermeticBook();
    const deps = makeDeps(root);

    const presented = presentCandidates(deps, {
      level: 'cursor',
      options: [
        { candidateId: 'cand_a', text: '版本甲，雨夜追凶。' },
        { candidateId: 'cand_b', text: '版本乙，雪夜闭门。' },
        { candidateId: 'cand_c', text: '版本丙，晨雾渡江。' },
      ],
    });
    expect(presented.map((entry) => entry.candidateId)).toEqual(['cand_a', 'cand_b', 'cand_c']);

    const decision = recordCandidateDecision(deps, {
      level: 'cursor',
      acceptedOptionIds: ['cand_b'],
      rejectedOptionIds: ['cand_a', 'cand_c'],
    });
    expect(decision.acceptedOptionIds).toEqual(['cand_b']);
    expect(decision.rejectedOptionIds).toEqual(['cand_a', 'cand_c']);

    const events = readLedger({ root }).map((row) => row.event);
    const created = events.filter((event) => event.type === 'CandidateCreated');
    expect(created).toHaveLength(3);
    expect(created[0]).toMatchObject({
      taskRef: 'tsk_t17_cand',
      chapterIndex: 9,
      payload: { candidateId: 'cand_a', level: 'cursor' },
    });
    expect(typeof created[0]!.payload?.['chars']).toBe('number');

    // 双路落账：一条决策事件同时携带接受路与拒绝路
    const decisionEvent = events.find((event) => event.type === 'UserEditRecorded');
    expect(decisionEvent).toBeDefined();
    expect(decisionEvent!.payload).toMatchObject({
      action: 'candidate_decision',
      level: 'cursor',
      acceptedOptionIds: ['cand_b'],
      rejectedOptionIds: ['cand_a', 'cand_c'],
    });
  });

  it('单路决策不是有效飞轮信号：缺拒绝路即拒', () => {
    const root = hermeticBook();
    const deps = makeDeps(root);
    presentCandidates(deps, {
      level: 'selection',
      options: [
        { candidateId: 'cand_x', text: '甲' },
        { candidateId: 'cand_y', text: '乙' },
      ],
    });

    expect(() =>
      recordCandidateDecision(deps, { level: 'selection', acceptedOptionIds: ['cand_x'], rejectedOptionIds: [] }),
    ).toThrowError(/BOTH accepted and rejected/);
    expect(() =>
      recordCandidateDecision(deps, { level: 'selection', acceptedOptionIds: [], rejectedOptionIds: ['cand_y'] }),
    ).toThrowError(/BOTH accepted and rejected/);

    // 被拒的坏决策不落任何账
    const decisions = readLedger({ root })
      .map((row) => row.event)
      .filter((event) => event.type === 'UserEditRecorded');
    expect(decisions).toHaveLength(0);
  });

  it('宁败不猜：引用未呈现过的候选 id / 接受路拒绝路相交均拒', () => {
    const root = hermeticBook();
    const deps = makeDeps(root);
    presentCandidates(deps, {
      level: 'cursor',
      options: [
        { candidateId: 'cand_p', text: 'P' },
        { candidateId: 'cand_q', text: 'Q' },
      ],
    });

    expect(() =>
      recordCandidateDecision(deps, {
        level: 'cursor',
        acceptedOptionIds: ['cand_p'],
        rejectedOptionIds: ['cand_ghost'],
      }),
    ).toThrowError(/never presented/);

    expect(() =>
      recordCandidateDecision(deps, {
        level: 'cursor',
        acceptedOptionIds: ['cand_p'],
        rejectedOptionIds: ['cand_p'],
      }),
    ).toThrowError(/both accepted and rejected/);
  });

  it('动作位沿 M16 V1 两级：越级呈现/决策显式拒', () => {
    const root = hermeticBook();
    const deps = makeDeps(root);
    expect(() =>
      presentCandidates(deps, {
        level: 'wizard' as never,
        options: [
          { candidateId: 'a', text: 'A' },
          { candidateId: 'b', text: 'B' },
        ],
      }),
    ).toThrowError(EditActionLevelError);
    expect(() =>
      recordCandidateDecision(deps, { level: 'panel' as never, acceptedOptionIds: ['a'], rejectedOptionIds: ['b'] }),
    ).toThrowError(EditActionLevelError);
  });

  it('少于两个候选不构成分支（ADR-0013 局部多候选前提）', () => {
    const root = hermeticBook();
    expect(() =>
      presentCandidates(makeDeps(root), { level: 'cursor', options: [{ candidateId: 'only', text: '唯一' }] }),
    ).toThrowError(/at least two options/);
  });
});
