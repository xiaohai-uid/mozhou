/**
 * packages/data-plane · 纯文本清洁导出器 (TXT · 起点/番茄规范排版)。
 */
export interface ChapterExportItem {
  readonly title: string
  readonly content: string
}

export function exportCleanTxt(bookTitle: string, chapters: readonly ChapterExportItem[]): string {
  let output = `《${bookTitle}》\n\n`

  for (const ch of chapters) {
    output += `========================\n`
    output += `${ch.title}\n`
    output += `========================\n\n`

    const paragraphs = ch.content.split(/\n+/)
    for (const p of paragraphs) {
      const trimmed = p.trim()
      if (!trimmed) continue
      // 按照标准中文两全角空格排版，适合直接粘贴进作家助手或网文后台
      const indented = trimmed.startsWith('　　') ? trimmed : `　　${trimmed}`
      output += `${indented}\n\n`
    }
  }

  return output
}
