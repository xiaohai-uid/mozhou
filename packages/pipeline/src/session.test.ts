/**
 * T16 验收测试（#40）：ChapterProductionSession 步进状态机——
 * 十步事件链配对 / 投影恢复当前步 / 一 session↔一 commit / 重提交=新 session。
 * 零时钟零外部服务：taskRef 注入固定值；账本落在 hermetic 临时目录。
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PublishBus, readLedger } from '@mozhou/runtime';
import type { StoredEvent } from '@mozhou/runtime';
import {
  ChapterProductionSession,
  SessionAlreadyActiveError,
  StepGuardError,
  StepTransitionError,
  nextStepOf,
  projectSession,
  readPipelineLedger,
} from './index.js';

let roots: string[] = [];
function hermeticRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-t16-session-'));
  // 账本目录预存在（createBook 的运行时区等价物；PublishBus 只追加不建目录）
  mkdirSync(join(root, '.mozhou'), { recursive: true });
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch {} }
  roots = [];
});

const TASK_REFS = ['tsk_t16_a', 'tsk_t16_b'];
const makeDeps = (root: string, refIndex = 0) => ({
  bus: new PublishBus(),
  root,
  chapterIndex: 7,
  newTaskRef: () => TASK_REFS[refIndex]!,
});

/** 走完十步：advance ×9 + 提案头/正典提交/收卷三个步锚。 */
function walkAllTen(session: ChapterProductionSession): void {
  const order = ['compile', 'draft', 'review', 'user_edit', 'final_extract', 'continuity_gate', 'canon_proposal'] as const;
  for (const step of order) {
    if (step === 'user_edit') session.recordQualityReview({ reportId: 'rpt_t16_pass', verdict: 'pass' });
    session.advance(step);
  }
  session.recordProposal({ proposalId: 'prop_x' });
  session.advance('commit');
  session.markCommitted('cmit_t16_x');
  session.advance('flywheel_record');
  session.finish();
}

describe('十步步进序列与事件链配对', () => {
  it('开卷即 TaskStarted(step=prepare)，此后每步一条 TaskStepTransitioned', () => {
    const root = hermeticRoot();
    const session = ChapterProductionSession.start(makeDeps(root));
    expect(session.currentStep).toBe('prepare');

    session.advance('compile');
    const events = readLedger({ root }).map((row) => row.event);
    expect(events.map((event) => event.type)).toEqual(['TaskStarted', 'TaskStepTransitioned']);
    expect(events[0]).toMatchObject({ taskRef: TASK_REFS[0]!, chapterIndex: 7, payload: { step: 'prepare' } });
    expect(events[1]).toMatchObject({ payload: { from: 'prepare', to: 'compile' } });
  });

  it('全链走完后：TaskStarted/TaskFinished 配对闭合、无悬挂 head、步序完整', () => {
    const root = hermeticRoot();
    const session = ChapterProductionSession.start(makeDeps(root));
    walkAllTen(session);

    const stored: readonly StoredEvent[] = readLedger({ root });
    const types = stored.map((row) => row.event.type);
    expect(types[0]).toBe('TaskStarted');
    expect(types.at(-1)).toBe('TaskFinished');
    // 九次步进 = prepare→…→flywheel_record 的全部相邻对
    const transitions = stored
      .map((row) => row.event)
      .filter((event) => event.type === 'TaskStepTransitioned')
      .map((event) => event.payload as { from: string; to: string });
    expect(transitions).toHaveLength(9);
    expect(transitions[0]).toEqual({ from: 'prepare', to: 'compile' });
    expect(transitions.at(-1)).toEqual({ from: 'commit', to: 'flywheel_record' });

    // 投影侧：无悬挂 head（TaskStarted↔TaskFinished、CanonProposalCreated↔CanonCommitted 均闭合）
    const projection = projectSession(readPipelineLedger(root), 7);
    expect(projection.openHeads).toEqual([]);
    expect(projection.finished).toBe(true);
    expect(projection.committed).toBe(true);
    expect(projection.commitId).toBe('cmit_t16_x');
    expect(projection.sessionOpen).toBe(false);
  });

  it('非法跳跃被拒且不落任何事件（宁败不脏）', () => {
    const root = hermeticRoot();
    const session = ChapterProductionSession.start(makeDeps(root));
    expect(() => session.advance('draft')).toThrowError(StepTransitionError);
    const events = readLedger({ root });
    expect(events).toHaveLength(1); // 只有 TaskStarted
    // 后继序函数本身：末步无后继
    expect(nextStepOf('flywheel_record')).toBeNull();
  });

  it('步锚卫兵：提案/提交/收卷在错误步上即拒', () => {
    const root = hermeticRoot();
    const session = ChapterProductionSession.start(makeDeps(root));
    expect(() => session.recordProposal()).toThrowError(StepGuardError);
    expect(() => session.markCommitted('cmit_early')).toThrowError(StepGuardError);
    expect(() => session.finish()).toThrowError(StepGuardError);
  });
});

