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
    try {
      const binding = this.#bindings.get(resolution.providerId);
      if (!binding) throw new ProviderBindingMissingError(resolution.providerId);
      const value = await binding(payload, snapshot);
      this.#bus.publish(this.#ctx, {
        type: 'GenerationFinished',
        taskRef,
        payload: { outcome: 'succeeded' satisfies Outcome },
      });
      return { outcome: 'succeeded', value, snapshot };
    } catch (err) {
      if (err instanceof RecoverableError) {
        this.#bus.publish(this.#ctx, {
          type: 'GenerationFinished',
          taskRef,
          payload: { outcome: 'failed_recoverable' satisfies Outcome, reason: err.message },
        });
        return {
          outcome: 'failed_recoverable',
          repairHint: err.repairHint,
          snapshot,
        };
      }
      const reason = err instanceof Error ? err.message : String(err);
      this.#bus.publish(this.#ctx, {
        type: 'GenerationFinished',
        taskRef,
        payload: { outcome: 'failed_terminal' satisfies Outcome, reason },
      });
      return { outcome: 'failed_terminal', snapshot };
    }
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
