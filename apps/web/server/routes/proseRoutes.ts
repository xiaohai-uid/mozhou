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
 *
 * 步 7 Continuity Gate 接线（chapter-pipeline-spec §1 表第 7 行 / S5）：
 * POST /api/chapter.commit 在步 6 提取出五族 delta 后、写正典前插入纯机械核检
 * （四族行形状 + dependency 引用完整性 + M2 时间线单调 + POV 秘密零泄漏）。
 *   通过 → 200，响应带 continuityGate.verdict='pass'；
 *   冲突 → 409 CONTINUITY_HARD_CONFLICT，Result 顶层 hardConflicts[] {factId,
 *   assertion, suggestion} 原样回给作者（回炉 Final Extract 重提取），正典零写入。
 * Gate 读不到存量叙事状态时同样显式失败（500），绝不降级为「跳过门禁」——
 * 跳过门禁等于把未经核检的 delta 盲写正典。
 */
import type { RouteHandler } from '../router.js'
import { assertSafeBookRoot } from '../security.js'
import {
  ChapterExistsError,
  ChapterPhaseError,
  LocalDataPlane,
  PreWriteHashMismatchError,
  ProseRevisionConflictError,
  proseChapterPath,
  readProseChapter,
} from '@mozhou/data-plane'
import { runContinuityGate } from '@mozhou/pipeline'
import { extractChapterDelta } from '../analysis/deltaExtractor.js'

const CHAPTER_MISSING = 'CHAPTER_MISSING'

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export const proseRoutes: RouteHandler = async (req, res, { path, body, json, bookRoot }) => {
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

  if (path === '/api/chapter.commit') {
    const rawRoot = resolvedRoot
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    const summary = typeof body['summary'] === 'string' && body['summary'].trim().length > 0
      ? body['summary'].trim()
      : `第 ${chapterIndex} 章定稿`

    if (rawRoot === null || chapterIndex === null || chapterIndex < 1) {
      json(400, { ok: false, error: 'root and integer chapterIndex >= 1 required' })
      return true
    }

    try {
      const root = assertSafeBookRoot(rawRoot)
      const plane = LocalDataPlane.openOrRebuild(root)
      try {
        // 步 6 Final Extract 接线：终稿 → 五族叙事状态增量。
        // 提取失败不阻塞提交（作者的正文必须能定稿），但必须在响应里如实报出，
        // 否则「提交后叙事层零增长」会被误读为「一切正常」。
        const prose = readProseChapter(root, proseChapterPath(chapterIndex)).body
        const delta = await extractChapterDelta(root, plane.book.id, chapterIndex, prose)
        const hasDelta = Object.keys(delta.appends).length > 0
        const deltaExtraction = {
          extractor: delta.extractor,
          counts: delta.counts,
          dropped: delta.dropped,
          ...(delta.reason === undefined ? {} : { reason: delta.reason }),
        }

        // 步 7 Continuity Gate：候选 delta 写正典前过机械核检。冲突 = 硬门禁，
        // commitChapter 一步不调（正典零写入），冲突清单经 Result 顶层
        // hardConflicts[] 回给作者——回炉重提取是唯一出路，不许静默放行。
        const gate = runContinuityGate({ bookRoot: root, chapterIndex, delta: delta.appends, prose })
        if (gate.verdict === 'hard_conflict') {
          json(409, {
            ok: false,
            code: 'CONTINUITY_HARD_CONFLICT',
            chapterIndex,
            error: `连续性门禁未通过：${gate.hardConflicts.length} 项硬冲突——本章正典零写入`,
            hardConflicts: gate.hardConflicts,
            deltaExtraction,
          })
          return true
        }

        const result = plane.commitChapter({
          chapterIndex,
          summary,
          ...(hasDelta ? { appends: delta.appends } : {}),
        })
        json(200, {
          ok: true,
          commitId: result.commitId,
          chapterIndex: result.chapterIndex,
          contentSha256: result.contentSha256,
          phase: 'committed',
          continuityGate: { verdict: 'pass' },
          deltaExtraction,
        })
      } finally {
        plane.close()
      }
    } catch (cause) {
      if (cause instanceof ChapterPhaseError) {
        json(409, { ok: false, code: 'CHAPTER_ALREADY_COMMITTED', error: (cause as Error).message })
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
