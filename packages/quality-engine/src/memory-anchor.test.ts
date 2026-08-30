import { describe, expect, it } from 'vitest';
import {
  parseMemoryAnchors,
  recordAnchorEcho,
  retireAnchor,
  selectRelevantAnchors,
  serializeMemoryAnchors,
} from './memory-anchor.js';
import type { MemoryAnchor } from './memory-anchor.js';

function anchor(anchorId: string, plantedChapter: number, overrides: Partial<MemoryAnchor> = {}): MemoryAnchor {
  return {
    anchorId,
    type: 'object',
    description: '锚 ' + anchorId,
    plantedChapter,
    lastEchoChapter: null,
    status: 'planted',
    ...overrides,
  };
}

describe('MemoryAnchor 编解码', () => {
  it('序列化/解析逐字段往返', () => {
    const anchors = [anchor('a1', 1), anchor('a2', 3, { status: 'echoed', lastEchoChapter: 5, type: 'line' })];
    expect(parseMemoryAnchors(serializeMemoryAnchors(anchors))).toEqual(anchors);
  });

  it('撕裂行跳过', () => {
    const torn = '{"anchorId":"a1"\n' + JSON.stringify(anchor('a2', 2)) + '\n';
    expect(parseMemoryAnchors(torn)).toEqual([anchor('a2', 2)]);
  });
});

describe('锚生命周期', () => {
  it('回响推进 planted→echoed 且 lastEchoChapter 取 max', () => {
    const out = recordAnchorEcho([anchor('a1', 1)], 'a1', 4);
    expect(out[0]).toMatchObject({ status: 'echoed', lastEchoChapter: 4 });
    const again = recordAnchorEcho(out, 'a1', 2);
    expect(again[0]?.lastEchoChapter).toBe(4);
  });

  it('退役为终态：retired 不回响、不再入相关集', () => {
    const retired = retireAnchor([anchor('a1', 1)], 'a1');
    expect(retired[0]?.status).toBe('retired');
    const echoAttempt = recordAnchorEcho(retired, 'a1', 9);
    expect(echoAttempt[0]?.status).toBe('retired');
    expect(echoAttempt[0]?.lastEchoChapter).toBeNull();
    expect(selectRelevantAnchors(retired, {})).toEqual([]);
  });
});

describe('selectRelevantAnchors 有界相关集', () => {
  it('按最近触达降序取 ≤8 个，退役锚排除', () => {
    const anchors = [
      anchor('old', 1, { status: 'retired' }),
      ...Array.from({ length: 10 }, (_, i) =>
        anchor('a' + i, i + 1, { lastEchoChapter: i + 2, status: 'echoed' as const }),
      ),
    ];
    const slice = selectRelevantAnchors(anchors, {});
    expect(slice).toHaveLength(8);
    expect(slice.map((a) => a.anchorId)[0]).toBe('a9'); // 最近触达 ch11
    expect(slice.some((a) => a.anchorId === 'old')).toBe(false);
  });

  it('无回响的锚以埋设章为触达序', () => {
    const slice = selectRelevantAnchors([anchor('p1', 2), anchor('p2', 9)], {});
    expect(slice.map((a) => a.anchorId)).toEqual(['p2', 'p1']);
  });
});
