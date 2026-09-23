import type { ChapterExportItem } from './txtCleanExporter'
import { post } from '../lib/post'
import type { WorksOverviewResponse } from '../../server/api'

export interface ExportDownloadOptions {
  bookTitle: string
  format: 'txt' | 'docx' | 'epub'
  chapters: readonly ChapterExportItem[]
  bookId?: string | undefined
  root?: string | undefined
  author?: string
  synopsis?: string
}

export async function downloadNovelExport({
  bookTitle,
  format,
  chapters,
  bookId,
  root,
  author = '墨舟作者',
  synopsis = '',
}: ExportDownloadOptions): Promise<{ fileName: string }> {
  const safeTitle = bookTitle.trim() || '未命名作品'

  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bookTitle: safeTitle,
      format,
      chapters,
      bookId,
      root,
      author,
      synopsis,
    }),
  })

  if (!res.ok) {
    throw new Error(`导出请求失败 (HTTP ${res.status})`)
  }

  const blob = await res.blob()
  const extension = format === 'docx' ? 'docx' : format === 'epub' ? 'epub' : 'txt'
  const fileName = `${safeTitle}.${extension}`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  return { fileName }
}

export async function fetchBookChaptersForExport(root: string): Promise<ChapterExportItem[]> {
  const worksRes = await post<WorksOverviewResponse>('/api/works', { root })
  if (!worksRes || !worksRes.ok || !worksRes.chapters) {
    return []
  }
  const items: ChapterExportItem[] = []
  for (const ch of worksRes.chapters) {
    try {
      const proseRes = await post<{ ok: boolean; body?: string }>('/api/chapter.prose', {
        root,
        chapterIndex: ch.chapterIndex,
      })
      if (!proseRes.body || proseRes.body.trim().length === 0) {
        throw new Error('正文为空')
      }
      items.push({
        title: ch.title || `第 ${ch.chapterIndex} 章`,
        content: proseRes.body,
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`第 ${ch.chapterIndex} 章正文读取失败，已取消导出：${detail}`, { cause: error })
    }
  }
  return items
}

export interface PrepareExportParams {
  book?: { root: string; title: string; bookId?: string } | null | undefined
  exportingRealBook: boolean
  title: string
  format: 'txt' | 'docx' | 'epub'
  customSampleText?: string
}

export async function executeExportWorkflow({
  book,
  exportingRealBook,
  title,
  format,
  customSampleText,
}: PrepareExportParams): Promise<{ success: boolean; message: string }> {
  const safeTitle = title.trim() || book?.title || '未命名作品'
  let chapters: ChapterExportItem[] = []

  if (book?.root && exportingRealBook) {
    chapters = await fetchBookChaptersForExport(book.root)
    if (chapters.length === 0 || chapters.every((c) => !c.content.trim())) {
      return {
        success: false,
        message: `作品《${book.title}》暂无正文章节内容，请先在工作台撰写第一章。`,
      }
    }
  } else if (customSampleText && customSampleText.trim().length > 0) {
    chapters = [
      {
        title: '样章草稿',
        content: customSampleText.trim(),
      },
    ]
  } else {
    return {
      success: false,
      message: '请输入待导出的文本段落，或勾选导出作品全量正典章节。',
    }
  }

  const { fileName } = await downloadNovelExport({
    bookTitle: safeTitle,
    format,
    chapters,
    bookId: book?.bookId,
    root: book?.root,
  })

  return {
    success: true,
    message: `导出成功：已下载 ${fileName}（共 ${chapters.length} 章）`,
  }
}
