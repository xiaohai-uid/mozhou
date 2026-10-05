/**
 * W4-2c-3 『续写』操作（t41 §E.2 / 主方案 §6.5）。
 *
 * 核心契约：
 * 1. 新 operationId：必须为新生成，严禁复用 generationId，严禁复用被续写候选 id；
 * 2. taskKind='draft.continue'：与常规生成 ('draft.generate') 正交区分，落盘任务记录；
 * 3. 成本发起前可见：提供 estimateContinueCost 计算基底字数与预估输入/输出 tokens；
 * 4. 不允许静默自动发起：必须由显式用户请求或调用触发；
 * 5. 禁止实现成重放原 attemptId：每次调用分配全新 attemptId，计费独立归因。
 */
import { randomUUID } from 'node:crypto'
import {
  createTaskRecord,
  beginTaskAttempt,
  linkTaskOperation,
  readTaskRecord,
  type TaskRecord,
} from '@mozhou/data-plane'
import { readDraftCandidate, type DraftCandidate } from './draft-candidate.js'

export interface ContinueCostEstimate {
  readonly baseChars: number
  readonly estimatedInputTokens: number
  readonly estimatedOutputTokens: number
  readonly provider: string
  readonly costNotice: string
}

export interface PrepareDraftContinueRequest {
  readonly bookRoot: string
  readonly sourceCandidateId: string
  readonly operationId: string
  readonly taskId?: string | undefined
  readonly provider?: string | undefined
  readonly model?: string | undefined
}

export interface PrepareDraftContinueResult {
  readonly taskId: string
  readonly attemptId: string
  readonly operationId: string
  readonly sourceCandidate: DraftCandidate
  readonly taskRecord: TaskRecord
  readonly costEstimate: ContinueCostEstimate
}

export class ContinueOperationError extends Error {
  override readonly name = 'ContinueOperationError'
  constructor(
    readonly code: 'INVALID_OPERATION_ID' | 'CANDIDATE_NOT_FOUND' | 'AUTO_LAUNCH_FORBIDDEN',
    message: string,
  ) {
    super(message)
  }
}

/** 估算续写成本（发起前可见）。 */
export function estimateContinueCost(candidate: DraftCandidate, provider = 'deepseek'): ContinueCostEstimate {
  const baseChars = candidate.text.length
  // 中文场景估算：基底字符 + 提示词开销，预估输出 1000 tokens
  const estimatedInputTokens = Math.ceil(baseChars / 1.5) + 300
  const estimatedOutputTokens = 1000
  return {
    baseChars,
    estimatedInputTokens,
    estimatedOutputTokens,
    provider,
    costNotice: `续写基底 ${baseChars} 字，预计输入 ~${estimatedInputTokens} tokens，预计输出 ~${estimatedOutputTokens} tokens`,
  }
}

/**
 * 准备续写操作（非静默显式入口）：
 * 校验 operationId 不复用 generationId / 候选 id；
 * 创建 taskKind='draft.continue' 任务记录并绑定全新 attemptId；
 * 返回发起前可见的成本估算。
 */
export function prepareDraftContinue(request: PrepareDraftContinueRequest): PrepareDraftContinueResult {
  const { bookRoot, sourceCandidateId, operationId } = request
  if (!operationId || typeof operationId !== 'string') {
    throw new ContinueOperationError('INVALID_OPERATION_ID', 'INVALID_OPERATION_ID: valid operationId is required')
  }

  const candidate = readDraftCandidate(bookRoot, sourceCandidateId)
  if (candidate === null) {
    throw new ContinueOperationError('CANDIDATE_NOT_FOUND', `CANDIDATE_NOT_FOUND: source candidate ${sourceCandidateId} not found`)
  }

  // 严禁复用 generationId 与候选 id
  if (operationId === candidate.id || operationId === candidate.generationId) {
    throw new ContinueOperationError(
      'INVALID_OPERATION_ID',
      `INVALID_OPERATION_ID: continue operationId cannot reuse candidateId (${candidate.id}) or generationId (${candidate.generationId})`,
    )
  }

  const taskId = request.taskId ?? `task_cont_${randomUUID()}`
  let task = readTaskRecord(bookRoot, taskId)
  if (task === null) {
    task = createTaskRecord(bookRoot, {
      taskId,
      bookId: candidate.bookId,
      taskKind: 'draft.continue',
    })
  }

  // 严禁重放原 attemptId：每次调用分配全新 attemptId
  const attemptId = `att_cont_${randomUUID()}`
  task = beginTaskAttempt(bookRoot, taskId, {
    attemptId,
    ...(request.provider === undefined ? {} : { provider: request.provider }),
    ...(request.model === undefined ? {} : { model: request.model }),
  })
  task = linkTaskOperation(bookRoot, taskId, operationId)

  const costEstimate = estimateContinueCost(candidate, request.provider ?? 'deepseek')

  return {
    taskId,
    attemptId,
    operationId,
    sourceCandidate: candidate,
    taskRecord: task,
    costEstimate,
  }
}
