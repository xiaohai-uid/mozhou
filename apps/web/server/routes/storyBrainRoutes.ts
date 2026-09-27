/**
 * apps/web · Story Brain 与核心书目数据路由控制器。
 */
import type { RouteHandler } from '../router.js'
import {
  AUTHOR_INTENT_PATH,
  TRACKING_STREAMS,
  createBook,
  LocalDataPlane,
  readPlanningArtifact,
  readWizardAuthorIntent,
  syncPlanningArtifactRow,
  withPlane,
  wizardAuthorIntentEquals,
  writeWizardAuthorIntent,
} from '@mozhou/data-plane'
import type { WizardAuthorIntentInput } from '@mozhou/data-plane'
import type { EntityRef } from '@mozhou/kernel'
import { assertSafeBookRoot } from '../security.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * S4 增量收口：应用自己刚写完作者意图后，只同步 planning_artifacts 投影行并把
 * 该文件并入 hash 基线，不走 rebuildProjectionFromCanon——全量重建的 buildManifest
 * 会把无关的外部漂移一并吸进基线，静默吞掉作者尚未审阅的外部改动。
 */
function absorbAuthorIntentWrite(root: string): void {
  const plane = LocalDataPlane.openOrRebuild(root)
  try {
    syncPlanningArtifactRow(plane.db, readPlanningArtifact(root, AUTHOR_INTENT_PATH, 'authorIntent'))
    plane.absorbAppWrite([AUTHOR_INTENT_PATH])
  } finally {
    plane.close()
  }
}

