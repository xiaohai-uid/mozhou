/**
 * S9 重提交测试（T19 · #43）：commit 后章节允许 requestResubmit——相位移回
 * draft（reopenChapter；I5：旧 commit 物理痕迹永不改写），随后 V1 全量重走
 * 十步（新 taskRef 新会话）。重提交期间读取真相 = phase=committed 的最新
 * commitId（事件行锚，不读已翻回 draft 的正文文件）；重提交完成后旧 commit
 * 的 canon 文件逐字节不变（追踪流 md5 前后相等 + 首提交事件行原样在账）。
 * 零时钟零外部服务：手工 taskRef / 注入 entryId / 手工行 id。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newUlid } from '@mozhou/kernel';
import {
  LocalDataPlane,
  PreWriteHashMismatchError,
  RUNTIME_EVENTS_PATH,
  TRACKING_STREAMS,
  createBook,
  proseChapterPath,
  readProseChapter,
} from '@mozhou/data-plane';
import { PublishBus } from '@mozhou/runtime';
import {
  ChapterProductionSession,
  GlobalSingleFlightError,
  ResubmitNotCommittedError,
  SessionNotAbandonableError,
  confirmedAppendsForCommit,
  createCanonProposal,
  findOpenSessionWindow,
  latestCommittedTruth,
  readPipelineLedger,
  recordUserEdit,
  requestResubmit,
  runContinuityGate,
  runFinalExtract,
  runFlywheelRecord,
} from './index.js';
// assertSessionStartable 是 session 模块的公共守卫，未在 index 重导出（与 resubmit.ts 同源用法）
import { assertSessionStartable } from './session.js';
import { markProposalConsumed } from './proposal-step.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ } }
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
  session.recordQualityReview({ reportId: 'rpt_rs_pass', verdict: 'pass' });
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

/** 账上已开卷次数——用于断言「被拒的重提交没有留下孤儿窗口」。 */
function taskStartedCount(root: string): number {
  return readFileSync(join(root, RUNTIME_EVENTS_PATH), 'utf8')
    .split('\n')
    .filter((line) => line.includes('"type":"TaskStarted"')).length;
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

  it('外部改盘：拒绝零盘面副作用（相位仍 committed、无 TaskStarted），修好后可重试成功', () => {
    const dir = makeBookWithChapter('mozhou-t19-rs5-');
    const bus = new PublishBus();
    walkToCommit(dir, startWindow(dir, 'tsk_rs_a', bus), bus, { extract: () => lowRiskDelta() });

    const file = join(dir, proseChapterPath(2));
    const pristine = readFileSync(file, 'utf8');
    writeFileSync(file, pristine.replace(PROSE_V1, 'EXTERNAL TAMPER'));
    const startedBefore = taskStartedCount(dir);

    expect(() =>
      requestResubmit({ bus, root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_rs_retry' }),
    ).toThrow(PreWriteHashMismatchError);
    // 写前哈希失配在 reopenChapter 内、任何写入之前抛出 ⇒ 相位未翻、窗口未开
    expect(readProseChapter(dir, proseChapterPath(2)).phase).toBe('committed');
    expect(taskStartedCount(dir)).toBe(startedBefore);

    // 作者修好外部改动后重试同章：重提交成功（不会被 SessionAlreadyActive 挡死）
    writeFileSync(file, pristine);
    const outcome = requestResubmit({ bus, root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_rs_retry' });
    expect(outcome.session.taskRef).toBe('tsk_rs_retry');
    expect(outcome.session.currentStep).toBe('prepare');
    expect(readProseChapter(dir, proseChapterPath(2)).phase).toBe('draft');
  });

  it('账实不符：拒绝零盘面副作用（相位未翻、窗口未开），不留孤儿窗口', () => {
    const dir = makeBookWithChapter('mozhou-t19-rs6-');
    const bus = new PublishBus();
    walkToCommit(dir, startWindow(dir, 'tsk_rs_a', bus), bus, { extract: () => lowRiskDelta() });

    // 抹掉事件流里的 ChapterCommitted 行：相位仍 committed，但真相锚无处可读
    const eventsPath = join(dir, RUNTIME_EVENTS_PATH);
    const kept = readFileSync(eventsPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0 && !line.includes('"ChapterCommitted"'));
    writeFileSync(eventsPath, kept.join('\n') + '\n');
    const startedBefore = taskStartedCount(dir);

    expect(() =>
      requestResubmit({ bus, root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_rs_bad' }),
    ).toThrow(/ledger\/prose inconsistent/);
    expect(readProseChapter(dir, proseChapterPath(2)).phase).toBe('committed');
    expect(taskStartedCount(dir)).toBe(startedBefore);
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

describe('S9 收口 · 作废后该章可再次重提交（不残留锁）', () => {
  it('重提交窗口作废 → 单飞释放 → 再定稿后 requestResubmit 再次成功', () => {
    const dir = makeBookWithChapter('mozhou-t19-rs7-');
    const bus = new PublishBus();
    walkToCommit(dir, startWindow(dir, 'tsk_rs_a', bus), bus, { extract: () => lowRiskDelta() });

    const first = requestResubmit({ bus, root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_rs_b' });
    expect(first.session.taskRef).toBe('tsk_rs_b');
    // 窗口占住全局单飞：此时别章开不了卷（这就是需要作废出口的死锁）
    expect(() =>
      assertSessionStartable({ bus: new PublishBus(), root: dir, chapterIndex: 5 }),
    ).toThrow(GlobalSingleFlightError);

    // 作者/运维显式作废（跨请求：新 bus 实例，靠 adoptOpenHeads 认领悬挂 head）
    const abandoned = ChapterProductionSession.abandonOpenWindow(
      { bus: new PublishBus(), root: dir, chapterIndex: 2 },
      'author_abandoned',
    );
    expect(abandoned).toBe('tsk_rs_b');
    expect(findOpenSessionWindow(readPipelineLedger(dir))).toBeNull();
    // 单飞释放：别章开卷不再被挡
    expect(() =>
      assertSessionStartable({ bus: new PublishBus(), root: dir, chapterIndex: 5 }),
    ).not.toThrow();

    // 作者改文后再定稿（数据面提交，与 web 提交出口同款），章回到 committed
    const plane = LocalDataPlane.open(dir);
    try {
      plane.commitChapter({ chapterIndex: 2, summary: '再定稿', finalProse: PROSE_V2 });
    } finally {
      plane.close();
    }

    // 再次重提交成功：窗口已作废 ⇒ 不残留锁（否则会被 SessionAlreadyActive 挡死）
    const again = requestResubmit({ bus: new PublishBus(), root: dir, chapterIndex: 2, newTaskRef: () => 'tsk_rs_c' });
    expect(again.session.taskRef).toBe('tsk_rs_c');
    expect(again.session.currentStep).toBe('prepare');
    expect(readProseChapter(dir, proseChapterPath(2)).phase).toBe('draft');
  });
});

/* ==========================================================================
 * S9 收口：ChapterProductionSession.abandon（会话窗口作废）
 *
 * 把「活动」会话窗口变「已放弃」——发布 TaskFinished{outcome:'abandoned'}，在
 * findOpenSessionWindow 视角下真正关闭窗口并释放 V1 全局单飞，**不发 CanonCommitted**。
 * 存在的意义：web 侧没有会话内 commit/finish 路由，requestResubmit 开出的窗口在 web
 * 可达路径上无法走完十步闭合，一旦开出就永久占住单飞、锁死全书后续开卷——作废是出口。
 *
 * 覆盖的不变量与失败路径：
 *   1. 开窗口 → abandon → findOpenSessionWindow 返回 null（核心）；同章/别章
 *      assertSessionStartable 不再抛错、别章 session.start 成功（单飞真正释放）；
 *   2. 跨请求配对：abandon 用新 PublishBus 实例也能成功（adoptOpenHeads 认领悬挂 head，
 *      否则 PAIRING_TAIL_WITHOUT_HEAD）；
 *   3. 从非末步调用合法（prepare / draft 中途），对比 finish() 的步进守卫；
 *   4. 留痕可观测：TaskFinished 带 outcome='abandoned' + reason，配对 head 闭合；
 *   5. 失败路径：空 reason 拒；二次作废拒；finish 之后拒；markCommitted（本会话真完成）
 *      之后拒——作废是「放弃未完成」，不是「抹掉完成」；
 *   6. abandonOpenWindow：无窗口 / 窗口属别章 ⇒ null 空操作，别章窗口原封不动。
 * ========================================================================== */

/** 只建 .mozhou 账本目录的 hermetic root（abandon 测试不需要书；PublishBus 只追加不建目录）。 */
function ledgerOnlyRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-s9-abandon-'));
  mkdirSync(join(dir, '.mozhou'), { recursive: true });
  roots.push(dir);
  return dir;
}

const abandonDeps = (root: string, chapterIndex: number, taskRef: string) => ({
  bus: new PublishBus(),
  root,
  chapterIndex,
  newTaskRef: () => taskRef,
});

/** 走到 commit 步（含门禁 pass 的 Result 字段）——markCommitted 前置。 */
function advanceToCommitStep(session: ChapterProductionSession): void {
  session.advance('compile');
  session.advance('draft');
  session.advance('review');
  session.recordQualityReview({ reportId: 'rpt_ab_pass', verdict: 'pass' });
  session.advance('user_edit');
  session.advance('final_extract');
  session.advance('continuity_gate', { verdict: 'pass' });
  session.advance('canon_proposal');
  session.recordProposal({ proposalId: 'prop_ab' });
  session.advance('commit');
}

function taskFinishedRows(root: string): Record<string, unknown>[] {
  return readFileSync(join(root, RUNTIME_EVENTS_PATH), 'utf8')
    .split('\n')
    .filter((line) => line.includes('"TaskFinished"'))
    .map((line) => (JSON.parse(line) as { event: Record<string, unknown> }).event);
}

/** 账本任务行（PublishBus 格式 {seq, event}）的事件类型序列——平铺领域行无 event 槽，跳过。 */
function taskEventTypes(root: string): string[] {
  const types: string[] = [];
  for (const line of readFileSync(join(root, RUNTIME_EVENTS_PATH), 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    const event = (JSON.parse(line) as { event?: { type?: string } }).event;
    if (event !== undefined && typeof event.type === 'string') types.push(event.type);
  }
  return types;
}

describe('S9 收口 · abandon 关闭活动窗口并释放全局单飞', () => {
  it('开窗口 → abandon → findOpenSessionWindow=null；同章/别章开卷不再被单飞挡死', () => {
    const root = ledgerOnlyRoot();
    ChapterProductionSession.start(abandonDeps(root, 2, 'tsk_ab_a'));

    // 作废之前：别章开卷被 V1 全局单飞拒（这正是需要出口的死锁）
    expect(findOpenSessionWindow(readPipelineLedger(root))).toEqual({ chapterIndex: 2, taskRef: 'tsk_ab_a' });
    expect(() => assertSessionStartable(abandonDeps(root, 3, 'tsk_ab_probe'))).toThrow(GlobalSingleFlightError);

    // 跨请求：abandon 用**新** PublishBus 实例（开卷的那个已随请求销毁）
    const resumed = ChapterProductionSession.resume(abandonDeps(root, 2, 'unused'));
    expect(resumed).not.toBeNull();
    resumed!.abandon('author_abandoned');

    // 窗口在 findOpenSessionWindow 视角下确实关闭
    expect(findOpenSessionWindow(readPipelineLedger(root))).toBeNull();
    // 同章与别章的纯读预检都不再抛错（单飞释放）
    expect(() => assertSessionStartable(abandonDeps(root, 2, 'tsk_ab_same'))).not.toThrow();
    expect(() => assertSessionStartable(abandonDeps(root, 3, 'tsk_ab_other'))).not.toThrow();
    // 别章真的能开卷（端到端证明锁没了）
    const other = ChapterProductionSession.start(abandonDeps(root, 3, 'tsk_ab_c'));
    expect(other.taskRef).toBe('tsk_ab_c');
  });

  it('跨请求配对：新实例发 tail 前认领账本悬挂 head（否则 PAIRING_TAIL_WITHOUT_HEAD）', () => {
    const root = ledgerOnlyRoot();
    ChapterProductionSession.start(abandonDeps(root, 2, 'tsk_ab_pair'));

    // 未认领的裸新实例直接发 tail 必被配对纪律拒（证明 adoptOpenHeads 不是装饰）
    const bare = new PublishBus();
    expect(() =>
      bare.publish({ root }, { type: 'TaskFinished', taskRef: 'tsk_ab_pair', chapterIndex: 2, payload: { outcome: 'abandoned' } }),
    ).toThrowError(/PAIRING_TAIL_WITHOUT_HEAD/);

    // abandon 内部认领后成功，且配对闭合（无悬挂 head）
    const resumed = ChapterProductionSession.resume(abandonDeps(root, 2, 'unused'))!;
    resumed.abandon('author_abandoned');
    expect(findOpenSessionWindow(readPipelineLedger(root))).toBeNull();
    expect(taskEventTypes(root)).toEqual(['TaskStarted', 'TaskFinished']);
  });

  it('从非末步调用合法（prepare / draft 中途），对比 finish() 的步进守卫', () => {
    // 刚开卷即作废（prepare）
    const rootA = ledgerOnlyRoot();
    const atPrepare = ChapterProductionSession.start(abandonDeps(rootA, 2, 'tsk_ab_prepare'));
    expect(atPrepare.currentStep).toBe('prepare');
    // finish() 在此步被步进守卫拒（作废的对照组）
    expect(() => atPrepare.finish()).toThrow(/requires current step 'flywheel_record'/);
    expect(() => atPrepare.abandon('author_abandoned')).not.toThrow();
    expect(findOpenSessionWindow(readPipelineLedger(rootA))).toBeNull();

    // 走到中途 draft 再作废
    const rootB = ledgerOnlyRoot();
    const mid = ChapterProductionSession.start(abandonDeps(rootB, 2, 'tsk_ab_mid'));
    mid.advance('compile');
    mid.advance('draft');
    expect(mid.currentStep).toBe('draft');
    expect(() => mid.finish()).toThrow(/requires current step 'flywheel_record'/);
    expect(() => mid.abandon('author_abandoned')).not.toThrow();
    expect(findOpenSessionWindow(readPipelineLedger(rootB))).toBeNull();
  });

  it('留痕可观测：TaskFinished 携带 outcome=abandoned + reason（账本事件即审计面）', () => {
    const root = ledgerOnlyRoot();
    const session = ChapterProductionSession.start(abandonDeps(root, 2, 'tsk_ab_trace'));
    session.advance('compile');
    session.abandon('author_resubmitted');

    const finished = taskFinishedRows(root);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      taskRef: 'tsk_ab_trace',
      chapterIndex: 2,
      payload: { outcome: 'abandoned', reason: 'author_resubmitted' },
    });
    // 作废绝不发 CanonCommitted：完成态语义不被改写
    expect(readPipelineLedger(root).some((row) => row.kind === 'task' && row.event.type === 'CanonCommitted')).toBe(false);
  });
});

describe('S9 收口 · abandon 的失败路径（宁败不猜）', () => {
  it('空 reason 拒（审计必须记下为什么作废）', () => {
    const root = ledgerOnlyRoot();
    const session = ChapterProductionSession.start(abandonDeps(root, 2, 'tsk_ab_noreason'));
    expect(() => session.abandon('   ')).toThrow(/non-empty reason/);
    // 拒后窗口仍开着（失败零副作用）
    expect(findOpenSessionWindow(readPipelineLedger(root))).toEqual({ chapterIndex: 2, taskRef: 'tsk_ab_noreason' });
  });

  it('二次作废拒（幂等：窗口已关即拒，不重复发 tail）', () => {
    const root = ledgerOnlyRoot();
    const session = ChapterProductionSession.start(abandonDeps(root, 2, 'tsk_ab_twice'));
    session.abandon('author_abandoned');
    expect(() => session.abandon('author_abandoned')).toThrow(SessionNotAbandonableError);
    expect(taskFinishedRows(root)).toHaveLength(1);
  });

  it('finish() 收卷之后拒（已闭合的窗口不可再作废）', () => {
    const root = ledgerOnlyRoot();
    const session = ChapterProductionSession.start(abandonDeps(root, 2, 'tsk_ab_fin'));
    advanceToCommitStep(session);
    session.markCommitted('cmit_ab_fin');
    session.advance('flywheel_record');
    session.finish();
    expect(() => session.abandon('author_abandoned')).toThrow(SessionNotAbandonableError);
  });

  it('markCommitted（本会话真完成）之后拒：作废是「放弃未完成」，不是「抹掉完成」', () => {
    const root = ledgerOnlyRoot();
    const session = ChapterProductionSession.start(abandonDeps(root, 2, 'tsk_ab_done'));
    advanceToCommitStep(session);
    session.markCommitted('cmit_ab_done');
    // CanonCommitted 任务行让 findOpenSessionWindow 视窗口已闭合
    expect(findOpenSessionWindow(readPipelineLedger(root))).toBeNull();
    expect(() => session.abandon('author_abandoned')).toThrow(SessionNotAbandonableError);
    // 完成态未被改写
    expect(session.isCompleted()).toBe(true);
  });
});

describe('S9 收口 · abandonOpenWindow（路由层收口入口）', () => {
  it('无活动窗口 ⇒ null 空操作（幂等，运维可重复调用）', () => {
    const root = ledgerOnlyRoot();
    expect(ChapterProductionSession.abandonOpenWindow(abandonDeps(root, 2, 'unused'), 'ops_cleanup')).toBeNull();
  });

  it('活动窗口属别章 ⇒ null，别章窗口原封不动（不越章作废）', () => {
    const root = ledgerOnlyRoot();
    ChapterProductionSession.start(abandonDeps(root, 2, 'tsk_ab_owner'));
    expect(ChapterProductionSession.abandonOpenWindow(abandonDeps(root, 3, 'unused'), 'ops_cleanup')).toBeNull();
    expect(findOpenSessionWindow(readPipelineLedger(root))).toEqual({ chapterIndex: 2, taskRef: 'tsk_ab_owner' });
  });

  it('活动窗口属本章 ⇒ 返回被作废 taskRef 且窗口关闭', () => {
    const root = ledgerOnlyRoot();
    ChapterProductionSession.start(abandonDeps(root, 2, 'tsk_ab_mine'));
    expect(ChapterProductionSession.abandonOpenWindow(abandonDeps(root, 2, 'unused'), 'author_resubmitted')).toBe('tsk_ab_mine');
    expect(findOpenSessionWindow(readPipelineLedger(root))).toBeNull();
    // 幂等：再调一次得 null，不重复落事件
    expect(ChapterProductionSession.abandonOpenWindow(abandonDeps(root, 2, 'unused'), 'author_resubmitted')).toBeNull();
    expect(taskFinishedRows(root)).toHaveLength(1);
  });
});

