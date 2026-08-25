/**
 * 多候选择优（T17 · #41；ADR-0013 Localized Multi-Candidate Branching / S4）。
 *
 * 段落级分支：作者在光标/选区动作位上触发多候选（2-3 个竞争版本）时，
 * 每个候选先落 CandidateCreated（候选存在性入账），作者的择优选再落
 * UserEditRecorded{action:'candidate_decision'}——**accepted 与 rejected 两路
 * 必须同账落一行**方为有效飞轮信号（喂 Tier-1 偏好 EMA；只记接受不记拒绝的
 * 单路信号无法构成偏好对，机械校验在此挡住）。
 *
 * 纪律：
 *   - 决策引用的候选 id 必须能在账本中回溯到 CandidateCreated 行（宁败不猜——
 *     凭空决策不是信号）；
 *   - 动作位沿 M16 V1 两级（cursor/selection，复用 user-edit-step 词表）；
 *   - 本模块只管落账与校验：候选文本的生成走 Draft 缝（engine.execute），
 *     原文驻留调用方，账面只携带 id/字数等轻量元数据。
 */
import type { PublishBus } from '@mozhou/runtime';
import { readPipelineLedger } from './ledger.js';
import { EDIT_ACTION_LEVELS_V1, EditActionLevelError } from './user-edit-step.js';
import type { EditActionLevel } from './user-edit-step.js';

/** 候选项视图：调用方供给的竞争版本（原文不入账，只入元数据）。 */
export interface CandidateOption {
  readonly candidateId: string;
  readonly text: string;
}

export interface PresentedCandidate {
  readonly candidateId: string;
  readonly chars: number;
}

function assertActionLevel(level: EditActionLevel): void {
  if (!(EDIT_ACTION_LEVELS_V1 as readonly string[]).includes(level)) {
    throw new EditActionLevelError(String(level));
  }
}

interface CandidateDeps {
  readonly bus: PublishBus;
  readonly bookRoot: string;
  readonly taskRef: string;
  readonly chapterIndex: number;
}

/**
 * 候选呈现：每个候选项落一条 CandidateCreated（payload 携带 id/动作位/字数）。
 * 返回呈现视图供 UI/编排方引用。
 */
export function presentCandidates(
  deps: CandidateDeps,
  request: { readonly level: EditActionLevel; readonly options: readonly CandidateOption[] },
): readonly PresentedCandidate[] {
  assertActionLevel(request.level);
  if (request.options.length < 2) {
    throw new Error('multi-candidate branching requires at least two options (ADR-0013)');
  }
  const seen = new Set<string>();
  for (const option of request.options) {
    if (option.candidateId.length === 0) {
      throw new Error('candidateId must be non-empty');
    }
    if (seen.has(option.candidateId)) {
      throw new Error(`duplicate candidateId: ${option.candidateId}`);
    }
    seen.add(option.candidateId);
  }

  const presented: PresentedCandidate[] = [];
  for (const option of request.options) {
    deps.bus.publish({ root: deps.bookRoot }, {
      type: 'CandidateCreated',
      taskRef: deps.taskRef,
      chapterIndex: deps.chapterIndex,
      payload: {
        candidateId: option.candidateId,
        level: request.level,
        chars: option.text.length,
      },
    });
    presented.push({ candidateId: option.candidateId, chars: option.text.length });
  }
  return presented;
}

/** 账本回溯：同任务窗口内已呈现过的候选 id 集。 */
function presentedCandidateIds(deps: CandidateDeps): Set<string> {
  const ids = new Set<string>();
  for (const row of readPipelineLedger(deps.bookRoot)) {
    if (row.kind !== 'task') continue;
    const event = row.event;
    if (event.type !== 'CandidateCreated' || event.taskRef !== deps.taskRef) continue;
    const id = event.payload?.['candidateId'];
    if (typeof id === 'string') {
      ids.add(id);
    }
  }
  return ids;
}

export interface CandidateDecisionRequest {
  readonly level: EditActionLevel;
  /** 接受路：被采纳的候选 id（≥1，否则不构成偏好信号）。 */
  readonly acceptedOptionIds: readonly string[];
  /** 拒绝路：被否决的候选 id（≥1；与接受路不相交）。 */
  readonly rejectedOptionIds: readonly string[];
}

/**
 * 择优决策：accepted/rejected 双路同账落一条 UserEditRecorded——有效飞轮信号的
 * 唯一合法形态。全部 id 必须能回溯到本任务窗口的 CandidateCreated 行。
 */
export function recordCandidateDecision(
  deps: CandidateDeps,
  request: CandidateDecisionRequest,
): { readonly acceptedOptionIds: readonly string[]; readonly rejectedOptionIds: readonly string[] } {
  assertActionLevel(request.level);

  const accepted = [...request.acceptedOptionIds];
  const rejected = [...request.rejectedOptionIds];
  if (accepted.length === 0 || rejected.length === 0) {
    throw new Error(
      'preference signal requires BOTH accepted and rejected paths (ADR-0013) — single-path decisions are not valid flywheel input',
    );
  }
  const overlap = accepted.filter((id) => rejected.includes(id));
  if (overlap.length > 0) {
    throw new Error(`candidate cannot be both accepted and rejected: ${overlap.join(', ')}`);
  }

  // 回溯校验：凭空决策不是信号（宁败不猜）
  const known = presentedCandidateIds(deps);
  const unknown = [...accepted, ...rejected].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`decision references candidates never presented in this window: ${unknown.join(', ')}`);
  }

  deps.bus.publish({ root: deps.bookRoot }, {
    type: 'UserEditRecorded',
    taskRef: deps.taskRef,
    chapterIndex: deps.chapterIndex,
    payload: {
      action: 'candidate_decision',
      level: request.level,
      acceptedOptionIds: accepted,
      rejectedOptionIds: rejected,
    },
  });
  return { acceptedOptionIds: accepted, rejectedOptionIds: rejected };
}
