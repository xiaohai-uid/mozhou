/**
 * 语义（LLM）审查者契约——只有契约，没有硬编码题材提示词（ADR-0025：
 * 平台包不含任何具体小说词汇；规则按 id 注入，实现方自带 recipe）。
 *
 * 实现方职责：
 * - 只对 `rules` 中列出的规则返回评估；未评估 = 未知（review 层按 fail closed 处理）。
 * - fail 必须附证据（evidenceRequired 规则）。
 * - 提供方不可用/异常应抛错，由 review 层转 explicit refusal——**不得**吞错返回空数组
 *   （空数组会让全部语义规则变 unknown → refused，效果一致但丢失原因）。
 */
import type {
  FailurePattern,
  QualityRuleDefinition,
  QualityRuleEvaluation,
} from './types.js';

export interface SemanticQualityEvaluatorInput {
  readonly prose: string;
  readonly rules: readonly QualityRuleDefinition[];
  readonly projectFailurePatterns: readonly FailurePattern[];
}

export interface SemanticQualityEvaluator {
  evaluate(input: SemanticQualityEvaluatorInput): Promise<readonly QualityRuleEvaluation[]>;
}

/** V1 内置可复用语义规则 id（平台默认；项目可按 id 覆盖 severity/enabled）。 */
export const SEMANTIC_RULE_IDS = [
  'NARR-001', // outline_expansion
  'CHAR-001', // character_toolization
  'KNOW-001', // knowledge_overreach
  'PAY-001', // payoff_zeroed
  'PAY-002', // information_only_reward_streak
  'PAT-001', // repeated_solution_algorithm
  'STYLE-001', // forced_golden_line
  'MEM-001', // memory_anchor_repetition_without_added_meaning
  'MEM-002', // forced_anchor_creation
  'PAY-003', // repeated_pressure_without_expectation_growth
  'PAY-004', // tangible_gain_immediately_fully_erased_without_compensating_agency
  'PAT-002', // same_high_level_solution_pattern_repeated_across_recent_chapters
  'MEM-003', // anchor_echoed_with_no_added_meaning
  'MEM-004', // chapter_manufactures_a_new_anchor_solely_to_satisfy_quota
  'SEPIA-001', // theme_telling (Pass 1 Narrative Architecture: 主题旁白直接说教)
  'SEPIA-002', // single_track_causality (Pass 1: 单一整洁因果链与顿悟结案)
  'SEPIA-003', // bodily_sensation_monotony (Pass 1: 纯生理情绪反应堆砌)
  'SEPIA-004', // discourse_flow_sag (Pass 2 Discourse Flow: 段末设问与中段塌陷)
  'SEPIA-005', // surface_cliches (Pass 3 Surface Style: 机械AI套话连接词)
] as const;

export type SemanticRuleId = (typeof SEMANTIC_RULE_IDS)[number];
