import JSZip from 'jszip'
import { ChapterExportItem } from './txtCleanExporter'

/** XML 转义：正文/标题中的 & < > " ' 若不转义会产出损坏的 EPUB（阅读器拒绝打开）。 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 中文段落切分：与 txtCleanExporter 同口径（空行分段、去首行全角缩进）。 */
function chapterParagraphs(content: string): string[] {
  return content
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.replace(/^　　/, ''))
}

function chapterXhtml(index: number, title: string, paragraphs: readonly string[]): string {
  const body = paragraphs.map((p) => `    <p>${escapeXml(p)}</p>`).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN">
<head>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <section epub:type="chapter" id="chapter_${index}">
    <h2>${escapeXml(title)}</h2>
${body}
  </section>
</body>
</html>`
}

function navXhtml(bookTitle: string, chapters: readonly ChapterExportItem[]): string {
  const items = chapters
    .map(
      (ch, i) =>
        `      <li><a href="chapter_${i + 1}.xhtml">${escapeXml(ch.title)}</a></li>`
    )
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN">
<head>
  <title>目录</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>`
}

function tocNcx(bookTitle: string, bookUid: string, chapters: readonly ChapterExportItem[]): string {
  const navPoints = chapters
    .map(
      (ch, i) => `    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
      <content src="chapter_${i + 1}.xhtml"/>
    </navPoint>`
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(bookUid)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(bookTitle)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`
}

function contentOpf(
  bookTitle: string,
  author: string,
  bookUid: string,
  modifiedIso: string,
  chapterCount: number
): string {
  const manifestItems = [
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `    <item id="css" href="style.css" media-type="text/css"/>`,
    ...Array.from(
      { length: chapterCount },
      (_, i) =>
        `    <item id="chapter_${i + 1}" href="chapter_${i + 1}.xhtml" media-type="application/xhtml+xml"/>`
    ),
  ].join('\n')
  const spineItems = Array.from(
    { length: chapterCount },
    (_, i) => `    <itemref idref="chapter_${i + 1}"/>`
  ).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-uid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-uid">${escapeXml(bookUid)}</dc:identifier>
    <dc:title>${escapeXml(bookTitle)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">${modifiedIso}</meta>
  </metadata>
  <manifest>
${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`
}

const EPUB_STYLE_CSS = `body { font-family: "Noto Serif CJK SC", "Source Han Serif SC", serif; line-height: 1.8; }
h2 { text-align: center; margin: 1.5em 0; }
p { text-indent: 2em; margin: 0 0 0.5em; }`

/**
 * 打包真实 EPUB 3（对标 koodo-reader / readest 的电子书导出）：
 * EPUB 规范要求 mimetype 条目必须是 ZIP 首条且不压缩（STORED），
 * 否则主流阅读器（Apple Books / Calibre / koodo）会拒绝打开。
 */
export async function buildEpub(
  bookTitle: string,
  author: string,
  chapters: readonly ChapterExportItem[]
): Promise<Uint8Array> {
  if (chapters.length === 0) {
    throw new Error('无可导出章节：EPUB 至少需要 1 章正文')
  }

  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `fallback-${Date.now().toString(16)}`
  const bookUid = `urn:uuid:mozhou-${uuid}`
  const modifiedIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  const zip = new JSZip()
  // EPUB OCF: mimetype 必须第一且 STORED
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  )
  const oebps = zip.folder('OEBPS')
  if (oebps === null) throw new Error('EPUB OEBPS 目录创建失败')
  oebps.file('style.css', EPUB_STYLE_CSS)
  oebps.file('content.opf', contentOpf(bookTitle, author, bookUid, modifiedIso, chapters.length))
  oebps.file('nav.xhtml', navXhtml(bookTitle, chapters))
  oebps.file('toc.ncx', tocNcx(bookTitle, bookUid, chapters))
  chapters.forEach((ch, i) => {
    oebps.file(`chapter_${i + 1}.xhtml`, chapterXhtml(i + 1, ch.title, chapterParagraphs(ch.content)))
  })

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/epub+zip' })
}

/** 浏览器下载用 Blob 封装。 */
export async function exportEpubBlob(
  bookTitle: string,
  author: string,
  chapters: readonly ChapterExportItem[]
): Promise<Blob> {
  const bytes = await buildEpub(bookTitle, author, chapters)
  return new Blob([bytes], { type: 'application/epub+zip' })
}
