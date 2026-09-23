/**
 * CapabilityRegistry（T11 · 规格 §4，Q6/Q7）：
 * 调用期解析 + fail-fast 类型化错误 + V1 仅代码内 registerCapability 单级。
 * 两级配置（包内默认 ← 全局覆盖）的全局覆盖层由 T14 路由加载器填充，
 * 本模块暴露 setGlobalOverride 供其写入。
 */
import type { CapabilityRegistration } from './types.js';
import { NoProviderError, isSemver } from './types.js';
export class CapabilityConflictError extends Error {
  override name = 'CapabilityConflictError';
  constructor(taskType: string) {
    super(`CAPABILITY_CONFLICT: taskType ${taskType} 已注册——V1 禁止覆盖，先注销再注册`);
  }
}

export interface Resolution {
  readonly taskType: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly failurePolicy: CapabilityRegistration['failurePolicy'];
}

export class CapabilityRegistry {
  readonly #defaults = new Map<string, CapabilityRegistration>();
  #globalOverride: ReadonlyMap<string, { providerId: string; providerVersion: string }> | null =
    null;

  registerCapability(cap: CapabilityRegistration): void {
    if (!isSemver(cap.providerVersion)) {
      throw new Error(
        `PROVIDER_VERSION_INVALID: ${cap.providerId}@${cap.providerVersion} 不是 semver（必填 x.y.z，Q7=A）`,
      );
    }
    if (this.#defaults.has(cap.taskType)) {
      throw new CapabilityConflictError(cap.taskType);
    }
    this.#defaults.set(cap.taskType, cap);
  }

  /** T14 路由加载器写入的全局覆盖层（taskType → provider 绑定）。 */
  setGlobalOverride(bindings: ReadonlyMap<string, { providerId: string; providerVersion: string }>): void {
    this.#globalOverride = bindings;
  }

  /** 调用期解析：全局覆盖优先，无则包内默认；均无 ⇒ NO_PROVIDER_TASK_TYPE。 */
  resolve(taskType: string): Resolution {
    const override = this.#globalOverride?.get(taskType);
    if (override) {
      const base = this.#defaults.get(taskType);
      if (!base) {
        throw new NoProviderError('NO_PROVIDER_TASK_TYPE', `providers.${override.providerId}`);
      }
      return {
        taskType,
        providerId: override.providerId,
        providerVersion: override.providerVersion,
        failurePolicy: base.failurePolicy,
      };
    }
    const cap = this.#defaults.get(taskType);
    if (!cap) {
      throw new NoProviderError(
        'NO_PROVIDER_TASK_TYPE',
        `runtime.capabilities.${taskType}（未 registerCapability 且 settings.yaml tiers 无覆盖）`,
      );
    }
    return {
      taskType,
      providerId: cap.providerId,
      providerVersion: cap.providerVersion,
      failurePolicy: cap.failurePolicy,
    };
  }

  /** fallback 链条校验：fallbackProviderIds 引用的 id 必须可解析，否则启动即 fail fast。 */
  validateFallbackChain(): string[] {
    const problems: string[] = [];
    for (const [taskType, cap] of this.#defaults) {
      for (const fb of cap.failurePolicy.fallbackProviderIds) {
        if (fb === cap.providerId) {
          problems.push(`${taskType}: fallback 与主 provider 相同（${fb}）`);
        }
      }
    }
    return problems;
  }
}
