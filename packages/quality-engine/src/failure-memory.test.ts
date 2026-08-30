import { describe, expect, it } from 'vitest';
import { parseFailurePatterns, serializeFailurePatterns, updateFailurePatterns } from './failure-memory.js';
import type { FailurePattern } from './types.js';

const SEED: FailurePattern[] = [
  {
    code: 'outline_expansion',
    firstSeenChapter: 3,
    lastSeenChapter: 3,
    occurrences: 1,
    active: true,
    authorNote: '不要把大纲当正文写',
  },
];

describe('updateFailurePatterns', () => {
  it('新原因追加模式（occurrences=1，active=true）', () => {
    const out = updateFailurePatterns(SEED, 5, ['payoff_zeroed']);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      code: 'payoff_zeroed',
      firstSeenChapter: 5,
      lastSeenChapter: 5,
      occurrences: 1,
      active: true,
    });
    // 既有模式原样保留
    expect(out[0]).toEqual(SEED[0]);
  });

  it('同原因复发递增 occurrences 并推进 lastSeenChapter（append-only 语义）', () => {
    const out = updateFailurePatterns(SEED, 7, ['outline_expansion']);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      code: 'outline_expansion',
      firstSeenChapter: 3,
      lastSeenChapter: 7,
      occurrences: 2,
      active: true,
    });
  });

  it('乱序章节输入下 first/last 仍取 min/max', () => {
    const out = updateFailurePatterns(SEED, 1, ['outline_expansion']);
    expect(out[0]?.firstSeenChapter).toBe(1);
    expect(out[0]?.lastSeenChapter).toBe(3);
  });

  it('显式 note 覆盖 authorNote；未提供则保留原值', () => {
    const withNote = updateFailurePatterns(SEED, 7, ['outline_expansion'], '第7章又犯了');
    expect(withNote[0]?.authorNote).toBe('第7章又犯了');
    const withoutNote = updateFailurePatterns(SEED, 7, ['outline_expansion']);
    expect(withoutNote[0]?.authorNote).toBe('不要把大纲当正文写');
  });

  it('同一次多原因各自动折叠', () => {
    const out = updateFailurePatterns([], 2, ['style_drift', 'other']);
    expect(out.map((p) => p.code).sort()).toEqual(['other', 'style_drift']);
  });
});

describe('failure-memory JSONL 编解码', () => {
  it('序列化/解析逐字段往返', () => {
    const patterns = updateFailurePatterns(SEED, 5, ['payoff_zeroed', 'outline_expansion']);
    const round = parseFailurePatterns(serializeFailurePatterns(patterns));
    expect(round).toEqual(patterns);
  });

  it('空集序列化为空串；空串/空白解析为空集', () => {
    expect(serializeFailurePatterns([])).toBe('');
    expect(parseFailurePatterns('')).toEqual([]);
    expect(parseFailurePatterns('\n  \n')).toEqual([]);
  });

  it('撕裂行跳过不报废整册（Ledger 容读同纪律）', () => {
    const good = JSON.stringify(SEED[0]);
    const jsonl = good + '\n{"code": "payoff_ze\n' + '\n' + JSON.stringify(SEED[0]!) + '\n';
    const parsed = parseFailurePatterns(jsonl);
    expect(parsed).toHaveLength(2);
    expect(parsed.every((p) => p.code === 'outline_expansion')).toBe(true);
  });
});
