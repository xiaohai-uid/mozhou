/**
 * apps/web · Story Brain 与核心书目数据路由控制器。
 */
import type { RouteHandler } from '../router.js'
import { createBook, LocalDataPlane } from '@mozhou/data-plane'
import type { EntityRef } from '@mozhou/kernel'
import { assertSafeBookRoot } from '../security.js'
import { defaultBookAccessManager } from '../bookAccess.js'

export const storyBrainRoutes: RouteHandler = (req, res, { path, body, json, principal }) => {
  if (req.method !== 'POST') return false

  if (path === '/api/book') {
    if (defaultBookAccessManager.isHostedMode()) {
      if (typeof body['dir'] === 'string' && (body['dir'].includes('..') || body['dir'].startsWith('/') || body['dir'].startsWith('\\') || /^[A-Za-z]:/.test(body['dir']))) {
        json(400, { ok: false, error: 'direct filesystem dir rejected in hosted mode' })
        return true
      }
      const title = typeof body['title'] === 'string' ? body['title'] : '未命名之书'
      const userId = principal?.userId ?? 'local_user'
      const book = defaultBookAccessManager.createHostedBook(userId, title)
      json(200, { ok: true, root: book.root, bookId: book.bookId })
      return true
    }
    const dir = typeof body['dir'] === 'string' ? body['dir'] : '/tmp/mozhou-book-' + Date.now()
    const title = typeof body['title'] === 'string' ? body['title'] : '未命名之书'
    const result = createBook({ dir, title })
    defaultBookAccessManager.registerLocalBook(result.root, result.book.id)
    json(200, { ok: true, root: result.root, bookId: result.book.id })
    return true
  }

  if (path === '/api/book.state') {
    const rawRoot = typeof body['root'] === 'string' ? body['root'] : null
    if (rawRoot === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    const root = assertSafeBookRoot(rawRoot)
    const plane = LocalDataPlane.openOrRebuild(root)
    try {
      json(200, { ok: true, state: plane.getCanonState() })
    } finally {
      plane.close()
    }
    return true
  }

  if (path === '/api/story-brain.entities') {
    const rawRoot = typeof body['root'] === 'string' ? body['root'] : null
    if (rawRoot === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    const root = assertSafeBookRoot(rawRoot)
    const plane = LocalDataPlane.open(root)
    json(200, { ok: true, cards: plane.getEntityCards() })
    return true
  }

  if (path === '/api/story-brain.facts') {
    const rawRoot = typeof body['root'] === 'string' ? body['root'] : null
    if (rawRoot === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    const root = assertSafeBookRoot(rawRoot)
    const rawEntityIds = Array.isArray(body['entityIds']) ? body['entityIds'] : []
    const entityIds = rawEntityIds.filter((r): r is EntityRef => typeof r === 'string' && r.length > 0)

    const plane = LocalDataPlane.open(root)
    const overview = plane.queryStoryBrain({ entityIds })
    json(200, {
      ok: true,
      ...overview,
    })
    return true
  }

  return false
}
