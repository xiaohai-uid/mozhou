/**
 * RuntimeEngine（T11 · 规格 §1/§4，Q6-Q8）：
 * execute 骨架——解析快照 → GenerationStarted → provider 调用位（T13 接入）→
 * GenerationFinished → TaskResult 四态。解析逻辑本票只到 Registry.resolve，
 * tier 层由 T14 填充 setGlobalOverride。
 *
 * T21 受控增补（#54 · t52）：第三可选参 meta 桥接会话窗口与执行事件（B1）、
 * nowMs 注入测量时钟统一盖 durationMs（B3）、TaskResult 回执 taskRef（Q-E）。
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
  /**
   * 零时钟判例边界（T21 · t52:B3 注释级锚定）：**测量值可缺省注入时钟、时刻戳必显式**。
   * 本 dep 只产测量值——execute 入口取样一次，与各 GenerationFinished 出口取样做差
   * 得 durationMs；缺省 Date.now。时刻戳类字段（at/nowIso/createdAtUtc）不在此取：
   * 必须调用方显式注入、缺省不落（record-step.ts 头注交叉引用同一判例）。
   */
  readonly nowMs?: () => number;
}

/**
 * execute 第三可选参（T21 · t52:B1 执行桥接）：把会话窗口上下文桥进执行事件。
 *   - parentTaskRef：会话窗口任务引用。**只准进 payload 层**——DomainEvent 禁止新增
 *     顶层字段（t52:B5 硬约束：pipeline 读面逐字段白名单重建 ledger.ts，未知顶层键
 *     会被静默丢弃，顶层新字段即「写侧入了账、读侧永远看不见」的哑字段）；
 *   - chapterIndex：上 DomainEvent 既有顶层可选槽；
 *   - eventPayload：M14 形状载荷增补（toGenerationStartedPayload 产出），并入
 *     GenerationStarted.payload（snapshot 之后）。
 * 三槽全可选；缺省行为与既有双参调用完全一致（零回归）。
 */
export interface ExecutionMeta {
  readonly parentTaskRef?: string;
  readonly chapterIndex?: number;
  readonly eventPayload?: Readonly<Record<string, unknown>>;
}

export class RuntimeEngine {
  readonly #bus: PublishBus;
  readonly #ctx: LedgerCtx;
  readonly #registry: CapabilityRegistry;
  readonly #bindings = new Map<string, ProviderBinding>();
  readonly #newTaskRef: () => string;
  readonly #nowMs: () => number;

  constructor(deps: RuntimeEngineDeps) {
    this.#bus = deps.bus;
    this.#ctx = deps.ctx;
    this.#registry = deps.registry ?? new CapabilityRegistry();
    this.#newTaskRef = deps.newTaskRef ?? (() => newUlid());
    this.#nowMs = deps.nowMs ?? (() => Date.now());
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

  async execute(taskType: string, payload: unknown, meta?: ExecutionMeta): Promise<TaskResult> {
    const taskRef = this.#newTaskRef();
    // P3（t52:B3）：入口取样一次，三个 GenerationFinished 出口统一盖 durationMs
    //（含 fallback 链全程——引擎层测量天然覆盖多 attempt 区间）。
    const startedAtMs = this.#nowMs();
    // 桥接槽条件展开（exactOptionalPropertyTypes 纪律）：缺省零键。
    const chapterSlot = meta?.chapterIndex === undefined ? {} : { chapterIndex: meta.chapterIndex };
    const parentPatch = meta?.parentTaskRef === undefined ? {} : { parentTaskRef: meta.parentTaskRef };
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
      ...chapterSlot,
      payload: {
        snapshot,
        // B1：eventPayload（M14 形状 toGenerationStartedPayload 产出）并入 snapshot 之后
        ...(meta?.eventPayload === undefined ? {} : meta.eventPayload),
      },
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
          ...chapterSlot,
          payload: { providerId, reason: lastReason, ...parentPatch },
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
          ...chapterSlot,
          payload: {
            outcome: 'succeeded' satisfies Outcome,
            providerId,
            durationMs: this.#nowMs() - startedAtMs,
            ...parentPatch,
          },
        });
        return { outcome: 'succeeded', value, snapshot: servedSnapshot, taskRef };
      } catch (err) {
        lastReason = err instanceof Error ? err.message : String(err);
        // 普通异常直通 failed_terminal；超时/可恢复才值得烧下一个候选。
        if (err instanceof RecoverableError) lastRepairHint = err.repairHint;
        if (!(err instanceof TimeoutError) && !(err instanceof RecoverableError)) {
          this.#bus.publish(this.#ctx, {
            type: 'GenerationFinished',
            taskRef,
            ...chapterSlot,
            payload: {
              outcome: 'failed_terminal' satisfies Outcome,
              reason: lastReason,
              durationMs: this.#nowMs() - startedAtMs,
              ...parentPatch,
            },
          });
          return { outcome: 'failed_terminal', snapshot, taskRef };
        }
      }
    }

    // 候选穷尽 ⇒ failed_recoverable + tried 列表（M17：给人工兜底留活路）。
    this.#bus.publish(this.#ctx, {
      type: 'GenerationFinished',
      taskRef,
      ...chapterSlot,
      payload: {
        outcome: 'failed_recoverable' satisfies Outcome,
        reason: `全部候选失败：${lastReason}`,
        triedProviders,
        durationMs: this.#nowMs() - startedAtMs,
        ...parentPatch,
      },
    });
    return {
      outcome: 'failed_recoverable',
      // 合并末次业务 repairHint 与降级轨迹：二级定向重生两样都需要
      repairHint: { ...(lastRepairHint as object), triedProviders },
      snapshot,
      taskRef,
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
