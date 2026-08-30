/**
 * 可机械判断的文学规则（ADR-0025：确定性规则不依赖 LLM，证据为正文精确区间）。
 *
 * 只判 PASS/FAIL 并给证据；**永不改写正文**——改写是回炉（draft 重写）的事，
 * 且只能由 pipeline 显式驱动。
 *
 * 实现说明：段落切分/句子计数用显式字符循环而非正则——全角标点与
 * 空白类目在此更清晰，也避免双关转义。
 */
import type {
  QualityEvidence,
  QualityPolicy,
  QualityRuleDefinition,
  QualityRuleEvaluation,
} from './types.js';

export const PARA_001_ID = 'PARA-001';
export const REV_001_ID = 'REV-001';
export const DETERMINISTIC_RULE_VERSION = '1.0.0';

export interface DeterministicRuleOptions {
  /**
   * 调用方显式标记为「动作拍点」的段落索引（0 起）：这些段落豁免于
   * PARA-001 的连续独句流水判定。V1 保守策略：除对话外仅此豁免。
   */
  readonly actionBeatParagraphs?: ReadonlySet<number>;
  /** 待审正文的精确 SHA-256（UTF-8）；与 anchorDraftContentHash 对照驱动 REV-001。 */
  readonly proseContentHash?: string;
  /** 审查锚点声称的 draft 内容哈希（来自 QualityReviewAnchor）。 */
  readonly anchorDraftContentHash?: string;
}

interface Paragraph {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly isDialogue: boolean;
  readonly isOneSentence: boolean;
}

const TERMINALS = new Set(['。', '！', '？', '!', '?', '…']);
const OPENING_QUOTES = new Set(['「', '『', '“', '"', '‘', "'"]);

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '　' || ch === '\r';
}

/** 按空行（可含空白的 \n 行）切段，段内记录精确字符区间。 */
function splitParagraphs(prose: string): Paragraph[] {
  const lines = prose.split('\n');
  const paragraphs: Paragraph[] = [];
  let pos = 0;
  let current: { start: number; end: number; text: string } | null = null;
  let index = 0;

  const flush = () => {
    if (!current) return;
    const text = current.text;
    let first = 0;
    while (first < text.length && isWhitespace(text.charAt(first))) first += 1;
    const isDialogue = first < text.length && OPENING_QUOTES.has(text.charAt(first));
    let runs = 0;
    let inRun = false;
    for (let i = 0; i < text.length; i += 1) {
      const isTerminal = TERMINALS.has(text.charAt(i));
      if (isTerminal && !inRun) runs += 1;
      inRun = isTerminal;
    }
    paragraphs.push({
      index: index++,
      start: current.start,
      end: current.end,
      isDialogue,
      isOneSentence: runs === 1 && !isDialogue,
    });
    current = null;
  };

  for (const line of lines) {
    const lineStart = pos;
    pos += line.length + 1; // +1 为换行符（末行多计，无影响）
    const hasContent = line.split('').some((ch) => !isWhitespace(ch));
    if (!hasContent) {
      flush();
      continue;
    }
    if (!current) current = { start: lineStart, end: lineStart + line.length, text: line };
    else {
      current = {
        start: current.start,
        end: lineStart + line.length,
        text: current.text + '\n' + line,
      };
    }
  }
  flush();
  return paragraphs;
}

function paraEvaluation(
  definition: QualityRuleDefinition,
  prose: string,
  options: DeterministicRuleOptions,
): QualityRuleEvaluation {
  const paragraphs = splitParagraphs(prose);
  const exempt = options.actionBeatParagraphs ?? new Set<number>();
  const evidence: QualityEvidence[] = [];

  let runStart: Paragraph | null = null;
  let runLast: Paragraph | null = null;
  let runLength = 0;
  const flush = () => {
    if (runStart && runLast && runLength >= 3) {
      evidence.push({
        ruleId: definition.id,
        location: { start: runStart.start, end: runLast.end },
        note: `连续 ${runLength} 个独句叙事段落（无对话、未标记为动作拍点）——段落瀑布`,
      });
    }
    runStart = null;
    runLast = null;
    runLength = 0;
  };
  for (const p of paragraphs) {
    const plain = !p.isDialogue && !exempt.has(p.index);
    if (p.isOneSentence && plain) {
      if (!runStart) runStart = p;
      runLast = p;
      runLength += 1;
    } else {
      flush();
    }
  }
  flush();

  return {
    ruleId: definition.id,
    ruleVersion: definition.version,
    verdict: evidence.length > 0 ? 'fail' : 'pass',
    evidence,
  };
}

function revEvaluation(
  definition: QualityRuleDefinition,
  options: DeterministicRuleOptions,
): QualityRuleEvaluation | null {
  const { proseContentHash, anchorDraftContentHash } = options;
  if (proseContentHash === undefined || anchorDraftContentHash === undefined) return null;
  const current = proseContentHash === anchorDraftContentHash;
  return {
    ruleId: definition.id,
    ruleVersion: definition.version,
    verdict: current ? 'pass' : 'fail',
    evidence: current
      ? []
      : [
          {
            ruleId: definition.id,
            note: `审查锚点哈希 ${anchorDraftContentHash.slice(0, 12)}… 与待审正文精确哈希 ${proseContentHash.slice(0, 12)}… 不一致——该报告不能作为 PASS 使用`,
          },
        ],
  };
}

/**
 * 评估策略中启用的确定性规则。REV-001 是结构性不变量：只要同时给了
 * proseContentHash 与 anchorDraftContentHash 就一定评估（即使策略漏配），
 * 保证「锚定哈希不一致的报告不能是 PASS」无条件成立。
 */
export function evaluateDeterministicRules(
  prose: string,
  policy: QualityPolicy,
  options: DeterministicRuleOptions = {},
): QualityRuleEvaluation[] {
  const out: QualityRuleEvaluation[] = [];
  const paraDef = policy.rules.find((r) => r.id === PARA_001_ID && r.enabled);
  if (paraDef) {
    out.push(paraEvaluation(paraDef, prose, options));
  }
  const revDef = policy.rules.find((r) => r.id === REV_001_ID);
  const revMeta: QualityRuleDefinition =
    revDef ?? {
      id: REV_001_ID,
      version: DETERMINISTIC_RULE_VERSION,
      scope: 'platform',
      kind: 'deterministic',
      severity: 'blocking',
      description: '审查锚点必须与待审正文精确 revision/hash 一致（结构性，不可禁用）',
      evidenceRequired: true,
      enabled: true,
    };
  const rev = revEvaluation(revMeta, options);
  if (rev) out.push(rev);
  return out;
}
