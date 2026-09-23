/**
 * apps/web · 出版级全格式导出路由控制器 (Word DOCX / EPUB 3 / TXT · T10)。
 */
import type { RouteHandler } from '../router.js'
import {
  exportSubmissionDocx,
  exportSubmissionEpub,
  exportCleanTxt,
  type ChapterExportItem,
  LocalDataPlane,
  readProseChapter,
  proseChapterPath,
} from '@mozhou/data-plane'

export const exportRoutes: RouteHandler = (req, res, { path, body, json, bookRoot, authorizedBook }) => {
  if (path === '/api/export' && req.method === 'POST') {
    const bookTitle = typeof body['bookTitle'] === 'string' && body['bookTitle'].trim().length > 0
      ? body['bookTitle'].trim()
      : authorizedBook?.title ?? '未命名作品'
    const synopsis = typeof body['synopsis'] === 'string' ? body['synopsis'].trim() : ''
    const author = typeof body['author'] === 'string' ? body['author'].trim() : '墨舟作者'
    const format = typeof body['format'] === 'string' ? body['format'] : 'txt'
    const rawChapters = Array.isArray(body['chapters']) ? body['chapters'] : []

    let chapters: ChapterExportItem[] = rawChapters.map((entry, idx) => {
      const ch = (entry ?? {}) as Record<string, unknown>
      return {
        title: typeof ch.title === 'string' ? ch.title : `第 ${idx + 1} 章`,
        content: typeof ch.content === 'string' ? ch.content : '',
      }
    })

    if (chapters.length === 0 && typeof bookRoot === 'string') {
      const root = bookRoot
      let plane: LocalDataPlane | null = null
      try {
        plane = LocalDataPlane.open(root)
        const overview = plane.getWorksOverview()
        chapters = overview.chapters.map((ch) => {
          const scan = readProseChapter(root, proseChapterPath(ch.chapterIndex))
          return {
            title: ch.title || `第 ${ch.chapterIndex} 章`,
            content: scan.body,
          }
        })
      } catch (error) {
        json(409, {
          ok: false,
          code: 'EXPORT_SOURCE_UNREADABLE',
          error: `导出源章节读取失败，已取消导出：${(error as Error).message}`,
        })
        return true
      } finally {
        plane?.close()
      }
    }

    if (chapters.length === 0) {
      json(409, { ok: false, code: 'EXPORT_NO_CHAPTERS', error: '没有可导出的正文章节' })
      return true
    }

    const emptyChapterIndex = chapters.findIndex((chapter) => chapter.content.trim().length === 0)
    if (emptyChapterIndex >= 0) {
      json(409, {
        ok: false,
        code: 'EXPORT_EMPTY_CHAPTER',
        error: `第 ${emptyChapterIndex + 1} 个导出章节正文为空，已取消导出以避免生成缺章文件`,
      })
      return true
    }

    if (format === 'txt') {
      const text = exportCleanTxt(bookTitle, chapters)
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(bookTitle)}.txt"`)
      res.end(text)
      return true
    }

    if (format === 'docx') {
      const buf = exportSubmissionDocx(bookTitle, synopsis, chapters)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(bookTitle)}.docx"`)
      res.end(buf)
      return true
    }

    if (format === 'epub') {
      const buf = exportSubmissionEpub(bookTitle, author, chapters)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/epub+zip')
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(bookTitle)}.epub"`)
      res.end(buf)
      return true
    }

    json(400, { ok: false, error: `unsupported export format: ${format}` })
    return true
  }

  return false
}
