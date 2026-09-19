/**
 * 章节正文存取路由（发布评审 R1/R2 修复 · 预期版本契约）：
 * POST /api/chapter.prose        {root, chapterIndex}
 *   → 章快照 {exists, revision, phase, commitId?, body}；作者实际读取内容的来源。
 * POST /api/chapter.prose.save   {root, chapterIndex, body, expectedRevision, title?}
 *   → Accept → Active Draft。expectedRevision:null=仅新建（章已存在 409）；
 *     数字=必须等于盘上 revision（不等 409 PROSE_REVISION_CONFLICT）。
 *     外部改盘由数据平面写前哈希拒绝（409 PROSE_EXTERNAL_CHANGE）；
 *     committed 章普通保存 409（CHAPTER_COMMITTED）——重开必须走显式
 *     /api/chapter.reopen（复用 reopenChapter：写前哈希 + ChapterReopened 事件 +
 *     基线刷新），本路由绝不静默降级或自动重开。冲突路径零磁盘变更。
 *   语义：phase 恒 draft；Commit 仍只经管线质量门后的 commitChapter。
 * 不触碰 Protected Author Content 以外的任何正典工件。
 */
import type { RouteHandler } from '../router.js'
import { assertSafeBookRoot } from '../security.js'
import {
  ChapterExistsError,
  ChapterPhaseError,
  LocalDataPlane,
  PreWriteHashMismatchError,
  ProseRevisionConflictError,
} from '@mozhou/data-plane'

const CHAPTER_MISSING = 'CHAPTER_MISSING'

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export const proseRoutes: RouteHandler = (req, res, { path, body, json, bookRoot }) => {
  if (req.method !== 'POST') return false

  const resolvedRoot = bookRoot ?? null

  if (path === '/api/chapter.prose') {
    const rawRoot = resolvedRoot
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    if (rawRoot === null || chapterIndex === null || chapterIndex < 1) {
      json(400, { ok: false, error: 'root and integer chapterIndex >= 1 required' })
      return true
    }
    try {
      const root = assertSafeBookRoot(rawRoot)
      const plane = LocalDataPlane.openOrRebuild(root)
      try {
        const chapter = plane.getProseChapter(chapterIndex)
        json(200, {
          ok: true,
          exists: true,
          chapterIndex: chapter.chapterIndex,
          revision: chapter.revision,
          phase: chapter.phase,
          commitId: chapter.commitId,
          body: chapter.body,
        })
      } finally {
        plane.close()
      }
    } catch (cause) {
      if (isEnoent(cause)) {
        json(200, { ok: true, exists: false, chapterIndex })
        return true
      }
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  if (path === '/api/chapter.prose.save') {
    const rawRoot = resolvedRoot
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    const rawBody = typeof body['body'] === 'string' ? body['body'] : null
    const title = typeof body['title'] === 'string' ? body['title'] : undefined
    // 契约显式：expectedRevision 必须在场（null=新建语义），杜绝旧客户端静默覆盖
    const rawExpected = body['expectedRevision']
    const expectedRevision = rawExpected === null
      ? null
      : typeof rawExpected === 'number' && Number.isInteger(rawExpected) && rawExpected >= 0
        ? rawExpected
        : undefined
    // 作者显式确认覆盖外部修改（仅在 expectedRevision 匹配 + 写前哈希失配时被数据平面采纳）
    const confirmExternalOverwrite = body['confirmExternalOverwrite'] === true ? true : undefined
    if (rawRoot === null || chapterIndex === null || rawBody === null || rawBody.trim() === '' || expectedRevision === undefined) {
      json(400, { ok: false, error: 'root, chapterIndex, non-empty body and expectedRevision (integer >= 0 or null) required' })
      return true
    }
    try {
      const root = assertSafeBookRoot(rawRoot)
      const plane = LocalDataPlane.openOrRebuild(root)
      try {
        const result = plane.saveProseDraft({ chapterIndex, body: rawBody, expectedRevision, title, confirmExternalOverwrite })
        json(200, {
          ok: true,
          chapterIndex: result.chapterIndex,
          revision: result.revision,
          phase: result.phase,
          created: result.created,
        })
      } finally {
        plane.close()
      }
    } catch (cause) {
      if (cause instanceof ChapterPhaseError) {
        // committed 章拒绝普通保存；带出 commitId 供界面呈现定稿身份
        const plane = LocalDataPlane.openOrRebuild(assertSafeBookRoot(rawRoot))
        try {
          const chapter = plane.getProseChapter(chapterIndex)
          json(409, { ok: false, code: 'CHAPTER_COMMITTED', commitId: chapter.commitId, error: (cause as Error).message })
        } catch {
          json(409, { ok: false, code: 'CHAPTER_COMMITTED', commitId: null, error: (cause as Error).message })
        } finally {
          plane.close()
        }
        return true
      }
      if (cause instanceof ProseRevisionConflictError) {
        json(409, {
          ok: false,
          code: 'PROSE_REVISION_CONFLICT',
          expectedRevision: cause.expectedRevision,
          currentRevision: cause.currentRevision,
          error: (cause as Error).message,
        })
        return true
      }
      if (cause instanceof PreWriteHashMismatchError) {
        json(409, { ok: false, code: 'PROSE_EXTERNAL_CHANGE', error: '磁盘内容已被外部修改（或与基线不一致）——拒绝静默覆盖，请先读取最新内容' })
        return true
      }
      if (cause instanceof ChapterExistsError) {
        json(409, { ok: false, code: 'CHAPTER_EXISTS', error: '章节已存在（并发新建？）——请先读取后按更新语义保存' })
        return true
      }
      if (isEnoent(cause)) {
        json(404, { ok: false, code: CHAPTER_MISSING, error: `chapter ${chapterIndex} not found on disk` })
        return true
      }
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  if (path === '/api/chapter.reopen') {
    const rawRoot = resolvedRoot
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    if (rawRoot === null || chapterIndex === null || chapterIndex < 1) {
      json(400, { ok: false, error: 'root and integer chapterIndex >= 1 required' })
      return true
    }
    try {
      const root = assertSafeBookRoot(rawRoot)
      const plane = LocalDataPlane.openOrRebuild(root)
      try {
        const result = plane.reopenChapter(chapterIndex)
        json(200, {
          ok: true,
          chapterIndex: result.chapterIndex,
          reopenedFromCommitId: result.reopenedFromCommitId,
          proseRelPath: result.proseRelPath,
        })
      } finally {
        plane.close()
      }
    } catch (cause) {
      if (cause instanceof ChapterPhaseError) {
        json(409, { ok: false, code: 'CHAPTER_NOT_COMMITTED', error: '章节不是 committed 态——无定稿可重开' })
        return true
      }
      if (cause instanceof PreWriteHashMismatchError) {
        json(409, { ok: false, code: 'PROSE_EXTERNAL_CHANGE', error: '定稿文件已被外部修改——拒绝重开，请先人工核对外部改动' })
        return true
      }
      if (isEnoent(cause)) {
        json(404, { ok: false, code: CHAPTER_MISSING, error: `chapter ${chapterIndex} not found on disk` })
        return true
      }
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  return false
}
