/**
 * apps/web · Story Brain 与核心书目数据路由控制器。
 */
import type { RouteHandler } from '../router.js'
import { createBook, LocalDataPlane, readCanonState } from '@mozhou/data-plane'
import type { EntityRef } from '@mozhou/kernel'

export const storyBrainRoutes: RouteHandler = (req, res, { path, body, json }) => {
  if (req.method !== 'POST') return false

  if (path === '/api/book') {
    const dir = typeof body['dir'] === 'string' ? body['dir'] : '/tmp/mozhou-book-' + Date.now()
    const title = typeof body['title'] === 'string' ? body['title'] : '未命名之书'
    const result = createBook({ dir, title })
    json(200, { ok: true, root: result.root, bookId: result.book.id })
    return true
  }

  if (path === '/api/book.state') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    if (root === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    json(200, { ok: true, state: readCanonState(root) })
    return true
  }

  if (path === '/api/story-brain.entities') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    if (root === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    const plane = LocalDataPlane.open(root)
    json(200, { ok: true, cards: plane.getEntityCards() })
    return true
  }

  if (path === '/api/story-brain.facts') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    if (root === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
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
