import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  proseChapterPath,
  readBookRecord,
  readNarrativeSnapshot,
  readProseChapter,
  scanEntityCards,
} from '@mozhou/data-plane'
import { EmptyRecallError, type ContextPacket, type ExactTokenizer } from '@mozhou/context-compiler'
import { runCompileStep } from '@mozhou/pipeline'

const PREVIEW_CONTEXT_WINDOW_BYTES = 48_000
const MAX_RECENT_CHAPTERS = 3
const MAX_RECENT_CHARS_PER_CHAPTER = 12_000

/**
 * v0.1 Technical Preview 的确定性保守预算器。
 * 这里的 profile 明确按 UTF-8 bytes 计预算，而不是伪称某个远端模型的精确 BPE；
 * Receipt 会记录该 version，后续接 provider 精确 tokenizer 时可无歧义替换。
 */
const previewByteBudget: ExactTokenizer = {
  version: 'mozhou-preview-utf8-byte-budget-v1',
  count(text: string): number {
    return Buffer.byteLength(text, 'utf8')
  },
}

function recentStoryText(root: string, chapterIndex: number): string[] {
  const first = Math.max(1, chapterIndex - MAX_RECENT_CHAPTERS + 1)
  const slices: string[] = []
  for (let index = first; index <= chapterIndex; index += 1) {
    const relPath = proseChapterPath(index)
    if (!existsSync(join(root, relPath))) continue
    try {
      const body = readProseChapter(root, relPath).body.trim()
      if (body.length === 0) continue
      slices.push(body.slice(-MAX_RECENT_CHARS_PER_CHAPTER))
    } catch {
      // 单个损坏章不在这里被吞成“正典”；Compile/质量面会另行暴露结构错误。
    }
  }
  return slices
}

function structuralFallback(
  bookTitle: string,
  chapterIndex: number,
  authorPrompt: string,
  storyText: readonly string[],
  alwaysCards: readonly { ref: string; brief?: string | null }[],
): ContextPacket {
  const sections = [
    {
      section: 'book_identity',
      text: `作品：《${bookTitle}》\n当前章节：第 ${chapterIndex} 章\n作者指令：${authorPrompt}\n`,
    },
    ...alwaysCards.map((card) => ({
      section: `entity:${card.ref}`,
      text: `${card.brief ?? ''}\n`,
    })),
  ].map((piece) => ({ ...piece, tokens: previewByteBudget.count(piece.text) }))

  const storyBody = storyText.join('\n\n')
  const storyRendered = storyBody.length > 0 ? storyBody + '\n' : ''
  const text = sections.map((piece) => piece.text).join('') + storyRendered
  return {
    taskType: 'CHAPTER_DRAFTING',
    chapterIndex,
    structural: sections,
    settings: [],
    story: {
      text: storyRendered,
      tokens: previewByteBudget.count(storyRendered),
      trimType: 'none',
    },
    text,
    totalTokens: previewByteBudget.count(text),
  }
}

export interface DraftContextResult {
  readonly packet: ContextPacket
  readonly mode: 'compiled_receipt' | 'structural_fallback'
}

/**
 * Web 主生成链路的唯一上下文入口。
 * 优先走正式 Context Compiler（目录卡 + NarrativeStateSnapshot + 近期正文 + Receipt）；
 * 只有全部召回通道确实为空时，才回落到可审计的 book/chapter/story 结构层，不伪造 Receipt。
 */
export async function buildDraftContext(input: {
  readonly root: string
  readonly chapterIndex: number
  readonly authorPrompt: string
}): Promise<DraftContextResult> {
  const book = readBookRecord(input.root)
  const cards = scanEntityCards(input.root)
  const snapshot = readNarrativeSnapshot(input.root)
  const storyText = recentStoryText(input.root, input.chapterIndex)
  const alwaysCards = cards.filter((card) => card.aiContext === 'always')

  const structuralSections = [
    {
      section: 'book_identity',
      content: `作品：《${book.title}》\n当前章节：第 ${input.chapterIndex} 章\n作者指令：${input.authorPrompt}`,
    },
  ]

  try {
    const outcome = await runCompileStep(
      { chapterIndex: input.chapterIndex, staleMarker: null },
      {
        bookRoot: input.root,
        bookId: book.id,
        // keyword / graph / embedding 的激活查询同时看作者指令与近期正文。
        draftText: [input.authorPrompt, ...storyText].join('\n\n'),
        cards,
        snapshot,
        scope: { chapterIndex: input.chapterIndex, pov: 'protagonist' },
        structuralSections,
        storyText,
        modelProfile: {
          id: 'mozhou-preview-utf8-byte-budget-v1',
          contextWindow: PREVIEW_CONTEXT_WINDOW_BYTES,
        },
        tokenizer: previewByteBudget,
      },
    )
    return { packet: outcome.packet, mode: 'compiled_receipt' }
  } catch (error) {
    if (!(error instanceof EmptyRecallError)) throw error
    return {
      packet: structuralFallback(book.title, input.chapterIndex, input.authorPrompt, storyText, alwaysCards),
      mode: 'structural_fallback',
    }
  }
}
