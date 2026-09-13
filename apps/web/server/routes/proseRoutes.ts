/**
 * 章节正文存取路由（Ink Realm 主权链收口 · P1）：
 * POST /api/chapter.prose.save {root, chapterIndex, body, title?}
 *   → 作者把 Reading Slate 写作层文本「落为当前章 Active Draft」：
 *     章缺失则建章草稿（plane.createChapterDraft）；存在则 revision+1
 *     以 renderProseChapter 冻结字段序原子替换（atomicReplace）。
 *   语义：Accept → Active Draft（phase 恒 draft）；Commit 仍只经管线
 *   质量门后的 commitChapter——本路由绝不翻转相位。
 * 不触碰 Protected Author Content 以外的任何正典工件。
 */
import type { RouteHandler } from '../router.js'
import { assertSafeBookRoot } from '../security.js'
import {
  LocalDataPlane,
  atomicReplace,
  proseChapterPath,
  renderProseChapter,
} from '@mozhou/data-plane'

export async function saveProseChapter(
  rawRoot: string,
  chapterIndex: number,
  body: string,
  title?: string,
): Promise<{ chapterIndex: number; revision: number; phase: 'draft'; created: boolean }> {
  const root = assertSafeBookRoot(rawRoot)
  const plane = LocalDataPlane.openOrRebuild(root)
  try {
    const relPath = proseChapterPath(chapterIndex)

    let mozhouId: string
    let revision: number
    let created = false
    try {
      const existing = plane.getProseChapter(chapterIndex)
      mozhouId = existing.mozhouId
      revision = existing.revision
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      // 章缺失：建章草稿（大纲节点 + draft 正文 + 基线登记），再在其上覆写作者文本。
      plane.createChapterDraft({ chapterIndex, title: title?.trim() || `第${chapterIndex}章` })
      const fresh = plane.getProseChapter(chapterIndex)
      mozhouId = fresh.mozhouId
      revision = fresh.revision
      created = true
    }

    const normalizedBody = body.endsWith('\n') ? body : `${body}\n`
    const content = renderProseChapter({
      mozhouId,
      revision: revision + 1,
      chapterIndex,
      phase: 'draft',
      body: normalizedBody,
    })
    atomicReplace(root, relPath, content)

    return { chapterIndex, revision: revision + 1, phase: 'draft', created }
  } finally {
    plane.close()
  }
}

export const proseRoutes: RouteHandler = async (req, res, { path, body, json }) => {
  if (req.method !== 'POST') return false

  if (path === '/api/chapter.prose.save') {
    const rawRoot = typeof body['root'] === 'string' ? body['root'] : null
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    const rawBody = typeof body['body'] === 'string' ? body['body'] : null
    const title = typeof body['title'] === 'string' ? body['title'] : undefined
    if (rawRoot === null || chapterIndex === null || rawBody === null || rawBody.trim() === '') {
      json(400, { ok: false, error: 'root, chapterIndex and non-empty body required' })
      return true
    }
    try {
      const result = await saveProseChapter(rawRoot, chapterIndex, rawBody, title)
      json(200, { ok: true, ...result })
    } catch (cause) {
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  return false
}
