/**
 * 十步步进词表（T16 · #40；chapter-pipeline-spec §1 十步总览 / ADR-0024）。
 *
 * 一章的生产 = 一个 ChapterProductionSession 的十步步进序列；每步转换是一条
 * Ledger 任务事件（TaskStarted 开卷、TaskStepTransitioned 步进、TaskFinished 收卷），
 * 当前步可随时从投影恢复。回环只由作者显式动作驱动（S7）——本词表 V1 只表达
 * 线性后继序，Gate 冲突后的回炉重走由后续票在显式驱动下扩展。
 */

/** 十步序列（步 id 即 Ledger 事件 payload 里的 step 值，人读可 grep）。 */
export const PIPELINE_STEPS = [
  'prepare',
  'compile',
  'draft',
  'review',
  'user_edit',
  'final_extract',
  'continuity_gate',
  'canon_proposal',
  'commit',
  'flywheel_record',
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];

/** 步的序位（0 起）；词表外值返回 -1。 */
export function stepIndex(step: string): number {
  const index = (PIPELINE_STEPS as readonly string[]).indexOf(step);
  return index;
}

/** 词表守卫：任意字符串是否为合法步 id。 */
export function isPipelineStep(value: string): value is PipelineStep {
  return stepIndex(value) >= 0;
}

/** 严格后继步：末步之后无后继（返回 null）。 */
export function nextStepOf(step: PipelineStep): PipelineStep | null {
  const index = stepIndex(step);
  if (index < 0 || index === PIPELINE_STEPS.length - 1) {
    return null;
  }
  return PIPELINE_STEPS[index + 1] ?? null;
}
