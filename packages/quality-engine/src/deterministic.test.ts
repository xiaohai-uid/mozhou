import { describe, expect, it } from 'vitest';
import { PARA_001_ID, evaluateDeterministicRules } from './deterministic.js';
import { defaultPlatformRules } from './policy.js';
import type { QualityPolicy } from './types.js';

function policyWith(...ids: string[]): QualityPolicy {
  return {
    schemaVersion: 1,
    projectId: 'book-a',
    rules: defaultPlatformRules().map((r) =>
      ids.includes(r.id) ? r : { ...r, enabled: false },
    ),
    maxAutomaticReworks: 2,
  };
}

describe('PARA-001 段落瀑布', () => {
  it('连续独句叙事段落判 fail 并给出证据', () => {
    const prose = '他抬头。\n\n门开了。\n\n风进来了。\n\n陈缺没有动。';
    const result = evaluateDeterministicRules(prose, policyWith(PARA_001_ID));
    const para = result.find((x) => x.ruleId === PARA_001_ID);
    expect(para?.verdict).toBe('fail');
    expect(para?.evidence.length).toBeGreaterThan(0);
  });

  it('对话段落不计入瀑布', () => {
    const prose = '「你走。」\n\n「我不。」\n\n「为什么。」';
    const result = evaluateDeterministicRules(prose, policyWith(PARA_001_ID));
    expect(result.find((x) => x.ruleId === PARA_001_ID)?.verdict).toBe('pass');
  });

  it('不足三个连续独句段落判 pass', () => {
    const prose = '他抬头。\n\n门开了。风进来了，吹动桌上的纸。';
    const result = evaluateDeterministicRules(prose, policyWith(PARA_001_ID));
    expect(result.find((x) => x.ruleId === PARA_001_ID)?.verdict).toBe('pass');
  });

  it('调用方标记的动作拍点段落豁免', () => {
    const prose = '他抬头。\n\n门开了。\n\n风进来了。';
    const result = evaluateDeterministicRules(prose, policyWith(PARA_001_ID), {
      actionBeatParagraphs: new Set([1]),
    });
    expect(result.find((x) => x.ruleId === PARA_001_ID)?.verdict).toBe('pass');
  });

  it('规则禁用时不产出评估', () => {
    const prose = '他抬头。\n\n门开了。\n\n风进来了。';
    const result = evaluateDeterministicRules(prose, policyWith());
    expect(result.find((x) => x.ruleId === PARA_001_ID)).toBeUndefined();
  });
});

describe('REV-001 锚点一致性', () => {
  it('锚点哈希与正文哈希一致判 pass，不一致判 fail', () => {
    const prose = '正文内容。';
    const good = evaluateDeterministicRules(prose, policyWith('REV-001'), {
      proseContentHash: 'hash-a',
      anchorDraftContentHash: 'hash-a',
    });
    expect(good.find((x) => x.ruleId === 'REV-001')?.verdict).toBe('pass');

    const bad = evaluateDeterministicRules(prose, policyWith('REV-001'), {
      proseContentHash: 'hash-a',
      anchorDraftContentHash: 'hash-b',
    });
    const rev = bad.find((x) => x.ruleId === 'REV-001');
    expect(rev?.verdict).toBe('fail');
    expect(rev?.evidence.length).toBeGreaterThan(0);
  });
});
