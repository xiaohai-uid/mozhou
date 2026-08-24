/**
 * Runtime 类型库（T11）——事件词表、成对约束、能力注册契约、四态结局词表。
 * 规格真源：docs/specs/runtime-capability-spec.md §1/§3。
 * 纪律：事件词表与成对约束由本文件统一持有，各模块不得散写（Q5）。
 */

/** 事件词表：任务族 + 领域族（ADR-0007 七事件删除 AutomatedReviewCompleted，#32 S5；
 *  增补 GenerationFinished 作为 GenerationStarted 的配对 tail —— 规格 §9 受控增补第 1 条）。 */
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
  'CanonProposalCreated',
  'CanonCommitted',
  'FlywheelRecorded',
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export interface DomainEvent {
  readonly type: DomainEventType;
  /** 同一任务实例的配对/归组键（ULID，由 engine 生成）。 */
  readonly taskRef: string;
  readonly chapterIndex?: number;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** 成对约束表：head 必须被 tail 闭合，悬挂在投影合并时标记（DSH hook-protocol 先例，规格 §3）。 */
export const EVENT_PAIRS: ReadonlyArray<readonly [DomainEventType, DomainEventType]> = [
  ['GenerationStarted', 'GenerationFinished'],
  ['CanonProposalCreated', 'CanonCommitted'],
  ['TaskStarted', 'TaskFinished'],
];

/** 结局词表四态唯一（Q4）：正交原因维度归 failurePolicy 与事件字段，不进 outcome。 */
export type Outcome =
  | 'succeeded'
  | 'failed_recoverable'
  | 'failed_terminal'
  | 'state_degraded';

export type ProviderId = string;

/** failurePolicy 最小面（Q7=A）：重试归任务层 attempts、熔断不进 V1。 */
export interface FailurePolicy {
  readonly timeoutMs: number;
  readonly fallbackProviderIds: readonly ProviderId[];
}

const SEMVER: RegExp = /^\d+\.\d+\.\d+$/;

export function isSemver(v: string): boolean {
  return SEMVER.test(v);
}

/** 能力注册契约（Q7=A 冻结面）。taskType 词表沿 CapabilityType，受控增补。 */
export interface CapabilityRegistration {
  readonly taskType: string;
  readonly providerId: ProviderId;
  readonly providerVersion: `${number}.${number}.${number}`;
  readonly failurePolicy: FailurePolicy;
}

/** 解析快照（Q7=A）：每次 execute 写入 GenerationStarted payload —— M14 双向钉死的事件侧落点。 */
export interface ResolutionSnapshot {
  readonly taskType: string;
  readonly capability: string;
  readonly providerId: ProviderId;
  readonly providerVersion: string;
  readonly tier?: string;
  readonly provider?: string;
  readonly model?: string;
}

export interface TaskResult {
  readonly outcome: Outcome;
  readonly value?: unknown;
  /** failed_recoverable 时供二级定向重生（M17 分层协作，Q8=A）。 */
  readonly repairHint?: unknown;
  readonly snapshot: ResolutionSnapshot;
}

/** 解析失败 fail-fast 错误面（Q6=A）：报错文本必须指向具体配置键路径（ANWA #28 教训）。 */
export type NoProviderCode = 'NO_PROVIDER_TASK_TYPE' | 'NO_PROVIDER_TIER';

export class NoProviderError extends Error {
  override name = 'NoProviderError';
  readonly code: NoProviderCode;
  constructor(code: NoProviderCode, configKeyPath: string) {
    super(`${code}: 配置键 ${configKeyPath} 未解析到 provider——请检查 settings.yaml 对应 tiers/providers 条目`);
    this.code = code;
  }
}

/** 配对违规错误（Q5=A 成对纪律由类型库强制）。 */
export type PairingErrorCode =
  | 'PAIRING_HEAD_UNCLOSED'
  | 'PAIRING_TAIL_WITHOUT_HEAD';

export class PairingError extends Error {
  override name = 'PairingError';
  readonly code: PairingErrorCode;
  constructor(code: PairingErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}