describe('投影恢复当前步（会话态=投影，无第三处真源）', () => {
  it('任意步崩溃后 resume 回到同 taskRef 同步光标', () => {
    const root = hermeticRoot();
    const first = ChapterProductionSession.start(makeDeps(root));
    first.advance('compile');
    first.advance('draft');
    first.advance('review');

    // —— 崩溃：丢弃内存态，从账本折叠重建 ——
    const resumed = ChapterProductionSession.resume(makeDeps(root));
    expect(resumed).not.toBeNull();
    expect(resumed!.taskRef).toBe(TASK_REFS[0]);
    expect(resumed!.currentStep).toBe('review');

    // 恢复后的会话继续按后继序步进（ADR-0025：前进前先落 pass 审查）
    resumed!.recordQualityReview({ reportId: 'rpt_t16_resume', verdict: 'pass' });
    resumed!.advance('user_edit');
    expect(ChapterProductionSession.resume(makeDeps(root))!.currentStep).toBe('user_edit');
  });

  it('未开卷 resume 得 null；resumeOrThrow 显式报错', () => {
    const root = hermeticRoot();
    expect(ChapterProductionSession.resume(makeDeps(root))).toBeNull();
    expect(() => ChapterProductionSession.resumeOrThrow(makeDeps(root))).toThrowError(/no resumable session/);
  });
});

describe('一 session ↔ 一 commit 与重提交', () => {
  it('同章活动会话未闭合时禁止再开卷', () => {
    const root = hermeticRoot();
    ChapterProductionSession.start(makeDeps(root));
    expect(() => ChapterProductionSession.start(makeDeps(root, 1))).toThrowError(SessionAlreadyActiveError);
  });

  it('完成态单一事实源：CanonCommitted 存在即不可二次提交，恢复入口关闭', () => {
    const root = hermeticRoot();
    const session = ChapterProductionSession.start(makeDeps(root));
    for (const step of ['compile', 'draft', 'review', 'user_edit', 'final_extract', 'continuity_gate', 'canon_proposal'] as const) {
      if (step === 'user_edit') session.recordQualityReview({ reportId: 'rpt_t16_pass', verdict: 'pass' });
      session.advance(step);
    }
    session.recordProposal();
    session.advance('commit');
    session.markCommitted('cmit_one');
    expect(session.isCompleted()).toBe(true);

    // 二次提交即拒（ANWA #90：完成态多源雷区）
    expect(() => session.markCommitted('cmit_two')).toThrowError(/one session ↔ one commit/);
    // 已完成窗口不再可恢复——完成态以账本存在性为唯一判据
    expect(ChapterProductionSession.resume(makeDeps(root))).toBeNull();
  });

  it('重提交 = 新 session：旧 commit 不变，新卷从头起步且换新 taskRef', () => {
    const root = hermeticRoot();
    const first = ChapterProductionSession.start(makeDeps(root, 0));
    for (const step of ['compile', 'draft', 'review', 'user_edit', 'final_extract', 'continuity_gate', 'canon_proposal'] as const) {
      if (step === 'user_edit') first.recordQualityReview({ reportId: 'rpt_t16_first', verdict: 'pass' });
      first.advance(step);
    }
    first.recordProposal();
    first.advance('commit');
    first.markCommitted('cmit_old');
    first.advance('flywheel_record');
    first.finish();

    // 重提交流程在已闭合窗口之上开新卷
    const second = ChapterProductionSession.start(makeDeps(root, 1));
    expect(second.taskRef).toBe(TASK_REFS[1]);
    expect(second.currentStep).toBe('prepare');
    expect(second.isCompleted()).toBe(false); // 新会话未被旧 commit 污染

    const projection = projectSession(readPipelineLedger(root), 7);
    expect(projection.taskRef).toBe(TASK_REFS[1]);
    expect(projection.committed).toBe(false);
    // 两届会话的 CanonCommitted 各自留痕（I5 只增不改）
    const commits = readLedger({ root })
      .map((row) => row.event)
      .filter((event) => event.type === 'CanonCommitted');
    expect(commits).toHaveLength(1); // 第二届尚未走到 commit
  });
});
