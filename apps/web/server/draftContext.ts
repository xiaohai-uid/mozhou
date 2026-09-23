import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AUTHOR_INTENT_PATH,
  parseFrontmatter,
  proseChapterPath,
  readBookRecord,
  readLorebook,
  readNarrativeSnapshot,
  readProseChapter,
  scanEntityCards,
} from '@mozhou/data-plane'
import { EmptyRecallError, type ContextPacket, type ExactTokenizer } from '@mozhou/context-compiler'
import { runCompileStep } from '@mozhou/pipeline'

const PREVIEW_CONTEXT_WINDOW_TOKENS = 32_000
const MAX_RECENT_CHAPTERS = 3
const MAX_RECENT_CHARS_PER_CHAPTER = 12_000

function readAuthorIntentText(root: string): string | null {
  const p = join(root, AUTHOR_INTENT_PATH)
  if (!existsSync(p)) return null
  try {
    const raw = readFileSync(p, 'utf8')
    const doc = parseFrontmatter(raw)
    const body = doc.body.trim()
    return body.length > 0 ? body : null
  } catch {
    return null
  }
}

/**
 * v0.1 Technical Preview 的确定性本地 Token 计数器。
 * 依据加固设计要求（Plan §Task 5）：采用确定性 Unicode 码点（codepoint count）计量，
 * 使中文正典与小说上下文按 1 字符 ≈ 1 Token 比例拟合大模型 Token 预算，
 * 避免直接以 UTF-8 原始字节三倍虚高导致正典过早截断。
 */
const previewCodepointTokenizer: ExactTokenizer = {
  version: 'mozhou-preview-codepoint-budget-v1',
  count(text: string): number {
    let count = 0
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _char of text) {
      count += 1
    }
    return count
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
  authorIntentText?: string | null,
): ContextPacket {
  const rawSections = [
    {
      section: 'book_identity',
      text: `作品：《${bookTitle}》\n当前章节：第 ${chapterIndex} 章\n作者指令：${authorPrompt}\n`,
    },
    ...(authorIntentText ? [{ section: 'author_intent', text: `【作者核心设定与意图】\n${authorIntentText}\n` }] : []),
    ...alwaysCards.map((card) => ({
      section: `entity:${card.ref}`,
      text: `${card.brief ?? ''}\n`,
    })),
  ]

  let usedTokens = 0
  const sections: { section: string; text: string; tokens: number }[] = []
  for (const s of rawSections) {
    const tokens = previewCodepointTokenizer.count(s.text)
    if (usedTokens + tokens <= PREVIEW_CONTEXT_WINDOW_TOKENS) {
      sections.push({ ...s, tokens })
      usedTokens += tokens
    } else {
      throw new Error(
        `CONTEXT_OVERFLOW: 设定与作者意图等结构信息超出上下文总预算 (${PREVIEW_CONTEXT_WINDOW_TOKENS})，请精简设定或缩短作者指令`,
      )
    }
  }

  const remainingBudget = PREVIEW_CONTEXT_WINDOW_TOKENS - usedTokens
  let storyRendered = ''
  if (remainingBudget > 0 && storyText.length > 0) {
    const fullStory = storyText.join('\n\n') + '\n'
    const fullTokens = previewCodepointTokenizer.count(fullStory)
    if (fullTokens <= remainingBudget) {
      storyRendered = fullStory
    } else {
      storyRendered = fullStory.slice(-remainingBudget)
    }
  }

  const text = sections.map((piece) => piece.text).join('') + storyRendered
  return {
    taskType: 'CHAPTER_DRAFTING',
    chapterIndex,
    structural: sections,
    settings: [],
    story: {
      text: storyRendered,
      tokens: previewCodepointTokenizer.count(storyRendered),
      trimType: storyRendered.length < storyText.join('\n\n').length ? 'truncated' : 'none',
    },
    text,
    totalTokens: previewCodepointTokenizer.count(text),
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
  const authorIntentText = readAuthorIntentText(input.root)

  const structuralSections = [
    {
      section: 'book_identity',
      content: `作品：《${book.title}》\n当前章节：第 ${input.chapterIndex} 章\n作者指令：${input.authorPrompt}`,
    },
    ...(authorIntentText ? [{ section: 'author_intent', content: `【作者核心设定与意图】\n${authorIntentText}` }] : []),
  ]

  try {
    // 世界书：读失败不阻断生成（缺文件=空；坏文件降级为无世界书并继续正式链路）。
    let lorebook: ReturnType<typeof readLorebook> = []
    try {
      lorebook = readLorebook(input.root)
    } catch {
      lorebook = []
    }
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
        lorebook: [...lorebook],
        modelProfile: {
          id: 'mozhou-preview-codepoint-budget-v1',
          contextWindow: PREVIEW_CONTEXT_WINDOW_TOKENS,
        },
        tokenizer: previewCodepointTokenizer,
      },
    )
    return { packet: outcome.packet, mode: 'compiled_receipt' }
  } catch (error) {
    if (!(error instanceof EmptyRecallError)) throw error
    return {
      packet: structuralFallback(
        book.title,
        input.chapterIndex,
        input.authorPrompt,
        storyText,
        alwaysCards,
        authorIntentText,
      ),
      mode: 'structural_fallback',
    }
  }
}
