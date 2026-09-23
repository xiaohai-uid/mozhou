/**
 * @mozhou/quality-engine — 公开接口（curated 导出，不用 export *：
 * 接口即调用方必须学习的全部知识，新增导出必须显式过此文件）。
 */
export { CORRECTION_REASONS } from './types.js';
export type {
  CorrectionReason,
  FailurePattern,
  QualityEvidence,
  QualityPolicy,
  QualityReviewAnchor,
  QualityReviewReport,
  QualityRuleDefinition,
  QualityRuleEvaluation,
  QualityRuleKind,
  QualityRuleVerdict,
  QualitySeverity,
  ReviewerBinding,
} from './types.js';
export {
  defaultPlatformRules,
  mergeQualityPolicies,
  qualityRuleSetDigest,
} from './policy.js';
export type { ChapterQualityStatus, DraftIdentity } from './staleness.js';
export { isQualityReviewCurrent, queryChapterQualityStatus } from './staleness.js';
export {
  DETERMINISTIC_RULE_VERSION,
  PARA_001_ID,
  REV_001_ID,
  evaluateDeterministicRules,
} from './deterministic.js';
export type { DeterministicRuleOptions } from './deterministic.js';
export { SEMANTIC_RULE_IDS } from './semantic.js';
export type { SemanticQualityEvaluator, SemanticQualityEvaluatorInput, SemanticRuleId } from './semantic.js';
export {
  parseFailurePatterns,
  serializeFailurePatterns,
  updateFailurePatterns,
} from './failure-memory.js';
export {
  parseReaderExperienceDeltas,
  selectRecentDeltas,
  serializeReaderExperienceDeltas,
} from './reader-experience.js';
export type {
  ExpectationDelta,
  PayoffProgress,
  PressureDelta,
  ReaderExperienceDelta,
  TangibleGain,
} from './reader-experience.js';
export {
  parseMemoryAnchors,
  recordAnchorEcho,
  retireAnchor,
  selectRelevantAnchors,
  serializeMemoryAnchors,
} from './memory-anchor.js';
export type { AnchorStatus, AnchorType, MemoryAnchor } from './memory-anchor.js';
export { hashProse, runQualityReview } from './review.js';
export type { QualityReviewInput } from './review.js';
export {
  BUILTIN_REDLINES,
  detect4GramRepetition,
  evaluateMechanicalGates,
  findCommon5Gram,
  isInsideQuotes,
} from './mechanical-gates.js';
export type {
  MechanicalCheckResult,
  MechanicalGateReport,
} from './mechanical-gates.js';
export { evaluateStyleMetrics } from './style-metrics.js';
export type { SepiaNarrativeScore, StyleMetrics } from './style-metrics.js';
export {
  runDeAiDiagnostics,
  TIER_1_PATTERNS,
  TIER_2_CLUSTER_TERMS,
} from './de-ai-engine.js';
export type {
  DeAiEngineReport,
  DeAiFinding,
  DeAiSeverity,
} from './de-ai-engine.js';

