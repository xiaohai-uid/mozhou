/**
 * S9 重提交测试（T19 · #43）：commit 后章节允许 requestResubmit——相位移回
 * draft（reopenChapter；I5：旧 commit 物理痕迹永不改写），随后 V1 全量重走
 * 十步（新 taskRef 新会话）。重提交期间读取真相 = phase=committed 的最新
 * commitId（事件行锚，不读已翻回 draft 的正文文件）；重提交完成后旧 commit
 * 的 canon 文件逐字节不变（追踪流 md5 前后相等 + 首提交事件行原样在账）。
 * 零时钟零外部服务：手工 taskRef / 注入 entryId / 手工行 id。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newUlid } from '@mozhou/kernel';
import {
  LocalDataPlane,
  RUNTIME_EVENTS_PATH,
  TRACKING_STREAMS,
  createBook,
  createChapterDraft,
  proseChapterPath,
  readProseChapter,
} from '@mozhou/data-plane';
import { PublishBus } from '@mozhou/runtime';
import {
  ChapterProductionSession,
  GlobalSingleFlightError,
  ResubmitNotCommittedError,
  confirmedAppendsForCommit,
  createCanonProposal,
  latestCommittedTruth,
  recordUserEdit,
  requestResubmit,
  runContinuityGate,
  runFinalExtract,
  runFlywheelRecord,
} from './index.js';
import { markProposalConsumed } from './proposal-step.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

const NOW = '2026-08-26T00:00:00.000Z';

function md5File(absolutePath: string): string {
  return createHash('md5').update(readFileSync(absolutePath)).digest('hex');
}

function head(prefix: string): Record<string, unknown> {
  return { id: prefix + '_' + newUlid(), bookId: 'book_' + newUlid(), revision: 0, createdAt: NOW, updatedAt: NOW };
}

/** 首轮提取：Gate 全绿形状（沿 T18 夹具）——low 定位事实 + 引用它的本批时间线行。 */
function lowRiskDelta(): Record<string, unknown[]> {
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
    temporalFact: [located],
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

const PROSE_V1 = '首提交定稿正文。';
const PROSE_V2 = '重提交后的全新定稿正文。';

interface CommittedWindow {
  readonly root: string;
  readonly commitId: string;
  readonly contentSha256: string;
}

/** 从给定会话全量走到 CanonCommitted + 收卷（extract 注入缝与定稿正文由调用方给定）。 */
function walkToCommit(
  root: string,
  session: ChapterProductionSession,
  bus: PublishBus,
  opts: {
    readonly extract: () => Record<string, unknown[]>;
    readonly prose?: string;
    readonly summary?: string;
  },
): CommittedWindow {
  const chapterIndex = session.chapterIndex;
  session.advance('compile');
  session.advance('draft');
  session.advance('review');
  session.advance('user_edit');
  recordUserEdit({
    bus,
    bookRoot: root,
    taskRef: session.taskRef,
    chapterIndex,
    level: 'selection',
    source: 'author',
    blocks: [{ op: 'replace', paragraphStart: 1, paragraphEnd: 1, replacementText: opts.prose ?? PROSE_V1 }],
  });
  session.advance('final_extract');
  const extracted = runFinalExtract({
    bus,
    bookRoot: root,
    taskRef: session.taskRef,
    chapterIndex,
    extract: opts.extract,
  });
  expect(extracted.status).toBe('extracted');
  const gated = runContinuityGate({ bookRoot: root, chapterIndex, delta: extracted.batch ?? {} });
  expect(gated.verdict).toBe('pass');
  session.advance('continuity_gate', { verdict: gated.verdict, hardConflicts: gated.hardConflicts });
  session.advance('canon_proposal');
  const proposed = createCanonProposal({
    bus,
    bookRoot: root,
    taskRef: session.taskRef,
    chapterIndex,
    delta: extracted.batch ?? {},
  });
  const appends = confirmedAppendsForCommit(root, proposed.proposalId);
  session.advance('commit');
  // S10 编排方契约：长持平面句柄在步边界重开，同步盘上最新基线（含编辑后的正文哈希）
  const result = LocalDataPlane.open(root).commitChapter({
    chapterIndex,
    summary: opts.summary ?? '定稿',
    finalProse: opts.prose ?? PROSE_V1,
    appends,
  });
  session.markCommitted(result.commitId);
  markProposalConsumed(root, proposed.proposalId);
  session.advance('flywheel_record');
  runFlywheelRecord({
    bus,
    bookRoot: root,
    taskRef: session.taskRef,
    chapterIndex,
    commitId: result.commitId,
    usage: [],
    newEntryId: () => 'usg_' + session.taskRef,
  });
  session.finish();
  return { root, commitId: result.commitId, contentSha256: result.contentSha256 };
}

function makeBookWithChapter(prefix: string, chapterIndex = 2): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  createBook({ dir, title: '重提交之书' });
  if (chapterIndex > 0) {
    LocalDataPlane.open(dir).createChapterDraft({ chapterIndex, title: '第二章' });
  }
  return dir;
}

