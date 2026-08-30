import { describe, expect, it } from 'vitest';
import {
  parseReaderExperienceDeltas,
  selectRecentDeltas,
  serializeReaderExperienceDeltas,
} from './reader-experience.js';
import type { ReaderExperienceDelta } from './reader-experience.js';

function delta(chapterIndex: number, solutionPattern = 'borrow_knife'): ReaderExperienceDelta {
  return {
    chapterIndex,
    pressureDelta: 1,
    expectationDelta: 2,
    tangibleGain: 'resource',
    payoff: 'advanced',
    solutionPattern,
  };
}

describe('ReaderExperienceDelta 编解码', () => {
  it('序列化/解析逐字段往返', () => {
    const deltas = [delta(1), delta(2, 'trade_favor'), delta(3, 'force_open')];
    expect(parseReaderExperienceDeltas(serializeReaderExperienceDeltas(deltas))).toEqual(deltas);
  });

  it('空集 ⇔ 空串；撕裂行跳过', () => {
    expect(serializeReaderExperienceDeltas([])).toBe('');
    expect(parseReaderExperienceDeltas('')).toEqual([]);
    const torn = '{"chapterIndex":1,"pressureDel\n' + JSON.stringify(delta(2)) + '\n';
    expect(parseReaderExperienceDeltas(torn)).toEqual([delta(2)]);
  });

  it('值域非法行拒收（宁缺勿猜）', () => {
    const bad = JSON.stringify({ ...delta(1), tangibleGain: 'immortality' });
    expect(parseReaderExperienceDeltas(bad)).toEqual([]);
  });
});

describe('selectRecentDeltas 有界近窗', () => {
  it('只取目标章之前的记录，按章号降序，≤5 条', () => {
    const deltas = [1, 2, 3, 4, 5, 6, 7].map((n) => delta(n, 'p' + n));
    const slice = selectRecentDeltas(deltas, { chapterIndex: 8 });
    expect(slice.map((d) => d.chapterIndex)).toEqual([7, 6, 5, 4, 3]);
  });

  it('目标章自身与未来章不入上下文', () => {
    const deltas = [delta(4), delta(5)];
    const slice = selectRecentDeltas(deltas, { chapterIndex: 5 });
    expect(slice.map((d) => d.chapterIndex)).toEqual([4]);
  });
});
