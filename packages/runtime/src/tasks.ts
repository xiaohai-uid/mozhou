/**
 * 任务投影（T11 · 规格 §2，Q3=A）：任务当前态 = 纯函数折叠账本事件流的派生视图，
 * 可随时删除重建（T1）。本模块只做确定性折叠，无 IO、无时钟。
 */
import type { DomainEvent } from './types.js';
import { EVENT_PAIRS } from './types.js';

export interface StoredEvent {
  readonly seq: number;
  readonly event: DomainEvent;
}

export interface TaskProjectionEntry {
  readonly taskRef: string;
  started: boolean;
  finished: boolean;
  lastEventType: string | null;
  lastSeq: number | null;
  /** 开放未闭合的 head 类型集合（悬挂配对标记，规格 §3）。 */
  openHeads: string[];
}

export interface TaskProjection {
  readonly tasks: Map<string, TaskProjectionEntry>;
}

/** 折叠账本 → 任务投影。同一输入重复折叠结果逐字段相等（T1 幂等）。 */
export function projectTasks(events: readonly StoredEvent[]): TaskProjection {
  const tasks = new Map<string, TaskProjectionEntry>();
  for (const { seq, event } of events) {
    let entry = tasks.get(event.taskRef);
    if (!entry) {
      entry = {
        taskRef: event.taskRef,
        started: false,
        finished: false,
        lastEventType: null,
        lastSeq: null,
        openHeads: [],
      };
      tasks.set(event.taskRef, entry);
    }
    if (event.type === 'TaskStarted') entry.started = true;
    if (event.type === 'TaskFinished') entry.finished = true;
    entry.lastEventType = event.type;
    entry.lastSeq = seq;

    // 悬挂配对标记：head 入列、tail 出列（规格 §3 成对约束的投影侧呈现）。
    const pair = EVENT_PAIRS.find(
      ([h, t]) => h === event.type || t === event.type,
    );
    if (pair) {
      const key = `${pair[0]}#${event.taskRef}`;
      if (event.type === pair[0]) {
        if (!entry.openHeads.includes(key)) entry.openHeads.push(key);
      } else {
        const idx = entry.openHeads.indexOf(key);
        if (idx >= 0) entry.openHeads.splice(idx, 1);
      }
    }
  }
  return { tasks };
}
