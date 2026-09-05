/**
 * apps/web · Story Brain 与核心书目数据路由控制器。
 */
import type { RouteHandler } from '../router.js'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  AUTHOR_INTENT_PATH,
  atomicReplace,
  createBook,
  emitFrontmatter,
  LocalDataPlane,
  parseFrontmatter,
  readCanonState,
  readManifest,
  refreshManifestEntries,
  renderAuthorIntentBody,
  writeManifest,
  type InitialAuthorIntentInput,
} from '@mozhou/data-plane'
import type { EntityRef } from '@mozhou/kernel'
import { assertSafeBookRoot } from '../security.js'

function parseInitialAuthorIntent(input: unknown): InitialAuthorIntentInput | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const obj = input as Record<string, unknown>
  const result: {
    worldRule?: string
    volumePromise?: string
    opening?: string
    firstChapterGoal?: string
  } = {}
  if (typeof obj['worldRule'] === 'string' && obj['worldRule'].trim().length > 0) {
    result.worldRule = obj['worldRule'].trim()
  }
  if (typeof obj['volumePromise'] === 'string' && obj['volumePromise'].trim().length > 0) {
    result.volumePromise = obj['volumePromise'].trim()
  }
  if (typeof obj['opening'] === 'string' && obj['opening'].trim().length > 0) {
    result.opening = obj['opening'].trim()
  }
  if (typeof obj['firstChapterGoal'] === 'string' && obj['firstChapterGoal'].trim().length > 0) {
    result.firstChapterGoal = obj['firstChapterGoal'].trim()
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export const storyBrainRoutes: RouteHandler = (req, res, { path, body, json }) => {
  if (req.method !== 'POST') return false

  if (path === '/api/book') {
    const rawDir = typeof body['dir'] === 'string' && body['dir'].trim().length > 0 ? body['dir'].trim() : null
    let dir: string
    if (rawDir !== null) {
      dir = resolve(rawDir)
    } else {
      const library = resolve(process.env['MOZHOU_LIBRARY_DIR'] ?? join(homedir(), 'MoZhou', 'Books'))
      mkdirSync(library, { recursive: true })
      dir = join(library, randomUUID())
    }
    const title = typeof body['title'] === 'string' ? body['title'] : '未命名之书'
    const rawIntent = parseInitialAuthorIntent(body['authorIntent'])
    const result = createBook({
      dir,
      title,
      ...(rawIntent !== undefined ? { authorIntent: rawIntent } : {}),
    })
    const plane = LocalDataPlane.open(result.root)
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    } finally {
      plane.close()
    }
    json(200, { ok: true, root: resolve(result.root), bookId: result.book.id })
    return true
  }

  if (path === '/api/author-intent.update') {
    const rawRoot = typeof body['root'] === 'string' ? body['root'] : null
    if (rawRoot === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    const root = assertSafeBookRoot(rawRoot)
    const intentPath = join(root, AUTHOR_INTENT_PATH)
    if (!existsSync(intentPath)) {
      json(404, { ok: false, error: 'author intent file not found' })
      return true
    }
    const raw = readFileSync(intentPath, 'utf8')
    const doc = parseFrontmatter(raw)
    const worldRule = typeof body['worldRule'] === 'string' ? body['worldRule'].trim() : ''
    const volumePromise = typeof body['volumePromise'] === 'string' ? body['volumePromise'].trim() : ''
    const opening = typeof body['opening'] === 'string' ? body['opening'].trim() : ''
    const firstChapterGoal = typeof body['firstChapterGoal'] === 'string' ? body['firstChapterGoal'].trim() : ''

    const content = `${emitFrontmatter(doc.data)}${renderAuthorIntentBody({
      worldRule,
      volumePromise,
      opening,
      firstChapterGoal,
    })}`

    atomicReplace(root, AUTHOR_INTENT_PATH, content)
    writeManifest(root, refreshManifestEntries(readManifest(root), root, [AUTHOR_INTENT_PATH]))
    json(200, { ok: true })
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
