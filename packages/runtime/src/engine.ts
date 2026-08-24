/**
 * RuntimeEngine（T11 · 规格 §1/§4，Q6-Q8）：
 * execute 骨架——解析快照 → GenerationStarted → provider 调用位（T13 接入）→
 * GenerationFinished → TaskResult 四态。解析逻辑本票只到 Registry.resolve，
 * tier 层由 T14 填充 setGlobalOverride。
 */
import { newUlid } from '@mozhou/kernel';
import type {
  CapabilityRegistration,
  DomainEvent,
  Outcome,
  ResolutionSnapshot,
  TaskResult,
} from './types.js';
import { PublishBus } from './eventBus.js';
import type { LedgerCtx } from './eventBus.js';
import { CapabilityRegistry } from './registry.js';
import type { Resolution } from './registry.js';

export type ProviderBinding = (
  payload: unknown,
  snapshot: ResolutionSnapshot,
) => Promise<unknown>;

/** 可恢复失败（M17 二级定向重生的载体）：携带 repairHint。 */
export class RecoverableError extends Error {
  override name = 'RecoverableError';
  readonly repairHint?: unknown;
  constructor(message: string, repairHint?: unknown) {
    super(message);
    this.repairHint = repairHint;
  }
}

export class ProviderBindingMissingError extends Error {
  override name = 'ProviderBindingMissingError';
  constructor(providerId: string) {
    super(`PROVIDER_BINDING_MISSING: ${providerId} 未注册调用绑定（T13 adapter 接入位）`);
  }
}

/** 超时属可重试类失败（T12）：触发 fallback 链，穷尽后随链交 failed_recoverable。 */
export class TimeoutError extends RecoverableError {
  override name = 'TimeoutError';
}

/** 竞速包装：timeoutMs 内未决即 TimeoutError；定时器用后即清（不留悬挂句柄）。 */
function withTimeout<T>(p: Promise<T>, timeoutMs: number, providerId: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TimeoutError(`TIMEOUT: ${providerId} 超过 ${timeoutMs}ms 未返回`)),
      timeoutMs,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export interface ReplayFilter {
  readonly taskRef?: string;
  readonly chapterIndex?: number;
}

export interface ExecutionTrace {
  readonly events: readonly { seq: number; event: DomainEvent }[];
  readonly closedPairs: number;
  readonly hangingPairKeys: readonly string[];
}

export interface RuntimeEngineDeps {
  readonly bus: PublishBus;
  readonly ctx: LedgerCtx;
  readonly registry?: CapabilityRegistry;
  /** 零时钟纪律：taskRef 生成器可注入固定值（默认 newUlid）。 */
  readonly newTaskRef?: () => string;
}

export class RuntimeEngine {
  readonly #bus: PublishBus;
  readonly #ctx: LedgerCtx;
  readonly #registry: CapabilityRegistry;
  readonly #bindings = new Map<string, ProviderBinding>();
  readonly #newTaskRef: () => string;

  constructor(deps: RuntimeEngineDeps) {
    this.#bus = deps.bus;
    this.#ctx = deps.ctx;
    this.#registry = deps.registry ?? new CapabilityRegistry();
    this.#newTaskRef = deps.newTaskRef ?? (() => newUlid());
  }

  get registry(): CapabilityRegistry {
    return this.#registry;
  }

  /** T13 adapter 接入位：providerId → 调用绑定。重复注册覆盖（fail-fast 精神下仅限同 id 重绑）。 */
  registerProviderBinding(providerId: string, binding: ProviderBinding): void {
    this.#bindings.set(providerId, binding);
  }

  registerCapability(cap: CapabilityRegistration): void {
    this.#registry.registerCapability(cap);
  }

