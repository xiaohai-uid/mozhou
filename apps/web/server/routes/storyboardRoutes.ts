/**
 * 漫剧分镜路由（T02 契约与独立存储；T03 接生成）：
 * - POST /api/storyboard.source {root,chapterIndex} → 源快照（同读算 hash+预览；空章 400）
 * - POST /api/storyboard.generate {root,chapterIndex,expectedSourceHash,options} → 生成候选
 *   （T02 阶段诚实 501；T03 复用 openaiStream 实现后启用；绝不写盘）
 * - POST /api/storyboard.save {root,document,expectedRevision} → 原子保存（409 冲突保编辑）
 * - POST /api/storyboards {root} → 列表（含 sourceStale 与损坏计数）
 * - POST /api/storyboard {root,id} → 单篇（含 sourceStale）
 * 改编是独立衍生作品：不修改正文/Canon/质量门/Chapter Commit；不通过 /api/draft.stream
 * 生成分镜（该路径绑定小说写作管线）。
 */
import type { RouteHandler } from '../router.js'
import { assertSafeBookRoot, RequestBoundaryError } from '../security.js'
import {
  ChapterMissingError,
  StoryboardConflictError,
  StoryboardNotFoundError,
  listStoryboards,
  readSourceSnapshot,
  readStoryboard,
  saveStoryboard,
} from '../storyboard/store.js'
import { StoryboardValidationError } from '../storyboard/contract.js'
import type { AspectRatio } from '../storyboard/contract.js'
import {
  ModelOutputError,
  ProviderUnavailableError,
  SourceChangedError,
  SourceTooLargeError,
  generateStoryboardCandidate,
} from '../storyboard/generate.js'

