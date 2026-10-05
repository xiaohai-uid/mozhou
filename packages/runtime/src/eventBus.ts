/**
 * publishEvent 单口（T11 · 规格 §3，Q5=A）。
 * 唯一账本 append 入口；append 动作委托 data-plane 既有 IO（RUNTIME_EVENTS_PATH），
 * runtime 不自持文件路径常量。配对纪律在此强制：head 未闭合禁新同类 head、
 * tail 无 head 即 PairingError。
 */
import { existsSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNTIME_EVENTS_PATH } from '@mozhou/data-plane';
import {
  DOMAIN_EVENT_TYPES,
  EVENT_PAIRS,
  PairingError,
} from './types.js';
import type { DomainEvent, DomainEventType } from './types.js';

export interface LedgerCtx {
  readonly root: string;
}

/**
 * W4-2c：任务事件行 schema 版本。**只加在任务事件行上**，平铺领域行不动
 * （平铺行由 T3/T9 等先于 runtime 存在的写入方产生，动它会波及它们）。
 */
export const TASK_ROW_SCHEMA_VERSION = 1;

/**
 * W4-2c：任务事件行的身份块（与 seq/event 同级平铺）。
 *
 * **两个序号不是一回事，禁止混用**：
 * - seq（外层，账本级）：全账本单调递增，由 PublishBus 按行数分配，供 **SSE 游标补发**；
 * - sequence（内层，单任务级）：单任务内从 1 起，配合 generationEpoch 用于**丢弃旧代次的迟到 chunk**。
 */
export interface TaskRowIdentity {
  readonly taskId: string;
  /** 单次外部调用（计费归因）；与 taskId 不是一回事。 */
  readonly attemptId?: string;
  /** 客户端视图切换代次；与 attemptId 不是一回事（客户端驱动 vs 服务端驱动）。 */
  readonly generationEpoch: number;
  /** 单任务内序号（从 1 起）。 */
  readonly sequence: number;
}

interface StoredLine {
  readonly seq: number;
  readonly event: DomainEvent;
  /** 仅任务事件行携带（平铺领域行为 undefined）。 */
  readonly task?: TaskRowIdentity & { readonly schemaVersion: number };
}

function eventsFilePath(ctx: LedgerCtx): string {
  return join(ctx.root, RUNTIME_EVENTS_PATH);
}

function readStoredLines(ctx: LedgerCtx): StoredLine[] {
  const p = eventsFilePath(ctx);
  if (!existsSync(p)) return [];
  const text = readFileSync(p, 'utf8');
  if (text.length === 0) return [];
  const stored: StoredLine[] = [];
  text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .forEach((line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return; // 撕裂行：审计容忍，不阻断回读
      }
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).seq === 'number' &&
        typeof (parsed as Record<string, unknown>).event === 'object' &&
        (parsed as Record<string, unknown>).event !== null
      ) {
        // T16（#40）：账本同时承载平铺领域行（ChapterCommitted/ContextCompiled 等，
        // T3/T9 先于 runtime 存在的写入方）与任务事件行两种格式（单一账本 T2）。
        // 回读只取任务事件行，其余格式跳过——投影/配对语义不受平铺行干扰。
        const row = parsed as { seq?: unknown; event?: DomainEvent };
        if (typeof row.seq !== 'number' || !row.event) {
          return;
        }
        const identity = parseTaskRowIdentity(parsed as Record<string, unknown>);
        stored.push({ seq: row.seq, event: row.event, ...(identity === undefined ? {} : { task: identity }) });
      }
    });
  return stored;
}

/**
 * 解析任务行身份块：五项齐全才算任务行携带身份；缺项按「平铺/旧行」处理（不猜测、不补默认值）。
 * 旧账本里的任务行没有身份块 ⇒ 返回 undefined，读端行为与 W4 之前一致。
 */
function parseTaskRowIdentity(row: Record<string, unknown>): (TaskRowIdentity & { readonly schemaVersion: number }) | undefined {
  const schemaVersion = row['schemaVersion'];
  const taskId = row['taskId'];
  const generationEpoch = row['generationEpoch'];
  const sequence = row['sequence'];
  if (
    typeof schemaVersion !== 'number' ||
    typeof taskId !== 'string' ||
    typeof generationEpoch !== 'number' ||
    typeof sequence !== 'number'
  ) {
    return undefined;
  }
  const attemptId = row['attemptId'];
  return {
    schemaVersion,
    taskId,
    generationEpoch,
    sequence,
    ...(typeof attemptId === 'string' ? { attemptId } : {}),
  };
}

/** 全量读账本（replaySession/投影重建共用入口）。 */
export function readLedger(ctx: LedgerCtx): StoredLine[] {
  return readStoredLines(ctx);
}

/**
 * 发布事件：词表校验 → 配对状态机校验 → 以 seq=现行数+1 追加一行 JSON。
 * 单实例内串行使用；跨进程并发由调用方（单飞裁决 #32 S11）保证。
 */
export class PublishBus {
  /** key = `${headType}#${taskRef}` → head 已开未闭。 */
  readonly #openHeads = new Map<string, DomainEventType>();

