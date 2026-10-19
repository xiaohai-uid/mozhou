/**
 * packages/data-plane · 分章切分引擎 (S-03 · Chapter Splitter)。
 * 支持：
 * - 按常见章节标题正则（第X章/回/卷/节、Chapter \d+、Markdown # 标题等）切分；
 * - 针对长文或无标题文稿，支持按连续空行或字数阈值后备切分；
 * - 纯内存无外部依赖。
 */
import { parseDocx } from './docx-parser.js'
import {
  type ChapterParsedItem,
  type ParseDocumentOptions,
  type SplitOptions,
  ImportParseError,
} from './types.js'

export interface ChapterHeadingMatch {
  readonly isMatch: boolean
  readonly title: string
}

/**
 * 匹配一行文本是否为章节标题。
 */
export function matchChapterHeading(
  line: string,
  customPattern?: string | RegExp,
): ChapterHeadingMatch {
  const trimmed = line.trim()
  if (!trimmed) return { isMatch: false, title: '' }

  if (customPattern !== undefined) {
    const regex = typeof customPattern === 'string' ? new RegExp(customPattern) : customPattern
    const m = regex.exec(trimmed)
    if (m) {
      const extracted = (m[1] ?? trimmed).replace(/^#+\s*/, '').trim()
      return { isMatch: true, title: extracted }
    }
  }

  // 1. Markdown 标题：# 标题，## 标题，### 标题
  const mdMatch = /^#{1,4}\s+(.+)/.exec(trimmed)
  if (mdMatch && mdMatch[1]) {
    const titleText = mdMatch[1].trim()
    if (titleText.length > 0 && titleText.length <= 80) {
      return { isMatch: true, title: titleText }
    }
  }

  // 2. 中文常见章节标题：第[0-9一二三四五六七八九十百千万零两]+[章回卷节部篇集话幕]
  const cnMatch = /^第\s*[0-9一二三四五六七八九十百千万零两]+\s*[章回卷节部篇集话幕](?:[ :：、.．\-—_].*)?$/.exec(trimmed)
  if (cnMatch) {
    return { isMatch: true, title: trimmed }
  }

  // 3. 英文章节：Chapter 1, Chapter I, Chapter 1: The Beginning
  const enMatch = /^Chapter\s+(?:\d+|[a-z]+)(?:[ :：、.．\-—_].*)?$/i.exec(trimmed)
  if (enMatch) {
    return { isMatch: true, title: trimmed }
  }

  // 4. 特殊章节开头：序章、序言、楔子、引子、尾声、后记、番外等
  const spMatch = /^[【〔［(（]?(?:引子|序章|序言|序幕|楔子|尾声|番外|后记|最终章|终章|结语)(?:[】〕］)）].*|[ :：、.．\-—_].*|$)/.exec(trimmed)
  if (spMatch) {
    return { isMatch: true, title: trimmed }
  }

  return { isMatch: false, title: '' }
}

/**
 * 按照章节标题正则切分文本。
 */
export function splitByTitle(
  lines: readonly string[],
  bookTitle?: string,
  customPattern?: string | RegExp,
): ChapterParsedItem[] {
  const chapters: ChapterParsedItem[] = []
  let currentTitle = ''
  let currentLines: string[] = []
  let chapterIndex = 1

  const pushChapter = (title: string, bodyLines: readonly string[]) => {
    const content = bodyLines.join('\n').trim()
    if (content.length === 0) return
    const cleanedTitle = title.trim() || `第${chapterIndex}章`
    chapters.push({
      chapterIndex,
      title: cleanedTitle,
      content,
      wordCount: content.replace(/\s+/g, '').length,
    })
    chapterIndex += 1
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const heading = matchChapterHeading(line, customPattern)
    if (heading.isMatch) {
      if (currentTitle || currentLines.length > 0) {
        if (!currentTitle) {
          // 正式第一章之前的前置文本
          const preambleText = currentLines.join('\n').trim()
          // 只有前置文本非常充实（>= 500字）且非元数据时，才作为独立序言
          if (
            preambleText.length >= 500 &&
            (!bookTitle || !preambleText.includes(bookTitle)) &&
            !preambleText.includes('内容简介')
          ) {
            pushChapter('序言', currentLines)
          }
        } else {
          pushChapter(currentTitle, currentLines)
        }
      }
      currentTitle = heading.title
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }

  if (currentTitle) {
    pushChapter(currentTitle, currentLines)
  } else if (currentLines.length > 0) {
    const content = currentLines.join('\n').trim()
    if (content.length > 0) {
      pushChapter(bookTitle ? '第一章' : '正文', currentLines)
    }
  }

  return chapters
}

/**
 * 按照连续空行（2个及以上空行/段落分隔）后备切分。
 */
export function splitByBlankLines(text: string): ChapterParsedItem[] {
  const rawChunks = text.split(/\n\n\n+/)
  const chapters: ChapterParsedItem[] = []
  let chapterIndex = 1

  for (const chunk of rawChunks) {
    const trimmed = chunk.trim()
    if (!trimmed) continue

    const lines = trimmed.split(/\r?\n/)
    const firstLine = lines[0]?.trim() ?? ''
    const heading = matchChapterHeading(firstLine)

    let title: string
    let bodyLines: string[]
    if (heading.isMatch) {
      title = heading.title
      bodyLines = lines.slice(1)
    } else if (firstLine.length > 0 && firstLine.length <= 30 && !/[。！？!?.]$/.test(firstLine)) {
      title = firstLine
      bodyLines = lines.slice(1)
    } else {
      title = chapterIndex === 1 ? '第一章' : `第${chapterIndex}章`
      bodyLines = lines
    }

    const content = bodyLines.join('\n').trim() || trimmed
    chapters.push({
      chapterIndex,
      title,
      content,
      wordCount: content.replace(/\s+/g, '').length,
    })
    chapterIndex += 1
  }

  return chapters
}

/**
 * 按照字数阈值（在段落边界断开）后备切分。
 */
export function splitByWordCount(text: string, threshold = 3000): ChapterParsedItem[] {
  const paragraphs = text.split(/\n\s*\n/)
  const chapters: ChapterParsedItem[] = []
  let currentParagraphs: string[] = []
  let currentWords = 0
  let chapterIndex = 1

  const pushChapter = () => {
    if (currentParagraphs.length === 0) return
    const content = currentParagraphs.join('\n\n').trim()
    if (!content) return

    const firstLine = currentParagraphs[0]?.split('\n')[0]?.trim() ?? ''
    const heading = matchChapterHeading(firstLine)
    let title: string
    let finalContent = content
    if (heading.isMatch) {
      title = heading.title
      finalContent = content.slice(firstLine.length).trim() || content
    } else {
      title = chapterIndex === 1 ? '第一章' : `第${chapterIndex}章`
    }

    chapters.push({
      chapterIndex,
      title,
      content: finalContent,
      wordCount: finalContent.replace(/\s+/g, '').length,
    })
    chapterIndex += 1
    currentParagraphs = []
    currentWords = 0
  }

  for (const p of paragraphs) {
    const trimmed = p.trim()
    if (!trimmed) continue
    const pWords = trimmed.replace(/\s+/g, '').length
    if (currentWords > 0 && currentWords + pWords > threshold) {
      pushChapter()
    }
    currentParagraphs.push(trimmed)
    currentWords += pWords
  }
  pushChapter()

  return chapters
}

/**
 * 核心调度：按指定模式切分或在 auto 模式下自动降级后备。
 */
export function splitDocument(
  text: string,
  options?: SplitOptions,
  bookTitle?: string,
): ChapterParsedItem[] {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new ImportParseError('EMPTY_CONTENT', 'document contains no readable text')
  }

  const mode = options?.splitMode ?? 'auto'
  const threshold = options?.wordCountThreshold ?? 3000
  const customPattern = options?.customTitlePattern

  if (mode === 'title') {
    const lines = trimmed.split(/\r?\n/)
    return splitByTitle(lines, bookTitle, customPattern)
  }

  if (mode === 'blank-line') {
    return splitByBlankLines(trimmed)
  }

  if (mode === 'word-count') {
    return splitByWordCount(trimmed, threshold)
  }

  // mode === 'auto'
  // 1. 优先尝试标题正则切分
  const lines = trimmed.split(/\r?\n/)
  const byTitleChapters = splitByTitle(lines, bookTitle, customPattern)

  // 如果按标题切出至少 2 章，直接采用
  if (byTitleChapters.length >= 2) {
    return byTitleChapters
  }

  // 若只切出 1 章或 0 章，但总字数超过阈值，尝试后备切分
  const totalWords = trimmed.replace(/\s+/g, '').length
  if (totalWords > threshold) {
    // 先尝试连续空行后备切分
    const byBlankChapters = splitByBlankLines(trimmed)
    if (byBlankChapters.length >= 2) {
      return byBlankChapters
    }
    // 空行不够时，按字数阈值切分
    const byWordChapters = splitByWordCount(trimmed, threshold)
    if (byWordChapters.length >= 2) {
      return byWordChapters
    }
  }

  // 否则返回按标题切出的结果（通常是 1 章）
  return byTitleChapters
}

/**
 * 顶层解析入口：处理 TXT/MD/DOCX 输入并解析出章节列表。
 */
export function parseDocumentToChapters(options: ParseDocumentOptions): ChapterParsedItem[] {
  const format = options.format
  let text = options.content ?? ''

  if (options.buffer !== undefined) {
    if (
      format === 'docx' ||
      (options.buffer.length >= 4 && options.buffer.readUInt32LE(0) === 0x04034b50)
    ) {
      const paragraphs = parseDocx(options.buffer)
      text = paragraphs.join('\n\n')
    } else {
      text = options.buffer.toString('utf8')
    }
  } else if (format === 'docx') {
    const buf = Buffer.from(text, 'base64')
    if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
      const paragraphs = parseDocx(buf)
      text = paragraphs.join('\n\n')
    } else {
      throw new ImportParseError('CORRUPT_DOCX', 'invalid docx format: content must be base64-encoded docx binary')
    }
  }

  if (!text || text.trim().length === 0) {
    throw new ImportParseError('EMPTY_CONTENT', 'document content is empty')
  }

  const chapters = splitDocument(text, options.splitOptions, options.bookTitle)
  if (chapters.length === 0) {
    throw new ImportParseError('NO_CHAPTERS_EXTRACTED', 'failed to split document into at least 1 chapter')
  }

  return chapters
}
