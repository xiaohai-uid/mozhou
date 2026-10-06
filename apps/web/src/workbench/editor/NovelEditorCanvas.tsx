import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ProseLine } from './prose-ast';
import { SlashCommandMenu } from './SlashCommandMenu';
import { FloatingBubbleMenu } from './FloatingBubbleMenu';
import { SceneBreak } from './customNodes';
import {
  docToProseText,
  pmPosToTextOffset,
  buildLineSpans,
  planRangeReplacement,
  textOffsetToPmPos,
  textToProseLines,
} from './prose-ast';

export interface NovelEditorCanvasProps {
  value: string;
  onChange: (newValue: string) => void;
  /** 选区/Slash AI 动作回调。行内编辑契约（/api/prose.edit.stream）已由面板接线。 */
  onSelectionAction?: ((action: string, selectedText: string, customInstruction?: string) => void) | undefined;
  /** 选区变化回调（from/to 为正文纯文本 UTF-16 偏移与所选原文）。 */
  onSelectionChange?: ((selection: { from: number; to: number; selectedText: string } | null) => void) | undefined;
  placeholder?: string | undefined;
  readOnly?: boolean | undefined;
  className?: string | undefined;
}

/** 命令式编辑 API（面板 Accept 局部替换与选区测试锚点）。 */
export interface NovelEditorCanvasHandle {
  /** 把正文 [from,to)（纯文本 UTF-16 偏移）替换为 newText：走 ProseMirror transaction，可撤销。 */
  replaceRange(from: number, to: number, newText: string): void;
  /** 以正文纯文本偏移设置选区（真实 PM transaction 路径）。 */
  setSelection(from: number, to: number): void;
  /** 撤销上一次编辑事务（Accept 后「撤销 AI 替换」的显式入口；等效 Mod-Z）。 */
  undo(): void;
}

/* ---- 纯文本 ↔ ProseMirror 文档转换（行模型唯一桥梁的两个方向） ---- */

function textToDocJson(text: string): JSONContent {
  return {
    type: 'doc',
    content: textToProseLines(text).map((line) =>
      line.kind === 'scene_break'
        ? { type: 'sceneBreak', attrs: { marker: line.marker } }
        : {
            type: 'paragraph',
            ...(line.text ? { content: [{ type: 'text', text: line.text }] } : {}),
          },
    ),
  };
}

/** Enter 两全角缩进（中文排版纪律；IME 组词中绝不拦截）。 */
const ChineseIndent = Extension.create({
  name: 'chineseIndent',
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const view = this.editor.view;
        if (view.composing) return false; // 中文 IME 确认候选词的 Enter 不是分段。
        const selection = this.editor.state.selection;
        if (!selection.empty) return false; // 有选区的 Enter 走默认删除行为。
        return this.editor
          .chain()
          .focus()
          .splitBlock()
          .insertContentAt(this.editor.state.selection.from, '　　')
          .run();
      },
    };
  },
});

/**
 * 网文沉浸画卷（Reading Slate · ADR-0028 写作层 · CHG-20261006-02 AST 化）：
 * - 内部 ProseMirror/TipTap AST（段落 + 场景切分节点）；对外契约仍是正文纯文本字符串。
 * - Slash（场景 = 真场景节点；角色/节拍就地插入；rewrite/deslop 走面板契约）；
 * - 选区 Bubble（四预设 + 自定义指令 → 面板流式契约）；
 * - 中文输入优先：IME 组词不拦截；Enter 分段带两全角缩进。
 */
