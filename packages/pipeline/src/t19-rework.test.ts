/**
 * 回环停止策略测试（T19 · #43；S7）：HARD_CONFLICT → 作者显式选择改文 ⇒
 * requestRework 回炉 user_edit，沿线性序 Final Extract 全量重提取；无自动
 * 迭代、无次数上限——每次循环必须由作者显式动作驱动。零时钟零外部服务。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newUlid } from '@mozhou/kernel';
import { PublishBus, readLedger } from '@mozhou/runtime';
import { LocalDataPlane, createBook } from '@mozhou/data-plane';
import {
  ChapterProductionSession,
  HardConflictUnresolvedError,
  ReworkNotDrivenError,
  StepGuardError,
  StepTransitionError,
  runContinuityGate,
  runFinalExtract,
} from './index.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch {} }
  roots = [];
});

const NOW = '2026-08-25T00:00:00.000Z';

function head(prefix: string): Record<string, unknown> {
  return { id: prefix + '_' + newUlid(), bookId: 'book_' + newUlid(), revision: 0, createdAt: NOW, updatedAt: NOW };
}

function makeConflictedDelta(): Record<string, unknown[]> {
  // 秘密事实无 reader 披露行 ⇒ Gate 四项核检的 POV 零泄漏违例（hard_conflict 形状）
  return {
    temporalFact: [
      {
        ...head('fact'),
        subject: 'char:x',
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
      },
    ],
  };
}

interface Harness { root: string; bus: PublishBus; session: ChapterProductionSession; extractorCalls: () => number; }

/** 走到 continuity_gate 且注入冲突 delta（verdict=hard_conflict 悬置）。 */
function harnessToConflictedGate(prefix: string): Harness {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  createBook({ dir, title: '回环之书' });
  LocalDataPlane.open(dir).createChapterDraft({ chapterIndex: 2, title: '第二章' });
  const bus = new PublishBus();
  const session = ChapterProductionSession.start({ bus, root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_rw' });
  session.advance('compile');
  session.advance('draft');
  session.advance('review');
  session.recordQualityReview({ reportId: 'rpt_rw_pass', verdict: 'pass' });
  session.advance('user_edit');

  let calls = 0;
  const extractOnce = (prose: string): void => {
    calls += 1;
    const outcome = runFinalExtract({
      bus, bookRoot: dir, taskRef: session.taskRef, chapterIndex: 2,
      extract: () => ({ temporalFact: [{ ...makeConflictedDelta().temporalFact![0]! }] }),
    });
    expect(outcome.status).toBe('extracted');
    void prose;
  };

  session.advance('final_extract');
  extractOnce('第一版终稿');
  const gated = runContinuityGate({ bookRoot: dir, chapterIndex: 2, delta: makeConflictedDelta() });
  expect(gated.verdict).toBe('hard_conflict');
  session.advance('continuity_gate', { verdict: gated.verdict, hardConflicts: gated.hardConflicts });
  return { root: dir, bus, session, extractorCalls: () => calls };
}

describe('S7 回环停止策略（显式驱动，全量重提取）', () => {
  it('hard_conflict → requestRework 回炉 user_edit → 改文 → 全量重提取：提取缝被再次调用、事件带 reason', () => {
    const h = harnessToConflictedGate('mozhou-t19-rw1-');
    expect(h.session.currentStep).toBe('continuity_gate');
    expect(h.extractorCalls()).toBe(1);

    // 作者显式动作：承认错误改文（唯一逆向转换）
    h.session.requestRework();
    expect(h.session.currentStep).toBe('user_edit');

    const reworkEvent = readLedger({ root: h.root }).map((row) => row.event).at(-1);
    expect(reworkEvent?.type).toBe('TaskStepTransitioned');
    expect(reworkEvent?.payload).toMatchObject({ from: 'continuity_gate', to: 'user_edit', reason: 'hard_conflict_rework' });

    // 作者实际改文（结构化编辑块落正文文件），然后线性重走 Final Extract
    h.session.advance('final_extract');
    let secondRoundCalls = 0;
    const outcome = runFinalExtract({
      bus: h.bus, bookRoot: h.root, taskRef: h.session.taskRef, chapterIndex: 2,
      extract: () => {
        secondRoundCalls += 1;
        return { temporalFact: [] };
      },
    });
    expect(outcome.status).toBe('extracted');
    expect(secondRoundCalls).toBe(1); // 回炉后全量重提取真的再次调用了提取缝
    expect(h.extractorCalls()).toBe(1); // 首轮调用仍在账：两轮共两次全量提取（一致性优先于增量成本）
    expect(h.session.currentStep).toBe('final_extract');
  });

  it('无显式驱动即无自动循环：前进出口关闭、光标悬置、提取缝不自行重跑', () => {
    const h = harnessToConflictedGate('mozhou-t19-rw2-');
    const ledgerLenBefore = readLedger({ root: h.root }).length;
    const callsBefore = h.extractorCalls();

    // 带冲突的 delta 进不了确认面：canon_proposal 前进出口关闭
    expect(() => h.session.advance('canon_proposal')).toThrow(HardConflictUnresolvedError);
    // 逆向跳跃同样非法（advance 只认后继）
    expect(() => h.session.advance('user_edit')).toThrow(StepTransitionError);
    // 提取/门禁没有任何自动重跑通道：账本零增长、调用数不变、光标悬置原地
    expect(readLedger({ root: h.root })).toHaveLength(ledgerLenBefore);
    expect(h.extractorCalls()).toBe(callsBefore);
    expect(h.session.currentStep).toBe('continuity_gate');
    expect(h.session.project().lastGateVerdict).toBe('hard_conflict');
  });

  it('无次数上限：三轮 [冲突→requestRework→改文→再冲突] 显式循环后放行通过', () => {
    const h = harnessToConflictedGate('mozhou-t19-rw3-');
    let reworkCount = 0;
    for (let round = 0; round < 3; round += 1) {
      h.session.requestRework();
      reworkCount += 1;
      h.session.advance('final_extract');
      runFinalExtract({
        bus: h.bus, bookRoot: h.root, taskRef: h.session.taskRef, chapterIndex: 2,
        extract: () => ({ temporalFact: [{ ...makeConflictedDelta().temporalFact![0]! }] }),
      });
      const gated = runContinuityGate({ bookRoot: h.root, chapterIndex: 2, delta: makeConflictedDelta() });
      expect(gated.verdict).toBe('hard_conflict');
      h.session.advance('continuity_gate', { verdict: gated.verdict, hardConflicts: gated.hardConflicts });
    }
    expect(reworkCount).toBe(3); // 无次数上限——有显式驱动即无失控

    // 第四轮作者改对了：门禁通过后前进出口恢复开放
    h.session.requestRework();
    h.session.advance('final_extract');
    runFinalExtract({ bus: h.bus, bookRoot: h.root, taskRef: h.session.taskRef, chapterIndex: 2, extract: () => ({}) });
    const passed = runContinuityGate({ bookRoot: h.root, chapterIndex: 2, delta: {} });
    expect(passed.verdict).toBe('pass');
    h.session.advance('continuity_gate', { verdict: passed.verdict, hardConflicts: passed.hardConflicts });
    expect(h.session.project().lastGateVerdict).toBe('pass');
    expect(() => h.session.advance('canon_proposal')).not.toThrow();

    // 三次回炉事件都在账
    const reasons = readLedger({ root: h.root })
      .map((row) => row.event)
      .filter((event) => event.type === 'TaskStepTransitioned' && event.payload?.['reason'] === 'hard_conflict_rework');
    expect(reasons).toHaveLength(4);
  });

  it('非法驱动响亮拒绝：pass 后 requestRework 拒、未到门禁拒、回炉后再 requestRework 拒', () => {
    const h = harnessToConflictedGate('mozhou-t19-rw4-');

    // 回炉一次后立刻再 requestRework：光标已不在门禁（StepGuardError）
    h.session.requestRework();
    expect(() => h.session.requestRework()).toThrow(StepGuardError);

    // pass 之后不允许借道回炉：verdict=pass 不是「承认错误」
    h.session.advance('final_extract');
    runFinalExtract({ bus: h.bus, bookRoot: h.root, taskRef: h.session.taskRef, chapterIndex: 2, extract: () => ({}) });
    const gated = runContinuityGate({ bookRoot: h.root, chapterIndex: 2, delta: {} });
    h.session.advance('continuity_gate', { verdict: gated.verdict, hardConflicts: gated.hardConflicts });
    expect(() => h.session.requestRework()).toThrow(ReworkNotDrivenError);

    // 未走到门禁的新会话（另一本书，光标停在 prepare）同样拒绝
    const dir2 = mkdtempSync(join(tmpdir(), 'mozhou-t19-rw4b-'));
    roots.push(dir2);
    createBook({ dir: dir2, title: '第二册' });
    LocalDataPlane.open(dir2).createChapterDraft({ chapterIndex: 1, title: '第一章' });
    const fresh = ChapterProductionSession.start({ bus: h.bus, root: dir2, chapterIndex: 1, newTaskRef: () => 'tsk_rw_fresh' });
    expect(() => fresh.requestRework()).toThrow(StepGuardError);
  });
});
