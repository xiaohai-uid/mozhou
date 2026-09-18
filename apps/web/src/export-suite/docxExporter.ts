/**
 * apps/web/src/export-suite · 真 OOXML DOCX 导出器 (T10 · Word/WPS 标准兼容)。
 * 
 * 依照 reference/02-features.md T10 规格：
 * 正式 .docx 必须为标准 OOXML ZIP 包，包含 [Content_Types].xml、_rels/.rels、word/document.xml，
 * 支持宋体正文、首行缩进 2em、黑体章节标题与标准段落排版，可在 Microsoft Word、WPS Office 中直接打开。
 */
import { packZip, type ZipEntry } from '@mozhou/data-plane'
import type { ChapterExportItem } from './txtCleanExporter.js'

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 构建真正的 OOXML Word 文档 (.docx) 二进制 Buffer。
 */
export function exportSubmissionDocx(
  bookTitle: string,
  synopsis: string,
  chapters: readonly ChapterExportItem[],
): Buffer {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  let documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="SimHei" w:eastAsia="SimHei"/>
          <w:b/>
          <w:sz w:val="44"/>
          <w:szCs w:val="44"/>
        </w:rPr>
        <w:t>${escapeXml(bookTitle)}</w:t>
      </w:r>
    </w:p>`

  if (synopsis && synopsis.trim().length > 0) {
    documentXml += `
    <w:p>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="SimSun" w:eastAsia="SimSun"/>
          <w:b/>
          <w:sz w:val="24"/>
        </w:rPr>
        <w:t>【内容简介】</w:t>
      </w:r>
    </w:p>`
    for (const line of synopsis.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      documentXml += `
    <w:p>
      <w:pPr><w:ind w:firstLineChars="200"/></w:pPr>
      <w:r>
        <w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="SimSun"/><w:i/><w:sz w:val="21"/></w:rPr>
        <w:t>${escapeXml(trimmed)}</w:t>
      </w:r>
    </w:p>`
    }
  }

  for (const ch of chapters) {
    documentXml += `
    <w:p>
      <w:pPr>
        <w:pageBreakBefore/>
        <w:spacing w:before="240" w:after="120"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="SimHei" w:eastAsia="SimHei"/>
          <w:b/>
          <w:sz w:val="30"/>
        </w:rPr>
        <w:t>${escapeXml(ch.title)}</w:t>
      </w:r>
    </w:p>`

    const paragraphs = ch.content.split(/\n+/)
    for (const p of paragraphs) {
      const trimmed = p.trim().replace(/^　　/, '')
      if (!trimmed) continue
      documentXml += `
    <w:p>
      <w:pPr><w:ind w:firstLineChars="200"/></w:pPr>
      <w:r>
        <w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="SimSun"/><w:sz w:val="24"/></w:rPr>
        <w:t xml:space="preserve">${escapeXml(trimmed)}</w:t>
      </w:r>
    </w:p>`
    }
  }

  documentXml += `
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`

  const zipEntries: ZipEntry[] = [
    { path: '[Content_Types].xml', data: contentTypesXml },
    { path: '_rels/.rels', data: relsXml },
    { path: 'word/document.xml', data: documentXml },
  ]

  return packZip(zipEntries)
}

/** 兼容旧版 HTML 导出（若需 .html 格式保存） */
export function exportSubmissionDocxHtml(bookTitle: string, synopsis: string, chapters: readonly ChapterExportItem[]): string {
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeXml(bookTitle)}</title></head><body><h1>${escapeXml(bookTitle)}</h1>`
  for (const ch of chapters) {
    html += `<h2>${escapeXml(ch.title)}</h2>`
    for (const p of ch.content.split(/\n+/)) {
      if (p.trim()) html += `<p>${escapeXml(p.trim())}</p>`
    }
  }
  html += `</body></html>`
  return html
}
