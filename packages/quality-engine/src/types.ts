/**
 * @mozhou/quality-engine — 文学质量审查领域类型（ADR-0025）。
 *
 * 边界纪律：
 * - 本包的类型永不进入 Story Kernel 词汇表；QualityPolicy/ReaderExperienceDelta/
 *   MemoryAnchor 不是 TemporalFact，不参与 Canon 真伪折叠。
 * - QualityReviewReport 是版本绑定的值：锚定
 *   chapterIndex + draftRevision + draftContentHash + receiptId + ruleSetDigest
 *   （+ reviewerBinding），任一正文变化使旧 PASS stale（fail closed）。
 * - 不得把任何具体小说的题材词写进本包代码（平台规则与项目规则分层）。
 */

export type QualityRuleKind = 'deterministic' | 'semantic';
export type QualitySeverity = 'blocking' | 'advisory';
export type QualityRuleVerdict = 'pass' | 'fail' | 'na' | 'unknown';

export interface QualityRuleDefinition {
  readonly id: string;
  readonly version: string;
  readonly scope: 'platform' | 'project';
  readonly kind: QualityRuleKind;
  readonly severity: QualitySeverity;
  readonly description: string;
  readonly evidenceRequired: boolean;
  readonly enabled: boolean;
}

export interface QualityPolicy {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly rules: readonly QualityRuleDefinition[];
  readonly maxAutomaticReworks: 2;
}

export interface QualityEvidence {
  readonly ruleId: string;
  readonly excerpt?: string;
  readonly location?: { readonly start: number; readonly end: number };
  readonly note: string;
}

export interface QualityRuleEvaluation {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly verdict: QualityRuleVerdict;
  readonly evidence: readonly QualityEvidence[];
}

export interface ReviewerBinding {
  readonly providerId: string;
  readonly model: string;
  readonly recipeVersion: string;
}

export interface QualityReviewAnchor {
  readonly chapterIndex: number;
  readonly draftRevision: number;
  readonly draftContentHash: string;
  readonly receiptId: string;
  readonly ruleSetDigest: string;
}

export interface QualityReviewReport {
  readonly schemaVersion: 1;
  readonly reportId: string;
  readonly anchor: QualityReviewAnchor;
  readonly reviewer: ReviewerBinding;
  readonly evaluations: readonly QualityRuleEvaluation[];
  readonly verdict: 'pass' | 'blocking_fail' | 'refused';
}

/**
 * 作者结构化纠错原因（Task 5 正式落地失败记忆投影；词汇表先于此冻结，
 * 供 SemanticQualityEvaluator 输入契约引用）。不是 Canon 事实，只是质量先验。
 */
export type CorrectionReason =
  | 'outline_expansion'
  | 'character_toolization'
  | 'knowledge_overreach'
  | 'payoff_zeroed'
  | 'information_only_reward'
  | 'repeated_solution_algorithm'
  | 'forced_golden_line'
  | 'memory_anchor_misuse'
  | 'style_drift'
  | 'other';

/** CorrectionReason 词表（运行时校验用；与类型联合同源）。 */
export const CORRECTION_REASONS: readonly CorrectionReason[] = [
  'outline_expansion',
  'character_toolization',
  'knowledge_overreach',
  'payoff_zeroed',
  'information_only_reward',
  'repeated_solution_algorithm',
  'forced_golden_line',
  'memory_anchor_misuse',
  'style_drift',
  'other',
];

export interface FailurePattern {
  readonly code: CorrectionReason;
  readonly firstSeenChapter: number;
  readonly lastSeenChapter: number;
  readonly occurrences: number;
  readonly active: boolean;
  readonly authorNote?: string;
}
