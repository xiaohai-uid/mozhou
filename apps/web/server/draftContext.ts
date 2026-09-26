import {
  LocalDataPlane,
  readNarrativeSnapshot,
  readStyleProfiles,
} from '@mozhou/data-plane'
import { EmptyRecallError, createLocalTokenizer, type ContextPacket, type ExactTokenizer } from '@mozhou/context-compiler'
import { assertStyleSectionsWithinBudget, renderStyleSections } from '@mozhou/flywheel'
import { prepareChapterInputs, qualityStructuralSections, runCompileStep } from '@mozhou/pipeline'

const PREVIEW_CONTEXT_WINDOW_TOKENS = 32_000
const MAX_RECENT_CHAPTERS = 3
const MAX_RECENT_CHARS_PER_CHAPTER = 12_000

/**
 * 预算路径的 Token 计量（token-budget-assembly-spec §3）。
 *
 * 用随仓 bge-small-zh-v1.5 WordPiece 词表真实分词。此前这里是「1 码点 ≈ 1 token」
 * 估算器，规格明令禁止估算器进入预算核算路径——实测偏差可达百倍（'A'×150 估算 150、
 * 实际 1 个 [UNK]；'internationalization' 估算 20、实际 4），而它直接驱动正文保底
 * 配额与结构层截断。
 *
 * 惰性装载：资产缺失时让预算路径响亮失败（TokenizerAssetsError），而不是整个服务起不来。
 */
let tokenizerSingleton: ExactTokenizer | null = null
function exactTokenizer(): ExactTokenizer {
  tokenizerSingleton ??= createLocalTokenizer()
  return tokenizerSingleton
}

function recentStoryText(plane: LocalDataPlane, chapterIndex: number): string[] {
  const first = Math.max(1, chapterIndex - MAX_RECENT_CHAPTERS + 1)
  const slices: string[] = []
  for (let index = first; index <= chapterIndex; index += 1) {
    try {
      const body = plane.getProseChapter(index).body.trim()
      if (body.length === 0) continue
      slices.push(body.slice(-MAX_RECENT_CHARS_PER_CHAPTER))
    } catch {
      // 单个损坏/未创建章不在这里被吞成“正典”；Compile/质量面会另行暴露结构错误。
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
  ].map((piece) => ({ ...piece, tokens: exactTokenizer().count(piece.text) }))

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
      tokens: exactTokenizer().count(storyRendered),
      trimType: 'none',
    },
    text,
    totalTokens: exactTokenizer().count(text),
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
  const plane = LocalDataPlane.openOrRebuild(input.root)
  try {
    const book = plane.book
    const cards = plane.getEntityCards()
    const snapshot = readNarrativeSnapshot(input.root)
    const storyText = recentStoryText(plane, input.chapterIndex)
    const alwaysCards = cards.filter((card) => card.aiContext === 'always')

    // Prepare 步（S2）：章查询结果集是正文生成的生产输入面——stale 标记由 Compile
    // 追加 stale_warning 段（警告继续 + Receipt 留痕），有界质量切片（ADR-0025）
    // 并入既有结构段通道。章大纲缺失/非法原样抛出：宁败不脏，不降级成假上下文。
    const prepared = prepareChapterInputs(input.root, input.chapterIndex)

    // 风格画像（t51:B4）：文风.md 四场景型全注入 compile 结构层，section 键冻结为
    // style_profile:<scenarioType>。每次生成重扫盘上现值——StyleLearner 学习与文风面板
    // 改动因此下一章即生效；合计超 800 token 预算即抛错（冻结硬约束），不用泛化话术冒充文风。
    const styleSections = renderStyleSections(readStyleProfiles(input.root))
    assertStyleSectionsWithinBudget(styleSections)

    const structuralSections = [
      {
        section: 'book_identity',
        content: `作品：《${book.title}》\n当前章节：第 ${input.chapterIndex} 章\n作者指令：${input.authorPrompt}`,
      },
      ...qualityStructuralSections(prepared.qualitySlice),
      ...styleSections,
    ]

    try {
      const outcome = await runCompileStep(prepared, {
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
          id: 'mozhou-preview-wordpiece-budget-v1',
          contextWindow: PREVIEW_CONTEXT_WINDOW_TOKENS,
        },
        tokenizer: exactTokenizer(),
      })
      return { packet: outcome.packet, mode: 'compiled_receipt' }
    } catch (error) {
      if (!(error instanceof EmptyRecallError)) throw error
      return {
        packet: structuralFallback(book.title, input.chapterIndex, input.authorPrompt, storyText, alwaysCards),
        mode: 'structural_fallback',
      }
    }
  } finally {
    plane.close()
  }
}
