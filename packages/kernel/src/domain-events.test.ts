/**
 * T16 验收测试（#40 受控增补第 1 条）：ADR-0007 词表修订的机械断言——
 * 死事件 AutomatedReviewCompleted 不存在；任务族事件
 * TaskStarted / TaskStepTransitioned / CandidateDeltaExtracted 入列；
 * 成对约束随词表同册。
 */
import { describe, expect, it } from 'vitest';
import { DOMAIN_EVENT_TYPES, EVENT_PAIRS } from './domain-events.js';

describe('领域事件词表（T16 受控增补）', () => {
  it('死事件 AutomatedReviewCompleted 在词表中不存在（#32 S5 Gate 纯机械）', () => {
    // 词表联合类型层面即不存在该字面量（本文件能通过编译本身是第一重证明），
    // 运行时再以开放字符串集合断言一次，防词表被改回。
    const vocabulary: readonly string[] = DOMAIN_EVENT_TYPES;
    expect(vocabulary.includes('AutomatedReviewCompleted')).toBe(false);
    // 词表本体也不得出现任何 review 审查完结语义的变体拼写
    const variants = vocabulary.filter((type) => /review/i.test(type));
    expect(variants).toEqual([]);
  });

  it('任务族事件 TaskStarted/TaskStepTransitioned/CandidateDeltaExtracted 已入列', () => {
    for (const required of ['TaskStarted', 'TaskStepTransitioned', 'CandidateDeltaExtracted'] as const) {
      expect(DOMAIN_EVENT_TYPES.includes(required)).toBe(true);
    }
  });

  it('十步管线关键事件全部在册（chapter-pipeline-spec §1 表右列）', () => {
    const tenStepKeyEvents = [
      'TaskStarted',
      'ContextCompiled',
      'GenerationStarted',
      'GenerationFinished',
      'UserEditRecorded',
      'CandidateDeltaExtracted',
      'TaskStepTransitioned',
      'CanonProposalCreated',
      'CanonCommitted',
      'FlywheelRecorded',
    ] as const;
    for (const type of tenStepKeyEvents) {
      expect(DOMAIN_EVENT_TYPES.includes(type)).toBe(true);
    }
  });

  it('成对约束三对在册：生成/提案/任务生命周期', () => {
    expect(EVENT_PAIRS).toContainEqual(['GenerationStarted', 'GenerationFinished']);
    expect(EVENT_PAIRS).toContainEqual(['CanonProposalCreated', 'CanonCommitted']);
    expect(EVENT_PAIRS).toContainEqual(['TaskStarted', 'TaskFinished']);
    // 配对两端都必须是词表内事件（表与词表不脱钩）
    for (const [head, tail] of EVENT_PAIRS) {
      expect(DOMAIN_EVENT_TYPES.includes(head)).toBe(true);
      expect(DOMAIN_EVENT_TYPES.includes(tail)).toBe(true);
    }
  });
});

describe('T21 受控增补（#54 · t51:B5）+ T27（#68 · t66 R4）', () => {
  it('StyleProfileUpdated 入列：非成对收尾事件', () => {
    expect(DOMAIN_EVENT_TYPES.includes('StyleProfileUpdated')).toBe(true);
    // 非成对事件：StyleProfileUpdated 不出现在任何一端
    for (const [head, tail] of EVENT_PAIRS) {
      expect(head).not.toBe('StyleProfileUpdated');
      expect(tail).not.toBe('StyleProfileUpdated');
    }
  });

  it('词表 17 词条（15 + Traversal 对）；成对约束四对在册', () => {
    expect(DOMAIN_EVENT_TYPES).toHaveLength(17);
    expect(EVENT_PAIRS).toHaveLength(4);
    expect(EVENT_PAIRS).toContainEqual(['TraversalStarted', 'TraversalFinished']);
    // 配对两端都必须是词表内事件（表与词表不脱钩）
    for (const [head, tail] of EVENT_PAIRS) {
      expect(DOMAIN_EVENT_TYPES.includes(head)).toBe(true);
      expect(DOMAIN_EVENT_TYPES.includes(tail)).toBe(true);
    }
  });
});
