/**
 * StyleProfile → Context Compiler 注入缝（T23 · #56；t51:B4）。
 *
 * renderStyleSections 把四场景型 StyleProfile vN 渲染为 compile() 的
 * structural.sections（section='style_profile:<scenarioType>'）——CompileStepRequest
 * 的 structuralSections 槽位（T16 预留）。四场景型全注入（否决 top-2：选择器是
 * 误分类源且伤 Receipt 可复算性），合计 ≤800 token 断言超限抛错（t51:B4）。
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
import type { StyleProfilesMap } from '@mozhou/data-plane';
import { SCENARIO_TYPES, STYLE_PROFILES_FENCE_OPEN } from '@mozhou/data-plane';

/** t51:B4 冻结注入预算：四场景型合计 ≤800 token（中文按字符粗估 1 token ≈ 1.5 字）。 */
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

/** 四 sections 合计 token 估算（按 1.5 字符/token 的确定性粗估——只做上限断言）。 */
export function estimateStyleSectionsTokens(sections: readonly StyleSection[]): number {
  let chars = 0;
  for (const section of sections) {
    chars += section.content.length + section.section.length;
  }
  return Math.ceil(chars / 1.5);
}

/** 冻结断言：渲染结果合计 ≤800 token 估算；超限抛错（t51:B4 硬约束）。 */
export function assertStyleSectionsWithinBudget(sections: readonly StyleSection[]): void {
  const estimated = estimateStyleSectionsTokens(sections);
  if (estimated > STYLE_SECTIONS_TOKEN_BUDGET) {
    throw new Error(
      'style_profile sections exceed token budget: estimated ' + estimated +
        ' > ' + STYLE_SECTIONS_TOKEN_BUDGET + ' (t51:B4)',
    );
  }
}
