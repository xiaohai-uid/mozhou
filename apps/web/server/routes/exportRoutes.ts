/**
 * apps/web · 出版级全格式导出路由控制器 (Word DOCX / EPUB 3 / TXT · T10)。
 */
import type { RouteHandler } from '../router.js'
import { exportSubmissionDocx, exportSubmissionEpub, exportCleanTxt, type ChapterExportItem } from '@mozhou/data-plane'

export const exportRoutes: RouteHandler = (req, res, { path, body, json }) => {
  if (path === '/api/export' && req.method === 'POST') {
    const bookTitle = typeof body['bookTitle'] === 'string' ? body['bookTitle'].trim() : '未命名作品'
    const synopsis = typeof body['synopsis'] === 'string' ? body['synopsis'].trim() : ''
    const author = typeof body['author'] === 'string' ? body['author'].trim() : '墨舟作者'
    const format = typeof body['format'] === 'string' ? body['format'] : 'txt'
    const rawChapters = Array.isArray(body['chapters']) ? body['chapters'] : []

    const chapters: ChapterExportItem[] = rawChapters.map((entry, idx) => {
      const ch = (entry ?? {}) as Record<string, unknown>
      return {
        title: typeof ch.title === 'string' ? ch.title : `第 ${idx + 1} 章`,
        content: typeof ch.content === 'string' ? ch.content : '',
      }
    })

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
