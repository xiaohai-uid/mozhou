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
import { findOpenSessionWindow, projectSession } from './projection.js';
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

/**
 * 全局单飞违例（T19 · #43；S11 跨章并发 V1）：同时最多一个活动 session——
 * 别章窗口还开着时开新卷即拒。先 resume 或走完收卷再开新章。
 */
export class GlobalSingleFlightError extends Error {
  override readonly name = 'GlobalSingleFlightError';
  constructor(
    readonly requestedChapterIndex: number,
    readonly activeChapterIndex: number,
    readonly activeTaskRef: string,
  ) {
    super(
      `chapter ${requestedChapterIndex} cannot start: chapter ${activeChapterIndex} already has the global active ` +
        `production session (${activeTaskRef}) — V1 is globally single-flight (one active session at a time), ` +
        'resume or finish it first',
    );
  }
}

/** 非法步转换：只许沿十步后继序前进。 */
export class StepTransitionError extends Error {
  override readonly name = 'StepTransitionError';
  constructor(from: PipelineStep, to: PipelineStep, expected: PipelineStep | null) {
    super(`illegal step transition ${from} → ${to}; expected ${expected ?? '<none (last step)>'} (ten-step linear order)`);
  }
}

/**
 * 回环未被显式驱动（T19 · #43；S7 回环停止策略）：requestRework 只在门禁
 * hard_conflict 悬置时合法——无冲突可回炉、或门禁已通过，都不是「作者承认
 * 错误改文」的显式动作。循环无自动迭代，缺这一票就停。
 */
export class ReworkNotDrivenError extends Error {
  override readonly name = 'ReworkNotDrivenError';
  constructor(chapterIndex: number, verdict: string | null) {
    super(
      `chapter ${chapterIndex} rework not driven: the loop advances only by explicit author action ` +
        `(S7) — current gate verdict is '${verdict ?? '<none>'}', 'hard_conflict' required`,
    );
  }
}

/**
 * 硬冲突未决、前进出口关闭（T19 · #43；S7 停止策略）：门禁 hard_conflict
 * 悬置期间禁止步进 canon_proposal——带冲突的 delta 进不了确认面。唯一出路是
 * 作者显式动作：requestRework 承认错误改文回炉，别无自动通道。
 */
export class HardConflictUnresolvedError extends Error {
  override readonly name = 'HardConflictUnresolvedError';
  constructor(chapterIndex: number, taskRef: string) {
    super(
      `chapter ${chapterIndex} session ${taskRef}: continuity gate ended with hard_conflict — ` +
        'the forward exit to canon_proposal is closed until the author explicitly drives a rework ' +
        '(requestRework: acknowledge the mistake, edit the prose, full re-extract)',
    );
  }
}

/**
 * 文学审查未通过、前进出口关闭（ADR-0025 决策 3/4）：review→user_edit 只对
 * verdict='pass' 放行——blocking_fail 走 requestQualityRework 显式回炉；
 * refused 停给作者处置（提供方不可用/未知不升格为 pass，fail closed）。
 */
export class QualityReviewNotPassError extends Error {
  override readonly name = 'QualityReviewNotPassError';
  constructor(chapterIndex: number, taskRef: string, verdict: string | null) {
    super(
      `chapter ${chapterIndex} session ${taskRef}: literary review verdict is '${verdict ?? '<none>'}' ` +
        "— forward exit to user_edit requires 'pass' (ADR-0025); blocking_fail must drive an explicit " +
        'requestQualityRework, refused stops for the author',
    );
  }
}

/**
 * 文学审查回炉未被显式驱动（ADR-0025 决策 4）：requestQualityRework 只在
 * review 步且最新质量 verdict='blocking_fail' 时合法——verdict=pass/refused
 * 或尚未审查都不是「承认文学错误改文」的显式动作。
 */