  async execute(taskType: string, payload: unknown): Promise<TaskResult> {
    const taskRef = this.#newTaskRef();
    // Q6=A 调用期解析：解析不到即抛 NO_PROVIDER_*，不产生任何账本事件。
    const resolution: Resolution = this.#registry.resolve(taskType);
    const snapshot: ResolutionSnapshot = {
      taskType: resolution.taskType,
      capability: resolution.taskType,
      providerId: resolution.providerId,
      providerVersion: resolution.providerVersion,
    };
    this.#bus.publish(this.#ctx, {
      type: 'GenerationStarted',
      taskRef,
      payload: { snapshot },
    });

    // T12：主 provider + fallback 链依序尝试；每次尝试前发 TaskAttemptRegistered
    //（票面纪律：attempt 事件数=尝试次数）。普通（非超时非可恢复）异常直通 terminal 不烧候选。
    const candidates = [resolution.providerId, ...resolution.failurePolicy.fallbackProviderIds];
    const triedProviders: string[] = [];
    let lastReason = '';
    let lastRepairHint: unknown;
    for (const providerId of candidates) {
      if (triedProviders.length > 0) {
        this.#bus.publish(this.#ctx, {
          type: 'TaskAttemptRegistered',
          taskRef,
          payload: { providerId, reason: lastReason },
        });
      }
      triedProviders.push(providerId);
      try {
        const binding = this.#bindings.get(providerId);
        if (!binding) throw new ProviderBindingMissingError(providerId);
        const value = await withTimeout(
          Promise.resolve().then(() => binding(payload, snapshot)),
          resolution.failurePolicy.timeoutMs,
          providerId,
        );
        // 快照反映实际服务的 provider（降级成功时 ≠ 主候选）
        const servedSnapshot: ResolutionSnapshot = { ...snapshot, providerId };
        this.#bus.publish(this.#ctx, {
          type: 'GenerationFinished',
          taskRef,
          payload: { outcome: 'succeeded' satisfies Outcome, providerId },
        });
        return { outcome: 'succeeded', value, snapshot: servedSnapshot };
      } catch (err) {
        lastReason = err instanceof Error ? err.message : String(err);
        // 普通异常直通 failed_terminal；超时/可恢复才值得烧下一个候选。
        if (err instanceof RecoverableError) lastRepairHint = err.repairHint;
        if (!(err instanceof TimeoutError) && !(err instanceof RecoverableError)) {
          this.#bus.publish(this.#ctx, {
            type: 'GenerationFinished',
            taskRef,
            payload: { outcome: 'failed_terminal' satisfies Outcome, reason: lastReason },
          });
          return { outcome: 'failed_terminal', snapshot };
        }
      }
    }

    // 候选穷尽 ⇒ failed_recoverable + tried 列表（M17：给人工兜底留活路）。
    this.#bus.publish(this.#ctx, {
      type: 'GenerationFinished',
      taskRef,
      payload: {
        outcome: 'failed_recoverable' satisfies Outcome,
        reason: `全部候选失败：${lastReason}`,
        triedProviders,
      },
    });
    return {
      outcome: 'failed_recoverable',
      // 合并末次业务 repairHint 与降级轨迹：二级定向重生两样都需要
      repairHint: { ...(lastRepairHint as object), triedProviders },
      snapshot,
    };
  }

  replaySession(filter: ReplayFilter = {}): ExecutionTrace {
    const all = readLedgerFiltered(this.#ctx, filter);
    let closedPairs = 0;
    const open = new Set<string>();
    for (const { event } of all) {
      for (const [h, t] of PAIRS_SNAPSHOT) {
        if (event.type === h) open.add(`${h}#${event.taskRef}`);
        if (event.type === t && open.has(`${h}#${event.taskRef}`)) {
          open.delete(`${h}#${event.taskRef}`);
          closedPairs += 1;
        }
      }
    }
    return { events: all, closedPairs, hangingPairKeys: [...open] };
  }
}

import { readLedger } from './eventBus.js';
import { EVENT_PAIRS as PAIRS_SNAPSHOT } from './types.js';

function readLedgerFiltered(ctx: LedgerCtx, filter: ReplayFilter) {
  return readLedger(ctx).filter(({ event }) => {
    if (filter.taskRef !== undefined && event.taskRef !== filter.taskRef) return false;
    if (filter.chapterIndex !== undefined && event.chapterIndex !== filter.chapterIndex) return false;
    return true;
  });
}
