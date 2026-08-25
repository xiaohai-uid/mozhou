/**
 * 管线侧账本读取（T16 · #40）。
 *
 * .mozhou/events.jsonl 是单一 append 真源（runtime-capability-spec T2），但物理上
 * 承载两种行格式（历史共存，均不可改写）：
 *   - 任务事件行（PublishBus 单口写入）：{seq, event: DomainEvent}；
 *   - 平铺领域行（T3 commitChapter / T9 persistReceipt 先于 runtime 存在）：
 *     {type, seq, at, ...}——ChapterCommitted / ContextCompiled / ChapterReopened。
 * 投影与恢复必须同账读两格式：CanonCommitted 完成态存在性（ANWA #90）与
 * ContextCompiled 指针（INV-R1/R2 receiptId 续跑凭据）都可能在任一格式里。
 *
 * 撕裂 JSON 行跳过（审计账本不是真源，stale.ts readChapterDependencyPins 先例）；
 * 行序（数组位）即权威时序——平铺行的 seq 与任务行的 seq 基数不同（0 起 vs 1 起），
 * 跨格式不做 seq 算术，一律以 position 比较。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNTIME_EVENTS_PATH } from '@mozhou/data-plane';
import type { DomainEvent, DomainEventType } from '@mozhou/kernel';

/** 管线账本行：task = PublishBus 格式；domain = 平铺领域行（原样保留）。 */
export type PipelineLedgerRow =
  | { readonly position: number; readonly kind: 'task'; readonly seq: number; readonly event: DomainEvent }
  | { readonly position: number; readonly kind: 'domain'; readonly row: Readonly<Record<string, unknown>> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 全量读账本（含两种行格式；撕裂行跳过）。空/缺失账本返回空数组。 */
export function readPipelineLedger(root: string): PipelineLedgerRow[] {
  const eventsPath = join(root, RUNTIME_EVENTS_PATH);
  if (!existsSync(eventsPath)) {
    return [];
  }
  const content = readFileSync(eventsPath, 'utf8');
  if (content.length === 0) {
    return [];
  }
  const rows: PipelineLedgerRow[] = [];
  let position = 0;
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // 撕裂行：审计容忍，不阻断投影重建
    }
    if (!isRecord(parsed)) {
      continue;
    }
    const event = parsed['event'];
    if (isRecord(event) && typeof parsed['seq'] === 'number' && typeof event['type'] === 'string' && typeof event['taskRef'] === 'string') {
      // 逐字段重建（不透传未知键）：DomainEvent 形状即任务行冻结形状
      const storedEvent: DomainEvent = {
        type: event['type'] as DomainEventType,
        taskRef: event['taskRef'],
        ...(typeof event['chapterIndex'] === 'number' ? { chapterIndex: event['chapterIndex'] } : {}),
        ...(isRecord(event['payload']) ? { payload: event['payload'] } : {}),
      };
      rows.push({
        position,
        kind: 'task',
        seq: parsed['seq'],
        event: storedEvent,
      });
    } else if (typeof parsed['type'] === 'string') {
      rows.push({ position, kind: 'domain', row: parsed });
    }
    position += 1;
  }
  return rows;
}
