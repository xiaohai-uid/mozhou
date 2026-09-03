export interface EditorBlock {
  id: string;
  type: 'paragraph' | 'heading' | 'scene_break' | 'character_quote';
  content: string;
}

export function parseTextToBlocks(rawText: string): EditorBlock[] {
  const lines = rawText.split('\n');
  const blocks: EditorBlock[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) continue;

    if (trimmed.startsWith('# ')) {
      blocks.push({ id: `block-${i}`, type: 'heading', content: trimmed.replace(/^#\s+/, '') });
    } else if (trimmed === '***' || trimmed === '---' || trimmed === '【场景切分】') {
      blocks.push({ id: `block-${i}`, type: 'scene_break', content: '【场景切分】' });
    } else if (trimmed.startsWith('“') || trimmed.startsWith('「')) {
      blocks.push({ id: `block-${i}`, type: 'character_quote', content: trimmed });
    } else {
      // Standard novel paragraph with 2-em indent preserved or normalized
      const normalized = trimmed.startsWith('　　') ? trimmed : `　　${trimmed}`;
      blocks.push({ id: `block-${i}`, type: 'paragraph', content: normalized });
    }
  }

  return blocks;
}

export function serializeBlocksToText(blocks: EditorBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'heading') return `# ${b.content}`;
      if (b.type === 'scene_break') return '\n***\n';
      return b.content;
    })
    .join('\n\n');
}