export class QualityReworkNotDrivenError extends Error {
  override readonly name = 'QualityReworkNotDrivenError';
  constructor(chapterIndex: number, verdict: string | null) {
    super(
      `chapter ${chapterIndex} quality rework not driven: the loop advances only by explicit action ` +
        `(ADR-0025) — current literary review verdict is '${verdict ?? '<none>'}', 'blocking_fail' required`,
    );
  }
}

/**
 * 质量回炉次数超限（ADR-0025 决策 5）：每个 ChapterProductionSession 自动
 * 回炉上限 2 次；第 3 次请求即抛——停止并交作者处置，不允许无限 agent loop。
 */
export class QualityReworkLimitExceededError extends Error {
  override readonly name = 'QualityReworkLimitExceededError';
  constructor(chapterIndex: number, taskRef: string, attempted: number) {
    super(
      `chapter ${chapterIndex} session ${taskRef}: quality rework attempt ${attempted} exceeds the ` +
        'automatic cap of 2 per session (ADR-0025) — stopping for author action',
    );
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

  /** 开卷：TaskStarted(step=prepare)。同章活动会话存在即拒（重提交=新 session 的前置是旧卷已闭合）；
   *  别章活动会话存在同样即拒——V1 全局单飞，同时最多一个活动 session（S11）。守卫在
   *  TaskStarted 落账之前，拒绝零副作用。 */
  static start(deps: ChapterProductionSessionDeps): ChapterProductionSession {
    const rows = readPipelineLedger(deps.root);
    const projection = projectSession(rows, deps.chapterIndex);
    if (projection.sessionOpen && projection.taskRef !== null) {
      throw new SessionAlreadyActiveError(deps.chapterIndex, projection.taskRef);
    }
    const active = findOpenSessionWindow(rows);
    if (active !== null && active.chapterIndex !== deps.chapterIndex) {
      throw new GlobalSingleFlightError(deps.chapterIndex, active.chapterIndex, active.taskRef);
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

  /**
   * 步进到严格后继步；发射 TaskStepTransitioned{from,to}。result 是本步的
   * Result 字段（T18 · #42：Gate 冲突清单 hardConflicts[] 随步进事件进账，
   * chapter-pipeline-spec §1 表第 7 行「冲突清单进 Result 字段」），键原样
   * 并入事件 payload；缺省不携带。
   */
  advance(to: PipelineStep, result?: Readonly<Record<string, unknown>>): void {
    const expected = nextStepOf(this.#currentStep);
    if (to !== expected) {
      throw new StepTransitionError(this.#currentStep, to, expected);
    }
    // ADR-0025：文学审查未 pass 时 review→user_edit 前进出口关闭（结构性，
    // 判据读当下投影——崩溃恢复后同样可判）。blocking_fail 只能显式回炉，
    // refused 停给作者；'pass' 放行。
    if (to === 'user_edit' && this.#currentStep === 'review') {
      const verdict = this.project().lastQualityVerdict;
      if (verdict !== 'pass') {
        throw new QualityReviewNotPassError(this.#chapterIndex, this.#taskRef, verdict);
      }
    }
    // S7 停止策略：硬冲突悬置时前进出口关闭（delta 不进确认面），只许显式回炉
    if (to === 'canon_proposal' && this.project().lastGateVerdict === 'hard_conflict') {
      throw new HardConflictUnresolvedError(this.#chapterIndex, this.#taskRef);
    }
    this.#publish({
      type: 'TaskStepTransitioned',
      taskRef: this.#taskRef,
      chapterIndex: this.#chapterIndex,
      payload: { from: this.#currentStep, to, ...(result ?? {}) },
    });
    this.#currentStep = to;
  }

  /**
   * 回炉边（T19 · #43；S7 回环停止策略 / S8 Gate 后行的显式驱动面）：门禁
   * hard_conflict 悬置时，作者「承认错误」改文 ⇒ 光标移回 user_edit，随后沿
   * 线性序重走 Final Extract 全量重提取（一致性优先于增量成本）。纪律：
   *   - 这是唯一的逆向步转换——且必须由作者显式调用本方法驱动（无自动迭代、
   *     无次数上限：有显式驱动即无失控）；advance() 的线性后继守卫不变；
   *   - 判据读当下投影（lastGateVerdict='hard_conflict'），不是内存光标——
   *     崩溃恢复后同样可判；verdict=pass 或未走到门禁即拒（ReworkNotDrivenError）；
   *   - 回炉事件照常落账：TaskStepTransitioned{from:'continuity_gate',to:'user_edit'}
   *     携带 reason 字段，投影折叠自然回到 user_edit（无第三处真源）。
   */
  requestRework(): void {
    if (this.#currentStep !== 'continuity_gate') {
      throw new StepGuardError('continuity_gate', this.#currentStep, 'requestRework');
    }
    const verdict = this.project().lastGateVerdict;
    if (verdict !== 'hard_conflict') {
      throw new ReworkNotDrivenError(this.#chapterIndex, verdict);
    }
    this.#publish({
      type: 'TaskStepTransitioned',
      taskRef: this.#taskRef,
      chapterIndex: this.#chapterIndex,
      payload: { from: 'continuity_gate', to: 'user_edit', reason: 'hard_conflict_rework' },
    });
    this.#currentStep = 'user_edit';
  }

  /**
   * 第 4 步步锚：QualityReviewCompleted（ADR-0025）——文学质量审查结果落账。
   * verdict 必须在场且 ∈ {pass, blocking_fail, refused}（宁败不猜）；报告本体
   * 由 review 步落 `.mozhou/quality-reviews/`（非 Canon），事件只携带身份与裁决。
   */
  recordQualityReview(payload: {
    readonly reportId: string;
    readonly verdict: 'pass' | 'blocking_fail' | 'refused';
    readonly reportPath?: string;
    readonly draftRevision?: number;
    readonly draftContentHash?: string;
    readonly receiptId?: string;
    readonly ruleSetDigest?: string;
  }): void {
    if (this.#currentStep !== 'review') {
      throw new StepGuardError('review', this.#currentStep, 'recordQualityReview');
    }
    this.#publish({
      type: 'QualityReviewCompleted',
      taskRef: this.#taskRef,
      chapterIndex: this.#chapterIndex,
      payload,
    });
  }

  /**
   * 质量回炉边（ADR-0025 决策 4/5）：blocking_fail 悬置时，编排者显式调用
   * ⇒ 光标移回 draft 重写正文，重写后沿线性序重走 review。纪律：
   *   - 只在 review 步且最新质量 verdict='blocking_fail' 时合法（判据读当下
   *     投影——崩溃恢复后同样可判）；refused/pass 或未审查即拒；
   *   - 每 session 自动回炉上限 2 次：第 3 次请求抛 QualityReworkLimitExceededError，
   *     停止并交作者处置（无自动循环——本方法只做一次逆向转换，重写与重审
   *     由编排者逐步驱动）；
   *   - 回炉事件照常落账：TaskStepTransitioned{from:'review',to:'draft',
   *     reason:'quality_rework',reworkAttempt:n}，投影折叠自然回到 draft。
   */
  requestQualityRework(): void {
    if (this.#currentStep !== 'review') {
      throw new StepGuardError('review', this.#currentStep, 'requestQualityRework');
    }
    const verdict = this.project().lastQualityVerdict;
    if (verdict !== 'blocking_fail') {
      throw new QualityReworkNotDrivenError(this.#chapterIndex, verdict);
    }
    const attempt = this.project().qualityReworkCount + 1;
    if (attempt > 2) {
      throw new QualityReworkLimitExceededError(this.#chapterIndex, this.#taskRef, attempt);
    }
    this.#publish({
      type: 'TaskStepTransitioned',
      taskRef: this.#taskRef,
      chapterIndex: this.#chapterIndex,
      payload: { from: 'review', to: 'draft', reason: 'quality_rework', reworkAttempt: attempt },
    });
    this.#currentStep = 'draft';
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
