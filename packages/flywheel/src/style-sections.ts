/**
 * StyleProfile → Context Compiler 注入缝（T23 · #56；t51:B4）。
 *
 * renderStyleSections 把四场景型 StyleProfile vN 渲染为 compile() 的
 * structural.sections（section='style_profile:<scenarioType>'）——CompileStepRequest
 * 的 structuralSections 槽位（T16 预留）。四场景型全注入（否决 top-2：选择器是
 * 误分类源且伤 Receipt 可复算性），合计 ≤800 token 断言超限抛错（t51:B4）。
 *
 * 计量口径（token-budget-assembly-spec §3）：预算核算只认**注入的精确 tokenizer**，
 * 估算器严禁进入该路径。断言所需的计量器由编排方注入（本包不引入 context-compiler
 * 依赖），计量对象与 assemble 的结构层口径一致——逐 section 的 content + '\n'。
 *
 * 格式为确定性 fenced 文本：每个 section 一行 header（scenarioType vN）+ 量化分面
 * 键值——Receipt 可 diff、replayInputs 可复算。纯函数零 IO零时钟。
 */
/** 本地最小结构面（与 @mozhou/context-compiler StructuralSection 同构——flywheel
 *  不引入该依赖，编排方把本渲染结果直接喂 compile-step 的 structuralSections 槽位）。 */
export interface StyleSection {
  readonly section: string;
  readonly content: string;
}

/** 本地最小精确计量面（与 @mozhou/context-compiler ExactTokenizer 同构——同上不引入
 *  依赖，编排方把预算路径用的同一个实例传进来，保证 Receipt 可复算）。 */
export interface StyleTokenCounter {
  count(text: string): number;
}
import type { StyleProfilesMap } from '@mozhou/data-plane';
import { SCENARIO_TYPES, STYLE_PROFILES_FENCE_OPEN } from '@mozhou/data-plane';

/** t51:B4 冻结注入预算：四场景型合计 ≤800 token（精确计量，口径见 countStyleSectionsTokens）。 */
export const STYLE_SECTIONS_TOKEN_BUDGET = 800;

interface StyleProfileRowView {
  readonly revision: number;
  readonly dialogueRatio: number;
  readonly sensoryDensity: number;
  readonly actionPacing: number;
  readonly tabooWords: readonly string[];
  readonly sentenceLengthDistribution: readonly { readonly maxLengthChars: number; readonly share: number }[];
}

function bucketSummary(row: StyleProfileRowView): string {
  return row.sentenceLengthDistribution.map((bucket) => `≤${bucket.maxLengthChars}: ${bucket.share.toFixed(3)}`).join(' | ');
}

function profileStats(row: StyleProfileRowView): string {
  const lines: string[] = [
    `revision: ${row.revision}`,
    `dialogueRatio: ${row.dialogueRatio.toFixed(3)}`,
    `sentenceBuckets: ${bucketSummary(row)}`,
    `sensoryDensity: ${row.sensoryDensity.toFixed(3)}`,
    `actionPacing: ${row.actionPacing.toFixed(3)}`,
  ];
  if (row.tabooWords.length > 0) {
    lines.push('tabooWords: ' + row.tabooWords.join(','));
  }
  return lines.join('\n');
}

/** 把四分面画像渲染为 structural sections（四场景型全注入，冻结 section 键）。 */
export function renderStyleSections(profiles: StyleProfilesMap): StyleSection[] {
  return SCENARIO_TYPES.map((scenarioType) => {
    const row = profiles[scenarioType];
    const content = [
      `# ${scenarioType} StyleProfile v${row.revision}`,
      '',
      profileStats(row),
      '',
      STYLE_PROFILES_FENCE_OPEN,
      '（结构化分面见上；完整可编辑画像在 文风.md 唯一真源）',
      '```',
    ].join('\n');
    return { section: 'style_profile:' + scenarioType, content };
  });
}

/** 四 sections 合计 token 精确计数（注入计量器，规格 §3 唯一权威源）。
 *
 *  计量对象为 content + '\n'，与 assemble 的 renderPiece（assemble.ts:207/376）
 *  同口径——本断言因此是结构层 B_struct 计数的子集，两者不会互相打架。
 *  无计量器即无预算断言：调用方必须传，不存在字符数估算回退。 */
export function countStyleSectionsTokens(
  sections: readonly StyleSection[],
  tokenizer: StyleTokenCounter,
): number {
  let tokens = 0;
  for (const section of sections) {
    tokens += tokenizer.count(section.content + '\n');
  }
  return tokens;
}

/** 冻结断言：渲染结果合计 ≤800 token 精确计数；超限抛错（t51:B4 硬约束，宁败不截断）。 */
export function assertStyleSectionsWithinBudget(
  sections: readonly StyleSection[],
  tokenizer: StyleTokenCounter,
): void {
  const tokens = countStyleSectionsTokens(sections, tokenizer);
  if (tokens > STYLE_SECTIONS_TOKEN_BUDGET) {
    throw new Error(
      'style_profile sections exceed token budget: ' + tokens +
        ' > ' + STYLE_SECTIONS_TOKEN_BUDGET + ' (t51:B4)',
    );
  }
}
