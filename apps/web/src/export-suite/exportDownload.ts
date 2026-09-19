import { exportCleanTxt, type ChapterExportItem } from './txtCleanExporter'
import { exportSubmissionDocx } from './docxExporter'
import { exportSubmissionEpub } from './epubExporter'
import { post } from '../lib/post'
import type { WorksOverviewResponse } from '../../server/api'

export interface ExportDownloadOptions {
  bookTitle: string
  format: 'txt' | 'docx' | 'epub'
  chapters: readonly ChapterExportItem[]
  author?: string
  synopsis?: string
}

export function downloadNovelExport({
  bookTitle,
  format,
  chapters,
  author = '墨舟作者',
  synopsis = '',
}: ExportDownloadOptions): { fileName: string } {
  const safeTitle = bookTitle.trim() || '未命名作品'
  let blob: Blob
  let extension = 'txt'

  if (format === 'txt') {
    const content = exportCleanTxt(safeTitle, chapters)
    blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    extension = 'txt'
  } else if (format === 'docx') {
    const buf = exportSubmissionDocx(safeTitle, synopsis, chapters)
    blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    extension = 'docx'
  } else {
    const buf = exportSubmissionEpub(safeTitle, author, chapters)
    blob = new Blob([buf], { type: 'application/epub+zip' })
    extension = 'epub'
  }

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
      items.push({
        chapterIndex: ch.chapterIndex,
        title: ch.title || `第 ${ch.chapterIndex} 章`,
        content: proseRes.ok && proseRes.body ? proseRes.body : '',
      })
    } catch {
      items.push({
        chapterIndex: ch.chapterIndex,
        title: ch.title || `第 ${ch.chapterIndex} 章`,
        content: '',
      })
    }
  }
  return items
}
