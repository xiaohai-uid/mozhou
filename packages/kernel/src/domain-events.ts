/**
 * 领域事件词表与成对约束（T16 受控增补 · #40；chapter-pipeline-spec §4 第 1 条）。
 *
 * 规格锚点：ADR-0007(novel) 事件架构 + runtime-capability-spec §3（T11 引入，
 * T16 上收 kernel 类型库统一持有——「事件 schema 变更 = 类型库受控增补，禁止
 * 各模块散写」的词表真源自本文件起为 kernel）。
 *
 * 词表修订（相对 ADR-0007 原文）：
 *   - 删死事件 `AutomatedReviewCompleted`（#32 S5：Gate 纯机械拍板，LLM 审查
 *     降为旁路建议不入账——该事件自实现以来无发射方，属死词条）；
 *   - 增任务族 `CandidateDeltaExtracted`（十步第 6 步 Final Extract 的关键事件，
 *     chapter-pipeline-spec §1 表）；TaskStarted / TaskStepTransitioned 已随 T11
 *     入列，本票随词表上收一并归位；
 *   - 增风格族 `StyleProfileUpdated`（T21 · #54；t51:B5）：风格学习器的非成对
 *     收尾事件——无 head/tail 配对（EVENT_PAIRS 不动），taskRef/chapterIndex 走
 *     DomainEvent 既有顶层槽位（禁止塞 payload、也禁止新增顶层字段，t52:B5）。
 *
 * 成对约束：head 必须被 tail 闭合，悬挂在投影合并时标记（DSH hook-protocol 先例）。
 *
 * 词表增补（ADR-0025 · 质量门集成，2026-08-30）：任务族 `QualityReviewCompleted`
 * —— 文学质量审查步（十步第 4 步 Review）的步锚事件；payload 携带 verdict
 * （pass / blocking_fail / refused）与版本绑定锚（reportId / draftRevision /
 * draftContentHash / receiptId / ruleSetDigest）。非成对事件：报告本体落
 * `.mozhou/quality-reviews/`（运行期审计证据，非 Canon）。
 *
 * 词表增补（同上）：任务族 `AuthorCorrectionRecorded`——作者结构化纠错
 * （Task 5 失败记忆）：payload 携带 reasons（CorrectionReason 词表）与
 * noteDigest（纠错附注的 SHA-256 摘要；**原文不入账**——隐私红线 P0/P1）。
 * 非成对事件；飞轮 s7 重复纠错率的事件源。
 */

/** 事件词表：任务族 + 领域族（唯一真源；各模块禁止散写）。 */
export const DOMAIN_EVENT_TYPES = [
  'TaskStarted',
  'TaskStepTransitioned',
  'TaskAttemptRegistered',
  'TaskFinished',
  'ChapterGenerateRequested',
  'ContextCompiled',
  'GenerationStarted',
  'GenerationFinished',
  'CandidateCreated',
  'UserEditRecorded',
  'QualityReviewCompleted',
  'AuthorCorrectionRecorded',
  'CandidateDeltaExtracted',
  'CanonProposalCreated',
  'CanonCommitted',
  'FlywheelRecorded',
  'StyleProfileUpdated',
  'TraversalStarted',
  'TraversalFinished',
  'SemanticAnalyzed',
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export interface DomainEvent {
  readonly type: DomainEventType;
  /** 同一任务实例的配对/归组键（ULID，由 engine 生成）。 */
  readonly taskRef: string;
  readonly chapterIndex?: number;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** 成对约束表：head 必须被 tail 闭合，悬挂在投影合并时标记（规格 §3）。 */
export const EVENT_PAIRS: ReadonlyArray<readonly [DomainEventType, DomainEventType]> = [
  ['GenerationStarted', 'GenerationFinished'],
  ['CanonProposalCreated', 'CanonCommitted'],
  ['TaskStarted', 'TaskFinished'],
  ['TraversalStarted', 'TraversalFinished'],
];
