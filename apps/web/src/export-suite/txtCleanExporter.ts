export interface ChapterExportItem {
  title: string;
  content: string;
}

export function exportCleanTxt(bookTitle: string, chapters: readonly ChapterExportItem[]): string {
  let output = `《${bookTitle}》\n\n`;

  for (const ch of chapters) {
    output += `========================\n`;
    output += `${ch.title}\n`;
    output += `========================\n\n`;

    const paragraphs = ch.content.split(/\n+/);
    for (const p of paragraphs) {
      const trimmed = p.trim();
      if (!trimmed) continue;
      // Format with standard Chinese 2 em spaces for direct copy-paste into Qidian/Fanqie portals
      const indented = trimmed.startsWith('　　') ? trimmed : `　　${trimmed}`;
      output += `${indented}\n\n`;
    }
  }

  return output;
}
