/**
 * apps/web/server/routes/recycleRoutes.ts
 *
 * 回收站 HTTP 路由（对标 OpenWrite 议题 #103 / S-02 切片）：
 *   - POST /api/recycle.list    -> RecycleStore.list()
 *   - POST /api/recycle.restore -> 接收 { id }，RecycleStore.restore(id)，原路径被占用时明确拒绝（409 或 PATH_OCCUPIED 状态）
 *   - POST /api/recycle.purge   -> 接收 { id }，RecycleStore.purge(id) 彻底删除
 *
 * 策略 'account'：跟随主体或书上下文，严格使用 atomicWriteFileSync。
 */
import { join } from 'node:path'
import type { RouteHandler } from '../router.js'
import { RecycleStore, type TrashEntry } from '../recycle/recycleStore.js'

export interface RecycleListResponse {
  readonly ok: true
  readonly entries: readonly TrashEntry[]
}

export interface RecycleRestoreResponse {
  readonly ok: true
  readonly restoredTo: string
}

export interface RecyclePurgeResponse {
  readonly ok: true
  readonly purged: boolean
}

export interface RecycleErrorResponse {
  readonly ok: false
  readonly code: string
  readonly error: string
}

function resolveTrashRoot(body: Record<string, unknown>, contextBookRoot?: string | null): string {
  if (typeof body['trashRoot'] === 'string' && body['trashRoot'].trim() !== '') {
    return body['trashRoot'].trim()
  }
  const root =
    typeof body['root'] === 'string' && body['root'].trim() !== ''
      ? body['root'].trim()
      : contextBookRoot ?? null

  return root ? join(root, '..', 'trash') : join(process.cwd(), '.mozhou-trash')
}

export const recycleRoutes: RouteHandler = (req, res, { path, body, json, bookRoot: contextBookRoot }) => {
  if (req.method !== 'POST') return false

  if (path === '/api/recycle.list') {
    const store = new RecycleStore({ root: resolveTrashRoot(body, contextBookRoot) })
    try {
      const entries = store.list()
      json(200, { ok: true, entries })
    } catch (cause) {
      json(500, { ok: false, code: 'RECYCLE_LIST_FAILED', error: (cause as Error).message })
    }
    return true
  }

  if (path === '/api/recycle.restore') {
    const rawId = body['id']
    if (typeof rawId !== 'string' || rawId.trim() === '') {
      json(400, { ok: false, code: 'INVALID_RECYCLE_REQUEST', error: '缺少条目标识 id' })
      return true
    }
    const id = rawId.trim()
    const store = new RecycleStore({ root: resolveTrashRoot(body, contextBookRoot) })
    const result = store.restore(id)
    if (!result.ok) {
      if (result.error.includes('原路径已被占用')) {
        json(409, { ok: false, code: 'PATH_OCCUPIED', error: result.error })
      } else if (result.error.includes('不存在')) {
        json(404, { ok: false, code: 'TRASH_ENTRY_NOT_FOUND', error: result.error })
      } else {
        json(500, { ok: false, code: 'RECYCLE_RESTORE_FAILED', error: result.error })
      }
      return true
    }
    json(200, { ok: true, restoredTo: result.restoredTo })
    return true
  }

  if (path === '/api/recycle.purge') {
    const rawId = body['id']
    if (typeof rawId !== 'string' || rawId.trim() === '') {
      json(400, { ok: false, code: 'INVALID_RECYCLE_REQUEST', error: '缺少条目标识 id' })
      return true
    }
    const id = rawId.trim()
    const store = new RecycleStore({ root: resolveTrashRoot(body, contextBookRoot) })
    const purged = store.purge(id)
    if (!purged) {
      json(404, { ok: false, code: 'TRASH_ENTRY_NOT_FOUND', error: `回收站条目不存在或彻底删除失败：${id}` })
      return true
    }
    json(200, { ok: true, purged: true })
    return true
  }

  return false
}
