/**
 * ADR-0025（质量门集成）验收测试：质量回炉边——
 * pass 放行前进口 / blocking_fail 关闭前进口且显式回炉 / refused 停给作者 /
 * 每 session 自动回炉上限 2 次 / 崩溃恢复沿账本折叠重建 verdict 与计数。
 * 零时钟零外部服务：taskRef 注入固定值；账本落在 hermetic 临时目录。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PublishBus } from '@mozhou/runtime';
import {
  ChapterProductionSession,
  QualityReviewNotPassError,
  QualityReworkLimitExceededError,
  QualityReworkNotDrivenError,
} from './index.js';

let roots: string[] = [];
function hermeticRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-t25-rework-'));
  mkdirSync(join(root, '.mozhou'), { recursive: true });
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ } }
  roots = [];
});

function makeDeps(root: string) {
  return { bus: new PublishBus(), root, chapterIndex: 7, newTaskRef: () => 'tsk_t25' };
}

/** 走到 review 步（prepare 开卷 + compile/draft/review 三步进）。 */
function sessionAtReview(root: string): ChapterProductionSession {
  const session = ChapterProductionSession.start(makeDeps(root));
  session.advance('compile');
  session.advance('draft');
  session.advance('review');
  return session;
}

function recordVerdict(
  session: ChapterProductionSession,
  verdict: 'pass' | 'blocking_fail' | 'refused',
): void {
  session.recordQualityReview({ reportId: `rpt_${verdict}_${Math.random()}`, verdict });
}

describe('ADR-0025 质量回炉边', () => {
  it('pass review → user_edit 允许', () => {
    const root = hermeticRoot();
    const session = sessionAtReview(root);
    recordVerdict(session, 'pass');
    session.advance('user_edit');
    expect(session.currentStep).toBe('user_edit');
  });

  it('blocking_fail → user_edit 拒绝（前进出口关闭）', () => {
    const root = hermeticRoot();
    const session = sessionAtReview(root);
    recordVerdict(session, 'blocking_fail');
    expect(() => session.advance('user_edit')).toThrowError(QualityReviewNotPassError);
    expect(session.currentStep).toBe('review');
  });

  it('blocking_fail → requestQualityRework 回炉 draft → 重走 review 合法', () => {
    const root = hermeticRoot();
    const session = sessionAtReview(root);
    recordVerdict(session, 'blocking_fail');
    session.requestQualityRework();
    expect(session.currentStep).toBe('draft');
    expect(session.project().qualityReworkCount).toBe(1);
    session.advance('review');
    expect(session.currentStep).toBe('review');
  });

  it('第二次回炉允许（reworkAttempt=2）', () => {
    const root = hermeticRoot();
    const session = sessionAtReview(root);
    recordVerdict(session, 'blocking_fail');
    session.requestQualityRework();
    session.advance('review');
    recordVerdict(session, 'blocking_fail');
    session.requestQualityRework();
    expect(session.project().qualityReworkCount).toBe(2);
    expect(session.currentStep).toBe('draft');
  });

  it('第三次回炉拒绝（QualityReworkLimitExceededError——停止交作者）', () => {
    const root = hermeticRoot();
    const session = sessionAtReview(root);
    recordVerdict(session, 'blocking_fail');
    session.requestQualityRework();
    session.advance('review');
    recordVerdict(session, 'blocking_fail');
    session.requestQualityRework();
    session.advance('review');
    recordVerdict(session, 'blocking_fail');
    expect(() => session.requestQualityRework()).toThrowError(QualityReworkLimitExceededError);
    expect(session.currentStep).toBe('review');
  });

  it('refused → user_edit 拒绝且不允许回炉（无静默 pass，停给作者）', () => {
    const root = hermeticRoot();
    const session = sessionAtReview(root);
    recordVerdict(session, 'refused');
    expect(() => session.advance('user_edit')).toThrowError(QualityReviewNotPassError);
    expect(() => session.requestQualityRework()).toThrowError(QualityReworkNotDrivenError);
    expect(session.currentStep).toBe('review');
  });

  it('未审查（verdict=null）→ user_edit 拒绝', () => {
    const root = hermeticRoot();
    const session = sessionAtReview(root);
    expect(() => session.advance('user_edit')).toThrowError(QualityReviewNotPassError);
  });

  it('崩溃恢复：verdict 与回炉计数沿账本折叠重建（上限跨恢复生效）', () => {
    const root = hermeticRoot();
    const session = sessionAtReview(root);
    recordVerdict(session, 'blocking_fail');
    session.requestQualityRework();

    // —— 崩溃：丢弃内存态，从账本折叠重建 ——
    const resumed = ChapterProductionSession.resume(makeDeps(root));
    expect(resumed).not.toBeNull();
    expect(resumed!.currentStep).toBe('draft');
    expect(resumed!.project().lastQualityVerdict).toBe('blocking_fail');
    expect(resumed!.project().qualityReworkCount).toBe(1);

    resumed!.advance('review');
    recordVerdict(resumed!, 'blocking_fail');
    resumed!.requestQualityRework(); // 第 2 次（上限内）
    resumed!.advance('review');
    recordVerdict(resumed!, 'blocking_fail');

    // 再次崩溃恢复后，第 3 次仍被上限拒绝
    const resumed2 = ChapterProductionSession.resume(makeDeps(root));
    expect(resumed2!.project().qualityReworkCount).toBe(2);
    expect(() => resumed2!.requestQualityRework()).toThrowError(QualityReworkLimitExceededError);
  });
});
