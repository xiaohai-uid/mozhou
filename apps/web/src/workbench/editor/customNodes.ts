/**
 * 编辑器自定义节点与投影分类（CHG-20261006-02 AST 化）。
 *
 * - SceneBreak：ProseMirror 自定义 atom 节点（场景切分行）。正文契约仍是纯文本，
 *   场景结构在编辑器内部以节点表达，序列化时经 prose-ast 行模型无损往返。
 * - blocksFromText：正文纯文本 → EditorBlock 结构标注（本地 projection 存储，
 *   场景块位置等编辑器结构不进 Chapter body，落 workbenchStorage 投影键）。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { isSceneBreakText } from './prose-ast'

export interface EditorBlock {
  id: string;
  type: 'paragraph' | 'heading' | 'scene_break' | 'character_quote';
  content: string;
}

/**
 * 场景切分节点（atom、无内部内容）。
 * marker 存该行的原始文本（round-trip 无损；渲染层只做视觉标注）。
 */
export const SceneBreak = Node.create({
  name: 'sceneBreak',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      marker: { default: '【场景切分】' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-scene-break]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-scene-break': '', 'data-marker': String(node.attrs.marker ?? '') }),
      String(node.attrs.marker ?? ''),
    ]
  },
  renderText({ node }) {
    return String(node.attrs.marker ?? '')
  },
})

/** 正文纯文本 → 结构块标注（projection 用；空行无结构意义，跳过）。 */
export function blocksFromText(rawText: string): EditorBlock[] {
  const blocks: EditorBlock[] = []
  rawText.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (isSceneBreakText(line)) {
      blocks.push({ id: `block-${blocks.length}`, type: 'scene_break', content: trimmed });
      return;
    }
    if (trimmed.startsWith('# ')) {
      blocks.push({ id: `block-${blocks.length}`, type: 'heading', content: trimmed.replace(/^#\s+/, '') });
      return;
    }
    if (trimmed.startsWith('“') || trimmed.startsWith('「')) {
      blocks.push({ id: `block-${blocks.length}`, type: 'character_quote', content: trimmed });
      return;
    }
    blocks.push({ id: `block-${blocks.length}`, type: 'paragraph', content: trimmed });
  });
  return blocks;
}
