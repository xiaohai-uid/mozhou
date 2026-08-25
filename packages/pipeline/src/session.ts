/**
 * ChapterProductionSession（T16 · #40；chapter-pipeline-spec S1 / ADR-0024 Decision 1）。
 *
 * 内存态运行时对象：一章 = 一个 session = 十步步进序列。纪律：
 *   - 每步转换是一条 Ledger 任务事件——开卷 TaskStarted(step=prepare)、
 *     步进 TaskStepTransitioned{from,to}、收卷 TaskFinished；
 *   - 当前步可随时从投影恢复（resume = 折叠账本重建内存态，无第三处真源）；
 *   - 一 session ↔ 一 commit：完成态单一事实源 = 账本中本窗口 CanonCommitted
 *     存在性（ANWA #90）；markCommitted 二次提交即拒；
 *   - 重提交 = 新 session：已完成窗口之上 start 开新卷，旧 commit 不变（I5/S9）；
 *   - 步进严格沿十步后继序，非法跳跃 StepTransitionError（回环由作者显式动作
 *     驱动，S7；V1 线性序，回炉重走归后续票）。
 *
 * 步内工作产物不落会话态：Prepare 结果集是内存查询结果（S2）、Compile 产物是
 * Receipt 文件 + 指针事件（S3）——session 只持步光标与投影可重建的事实。
 */
import { newUlid } from '@mozhou/kernel';
import type { DomainEvent } from '@mozhou/kernel';
import { PublishBus } from '@mozhou/runtime';
import type { LedgerCtx } from '@mozhou/runtime';
import { readPipelineLedger } from './ledger.js';
import { projectSession } from './projection.js';
import type { SessionProjection } from './projection.js';
import { nextStepOf } from './steps.js';
import type { PipelineStep } from './steps.js';

export interface ChapterProductionSessionDeps {
  readonly bus: PublishBus;
  /** 书根（LedgerCtx 锚点）。 */
  readonly root: string;
  readonly chapterIndex: number;
  /** 测试确定性注入：缺省铸新 ULID。 */
  readonly newTaskRef?: () => string;
}

/** 同章已有活动会话时开新卷即拒（先 resume 或走完收卷；单飞语义的前置守卫）。 */
export class SessionAlreadyActiveError extends Error {
  override readonly name = 'SessionAlreadyActiveError';
  constructor(readonly chapterIndex: number, readonly activeTaskRef: string) {
    super(
      `chapter ${chapterIndex} already has an active production session (${activeTaskRef}) — ` +
        'resume it or finish it before starting a new one (one session ↔ one commit)',
    );
  }
}

/** 无可恢复的活动会话（未开卷 / 已完成 / 已收卷）。 */
export class SessionNotResumableError extends Error {
  override readonly name = 'SessionNotResumableError';
  constructor(readonly chapterIndex: number, detail: string) {
    super(`chapter ${chapterIndex} has no resumable session: ${detail}`);
  }
}

/** 非法步转换：只许沿十步后继序前进。 */
export class StepTransitionError extends Error {
  override readonly name = 'StepTransitionError';
  constructor(from: PipelineStep, to: PipelineStep, expected: PipelineStep | null) {
    super(`illegal step transition ${from} → ${to}; expected ${expected ?? '<none (last step)>'} (ten-step linear order)`);
  }
}

/** 步卫失败：动作与当前步不符（含步锚事件发射位）。 */
export class StepGuardError extends Error {
  override readonly name = 'StepGuardError';
  constructor(expected: PipelineStep, actual: PipelineStep | null, action: string) {
    super(`${action} requires current step '${expected}', got '${actual ?? '<none>'}'`);
  }
}

function toDomainEvent(event: DomainEvent): DomainEvent {
  return event;
}

export class ChapterProductionSession {
  readonly #bus: PublishBus;
  readonly #ctx: LedgerCtx;
  readonly #chapterIndex: number;
  readonly #taskRef: string;
  #currentStep: PipelineStep;

  private constructor(deps: ChapterProductionSessionDeps, taskRef: string, currentStep: PipelineStep) {
    this.#bus = deps.bus;
    this.#ctx = { root: deps.root };
    this.#chapterIndex = deps.chapterIndex;
    this.#taskRef = taskRef;
    this.#currentStep = currentStep;
  }

  get taskRef(): string {
    return this.#taskRef;
  }

  get chapterIndex(): number {
    return this.#chapterIndex;
  }

  get currentStep(): PipelineStep {
    return this.#currentStep;
  }

