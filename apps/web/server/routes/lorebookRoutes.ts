/**
 * apps/web · 世界书（Lorebook）路由控制器 — 对标 SillyTavern World Info 管理：
 * 条目 CRUD；命中注入语义在 context-compiler scanLorebookTriggers（draft 链路自动生效）。
 */
import type { RouteHandler } from '../router.js'
import {
  deleteLorebookEntry,
  readLorebook,
  upsertLorebookEntry,
  type LorebookEntry,
} from '@mozhou/data-plane'
import { assertSafeBookRoot } from '../security.js'

export interface LorebookListResponse {
  readonly ok: true
  readonly entries: readonly LorebookEntry[]
}

export interface LorebookUpsertRequest {
  readonly root: string
  readonly entry: LorebookEntry
}

function parseEntry(raw: unknown): LorebookEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  const id = obj['id']
  const title = obj['title']
  const keywords = obj['keywords']
  const content = obj['content']
  const enabled = obj['enabled']
  if (
    typeof id !== 'string' ||
    typeof title !== 'string' ||
    !Array.isArray(keywords) ||
    keywords.some((k) => typeof k !== 'string') ||
    typeof content !== 'string' ||
    typeof enabled !== 'boolean'
  ) {
    return null
  }
  return {
    id,
    title,
    keywords: keywords as readonly string[],
    content,
    enabled,
  }
}

export const lorebookRoutes: RouteHandler = (req, res, { path, body, json }) => {
  if (req.method !== 'POST') return false

  if (path === '/api/lorebook.list') {
    const rawRoot = typeof body['root'] === 'string' ? body['root'] : null
    if (rawRoot === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    const root = assertSafeBookRoot(rawRoot)
    let entries: readonly LorebookEntry[] = []
    try {
      entries = readLorebook(root)
    } catch (error) {
      json(400, { ok: false, error: (error as Error).message })
      return true
    }
    json(200, { ok: true, entries } satisfies LorebookListResponse)
    return true
  }

  if (path === '/api/lorebook.upsert') {
    const rawRoot = typeof body['root'] === 'string' ? body['root'] : null
    const entry = parseEntry(body['entry'])
    if (rawRoot === null || entry === null) {
      json(400, { ok: false, error: 'root and entry(id/title/keywords/content/enabled) required' })
      return true
    }
    const root = assertSafeBookRoot(rawRoot)
    try {
      const entries = upsertLorebookEntry(root, entry)
      json(200, { ok: true, entries })
      return true
    } catch (error) {
      json(400, { ok: false, error: (error as Error).message })
      return true
    }
  }

  if (path === '/api/lorebook.delete') {
    const rawRoot = typeof body['root'] === 'string' ? body['root'] : null
    const id = typeof body['id'] === 'string' ? body['id'] : null
    if (rawRoot === null || id === null) {
      json(400, { ok: false, error: 'root and id required' })
      return true
    }
    const root = assertSafeBookRoot(rawRoot)
    try {
      const entries = deleteLorebookEntry(root, id)
      json(200, { ok: true, entries })
      return true
    } catch (error) {
      json(400, { ok: false, error: (error as Error).message })
      return true
    }
  }

  return false
}
