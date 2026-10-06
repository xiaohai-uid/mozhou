/**
 * 正文 AST 行模型（编辑器 AST 化的纯函数核心 · CHG-20261006-02）。
 *
 * 契约不变量（验收「旧 textarea 草稿无损打开」与「选区不漂移」的根基）：
 * 1. Round-trip 无损：`proseLinesToText(textToProseLines(t)) === t` 对任意字符串成立。
 *    每行原样保留（含全角缩进与空白），场景切分行只做分类、不改写文本。
 * 2. 行 ↔ ProseMirror 位置一一对应：doc 顶层只含 paragraph 与 sceneBreak（atom）两类节点；
 *    paragraph 节点 size = 2 + len(text)，sceneBreak 节点 size = 1。
 * 3. 正式 Chapter body 仍是纯文本字符串（\n 分段）——本模块是字符串世界与 PM
 *    位置世界之间的唯一桥梁，两个世界互不越界。
 */

/** 场景切分行标记（trim 后的合法形态；round-trip 仍输出原始行文本）。 */
export const SCENE_BREAK_MARKERS = ['***', '---', '【场景切分】'] as const;

export type ProseLineKind = 'paragraph' | 'scene_break';

export interface ProseLine {
  readonly kind: ProseLineKind;
  /** 原始行文本（含全角缩进与空白——round-trip 无损的载体，永不 trim）。 */
  readonly text: string;
  /** kind='scene_break' 时的标记词（trim 后），其余为 undefined。 */
  readonly marker?: string;
}

export function isSceneBreakText(line: string): boolean {
  const trimmed = line.trim();
  return (SCENE_BREAK_MARKERS as readonly string[]).includes(trimmed);
}

/** 纯文本 → 行模型。每行一个元素（含空行 = 空 paragraph）。 */
export function textToProseLines(text: string): ProseLine[] {
  return text.split('\n').map((line) => {
    if (isSceneBreakText(line)) {
      return { kind: 'scene_break' as const, text: line, marker: line.trim() };
    }
    return { kind: 'paragraph' as const, text: line };
  });
}

/** 行模型 → 纯文本。与 textToProseLines 构成无损往返。 */
export function proseLinesToText(lines: readonly ProseLine[]): string {
  return lines.map((line) => line.text).join('\n');
}

/** 单个顶层节点的 ProseMirror 尺寸（open 边界 + 内容 + close 边界）。 */
function proseLineNodeSize(line: ProseLine): number {
  return line.kind === 'scene_break' ? 1 : 2 + line.text.length;
}

export interface ProseLineSpan {
  readonly index: number;
  readonly line: ProseLine;
  /** UTF-16 文本偏移区间 [textStart, textEnd)（不含行尾 \n）。 */
  readonly textStart: number;
  readonly textEnd: number;
  /** 节点开始边界（= 前序节点尺寸之和）。 */
  readonly pmNodeStart: number;
  /** 节点内文本 PM 区间 [pmTextFrom, pmTextTo)；sceneBreak 无文本，两者相等。 */
  readonly pmTextFrom: number;
  readonly pmTextTo: number;
  /** 节点结束边界（= 下一节点 pmNodeStart）。 */
  readonly pmNodeEnd: number;
}

/** 行模型 → PM 位置跨度表（O(n) 一次遍历）。 */
export function buildLineSpans(lines: readonly ProseLine[]): ProseLineSpan[] {
  const spans: ProseLineSpan[] = [];
  let textStart = 0;
  let pmNodeStart = 0;
  lines.forEach((line, index) => {
    const nodeSize = proseLineNodeSize(line);
    spans.push({
      index,
      line,
      textStart,
      textEnd: textStart + line.text.length,
      pmNodeStart,
      pmTextFrom: pmNodeStart + 1,
      pmTextTo: pmNodeStart + 1 + (line.kind === 'scene_break' ? 0 : line.text.length),
      pmNodeEnd: pmNodeStart + nodeSize,
    });
    textStart += line.text.length + 1; // + 行尾 \n
    pmNodeStart += nodeSize;
  });
  return spans;
}

/**
 * 文本偏移 → PM 位置。
 * - 行内 [textStart, textEnd)：pm = pmTextFrom + 偏移；
 * - 恰在行末（textEnd，\n 之前）：pm = pmTextTo（该行文本之后）；
 * - 超出末行：夹到最后一行文本末尾。
 * sceneBreak 行没有文本内容，偏移落在其区间时夹到行首（pmNodeStart + 1）。
 */
export function textOffsetToPmPos(spans: readonly ProseLineSpan[], offset: number): number {
  if (spans.length === 0) return 1; // 空 doc：唯一合法位置 1（空段内）。
  const clamped = Math.max(0, offset);
  for (const span of spans) {
    if (clamped < span.textStart) break; // 不发生（spans 单调），防御性短路。
    if (clamped <= span.textEnd) {
      if (span.line.kind === 'scene_break') return span.pmTextFrom;
      return span.pmTextFrom + (clamped - span.textStart);
    }
  }
  const last = spans[spans.length - 1];
  return last === undefined ? 1 : last.pmTextTo;
}