  /** 开卷：TaskStarted(step=prepare)。同章活动会话存在即拒（重提交=新 session 的前置是旧卷已闭合）。 */
  static start(deps: ChapterProductionSessionDeps): ChapterProductionSession {
    const projection = projectSession(readPipelineLedger(deps.root), deps.chapterIndex);
    if (projection.sessionOpen && projection.taskRef !== null) {
      throw new SessionAlreadyActiveError(deps.chapterIndex, projection.taskRef);
    }
    const taskRef = deps.newTaskRef ? deps.newTaskRef() : `tsk_${newUlid()}`;
    const session = new ChapterProductionSession(deps, taskRef, 'prepare');
    session.#publish({
      type: 'TaskStarted',
      taskRef,
      chapterIndex: deps.chapterIndex,
      payload: { step: 'prepare' },
    });
    return session;
  }

  /**
   * 恢复：折叠账本重建内存态会话（当前步从投影来）。无可恢复会话——未开卷 /
   * 已完成（CanonCommitted 存在性即完成态单一事实源）/ 已收卷——返回 null。
   */
  static resume(deps: ChapterProductionSessionDeps): ChapterProductionSession | null {
    const projection = projectSession(readPipelineLedger(deps.root), deps.chapterIndex);
    if (!projection.sessionOpen || projection.taskRef === null || projection.currentStep === null) {
      return null;
    }
    return new ChapterProductionSession(deps, projection.taskRef, projection.currentStep);
  }

  /** 强制恢复入口：不可恢复即抛（编排侧想显式区分「无会话」与「坏状态」时用）。 */
  static resumeOrThrow(deps: ChapterProductionSessionDeps): ChapterProductionSession {
    const resumed = ChapterProductionSession.resume(deps);
    if (resumed === null) {
      throw new SessionNotResumableError(deps.chapterIndex, 'no open session window (never started, committed, or finished)');
    }
    return resumed;
  }

  #publish(event: DomainEvent): void {
    this.#bus.publish(this.#ctx, toDomainEvent(event));
  }

  /** 折叠当下账本的投影（内存光标以账本为准回读——会话态=投影的一种）。 */
  project(): SessionProjection {
    return projectSession(readPipelineLedger(this.#ctx.root), this.#chapterIndex);
  }

  /** 完成态判定：账本中本窗口 CanonCommitted 存在性（ANWA #90，实时读账）。 */
  isCompleted(): boolean {
    return this.project().committed;
  }

  /** 步进到严格后继步；发射 TaskStepTransitioned{from,to}。 */
  advance(to: PipelineStep): void {
    const expected = nextStepOf(this.#currentStep);
    if (to !== expected) {
      throw new StepTransitionError(this.#currentStep, to, expected);
    }
    this.#publish({
      type: 'TaskStepTransitioned',
      taskRef: this.#taskRef,
      chapterIndex: this.#chapterIndex,
      payload: { from: this.#currentStep, to },
    });
    this.#currentStep = to;
  }

  /**
   * 第 8 步步锚：CanonProposalCreated（提案头开启，配对约束要求其被
   * CanonCommitted 闭合——发布总线当场强制）。
   */
  recordProposal(payload: Readonly<Record<string, unknown>> = {}): void {
    if (this.#currentStep !== 'canon_proposal') {
      throw new StepGuardError('canon_proposal', this.#currentStep, 'recordProposal');
    }
    this.#publish({
      type: 'CanonProposalCreated',
      taskRef: this.#taskRef,
      chapterIndex: this.#chapterIndex,
      payload,
    });
  }

  /**
   * 第 9 步步锚：CanonCommitted——一 session ↔ 一 commit 的唯一写点。
   * 完成态自此以账本存在性为单一事实源；二次提交即拒。
   */
  markCommitted(commitId: string, payload: Readonly<Record<string, unknown>> = {}): void {
    if (this.#currentStep !== 'commit') {
      throw new StepGuardError('commit', this.#currentStep, 'markCommitted');
    }
    if (this.isCompleted()) {
      throw new Error(
        `chapter ${this.#chapterIndex} session ${this.#taskRef} already has a CanonCommitted — one session ↔ one commit (ANWA #90)`,
      );
    }
    this.#publish({
      type: 'CanonCommitted',
      taskRef: this.#taskRef,
      chapterIndex: this.#chapterIndex,
      payload: { commitId, ...payload },
    });
  }

  /** 收卷：TaskFinished 闭合 TaskStarted 配对；仅完成态且走到末步时合法。 */
  finish(): void {
    if (this.#currentStep !== 'flywheel_record') {
      throw new StepGuardError('flywheel_record', this.#currentStep, 'finish');
    }
    if (!this.isCompleted()) {
      throw new Error('cannot finish a session without CanonCommitted — completion truth lives in the ledger');
    }
    this.#publish({
      type: 'TaskFinished',
      taskRef: this.#taskRef,
      chapterIndex: this.#chapterIndex,
      payload: { outcome: 'succeeded' },
    });
  }
}
