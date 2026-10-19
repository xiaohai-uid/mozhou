/**
 * packages/data-plane · 文档分章导入引擎与原子事务落盘 (S-03 · Document Importer)。
 * 
 * 依照 specs/openwrite-parity-capabilities-v1.md S-03 规范：
 * 1. 严格校验至少能切出 1 章，解析失败或格式损坏时直接抛错，绝不产生半本书或残留损坏目录；
 * 2. 写入时调用既有 data-plane 的 createBook 与 createChapterDraft / saveProseDraft 写出 正文/第一卷/第XXXX章.md，
 *    更新 manifest 基础并重建 SQLite 投影；
 * 3. 失败时执行物理目录事务回滚（rmSync），保障「失败不留半本书」。
 */
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createBook, BookDirectoryNotEmptyError } from '../create-book.js'
import { withStrictBook } from '../with-plane.js'
import { rebuildProjectionFromCanon } from '../projection-rebuild.js'
import { normalizeProseBody } from '../chapter.js'
import { parseDocumentToChapters } from './chapter-splitter.js'
import {
  type ImportDocumentOptions,
  type ImportDocumentResult,
  ImportParseError,
} from './types.js'

export function sanitizeDirName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : '未命名之书'
}

/**
 * 将 TXT / MD / DOCX 文档分章并原子建书落盘。
 * 成功返回书本元信息与章节清单；失败时回滚删除所有已建目录，绝不残留半本书。
 */
export function importDocumentToBook(options: ImportDocumentOptions): ImportDocumentResult {
  const { parentDir, title } = options
  if (!parentDir || typeof parentDir !== 'string') {
    throw new Error('parentDir required')
  }
  const trimmedTitle = title ? title.trim() : ''
  if (trimmedTitle.length === 0) {
    throw new Error('book title must be non-empty')
  }

  // 1. 优先解析分章；格式损坏或无有效章节时在此立即抛错，盘上零变更
  const chapters = parseDocumentToChapters({
    content: options.content,
    buffer: options.buffer,
    format: options.format,
    bookTitle: trimmedTitle,
    splitOptions: options.splitOptions,
  })

  if (chapters.length === 0) {
    throw new ImportParseError('NO_CHAPTERS_EXTRACTED', 'failed to split document into at least 1 chapter')
  }

  const dirName = sanitizeDirName(trimmedTitle)
  const targetRoot = options.targetDir ?? join(parentDir, dirName)

  if (existsSync(targetRoot) && readdirSync(targetRoot).length > 0) {
    throw new BookDirectoryNotEmptyError(targetRoot)
  }

  let bookCreated = false
  try {
    const created = createBook({ dir: targetRoot, title: trimmedTitle })
    bookCreated = true

    withStrictBook(created.root, (plane) => {
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i]!
        const chapterIndex = i + 1
        const chTitle = ch.title.trim() || `第${chapterIndex}章`
        const chContent = normalizeProseBody(ch.content)

        // 测试钩子：可注入模拟异常验证事务回滚
        if (options._testHookBeforeChapterDraft) {
          options._testHookBeforeChapterDraft(chapterIndex)
        }

        plane.createChapterDraft({
          chapterIndex,
          title: chTitle,
        })

        const formattedBody = chContent.startsWith('#')
          ? chContent
          : `# ${chTitle}\n\n${chContent}`

        plane.saveProseDraft({
          chapterIndex,
          body: formattedBody,
          expectedRevision: 0,
        })
      }
    })

    // 重新从已落盘的正典扫描重构 SQLite 投影与 manifest 基线
    rebuildProjectionFromCanon(created.root)

    return {
      root: created.root,
      book: created.book,
      bookId: created.book.id,
      title: created.book.title,
      chapterCount: chapters.length,
      chapters: chapters.map((ch, idx) => ({
        chapterIndex: idx + 1,
        title: ch.title.trim() || `第${idx + 1}章`,
        wordCount: ch.wordCount,
      })),
    }
  } catch (err) {
    // 原子回滚保证：一旦建书过程中发生任何错误（如建章中断、断言失败），
    // 立即彻底删除已生成的半本书目录，绝不遗留半本书或损坏目录。
    if (bookCreated && existsSync(targetRoot)) {
      try {
        rmSync(targetRoot, { recursive: true, force: true })
      } catch {
        // 忽略清理异常
      }
    }
    throw err
  }
}
