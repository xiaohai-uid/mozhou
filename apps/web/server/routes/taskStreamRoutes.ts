/**
 * W4-2c-2 · POST /api/tasks.events —— 任务事件流的**游标补发优先、快照回退兜底**。
 *
 * - 游标 = **外层 seq**（账本级全局序号）。客户端带 `since` 重连时，补发 `seq > since` 的任务事件行。
 * - 游标不可用（非法 / 领先于账本末号 / 早于账本首号之前）⇒ 返回**快照**，快照与账本真实终态一致
 *   （每个任务取账本里最后一条任务行）。
 * - **平铺领域行不参与**：读端（readLedger）本就只取任务事件行，本路由不改也不写任何行。
 *
 * 口径说明：判定规则与 apps/web/shared/taskStream.ts 的 decideStreamMode **同口径**。
 * 两侧不能互相 import（server 的 tsconfig rootDir=server，shared 在其外），故各自实现、
 * 各自有用例；**规则改动必须同步两侧**（用例表两侧相同）。
 */
import { randomUUID } from 'node:crypto'
import { isTaskOutcomeUnknown, readTaskRecord, retryTaskWithExplicitConfirmation } from '@mozhou/data-plane'
import { readLedger } from '@mozhou/runtime'
import type { RouteHandler } from '../router.js'
import { RequestBoundaryError, assertSafeBookRoot } from '../security.js'
import { BILLING_CONFIRMATION_REQUIRED, INVALID_BOOK_REQUEST, TASK_NOT_FOUND } from '../routeCodes.js'

interface TaskRowView {
  readonly seq: number
  readonly schemaVersion: number
  readonly taskId: string
  readonly attemptId?: string
  readonly generationEpoch: number
  readonly sequence: number
  readonly event: unknown
}

type StreamMode = { readonly mode: 'replay' } | { readonly mode: 'snapshot'; readonly reason: string }

/** 与 shared/taskStream.ts 的 decideStreamMode 同口径（改动必须同步）。 */
export function decideStreamMode(input: {
  readonly since: number | null
  readonly firstSeq: number | null
  readonly lastSeq: number | null
}): StreamMode {
  const { since, firstSeq, lastSeq } = input
  if (since === null || !Number.isInteger(since) || since < 0) {
    return { mode: 'snapshot', reason: 'cursor_invalid' }
  }
  if (lastSeq === null) {
    return { mode: 'replay' }
  }
  if (since > lastSeq) {
    return { mode: 'snapshot', reason: 'cursor_ahead' }
  }
  if (firstSeq !== null && since < firstSeq - 1) {
    return { mode: 'snapshot', reason: 'ledger_truncated' }
  }
  return { mode: 'replay' }
}

