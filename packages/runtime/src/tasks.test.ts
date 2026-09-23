/**
 * T11 验收测试：任务投影折叠幂等（规格 §2 不变量 T1，Q3=A）。
 */
import { describe, expect, it } from 'vitest';
import { projectTasks } from './tasks.js';
import type { DomainEvent, DomainEventType } from './types.js';

const ev = (type: DomainEventType, taskRef: string, seq: number): { seq: number; event: DomainEvent } => ({
  seq,
  event: { type, taskRef },
});

describe('projectTasks 折叠幂等（T1）', () => {
  const events = [
    ev('TaskStarted', 't1', 1),
    ev('GenerationStarted', 't1', 2),
    ev('GenerationFinished', 't1', 3),
    ev('CanonProposalCreated', 't1', 4),
    ev('TaskStepTransitioned', 't1', 5),
    ev('CanonCommitted', 't1', 6),
    ev('TaskFinished', 't1', 7),
  ];

  it('两次折叠结果逐字段相等', () => {
    const a = JSON.stringify(projectTasks(events));
    const b = JSON.stringify(projectTasks(events));
    expect(a).toBe(b);
  });

  it('完整生命周期：started/finished 且无悬挂 head', () => {
    const { tasks } = projectTasks(events);
    const t1 = tasks.get('t1');
    expect(t1?.started).toBe(true);
    expect(t1?.finished).toBe(true);
    expect(t1?.openHeads).toHaveLength(0);
    expect(t1?.lastSeq).toBe(7);
  });

  it('悬挂 head 在投影中可见（late tail 场景）', () => {
    const hanging = [ev('TaskStarted', 't2', 1), ev('GenerationStarted', 't2', 2)];
    const { tasks } = projectTasks(hanging);
    // TaskStarted 与 GenerationStarted 均为未闭合 head —— 两枚都应可见
    expect(tasks.get('t2')?.openHeads).toEqual([
      'TaskStarted#t2',
      'GenerationStarted#t2',
    ]);
  });
});