/** 开卷辅助：手工 taskRef 的确定性窗口（首轮走线用）；bus 与后续步发布同源（配对约束）。 */
function startWindow(root: string, taskRef: string, bus: PublishBus, chapterIndex = 2): ChapterProductionSession {
  return ChapterProductionSession.start({ bus, root, chapterIndex, newTaskRef: () => taskRef });
}

function snapshotStreams(root: string): { kind: string; path: string; md5: string }[] {
  return TRACKING_STREAMS.map((stream) => ({
    kind: String(stream.kind),
    path: stream.path,
    md5: existsSync(join(root, stream.path)) ? md5File(join(root, stream.path)) : 'ABSENT_MARKER',
  }));
}

describe('S9 重提交入口', () => {
  it('未提交章拒绝：draft 在盘与从未建章都报 ResubmitNotCommittedError', () => {
    const dir = makeBookWithChapter('mozhou-t19-rs0a-');
    expect(() =>
      requestResubmit({ bus: new PublishBus(), root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_rs_x' }),
    ).toThrow(ResubmitNotCommittedError);

    const bare = makeBookWithChapter('mozhou-t19-rs0b-', 0);
    expect(() =>
      requestResubmit({ bus: new PublishBus(), root: bare, chapterIndex: 9, newTaskRef: () => 'tsk_rs_y' }),
    ).toThrow(ResubmitNotCommittedError);
  });

  it('别章全局单飞先于翻相位拒绝：被重提交章保持 committed、零副作用', () => {
    const dir = makeBookWithChapter('mozhou-t19-rs1-');
    const bus = new PublishBus();
    walkToCommit(dir, startWindow(dir, 'tsk_rs_a', bus), bus, { extract: () => lowRiskDelta() });

    // 别章开一个活动窗口（单飞占用）
    ChapterProductionSession.start({ bus, root: dir, chapterIndex: 1, newTaskRef: () => 'tsk_rs_other' });
    expect(() =>
      requestResubmit({ bus, root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_rs_z' }),
    ).toThrow(GlobalSingleFlightError);
    // 守卫在翻相位之前：正文相位原封未动
    expect(readProseChapter(dir, proseChapterPath(2)).phase).toBe('committed');
  });

  it('commit 后 requestResubmit：相位移回 draft、新 taskRef 新会话从 prepare 全量重走', () => {
    const dir = makeBookWithChapter('mozhou-t19-rs2-');
    const bus = new PublishBus();
    const first = walkToCommit(dir, startWindow(dir, 'tsk_rs_a', bus), bus, { extract: () => lowRiskDelta() });

    const outcome = requestResubmit({
      bus,
      root: dir,
      chapterIndex: 2,
      newTaskRef: () => 'tsk_rs_b',
    });
    expect(outcome.reopenedFromCommitId).toBe(first.commitId);
    expect(outcome.session.taskRef).toBe('tsk_rs_b'); // 新 taskRef 新会话
    expect(outcome.session.currentStep).toBe('prepare'); // 十步从头走
    expect(outcome.session.isCompleted()).toBe(false); // 旧 commit 不构成新窗口完成态
    expect(readProseChapter(dir, proseChapterPath(2)).phase).toBe('draft'); // 相位移回
  });
});

describe('S9 重提交期间的真相读取', () => {
  it('readTruth 锚定 phase=committed 的最新 commitId，不读已翻回 draft 的正文文件', () => {
    const dir = makeBookWithChapter('mozhou-t19-rs3-');
    const bus = new PublishBus();
    const first = walkToCommit(dir, startWindow(dir, 'tsk_rs_a', bus), bus, { extract: () => lowRiskDelta() });

    const outcome = requestResubmit({
      bus,
      root: dir,
      chapterIndex: 2,
      newTaskRef: () => 'tsk_rs_b',
    });
    // 盘上文件已翻回 draft……
    expect(readProseChapter(dir, proseChapterPath(2)).phase).toBe('draft');
    // ……但真相锚仍指旧 commit（事件行携带的 contentSha256 与首提交一致）
    expect(outcome.truthAnchor).toEqual({
      commitId: first.commitId,
      contentSha256: first.contentSha256,
      proseRelPath: proseChapterPath(2),
    });
    expect(latestCommittedTruth(dir, 2)).toEqual(outcome.truthAnchor);

    // 从未提交过的章没有真相锚
    const bare = makeBookWithChapter('mozhou-t19-rs3b-', 0);
    expect(latestCommittedTruth(bare, 3)).toBeNull();
  });
});

describe('S9 重提交全量重走端到端 + 旧 commit 字节不变', () => {
  it('新会话十步走到再提交；追踪流 md5 前后相等、首提交事件行原样在账、真相前移到新 commit', () => {
    const dir = makeBookWithChapter('mozhou-t19-rs4-');
    const bus = new PublishBus();
    const first = walkToCommit(dir, startWindow(dir, 'tsk_rs_a', bus), bus, { extract: () => lowRiskDelta() });

    // 旧 commit 的 canon 痕迹快照：全部追踪流字节 + 首提交事件行原文
    const streamsBefore = snapshotStreams(dir);
    const eventsAbs = join(dir, RUNTIME_EVENTS_PATH);
    const firstCommitLine = readFileSync(eventsAbs, 'utf8')
      .split('\n')
      .find((line) => line.includes('"ChapterCommitted"'));
    expect(firstCommitLine).toBeDefined();

    const reopened = requestResubmit({ bus, root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_rs_b' });

    // 新会话全量重走十步（作者改文；零新候选 ⇒ 事实集不变，追踪流零触碰）——
    // 续接 requestResubmit 开出的窗口（重提交 = 新 session，不得二次 start）
    const second = walkToCommit(dir, reopened.session, bus, {
      extract: () => ({}),
      prose: PROSE_V2,
      summary: '第二章重提交定稿',
    });
    expect(second.commitId).not.toBe(first.commitId); // 新 commit 不等于旧 commit

    // I5：旧 commit 物理痕迹逐字节不变——追踪流快照前后相等（含首轮 low 事实行）
    expect(snapshotStreams(dir)).toEqual(streamsBefore);
    // 审计面同样不改写：首提交事件行原样还在账
    expect(readFileSync(eventsAbs, 'utf8')).toContain(firstCommitLine!);

    // 重提交完成后真相前移：最新 committed 锚 = 新 commitId
    expect(latestCommittedTruth(dir, 2)?.commitId).toBe(second.commitId);
    expect(readProseChapter(dir, proseChapterPath(2)).phase).toBe('committed');
  });
});

