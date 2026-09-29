/**
 * 备忘录路由（OpenWrite 对标切片 · 工单 22）：
 * - POST /api/memo 单端点 action 分发：list / create / update / delete。
 * - 策略 'account'（routePolicies）：本地模式回退 local_user 主体，
 *   hosted 模式必须持有效 Session——便签永远跟随主体，不跟随书。
 * - 校验失败 400、便签不存在 404、超上限 409；不虚构成功响应。
 */
import type { RouteHandler } from '../router.js'
import {
  MEMO_MAX_CONTENT_CHARS,
  MEMO_MAX_TITLE_CHARS,
  MemoLimitError,
  MemoNotFoundError,
  defaultMemoStore,
} from '../memo/memoStore.js'

export interface MemoNote {
  readonly id: string
  readonly title: string
  readonly content: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** POST /api/memo {action:'list'} 成功响应。 */
export interface MemoListResponse {
  readonly ok: true
  readonly notes: readonly MemoNote[]
}

/** POST /api/memo create/update → note；delete → deleted。 */
export interface MemoMutationResponse {
  readonly ok: true
  readonly note?: MemoNote
  readonly deleted?: true
}

export interface MemoErrorResponse {
  readonly ok: false
  readonly code: string
  readonly error: string
}

export type MemoResponse = MemoListResponse | MemoMutationResponse | MemoErrorResponse

function invalid(res: (status: number, payload: unknown) => void, error: string): void {
  res(400, { ok: false, code: 'INVALID_MEMO_REQUEST', error })
}

export const memoRoutes: RouteHandler = (req, res, { path, body, json, principal }) => {
  if (req.method !== 'POST' || path !== '/api/memo') return false

  if (principal === null || principal === undefined) {
    json(401, { ok: false, code: 'UNAUTHORIZED', error: 'authentication required' })
    return true
  }
  const userId = principal.userId

  const action = body['action']
  if (action === 'list') {
    try {
      json(200, { ok: true, notes: defaultMemoStore.list(userId) })
    } catch (error) {
      json(500, { ok: false, code: 'MEMO_PERSIST_FAILED', error: (error as Error).message })
    }
    return true
  }

  if (action === 'create') {
    const title = typeof body['title'] === 'string' ? body['title'].trim() : ''
    const content = typeof body['content'] === 'string' ? body['content'] : ''
    if (title.length > MEMO_MAX_TITLE_CHARS) {
      invalid(json, `title 超过 ${MEMO_MAX_TITLE_CHARS} 字上限`)
      return true
    }
    if (content.trim() === '') {
      invalid(json, 'content 不能为空')
      return true
    }
    if (content.length > MEMO_MAX_CONTENT_CHARS) {
      invalid(json, `content 超过 ${MEMO_MAX_CONTENT_CHARS} 字上限`)
      return true
    }
    try {
      json(200, { ok: true, note: defaultMemoStore.create(userId, title, content) })
    } catch (error) {
      if (error instanceof MemoLimitError) {
        json(409, { ok: false, code: 'MEMO_LIMIT_EXCEEDED', error: '便签数量已达上限' })
      } else {
        json(500, { ok: false, code: 'MEMO_PERSIST_FAILED', error: (error as Error).message })
      }
    }
    return true
  }

  if (action === 'update' || action === 'delete') {
    const id = typeof body['id'] === 'string' ? body['id'] : ''
    if (id === '') {
      invalid(json, 'id required')
      return true
    }
    try {
      if (action === 'delete') {
        defaultMemoStore.remove(userId, id)
        json(200, { ok: true, deleted: true })
        return true
      }
      const patch: { title?: string; content?: string } = {}
      if (typeof body['title'] === 'string') {
        const title = body['title'].trim()
        if (title.length > MEMO_MAX_TITLE_CHARS) {
          invalid(json, `title 超过 ${MEMO_MAX_TITLE_CHARS} 字上限`)
          return true
        }
        patch.title = title
      }
      if (typeof body['content'] === 'string') {
        if (body['content'].trim() === '') {
          invalid(json, 'content 不能为空')
          return true
        }
        if (body['content'].length > MEMO_MAX_CONTENT_CHARS) {
          invalid(json, `content 超过 ${MEMO_MAX_CONTENT_CHARS} 字上限`)
          return true
        }
        patch.content = body['content']
      }
      if (Object.keys(patch).length === 0) {
        invalid(json, 'title 或 content 至少提供一项')
        return true
      }
      json(200, { ok: true, note: defaultMemoStore.update(userId, id, patch) })
    } catch (error) {
      if (error instanceof MemoNotFoundError) {
        json(404, { ok: false, code: 'MEMO_NOTE_NOT_FOUND', error: '便签不存在或已被删除' })
      } else {
        json(500, { ok: false, code: 'MEMO_PERSIST_FAILED', error: (error as Error).message })
      }
    }
    return true
  }

  invalid(json, "action 必须是 list / create / update / delete")
  return true
}