export const storyBrainRoutes: RouteHandler = async (req, res, { path, body, json, principal, authorizedBook, bookRoot }) => {
  if (req.method !== 'POST') return false

  const resolvedRoot = bookRoot ?? null

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
    const requestedDir = typeof body['dir'] === 'string' ? body['dir'].trim() : ''
    // 本地模式未指定目录时，书必须落在数据根内（跟随 MOZHOU_DATA_ROOT / 数据卷），
    // 而非系统临时目录：此前默认 '/tmp/mozhou-book-<ts>' 在 Windows 上落到 C:\tmp，
    // 书脱离数据根——不在书架扫描范围、不随数据根备份、无法随卷迁移。
    const dir = requestedDir !== ''
      ? requestedDir
      : resolve(defaultBookAccessManager.getDataRoot(), 'books', `book-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`)
    const title = typeof body['title'] === 'string' ? body['title'] : '未命名之书'
    const result = createBook({ dir, title })
    defaultBookAccessManager.registerLocalBook(result.root, result.book.id)
    json(200, { ok: true, root: result.root, bookId: result.book.id })
    return true
  }

  if (path === '/api/book.state') {
    const rawRoot = resolvedRoot
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

  if (path === '/api/author-intent.save') {
    if (resolvedRoot === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    const root = assertSafeBookRoot(resolvedRoot)
    const fields: WizardAuthorIntentInput = {
      worldRule: typeof body['worldRule'] === 'string' ? body['worldRule'] : '',
      volumePromise: typeof body['volumePromise'] === 'string' ? body['volumePromise'] : '',
      opening: typeof body['opening'] === 'string' ? body['opening'] : '',
      firstChapterGoal: typeof body['firstChapterGoal'] === 'string' ? body['firstChapterGoal'] : '',
    }
    const values = Object.values(fields)
    if (values.some((value) => value.length > 20_000)) {
      json(413, { ok: false, error: 'author intent fields must be at most 20000 characters' })
      return true
    }
    const bookKey = authorizedBook?.bookId ?? root
    await defaultBookAccessManager.queue.withBookLock(bookKey, async () => {
      try {
        const revision = writeWizardAuthorIntent(root, fields)
        // S4 增量收口：只吸收本次应用写入的这一个文件（含 planning_artifacts 行同步），
        // 不用 rebuildProjectionFromCanon——否则无关的外部漂移会被一并吸进基线。
        absorbAuthorIntentWrite(root)
        json(200, { ok: true, path: AUTHOR_INTENT_PATH, revision })
      } catch (cause) {
        if ((cause as Error).name === 'AuthorIntentAlreadyInitializedError') {
          // 已初始化 ≠ 本次输入已保存。只有与盘上现值逐字等价时才判幂等成功
          // （响应丢失后客户端重试的路径）；任意不同输入必须走冲突，且原文不动。
          const stored = readWizardAuthorIntent(root)
          if (stored !== null && wizardAuthorIntentEquals(stored, fields)) {
            absorbAuthorIntentWrite(root)
            json(200, { ok: true, idempotent: true, path: AUTHOR_INTENT_PATH, stored })
            return
          }
          json(409, {
            ok: false,
            code: 'AUTHOR_INTENT_ALREADY_INITIALIZED',
            error: '这本书已经保存过首次建书输入，本次输入未写入（受保护原文不覆盖）。可保留已有设定继续进入工作台。',
            stored,
          })
          return
        }
        json(500, { ok: false, error: (cause as Error).message })
      }
    })
    return true
  }

  if (path === '/api/story-brain.entities') {
    const rawRoot = resolvedRoot
    if (rawRoot === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    const root = assertSafeBookRoot(rawRoot)
    const cards = withPlane(root, (plane) => plane.getEntityCards())
    json(200, { ok: true, cards })
    return true
  }

  if (path === '/api/story-brain.entity.save') {
    const rawRoot = resolvedRoot
    if (rawRoot === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    const root = assertSafeBookRoot(rawRoot)
    const name = typeof body['name'] === 'string' ? body['name'].trim() : ''
    const cardType = typeof body['cardType'] === 'string' ? body['cardType'] : 'char'
    const brief = typeof body['brief'] === 'string' ? body['brief'].trim() : ''
    const details = typeof body['details'] === 'string' ? body['details'].trim() : ''

    if (name.length === 0) {
      json(400, { ok: false, error: 'name must not be empty' })
      return true
    }

    const validPrefixes = new Set(['char', 'location', 'item', 'faction', 'concept'])
    if (!validPrefixes.has(cardType)) {
      json(400, { ok: false, error: `invalid cardType: ${cardType}` })
      return true
    }

    // slug 清洗：中文或字母数字转安全 slug
    const customSlug = typeof body['slug'] === 'string' && body['slug'].trim().length > 0 ? body['slug'].trim() : null
    const safeSlug = customSlug ?? name.replace(/[^\w\u4e00-\u9fa5]+/g, '_').toLowerCase().slice(0, 32)
    const ref = `${cardType}:${safeSlug}` as EntityRef

    try {
      const plane = LocalDataPlane.open(root)
      try {
        const card = plane.saveEntityCard(ref, {
          name,
          brief,
          body: details.length > 0 ? `# ${name}\n\n${details}\n` : `# ${name}\n`,
        })
        json(200, { ok: true, card })
      } finally {
        plane.close()
      }
    } catch (err) {
      json(500, { ok: false, error: (err as Error).message })
    }
    return true
  }

  if (path === '/api/story-brain.facts') {
    const rawRoot = resolvedRoot
    if (rawRoot === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    const root = assertSafeBookRoot(rawRoot)
    const rawEntityIds = Array.isArray(body['entityIds']) ? body['entityIds'] : []
    const entityIds = rawEntityIds.filter((r): r is EntityRef => typeof r === 'string' && r.length > 0)

    const overview = withPlane(root, (plane) => plane.queryStoryBrain({ entityIds }))
    json(200, {
      ok: true,
      ...overview,
    })
    return true
  }

  if (path === '/api/story-brain.contract') {
    const rawRoot = resolvedRoot
    if (rawRoot === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    const root = assertSafeBookRoot(rawRoot)
    const sourceName = typeof body['sourceName'] === 'string' ? body['sourceName'].trim() : ''
    const targetName = typeof body['targetName'] === 'string' ? body['targetName'].trim() : ''
    const relation = typeof body['relation'] === 'string' ? body['relation'].trim() : '契约约定'
    const summary = typeof body['summary'] === 'string' ? body['summary'].trim() : ''
    const deadline = typeof body['deadline'] === 'string' ? body['deadline'].trim() : undefined
    const penalty = typeof body['penalty'] === 'string' ? body['penalty'].trim() : undefined

    if (!sourceName || !targetName || !summary) {
      json(400, { ok: false, error: 'sourceName, targetName, and summary required' })
      return true
    }

    const contractId = 'contract_' + randomBytes(8).toString('hex')
    const contractRecord = {
      id: contractId,
      source: sourceName,
      target: targetName,
      relation,
      summary,
      deadline,
      penalty,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    }

    const promiseStream = TRACKING_STREAMS.find((stream) => stream.kind === 'narrativePromise')
    if (promiseStream === undefined) {
      json(500, { ok: false, error: 'narrativePromise tracking stream is not configured' })
      return true
    }
    const promiseFile = join(root, promiseStream.path)
    mkdirSync(dirname(promiseFile), { recursive: true })
    appendFileSync(promiseFile, `${JSON.stringify(contractRecord)}\n`, 'utf8')
    // 应用自己的写入必须并入基线（S4）：否则下次对账会把这行契约误判为
    // EXTERNAL_MODIFIED，作者刚建完契约就收到一条伪冲突提案。
    const plane = LocalDataPlane.openOrRebuild(root)
    try {
      plane.absorbAppWrite([promiseStream.path])
    } finally {
      plane.close()
    }

    json(200, { ok: true, contractId, contract: contractRecord })
    return true
  }

  return false
}
