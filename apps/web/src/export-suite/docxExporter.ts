import { ChapterExportItem } from './txtCleanExporter';

export function exportSubmissionDocxHtml(bookTitle: string, synopsis: string, chapters: ChapterExportItem[]): string {
  // Generates Word-compliant formatted HTML that saves as .docx / .doc with Songti, 1.5 spacing, 2em indent
  let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${bookTitle}</title>
<style>
body {
  font-family: "SimSun", "Songti SC", serif;
  font-size: 12pt;
  line-height: 1.5;
  color: #000000;
  margin: 3cm 2.5cm;
}
h1 {
  font-family: "SimHei", "Heiti SC", sans-serif;
  font-size: 20pt;
  text-align: center;
  margin-bottom: 24pt;
}
h2 {
  font-family: "SimHei", "Heiti SC", sans-serif;
  font-size: 15pt;
  margin-top: 24pt;
  margin-bottom: 12pt;
  page-break-before: always;
}
.synopsis {
  font-style: italic;
  margin-bottom: 30pt;
  border-left: 3px solid #ccc;
  padding-left: 12pt;
}
p {
  text-indent: 2em;
  margin: 0;
  padding: 0;
  line-height: 1.6;
}
</style>
</head>
<body>
<h1>${bookTitle}</h1>
<div class="synopsis">
<strong>【内容简介】</strong><br/>
${synopsis || '暂无简介'}
</div>
`;

  for (const ch of chapters) {
    html += `<h2>${ch.title}</h2>\n`;
    const paragraphs = ch.content.split(/\n+/);
    for (const p of paragraphs) {
      const trimmed = p.trim().replace(/^　　/, '');
      if (!trimmed) continue;
      html += `<p>${trimmed}</p>\n`;
    }
  }

  html += `</body></html>`;
  return html;
}
