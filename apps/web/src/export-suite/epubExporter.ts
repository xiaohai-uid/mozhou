import { ChapterExportItem } from './txtCleanExporter';

export function exportEpubXmlStructure(bookTitle: string, author: string, chapters: ChapterExportItem[]) {
  // Compiles standard EPUB 3 navigation and chapter XHTML package
  const ncxToc = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:mozhou-${Date.now()}"/>
  </head>
  <docTitle><text>${bookTitle}</text></docTitle>
  <navMap>
    ${chapters
      .map(
        (ch, i) => `
    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${ch.title}</text></navLabel>
      <content src="chapter_${i + 1}.xhtml"/>
    </navPoint>`
      )
      .join('\n')}
  </navMap>
</ncx>`;

  const chapterFiles = chapters.map((ch, i) => ({
    filename: `chapter_${i + 1}.xhtml`,
    content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${ch.title}</title>
  <style>
    p { text-indent: 2em; line-height: 1.8; margin-bottom: 0.5em; }
    h2 { text-align: center; margin-bottom: 1.5em; }
  </style>
</head>
<body>
  <h2>${ch.title}</h2>
  ${ch.content
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/^　　/, '')}</p>`)
    .join('\n  ')}
</body>
</html>`,
  }));

  return { ncxToc, chapterFiles };
}
