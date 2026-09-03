/**
 * 跨章并发全局单飞测试（T19 · #43；S11）：V1 同时最多一个活动 session——
 * 别章开卷即拒（守卫在 TaskStarted 落账前，拒绝零副作用）；收卷后单飞释放；
 * 同章既有守卫（SessionAlreadyActiveError）不回归。零时钟零外部服务。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PublishBus } from '@mozhou/runtime';
import { LocalDataPlane, createBook } from '@mozhou/data-plane';
import { readPipelineLedger } from './ledger.js';
import {
  ChapterProductionSession,
  GlobalSingleFlightError,
  SessionAlreadyActiveError,
  findOpenSessionWindow,
} from './index.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ } }
  roots = [];
});

function makeBook(prefix: string): { root: string; bus: PublishBus } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  createBook({ dir, title: '单飞之书' });
  const bus = new PublishBus();
  return { root: dir, bus };
}

function deps(root: string, bus: PublishBus, chapterIndex: number, tag: string) {
  return { bus, root, chapterIndex, newTaskRef: () => 'tsk_' + tag };
}

describe('S11 跨章并发 V1 全局单飞', () => {
  it('别章活动会话存在时开新卷即拒：GlobalSingleFlightError 指名活动窗口、拒绝零副作用', () => {
    const { root, bus } = makeBook('mozhou-t19-sf1-');
    const plane = LocalDataPlane.open(root);
    plane.createChapterDraft({ chapterIndex: 2, title: '第二章' });
    plane.createChapterDraft({ chapterIndex: 3, title: '第三章' });

    const first = ChapterProductionSession.start(deps(root, bus, 2, 'sf_ch2'));
    expect(first.currentStep).toBe('prepare');

    const before = readPipelineLedger(root).length;
    expect(() => ChapterProductionSession.start(deps(root, bus, 3, 'sf_ch3'))).toThrow(GlobalSingleFlightError);
    try {
      ChapterProductionSession.start(deps(root, bus, 3, 'sf_ch3'));
    } catch (error) {
      const single = error as GlobalSingleFlightError;
      expect(single.requestedChapterIndex).toBe(3);
      expect(single.activeChapterIndex).toBe(2);
      expect(single.activeTaskRef).toBe('tsk_sf_ch2');
      expect(single.message).toContain('globally single-flight');
    }
    // 守卫在事件落账之前：拒绝后账本零增长
    expect(readPipelineLedger(root)).toHaveLength(before);
    // 全局扫描与投影一致：仍只有 ch2 一个开放窗口
    expect(findOpenSessionWindow(readPipelineLedger(root))).toEqual({ chapterIndex: 2, taskRef: 'tsk_sf_ch2' });
  });

  it('同章活动会话仍是 SessionAlreadyActiveError（既有守卫不回归）；resume 照常续接', () => {
    const { root, bus } = makeBook('mozhou-t19-sf2-');
    LocalDataPlane.open(root).createChapterDraft({ chapterIndex: 2, title: '第二章' });
    ChapterProductionSession.start(deps(root, bus, 2, 'sf_same'));

    expect(() => ChapterProductionSession.start(deps(root, bus, 2, 'sf_again'))).toThrow(SessionAlreadyActiveError);

    const resumed = ChapterProductionSession.resume(deps(root, bus, 2, 'sf_same'));
    expect(resumed?.taskRef).toBe('tsk_sf_same');
    expect(resumed?.currentStep).toBe('prepare');
  });

  it('收卷后单飞释放：别章可开卷；完成态窗口不再算活动', () => {
    const { root, bus } = makeBook('mozhou-t19-sf3-');
    const plane = LocalDataPlane.open(root);
    plane.createChapterDraft({ chapterIndex: 2, title: '第二章' });
    plane.createChapterDraft({ chapterIndex: 3, title: '第三章' });

    // ch2 走完全十步并收卷（最小步进：无 LLM 缝参与，正文保持占位）
    const session = ChapterProductionSession.start(deps(root, bus, 2, 'sf_done'));
    for (const step of ['compile', 'draft', 'review', 'user_edit', 'final_extract', 'continuity_gate', 'canon_proposal'] as const) {
      if (step === 'user_edit') session.recordQualityReview({ reportId: 'rpt_sf_pass', verdict: 'pass' });
      session.advance(step);
    }
    session.recordProposal({ routed: { low: 0, medium: 0, high: 0 } });
    session.advance('commit');
    const result = LocalDataPlane.open(root).commitChapter({ chapterIndex: 2, summary: '二章提交' });
    session.markCommitted(result.commitId);
    session.advance('flywheel_record');
    session.finish();

    expect(findOpenSessionWindow(readPipelineLedger(root)) ?? null).toBeNull();

    const next = ChapterProductionSession.start(deps(root, bus, 3, 'sf_next'));
    expect(next.chapterIndex).toBe(3);
    expect(findOpenSessionWindow(readPipelineLedger(root)) ?? null).toEqual({ chapterIndex: 3, taskRef: 'tsk_sf_next' });
  });

  it('空账本无活动窗口；崩溃窗口（开卷未收卷）被扫描捕获', () => {
    const { root, bus } = makeBook('mozhou-t19-sf4-');
    expect(findOpenSessionWindow(readPipelineLedger(root)) ?? null).toBeNull();

    LocalDataPlane.open(root).createChapterDraft({ chapterIndex: 1, title: '第一章' });
    ChapterProductionSession.start(deps(root, bus, 1, 'sf_crash'));
    // 模拟崩溃：进程消失，账本上留下开放窗口
    expect(findOpenSessionWindow(readPipelineLedger(root)) ?? null).toEqual({ chapterIndex: 1, taskRef: 'tsk_sf_crash' });
  });
});