export const storyboardRoutes: RouteHandler = async (req, res, { path, body, json, authorizedBook }) => {
  if (req.method !== 'POST') return false

  const rawRoot = authorizedBook?.root ?? (typeof body['root'] === 'string' ? body['root'] : null)

  if (path === '/api/storyboard.source') {
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    if (rawRoot === null || chapterIndex === null || !Number.isInteger(chapterIndex) || chapterIndex < 1) {
      json(400, { ok: false, error: 'root and integer chapterIndex >= 1 required' })
      return true
    }
    try {
      const root = assertSafeBookRoot(rawRoot)
      const info = readSourceSnapshot(root, chapterIndex)
      json(200, {
        ok: true,
        source: info.source,
        title: info.title,
        characterCount: info.characterCount,
        excerpt: info.excerpt,
      })
    } catch (cause) {
      respondStoryboardError(json, cause)
    }
    return true
  }

  if (path === '/api/storyboard.generate') {
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    const expectedSourceHash = typeof body['expectedSourceHash'] === 'string' ? body['expectedSourceHash'] : null
    const optionsRaw = body['options']
    if (rawRoot === null || chapterIndex === null || expectedSourceHash === null || typeof optionsRaw !== 'object' || optionsRaw === null) {
      json(400, { ok: false, error: 'root, chapterIndex, expectedSourceHash and options required' })
      return true
    }
    const record = optionsRaw as Record<string, unknown>
    const aspectRatioOk = record['aspectRatio'] === '9:16' || record['aspectRatio'] === '16:9' || record['aspectRatio'] === '1:1'
    const durationOk = typeof record['targetDurationSeconds'] === 'number'
      && Number.isFinite(record['targetDurationSeconds'])
      && record['targetDurationSeconds'] >= 1 && record['targetDurationSeconds'] <= 3600
    const visualStyle = typeof record['visualStyle'] === 'string' ? record['visualStyle'] : ''
    const languageOk = record['language'] === undefined || record['language'] === 'zh-CN'
    if (!aspectRatioOk || !durationOk || visualStyle.trim() === '' || !languageOk) {
      json(400, { ok: false, error: 'options invalid: aspectRatio(9:16|16:9|1:1), targetDurationSeconds(1..3600), visualStyle required' })
      return true
    }
    try {
      const root = assertSafeBookRoot(rawRoot)
      const { document } = await generateStoryboardCandidate(root, chapterIndex, expectedSourceHash, {
        aspectRatio: record['aspectRatio'] as AspectRatio,
        targetDurationSeconds: record['targetDurationSeconds'] as number,
        visualStyle,
        language: 'zh-CN',
      })
      // 候选只在响应中返回，绝不写盘（保存走 /api/storyboard.save）。
      json(200, { ok: true, candidate: document })
    } catch (cause) {
      respondStoryboardError(json, cause)
    }
    return true
  }

  if (path === '/api/storyboard.save') {
    const document = body['document']
    const expectedRaw = body['expectedRevision']
    const expectedRevision = expectedRaw === null
      ? null
      : (typeof expectedRaw === 'number' && Number.isInteger(expectedRaw) && expectedRaw >= 0 ? expectedRaw : undefined)
    if (rawRoot === null || document === undefined || document === null || typeof document !== 'object' || expectedRevision === undefined) {
      json(400, { ok: false, error: 'root, document(object) and expectedRevision(null|integer>=0) required' })
      return true
    }
    try {
      const root = assertSafeBookRoot(rawRoot)
      const result = await saveStoryboard(root, document, expectedRevision)
      json(200, { ok: true, id: result.id, revision: result.revision, sourceStale: result.sourceStale })
    } catch (cause) {
      respondStoryboardError(json, cause)
    }
    return true
  }

  if (path === '/api/storyboards') {
    if (rawRoot === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    try {
      const root = assertSafeBookRoot(rawRoot)
      const { items, skippedInvalid } = listStoryboards(root)
      json(200, { ok: true, items, skippedInvalid })
    } catch (cause) {
      respondStoryboardError(json, cause)
    }
    return true
  }

  if (path === '/api/storyboard') {
    const id = typeof body['id'] === 'string' ? body['id'] : null
    if (rawRoot === null || id === null) {
      json(400, { ok: false, error: 'root and id required' })
      return true
    }
    try {
      const root = assertSafeBookRoot(rawRoot)
      const { document, sourceStale } = readStoryboard(root, id)
      json(200, { ok: true, document, sourceStale })
    } catch (cause) {
      respondStoryboardError(json, cause)
    }
    return true
  }

  return false
}

/** 错误→HTTP 映射：409 冲突/404 缺失/400 校验（含字段级 issues）/边界错误原状/500 其余（不泄路径）。 */
function respondStoryboardError(
  json: (status: number, body: unknown) => void,
  cause: unknown,
): void {
  if (cause instanceof RequestBoundaryError) {
    json(cause.status, { ok: false, code: cause.code, error: cause.message })
    return
  }
  if (cause instanceof ProviderUnavailableError) {
    json(503, { ok: false, code: 'PROVIDER_UNAVAILABLE', error: cause.message })
    return
  }
  if (cause instanceof SourceChangedError) {
    json(409, {
      ok: false,
      code: 'SOURCE_CHANGED',
      error: cause.message,
      currentSourceHash: cause.currentSourceHash,
      chapterIndex: cause.chapterIndex,
    })
    return
  }
  if (cause instanceof SourceTooLargeError) {
    json(413, {
      ok: false,
      code: 'SOURCE_TOO_LARGE',
      error: cause.message,
      characterCount: cause.characterCount,
      maxSourceCharacters: 12000,
    })
    return
  }
  if (cause instanceof ModelOutputError) {
    json(502, { ok: false, code: cause.code, error: cause.message })
    return
  }
  if (cause instanceof StoryboardConflictError) {
    json(409, {
      ok: false,
      code: 'STORYBOARD_REVISION_CONFLICT',
      error: '分镜已被另一处保存更新（revision 冲突）——你的本地编辑未丢失。',
      storedRevision: cause.storedRevision,
      storedId: cause.storedId,
    })
    return
  }
  if (cause instanceof StoryboardNotFoundError) {
    json(404, { ok: false, code: 'STORYBOARD_NOT_FOUND', error: '分镜不存在' })
    return
  }
  if (cause instanceof ChapterMissingError) {
    json(404, { ok: false, code: 'CHAPTER_MISSING', error: `第 ${cause.chapterIndex} 章在磁盘上不存在` })
    return
  }
  if (cause instanceof StoryboardValidationError) {
    json(400, { ok: false, code: 'STORYBOARD_INVALID', error: '分镜文档未通过校验', issues: cause.issues.slice(0, 20) })
    return
  }
  json(500, { ok: false, code: 'STORYBOARD_STORE_ERROR', error: '分镜存取失败（详见本机日志）' })
}
