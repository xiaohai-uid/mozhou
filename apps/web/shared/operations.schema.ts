/**
 * W3 操作幂等 · 运行时校验（browser-safe，无 node:* 依赖）。
 * 只做形状校验：UI 侧据此把服务端响应收窄成契约类型，未知形状一律拒绝（不静默解释）。
 */
import type { OperationStatus } from './operations.js'

/** operationId 形状：长度 1–128，字符集 ^[A-Za-z0-9._:-]+$（与服务端 parseOperationIntent 同口径）。 */
export function isOperationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把服务端状态响应收窄成 OperationStatus；形状不认识 → null（调用方按未知处理）。 */
export function parseOperationStatus(value: unknown): OperationStatus | null {
  if (!isRecord(value)) return null
  const state = value['state']
  if (state === 'not_found') {
    return { state: 'not_found', safeToRetrySameId: value['safeToRetrySameId'] === true }
  }
  const operationId = value['operationId']
  if (!isOperationId(operationId)) return null
  if (state === 'running' || state === 'cancelled' || state === 'outcome_unknown') {
    return { state, operationId }
  }
  if (state === 'failed') {
    const code = value['code']
    return { state: 'failed', operationId, code: typeof code === 'string' ? code : 'UNKNOWN' }
  }
  if (state === 'succeeded') {
    const result = value['result']
    if (!isRecord(result)) return null
    const appliedRevision = result['appliedRevision']
    const appliedBodyHash = result['appliedBodyHash']
    const currentRevision = value['currentRevision']
    if (typeof appliedRevision !== 'number' || typeof appliedBodyHash !== 'string' || typeof currentRevision !== 'number') {
      return null
    }
    const commitId = result['commitId']
    return {
      state: 'succeeded',
      operationId,
      result: {
        appliedRevision,
        appliedBodyHash,
        ...(typeof commitId === 'string' ? { commitId } : {}),
      },
      currentRevision,
      replayed: true,
    }
  }
  return null
}
