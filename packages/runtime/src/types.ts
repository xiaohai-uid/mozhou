/**
 * Runtime 类型库（T11）——能力注册契约、四态结局词表再导出、错误面。
 * 规格真源：docs/specs/runtime-capability-spec.md §1/§3。
 *
 * T16 受控增补（#40；chapter-pipeline-spec §4 第 1/3 条）：事件词表与成对约束
 * （含 CandidateDeltaExtracted 增补、AutomatedReviewCompleted 死事件删除）、
 * 四态结局 Outcome / ResolutionSnapshot / TaskResult / HardConflict 上收
 * kernel 类型库统一持有（@mozhou/kernel domain-events.ts + kernel-schema.ts §11）。
 * 本文件保留 runtime 侧能力注册契约与解析/配对错误面，并对上收类型作再导出，
 * 既有 `(runtime)` 内部引用面不变（Q5「各模块不得散写」的真源随之上收）。
 */

export { DOMAIN_EVENT_TYPES, EVENT_PAIRS } from '@mozhou/kernel';
import type { ProviderId } from '@mozhou/kernel';
export type {
  DomainEvent,
  DomainEventType,
  HardConflict,
  Outcome,
  ProviderId,
  ResolutionSnapshot,
  TaskResult,
} from '@mozhou/kernel';

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