  publish(ctx: LedgerCtx, event: DomainEvent, task?: TaskRowIdentity): void {
    if (!(DOMAIN_EVENT_TYPES as readonly string[]).includes(event.type)) {
      throw new Error(`未知事件类型 ${String(event.type)}——词表由 kernel 类型库统一持有（@mozhou/kernel domain-events.ts，T16 上收）`);
    }
    const pair = EVENT_PAIRS.find(
      ([h, t]) => h === event.type || t === event.type,
    );
    if (pair) {
      const key = `${pair[0]}#${event.taskRef}`;
      if (event.type === pair[0]) {
        if (this.#openHeads.has(key)) {
          throw new PairingError(
            'PAIRING_HEAD_UNCLOSED',
            `${pair[0]}#${event.taskRef} 尚未闭合，禁止再次开启`,
          );
        }
        this.#openHeads.set(key, pair[0]);
      } else {
        if (!this.#openHeads.has(key)) {
          throw new PairingError(
            'PAIRING_TAIL_WITHOUT_HEAD',
            `${pair[1]}#${event.taskRef} 无对应已开的 ${pair[0]}`,
          );
        }
        this.#openHeads.delete(key);
      }
    }
    // 外层 seq：账本级全局序号（既有语义，供 SSE 游标补发）；内层 sequence 由调用方按任务给。
    const seq = readStoredLines(ctx).length + 1;
    // 未提供任务身份 ⇒ 写出的行与 W4 之前**逐字节相同**（平铺领域行与旧调用方零影响）
    const row =
      task === undefined
        ? { seq, event }
        : {
            seq,
            schemaVersion: TASK_ROW_SCHEMA_VERSION,
            taskId: task.taskId,
            ...(task.attemptId === undefined ? {} : { attemptId: task.attemptId }),
            generationEpoch: task.generationEpoch,
            sequence: task.sequence,
            event,
          };
    appendFileSync(eventsFilePath(ctx), Buffer.from(`${JSON.stringify(row)}\n`, 'utf8'));
  }

  /**
   * 从账本重建未闭合 head 集合（跨请求续接配对状态）。
   *
   * 配对状态只活在实例内存里：一个会话窗口在上一请求的 PublishBus 实例上开卷
   * （TaskStarted 落账），该实例随请求销毁；后续请求用**新实例**发 tail
   * （TaskFinished）时新实例的 #openHeads 是空的，直接 publish 必抛
   * PAIRING_TAIL_WITHOUT_HEAD——即使账本上这个 head 明明还悬挂着。本方法把账本
   * 里仍悬挂的 head 认领进本实例，使「跨请求闭合一个已开的窗口」成为可能
   * （如 S9 重提交窗口的作废）。
   *
   * position 门控（工单 02B）：只认领「当前开卷窗口」内的 head——最后一个未闭合
   * TaskStarted 及其后的事件；窗口被 TaskFinished 闭合后、下个 TaskStarted 之前
   * 的 head 属于窗口间历史，不被认领；新 TaskStarted 取代旧窗口时清零重来（与
   * projectSession.openHeads 的窗口闸同源：openedAtPosition 闸 + position 比较，
   * 见 packages/pipeline/src/projection.ts）。没有这道闸，账本历史的永久悬挂 head
   * （web 提交路径的 CanonProposalCreated 按设计无配对尾，见 proseRoutes 成对账目
   * 注）会被灌进本实例的配对状态机，同一窗口键的合法新 head（windowTaskRef 是
   * 确定性键 web_commit_ch<N>_rev<R>，同章同 revision 重提交即同键）就会撞
   * PAIRING_HEAD_UNCLOSED。折叠规则仍与投影同源（同一 EVENT_PAIRS：head 入列、
   * tail 出列），幂等、只读、不改写任何行。
   */
  adoptOpenHeads(ctx: LedgerCtx): void {
    const lines = readStoredLines(ctx);
    let openedAt: number | null = null;
    for (let i = 0; i < lines.length; i++) {
      const event = lines[i]!.event;
      const pair = EVENT_PAIRS.find(
        ([h, t]) => h === event.type || t === event.type,
      );
      if (!pair) continue;
      const key = `${pair[0]}#${event.taskRef}`;
      if (event.type === 'TaskStarted') {
        // 新窗口取代旧窗口（重提交 = 新 session）：投影同款折叠（openHeads 清零）
        this.#openHeads.clear();
        openedAt = i;
        this.#openHeads.set(key, pair[0]);
        continue;
      }
      if (event.type === 'TaskFinished') {
        // 窗口闭合：恰闭合当前窗口 head 时，其后到下个 TaskStarted 之间的
        // head 属于窗口间历史，不再认领；孤儿 tail（账本上不可能经 publish 产生）
        // 不动窗口状态。
        if (this.#openHeads.delete(key)) openedAt = null;
        continue;
      }
      if (openedAt === null) continue;
      if (event.type === pair[0]) {
        this.#openHeads.set(key, pair[0]);
      } else {
        this.#openHeads.delete(key);
      }
    }
  }

  /** 测试与投影重建辅助：当前开放未闭合的 head 键集合。 */
  openHeadKeys(): string[] {
    return [...this.#openHeads.keys()];
  }
}