export const NovelEditorCanvas = forwardRef<NovelEditorCanvasHandle, NovelEditorCanvasProps>(
  ({ value, onChange, onSelectionAction, onSelectionChange, placeholder = '在此开始构思正文...', readOnly = false, className = '' }, ref) => {
    const [slashPosition, setSlashPosition] = useState<{ top: number; left: number } | null>(null);
    const [bubblePosition, setBubblePosition] = useState<{ top: number; left: number } | null>(null);
    const [selectedText, setSelectedText] = useState('');
    // 回调最新引用（editor 生命周期长于渲染周期，经 ref 转发防闭包过期）。
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onSelectionChangeRef = useRef(onSelectionChange);
    onSelectionChangeRef.current = onSelectionChange;

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // 正文行模型只需要 document/paragraph/text/hardBreak/undoRedo 与拖放辅助；
          // 其余富文本扩展一律关闭（网文正文无加粗/列表/引用语义）。
          blockquote: false,
          bold: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          heading: false,
          horizontalRule: false,
          italic: false,
          link: false,
          listItem: false,
          listKeymap: false,
          orderedList: false,
          strike: false,
          trailingNode: false,
          underline: false,
        }),
        SceneBreak,
        ChineseIndent,
      ],
      content: textToDocJson(value),
      editable: !readOnly,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': '章节正文编辑区',
          spellcheck: 'false',
        },
      },
      onUpdate: ({ editor: ed }) => {
        onChangeRef.current(docToProseText(ed.state.doc));
      },
      onSelectionUpdate: ({ editor: ed }) => {
        const { from, to, empty } = ed.state.selection;
        if (empty) {
          setSelectedText('');
          onSelectionChangeRef.current?.(null);
          return;
        }
        const spans = buildLineSpans(textToProseLines(docToProseText(ed.state.doc)));
        const textFrom = pmPosToTextOffset(spans, from);
        const textTo = pmPosToTextOffset(spans, to);
        const raw = ed.state.doc.textBetween(from, to, '\n');
        setSelectedText(raw.trim());
        if (textFrom < textTo && raw.length > 0) {
          onSelectionChangeRef.current?.({ from: textFrom, to: textTo, selectedText: raw });
        } else {
          onSelectionChangeRef.current?.(null);
        }
      },
      onTransaction: ({ editor: ed }) => {
        // 行首 '/'（行首 = 文档开头或上一字符为换行）→ 就地唤起 Slash。
        const { from } = ed.state.selection;
        if (from >= 1) {
          const before = ed.state.doc.textBetween(Math.max(0, from - 1), from, '\n');
          const two = ed.state.doc.textBetween(Math.max(0, from - 2), from, '\n');
          if (before === '/' && (two.length < 2 || two.charCodeAt(0) === 10)) {
            const coords = ed.view.coordsAtPos(from);
            setSlashPosition({ top: coords.top, left: coords.left + 12 });
            return;
          }
        }
      },
    });

    // 外部 value 变化（切章/服务端回填/Accept 前的文本演进）→ 同步进 AST（emitUpdate=false 防回写环）。
    useEffect(() => {
      if (editor === null || editor.isDestroyed) return;
      const current = docToProseText(editor.state.doc);
      if (current !== value) {
        editor.commands.setContent(textToDocJson(value), { emitUpdate: false });
      }
    }, [value, editor]);

    // readOnly 动态切换。
    useEffect(() => {
      if (editor === null || editor.isDestroyed) return;
      editor.setEditable(!readOnly);
    }, [editor, readOnly]);

    useImperativeHandle(
      ref,
      () => ({
        replaceRange: (from, to, newText) => {
          if (editor === null || editor.isDestroyed) return;
          const text = docToProseText(editor.state.doc);
          const plan = planRangeReplacement(text, from, to, newText);
          if (plan === null) return;
          const schema = editor.schema;
          const toNode = (line: ProseLine): ProseMirrorNode =>
            line.kind === 'scene_break'
              ? schema.nodes.sceneBreak!.create({ marker: line.marker })
              : schema.nodes.paragraph!.create(null, line.text ? [schema.text(line.text)] : undefined);
          // Slice 内容来源：open=0（整行级替换）用合并行；任一边 open=1 时用 newText 的
          // 行分解——open 层只融 newText 自身，原段落的前缀/后缀由 PM fit 拼接
          // （slice 若带 prefix 会把前缀重复插入，曾致 '　　单段　　单段插入。。'）。
          const pureInsertOrSplit = plan.openStart === 1 || plan.openEnd === 1;
          const nodes = (pureInsertOrSplit ? textToProseLines(newText) : plan.newLines).map(toNode);
          const tr = editor.state.tr
            .replace(plan.pmFrom, plan.pmTo, new Slice(Fragment.fromArray(nodes), plan.openStart, plan.openEnd))
            .scrollIntoView();
          editor.view.dispatch(tr);
          // 光标 = newText 结尾在**替换后全文**中的偏移（from+len），映射回 PM 位置。
          const after = docToProseText(editor.state.doc);
          const afterSpans = buildLineSpans(textToProseLines(after));
          editor.commands.setTextSelection(textOffsetToPmPos(afterSpans, from + newText.length));
        },
        setSelection: (from, to) => {
          if (editor === null || editor.isDestroyed) return;
          const spans = buildLineSpans(textToProseLines(docToProseText(editor.state.doc)));
          const pmFrom = textOffsetToPmPos(spans, from);
          const pmTo = textOffsetToPmPos(spans, to);
          editor.commands.setTextSelection({ from: Math.min(pmFrom, pmTo), to: Math.max(pmFrom, pmTo) });
        },
        undo: () => {
          if (editor === null || editor.isDestroyed) return;
          editor.commands.undo();
        },
      }),
      [editor],
    );

    /** 一键排版：首行两全角缩进归整与对白行引号归一（FR-1.1 纯文本层面，正文契约不变）。 */
  const handleFormatTypography = useCallback(() => {
    const formatted = value
      .split('\n')
      .map((p) => {
        let line = p.trim();
        if (!line) return '';
        // FR-1.1 对白行规范化：将英文直双引号按对归一为中文弯引号
        let isLeft = true;
        line = line.replace(/"/g, () => {
          const quote = isLeft ? '“' : '”';
          isLeft = !isLeft;
          return quote;
        });
        return line.startsWith('　　') ? line : '　　' + line;
      })
      .join('\n');
    onChange(formatted);
  }, [value, onChange]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      if (editor === null || editor.isDestroyed) return;
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        setBubblePosition(null);
        return;
      }
      const raw = editor.state.doc.textBetween(from, to, '\n');
      if (raw.trim().length > 0) {
        setBubblePosition({ top: e.clientY, left: e.clientX });
      } else {
        setBubblePosition(null);
      }
    }, [editor]);

    const insertMarker = useCallback(
      (text: string) => {
        if (editor === null || editor.isDestroyed) return;
        editor.chain().focus().insertContent(text).run();
      },
      [editor],
    );

    const handleSlashCommand = useCallback(
      (command: string) => {
        setSlashPosition(null);
        if (editor === null || editor.isDestroyed) return;
        const { from } = editor.state.selection;
        // 吃掉唤起菜单的 '/'（就地插入，不留斜杠残迹）。
        const before = editor.state.doc.textBetween(Math.max(0, from - 1), from, '\n');
        if (before === '/') {
          editor.chain().focus().deleteRange({ from: from - 1, to: from }).run();
        }
        if (command === 'scene') {
          // 场景 = 真 ProseMirror 场景节点（验收「场景节点可创建」）。
          editor
            .chain()
            .focus()
            .insertContent([
              { type: 'paragraph' },
              { type: 'sceneBreak', attrs: { marker: '【场景切分 · POV视点】' } },
              { type: 'paragraph' },
            ])
            .run();
        } else if (command === 'character') insertMarker('【正典角色卡：】');
        else if (command === 'beat') insertMarker('\n【核心节拍：冲突升级】\n');
        else onSelectionAction?.(command, '');
      },
      [editor, insertMarker, onSelectionAction],
    );

    const handleBubbleAction = useCallback(
      (action: string, customInstruction?: string) => {
        setBubblePosition(null);
        onSelectionAction?.(action, selectedText, customInstruction);
      },
      [onSelectionAction, selectedText],
    );

    return (
      <div
        className={`reading-slate ${className}`}
        style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        data-testid="novel-editor-canvas"
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 14px',
            borderBottom: '1px solid var(--hairline)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="kicker">READING SLATE · ACTIVE DRAFT</span>
            <span className="badge b-neutral" style={{ fontSize: 9 }}>标准排版</span>
          </div>
          <button type="button" className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={handleFormatTypography} title="一键首行缩进两字符与段落归整">
            一键网文排版
          </button>
        </div>

        <div style={{ position: 'relative', flex: 1, padding: '22px 28px', overflowY: 'auto' }} onMouseUp={handleMouseUp}>
          {value === '' && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                top: 26,
                left: 32,
                color: 'var(--text-faint)',
                fontFamily: 'var(--serif)',
                fontSize: 17,
                pointerEvents: 'none',
              }}
            >
              {placeholder}
            </span>
          )}
          <EditorContent
            editor={editor}
            style={{
              width: '100%',
              minHeight: 380,
              color: 'var(--foreground)',
              fontFamily: 'var(--serif)',
              fontSize: 17,
              lineHeight: 1.9,
              letterSpacing: '0.02em',
            }}
          />
        </div>

        <SlashCommandMenu position={slashPosition} onSelectCommand={handleSlashCommand} onClose={() => setSlashPosition(null)} />
        {selectedText.length > 0 && bubblePosition !== null && (
          <FloatingBubbleMenu
            selectedText={selectedText}
            position={bubblePosition}
            onAction={handleBubbleAction}
            onClose={() => setBubblePosition(null)}
          />
        )}
      </div>
    );
  },
);

NovelEditorCanvas.displayName = 'NovelEditorCanvas';