export const taskStreamRoutes: RouteHandler = (req, res, { path, body, json, bookRoot, principal }) => {
  if (path === '/api/tasks.retry') {
    // F-02：书根只认网关解析出的**已授权书根**（ctx.bookRoot = hosted 下按主体解析的
    // authorizedBook.root ?? local 下 body.root）。此前直接信任客户端 body.root——
    // hosted 用户 A 携带自己的 bookId + 用户 B 的合法相对 root 即可读写 B 的任务。
    // relative 路径能穿过 hosted 的路径注入检查（无 ..、非绝对、无盘符），故必须在
    // 这里收口到授权书根，绝不回读 body.root。
    if (typeof bookRoot !== 'string' || bookRoot.trim().length === 0) {
      json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'root is required' })
      return true
    }
    let root: string
    try {
      root = assertSafeBookRoot(bookRoot)
    } catch (cause) {
      if (cause instanceof RequestBoundaryError) {
        json(cause.status, { ok: false, code: cause.code, error: cause.message })
        return true
      }
      throw cause
    }
    const taskId = typeof body['taskId'] === 'string' ? body['taskId'] : null
    if (taskId === null) {
      json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'taskId is required' })
      return true
    }
    const record = readTaskRecord(root, taskId)
    if (record === null) {
      json(404, { ok: false, code: TASK_NOT_FOUND, error: `task ${taskId} not found` })
      return true
    }

    const confirmDuplicateBilling = Boolean(body['confirmDuplicateBilling'])
    if (isTaskOutcomeUnknown(record) && !confirmDuplicateBilling) {
      json(400, {
        ok: false,
        code: BILLING_CONFIRMATION_REQUIRED,
        error: '上次调用结果不明，可能已被计费；重新发起将作为全新尝试，需显式确认重复计费风险',
        retryAllowed: false,
      })
      return true
    }

    const newAttemptId = typeof body['newAttemptId'] === 'string' ? body['newAttemptId'] : `att_retry_${randomUUID()}`
    const newOperationId = typeof body['newOperationId'] === 'string' ? body['newOperationId'] : `op_retry_${randomUUID()}`

    try {
      const updated = retryTaskWithExplicitConfirmation(root, taskId, {
        newAttemptId,
        newOperationId,
        confirmDuplicateBilling,
      })
      json(200, {
        ok: true,
        taskId: updated.taskId,
        attemptId: newAttemptId,
        operationId: newOperationId,
        taskRecord: updated,
      })
    } catch (err) {
      json(400, { ok: false, error: (err as Error).message })
    }
    return true
  }

  if (path !== '/api/tasks.events') return false

  // F-02：与 /api/tasks.retry 同缝——书根只认网关已授权书根，不读客户端 body.root
  //（hosted 越权修复见上方 retry 分支注释）。
  if (typeof bookRoot !== 'string' || bookRoot.trim().length === 0) {
    json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'root is required' })
    return true
  }
  let root: string
  try {
    root = assertSafeBookRoot(bookRoot)
  } catch (cause) {
    if (cause instanceof RequestBoundaryError) {
      json(cause.status, { ok: false, code: cause.code, error: cause.message })
      return true
    }
    throw cause
  }
  void principal
  void req
  void res

  const rawSince = body['since']
  const since = typeof rawSince === 'number' ? rawSince : rawSince === undefined || rawSince === null ? null : Number.NaN

  // readLedger 只返回任务事件行（平铺领域行在读端被跳过，本路由不触碰它们）
  const rows = readLedger({ root }).filter((row) => row.task !== undefined)
  const firstSeq = rows.length === 0 ? null : (rows[0]?.seq ?? null)
  const lastSeq = rows.length === 0 ? null : (rows[rows.length - 1]?.seq ?? null)

  const decision = decideStreamMode({ since, firstSeq, lastSeq })
  if (decision.mode === 'snapshot') {
    // 快照 = 账本真实终态：每个任务取最后一条任务行
    const latest = new Map<string, TaskRowView>()
    for (const row of rows) {
      const task = row.task
      if (task === undefined) continue
      latest.set(task.taskId, {
        seq: row.seq,
        schemaVersion: task.schemaVersion,
        taskId: task.taskId,
        ...(task.attemptId === undefined ? {} : { attemptId: task.attemptId }),
        generationEpoch: task.generationEpoch,
        sequence: task.sequence,
        event: row.event,
      })
    }
    json(200, {
      ok: true,
      mode: 'snapshot',
      reason: decision.reason,
      snapshot: { lastSeq, tasks: [...latest.values()] },
    })
    return true
  }

  const replay = rows
    .filter((row) => since !== null && row.seq > since)
    .map((row) => {
      const task = row.task
      return {
        seq: row.seq,
        schemaVersion: task?.schemaVersion ?? 0,
        taskId: task?.taskId ?? '',
        ...(task?.attemptId === undefined ? {} : { attemptId: task.attemptId }),
        generationEpoch: task?.generationEpoch ?? 0,
        sequence: task?.sequence ?? 0,
        event: row.event,
      }
    })
  json(200, { ok: true, mode: 'replay', rows: replay, cursor: lastSeq ?? since ?? 0 })
  return true
}
