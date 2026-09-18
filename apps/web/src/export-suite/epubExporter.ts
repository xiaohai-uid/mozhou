/**
 * apps/web/src/export-suite · 真 EPUB 3 电子书导出器 (T10 · 阅读器标准兼容)。
 * 
 * 依照 reference/02-features.md T10 规格：
 * EPUB 必须是有效 EPUB3 ZIP（首项无压缩 mimetype、META-INF/container.xml、OPF/nav/XHTML、正确 XML 转义），
 * 可以在 Apple Books、Calibre 等主流 EPUB 阅读器中直接渲染打开。
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

export function exportSubmissionEpub(
  bookTitle: string,
  author: string,
  chapters: readonly ChapterExportItem[],
): Buffer {
  const bookId = `urn:uuid:mozhou-${Date.now()}`
  const zipEntries: ZipEntry[] = []

  // 1. mimetype (必须是归档的第一个条目，且不能压缩)
  zipEntries.push({
    path: 'mimetype',
    data: 'application/epub+zip',
    store: true,
  })

  // 2. META-INF/container.xml
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  zipEntries.push({ path: 'META-INF/container.xml', data: containerXml })

  // 3. OEBPS/toc.ncx (EPUB2 回退)
  const ncxXml = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${bookId}"/>
  </head>
  <docTitle><text>${escapeXml(bookTitle)}</text></docTitle>
  <navMap>
    ${chapters
      .map(
        (ch, i) => `
    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
      <content src="chapter_${i + 1}.xhtml"/>
    </navPoint>`,
      )
      .join('\n')}
  </navMap>
</ncx>`
  zipEntries.push({ path: 'OEBPS/toc.ncx', data: ncxXml })

  // 4. OEBPS/nav.xhtml (EPUB3 导航)
  const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>目录</title>
  <meta charset="utf-8"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
      ${chapters.map((ch, i) => `<li><a href="chapter_${i + 1}.xhtml">${escapeXml(ch.title)}</a></li>`).join('\n      ')}
    </ol>
  </nav>
</body>
</html>`
  zipEntries.push({ path: 'OEBPS/nav.xhtml', data: navXhtml })

  // 5. 各章节 XHTML 文件
  for (let i = 0; i < chapters.length; i += 1) {
    const ch = chapters[i]!
    const paras = ch.content
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p>${escapeXml(p.replace(/^　　/, ''))}</p>`)
      .join('\n  ')

    const chapterXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(ch.title)}</title>
  <meta charset="utf-8"/>
  <style>
    body { font-family: sans-serif; margin: 1em; }
    h2 { text-align: center; margin-bottom: 1.5em; }
    p { text-indent: 2em; line-height: 1.8; margin-bottom: 0.5em; margin-top: 0; }
  </style>
</head>
<body>
  <h2>${escapeXml(ch.title)}</h2>
  ${paras}
</body>
</html>`
    zipEntries.push({ path: `OEBPS/chapter_${i + 1}.xhtml`, data: chapterXhtml })
  }

  // 6. OEBPS/content.opf (元数据与清单)
  const opfXml = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${bookId}</dc:identifier>
    <dc:title>${escapeXml(bookTitle)}</dc:title>
    <dc:creator>${escapeXml(author || '墨舟作者')}</dc:creator>
    <dc:language>zh</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${chapters.map((_, i) => `<item id="ch${i + 1}" href="chapter_${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join('\n    ')}
  </spine>
</package>`
  zipEntries.push({ path: 'OEBPS/content.opf', data: opfXml })

  return packZip(zipEntries)
}

/** 兼容旧版 XML 结构导出 */
export function exportEpubXmlStructure(bookTitle: string, author: string, chapters: readonly ChapterExportItem[]) {
  const buffer = exportSubmissionEpub(bookTitle, author, chapters)
  return { buffer }
}
