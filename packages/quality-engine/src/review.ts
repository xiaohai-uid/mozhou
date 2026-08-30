/**
 * 质量审查总装：deterministic + semantic 合并 → 版本绑定 QualityReviewReport。
 *
 * 裁决纪律（ADR-0025 决策 3/4）：
 * - blocking_fail ⟺ 至少一条启用 blocking 规则 verdict=fail；
 * - 任一启用规则 verdict=unknown（提供方缺失/异常/未覆盖/缺证据）且无 blocking fail
 *   ⟹ refused——unknown 永不升格为 pass（fail closed）；
 * - REV-001 由 deterministic 层结构性保证：锚点哈希 ≠ 待审正文哈希的报告不能是 PASS。
 */
import { createHash, randomUUID } from 'node:crypto';
import { evaluateDeterministicRules } from './deterministic.js';
import type {
  FailurePattern,
  QualityPolicy,
  QualityReviewAnchor,
  QualityReviewReport,
  QualityRuleDefinition,
  QualityRuleEvaluation,
  ReviewerBinding,
} from './types.js';
import type { SemanticQualityEvaluator } from './semantic.js';

export function hashProse(prose: string): string {
  return createHash('sha256').update(prose, 'utf8').digest('hex');
}

export interface QualityReviewInput {
  readonly prose: string;
  readonly policy: QualityPolicy;
  readonly anchor: QualityReviewAnchor;
  readonly reviewer: ReviewerBinding;
  /** 项目级活跃失败模式（质量先验，非 Canon）；无则传空数组。 */
  readonly failurePatterns: readonly FailurePattern[];
  readonly semanticEvaluator?: SemanticQualityEvaluator;
  /** 见 DeterministicRuleOptions.actionBeatParagraphs。 */
  readonly actionBeatParagraphs?: ReadonlySet<number>;
}

async function evaluateSemanticRules(
  input: QualityReviewInput,
  semanticRules: readonly QualityRuleDefinition[],
): Promise<QualityRuleEvaluation[]> {
  const unknownFor = (rule: QualityRuleDefinition, note: string): QualityRuleEvaluation => ({
    ruleId: rule.id,
    ruleVersion: rule.version,
    verdict: 'unknown',
    evidence: [{ ruleId: rule.id, note }],
  });

  if (!input.semanticEvaluator) {
    return semanticRules.map((rule) =>
      unknownFor(rule, '语义审查提供方不可用——显式拒绝，不静默放行（fail closed）'),
    );
  }

  let evaluations: readonly QualityRuleEvaluation[];
  try {
    evaluations = await input.semanticEvaluator.evaluate({
      prose: input.prose,
      rules: semanticRules,
      projectFailurePatterns: input.failurePatterns,
    });
  } catch (err) {
    const note = '语义审查提供方异常：' + (err instanceof Error ? err.message : String(err));
    return semanticRules.map((rule) => unknownFor(rule, note));
  }

  const byId = new Map(evaluations.map((e) => [e.ruleId, e]));
  const out: QualityRuleEvaluation[] = [];
  for (const rule of semanticRules) {
    const evaluation = byId.get(rule.id);
    if (!evaluation) {
      out.push(unknownFor(rule, '语义审查提供方未返回该规则评估——显式拒绝（fail closed）'));
      continue;
    }
    if (evaluation.verdict === 'fail' && rule.evidenceRequired && evaluation.evidence.length === 0) {
      out.push(
        unknownFor(rule, '规则要求证据但提供方未附证据——按未知处理（fail closed）'),
      );
      continue;
    }
    out.push(evaluation);
  }
  return out;
}

export async function runQualityReview(input: QualityReviewInput): Promise<QualityReviewReport> {
  const proseHash = hashProse(input.prose);
  const deterministicOptions: {
    proseContentHash: string;
    anchorDraftContentHash: string;
    actionBeatParagraphs?: ReadonlySet<number>;
  } = {
    proseContentHash: proseHash,
    anchorDraftContentHash: input.anchor.draftContentHash,
  };
  if (input.actionBeatParagraphs !== undefined) {
    deterministicOptions.actionBeatParagraphs = input.actionBeatParagraphs;
  }
  const evaluations: QualityRuleEvaluation[] = [
    ...evaluateDeterministicRules(input.prose, input.policy, deterministicOptions),
  ];

  const semanticRules = input.policy.rules.filter((r) => r.enabled && r.kind === 'semantic');
  if (semanticRules.length > 0) {
    evaluations.push(...(await evaluateSemanticRules(input, semanticRules)));
  }

  const severityOf = (ruleId: string): 'blocking' | 'advisory' =>
    input.policy.rules.find((r) => r.id === ruleId)?.severity ?? 'blocking';

  let verdict: QualityReviewReport['verdict'] = 'pass';
  for (const evaluation of evaluations) {
    if (evaluation.verdict === 'fail' && severityOf(evaluation.ruleId) === 'blocking') {
      verdict = 'blocking_fail';
      break;
    }
  }
  if (verdict === 'pass') {
    for (const evaluation of evaluations) {
      if (evaluation.verdict === 'unknown') {
        verdict = 'refused';
        break;
      }
    }
  }

  return {
    schemaVersion: 1,
    reportId: randomUUID(),
    anchor: input.anchor,
    reviewer: input.reviewer,
    evaluations,
    verdict,
  };
}
