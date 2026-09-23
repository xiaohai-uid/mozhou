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

interface StoredLine {
  readonly seq: number;
  readonly event: DomainEvent;
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
        stored.push({ seq: row.seq, event: row.event });
      }
    });
  return stored;
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

  publish(ctx: LedgerCtx, event: DomainEvent): void {
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
    const seq = readStoredLines(ctx).length + 1;
    appendFileSync(
      eventsFilePath(ctx),
      Buffer.from(`${JSON.stringify({ seq, event })}\n`, 'utf8'),
    );
  }

  /** 测试与投影重建辅助：当前开放未闭合的 head 键集合。 */
  openHeadKeys(): string[] {
    return [...this.#openHeads.keys()];
  }
}