export interface ReplacePlan {
  /** tr.replace 的起始位置。 */
  readonly pmFrom: number;
  /** tr.replace 的结束位置。 */
  readonly pmTo: number;
  /** 替换完成后的建议光标位置（新内容末尾）。 */
  readonly pmCursor: number;
  /** 替换后的新行序列（供节点构造）。 */
  readonly newLines: readonly ProseLine[];
  /** Slice 开放度：pmFrom 落在 paragraph 行中间 ⇒ 首块与前段拼接（否则块替换会劈开段落）。 */
  readonly openStart: 0 | 1;
  /** Slice 开放度：pmTo 落在 paragraph 行中间 ⇒ 尾块与后段拼接。 */
  readonly openEnd: 0 | 1;
}

/**
 * 规划「字符串语义」的局部替换 [from, to) → newText 在 PM 世界的落点。
 *
 * 语义与 `text.slice(0, from) + newText + text.slice(to)` 逐字节一致，但只替换
 * 受影响的行区间（「AST 局部替换」），其余行的节点对象原样保留。
 * 返回 null 表示区间非法（from > to 或越界）。
 */
export function planRangeReplacement(
  text: string,
  from: number,
  to: number,
  newText: string,
): ReplacePlan | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > text.length) {
    return null;
  }
  const lines = textToProseLines(text);
  const spans = buildLineSpans(lines);
  const iA = findLineIndex(spans, from);
  const iB = findLineIndex(spans, Math.max(from, to - 1));
  if (iA === null || iB === null) return null;
  const spanA = spans[iA];
  const spanB = spans[iB];
  if (spanA === undefined || spanB === undefined) return null;
  const aOff = from - spanA.textStart;
  const bOff = to - spanB.textStart;
  const prefix = spanA.line.text.slice(0, aOff);
  const suffix = spanB.line.text.slice(bOff);

  const newLines = textToProseLines(prefix + newText + suffix);

  const pmFrom = aOff === 0 ? spanA.pmNodeStart : textOffsetToPmPos(spans, from);
  const pmTo =
    bOff >= spanB.line.text.length
      ? spanB.pmNodeEnd
      : textOffsetToPmPos(spans, to);

  // 光标：newText 结尾在拼接串中的偏移，映射回新行序列。
  const joined = prefix + newText + suffix;
  const endOff = Math.min(prefix.length + newText.length, joined.length);
  const newSpans = buildLineSpans(newLines);
  const pmCursor = textOffsetToPmPos(newSpans, endOff);

  // Slice 开放度：边界落在 paragraph 行内（非行首/行尾）⇒ 与现有段落拼接；
  // sceneBreak 是 atom（无内容可拼），恒为 0。
  const openStart: 0 | 1 =
    aOff > 0 && spanA.line.kind === 'paragraph' ? 1 : 0;
  const openEnd: 0 | 1 =
    bOff > 0 && bOff < spanB.line.text.length && spanB.line.kind === 'paragraph' ? 1 : 0;

  return { pmFrom, pmTo, pmCursor, newLines, openStart, openEnd };
}

/** 偏移所在行（闭区间 [textStart, textEnd]；末行含总长）。 */
function findLineIndex(spans: readonly ProseLineSpan[], offset: number): number | null {
  if (spans.length === 0) return null;
  for (const span of spans) {
    if (offset >= span.textStart && offset <= span.textEnd) return span.index;
  }
  return spans.length - 1; // 越界夹到末行。
}

/**
 * ProseMirror 位置 → 文本偏移（onSelectionUpdate 反向映射用）。
 * 节点边界位置夹到最近行；sceneBreak 区间夹到其行首（无文本可选）。
 */
export function pmPosToTextOffset(spans: readonly ProseLineSpan[], pos: number): number {
  if (spans.length === 0) return 0;
  for (const span of spans) {
    if (pos <= span.pmNodeStart) return span.textStart;
    if (pos <= span.pmTextFrom) return span.textStart;
    if (pos <= span.pmTextTo) return span.line.kind === 'scene_break' ? span.textStart : span.textStart + (pos - span.pmTextFrom);
  }
  const last = spans[spans.length - 1];
  return last === undefined ? 0 : last.textEnd;
}

/**
 * ProseMirror 文档 → 正文纯文本（行模型序列化；docToText 的唯一实现点）。
 * paragraph/heading 输出 textContent，sceneBreak 输出 marker 属性（原始行文本）。
 */
export function docToProseText(doc: { forEach: (cb: (node: ProseMirrorLikeNode) => void) => void }): string {
  const lines: string[] = [];
  doc.forEach((child) => {
    if (child.type?.name === 'sceneBreak') {
      lines.push(typeof child.attrs?.marker === 'string' ? child.attrs.marker : '【场景切分】');
      return;
    }
    lines.push(child.textContent ?? '');
  });
  return lines.join('\n');
}

/** @tiptap/pm/model Node 的结构子集（避免在本文件引入运行时依赖）。 */
export interface ProseMirrorLikeNode {
  readonly type: { readonly name: string } | undefined;
  readonly attrs: Record<string, unknown> | undefined;
  readonly textContent: string;
  readonly nodeSize: number;
}
