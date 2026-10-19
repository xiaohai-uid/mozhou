/**
 * packages/data-plane · 文档分章导入类型定义 (Import Types · S-03)。
 */
import type { BookRecord } from '@mozhou/kernel'

export type DocumentFormat = 'txt' | 'md' | 'docx'

export type SplitMode = 'auto' | 'title' | 'blank-line' | 'word-count'

export interface SplitOptions {
  /** 分章模式：auto（默认，优先按标题，不足时按后备）、title（仅标题）、blank-line（空行）、word-count（字数阈值） */
  readonly splitMode?: SplitMode | undefined
  /** 按字数分章阈值，默认 3000 字 */
  readonly wordCountThreshold?: number | undefined
  /** 自定义章节标题正则表达式（字符串形式或 RegExp） */
  readonly customTitlePattern?: string | RegExp | undefined
}

export interface ChapterParsedItem {
  readonly chapterIndex: number
  readonly title: string
  readonly content: string
  readonly wordCount: number
}

export interface ParseDocumentOptions {
  /** 文本内容（TXT 或 Markdown） */
  readonly content?: string | undefined
  /** 二进制内容（DOCX 或 TXT/MD Buffer） */
  readonly buffer?: Buffer | undefined
  /** 文档格式，默认自动探测 */
  readonly format?: DocumentFormat | undefined
  /** 书名（用于辅助识别或过滤书名行） */
  readonly bookTitle?: string | undefined
  /** 切分选项 */
  readonly splitOptions?: SplitOptions | undefined
}

export interface ImportDocumentOptions {
  /** 书库父目录（一书一目录） */
  readonly parentDir: string
  /** 书名 */
  readonly title: string
  /** 显式指定的目标书根目录（可选，若不指定则自动计算为 parentDir/sanitizedTitle） */
  readonly targetDir?: string | undefined
  /** 文本内容（TXT 或 Markdown） */
  readonly content?: string | undefined
  /** 二进制内容（DOCX 或 TXT/MD Buffer） */
  readonly buffer?: Buffer | undefined
  /** 文档格式，默认自动探测 */
  readonly format?: DocumentFormat | undefined
  /** 切分选项 */
  readonly splitOptions?: SplitOptions | undefined
  /** 测试钩子：在创建指定章节草稿前执行，用于模拟故障与测试原子回滚 */
  readonly _testHookBeforeChapterDraft?: ((chapterIndex: number) => void) | undefined
}

export interface ImportDocumentResult {
  readonly root: string
  readonly book: BookRecord
  readonly bookId: string
  readonly title: string
  readonly chapterCount: number
  readonly chapters: readonly {
    readonly chapterIndex: number
    readonly title: string
    readonly wordCount: number
  }[]
}

export class ImportParseError extends Error {
  override readonly name = 'ImportParseError'
  constructor(
    readonly code: 'EMPTY_CONTENT' | 'CORRUPT_DOCX' | 'UNSUPPORTED_FORMAT' | 'NO_CHAPTERS_EXTRACTED',
    message: string,
  ) {
    super(`[${code}] ${message}`)
  }
}
