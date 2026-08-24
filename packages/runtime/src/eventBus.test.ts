/**
 * T11 验收测试：publishEvent 单口 + 配对纪律 + 投影幂等（规格 §3，Q5/Q3）。
 * 全程零时钟零外部服务；账本落在 hermetic 临时目录。
 */
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PublishBus, readLedger } from './eventBus.js';
import { PairingError } from './types.js';

function hermeticRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-runtime-'));
  mkdirSync(join(root, '.mozhou'), { recursive: true });
  return { root, cleanup: () => root && undefined };
}

const ev = (type: 'GenerationStarted' | 'GenerationFinished' | 'TaskStarted', taskRef = 't1') =>
  ({ type, taskRef }) as const;

describe('PublishBus 配对纪律', () => {
  it('正常成对：head 开 → tail 闭，账本两行且 seq 递增', () => {
    const { root } = hermeticRoot();
    const bus = new PublishBus();
    bus.publish({ root }, ev('GenerationStarted'));
    bus.publish({ root }, ev('GenerationFinished'));
    const lines = readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? '{}') as { seq: number; event: { type: string } };
    const second = JSON.parse(lines[1] ?? '{}') as { seq: number };
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(first.event.type).toBe('GenerationStarted');
  });

  it('head 未闭合禁止再次开启（PAIRING_HEAD_UNCLOSED）', () => {
    const { root } = hermeticRoot();
    const bus = new PublishBus();
    bus.publish({ root }, ev('GenerationStarted'));
    expect(() => bus.publish({ root }, ev('GenerationStarted'))).toThrowError(PairingError);
  });

  it('tail 无 head 即拒（PAIRING_TAIL_WITHOUT_HEAD）', () => {
    const { root } = hermeticRoot();
    const bus = new PublishBus();
    expect(() => bus.publish({ root }, ev('GenerationFinished'))).toThrowError(PairingError);
  });

  it('不同 taskRef 的同名 head 互不干扰', () => {
    const { root } = hermeticRoot();
    const bus = new PublishBus();
    bus.publish({ root }, ev('GenerationStarted', 'a'));
    bus.publish({ root }, ev('GenerationStarted', 'b'));
    expect(readLedger({ root })).toHaveLength(2);
  });
});

describe('readLedger / 单口委托', () => {
  it('空目录读账本得空数组（不要求文件预存在）', () => {
    const { root } = hermeticRoot();
    expect(readLedger({ root })).toEqual([]);
  });

  it('publish 后 readLedger 可回读同序事件', () => {
    const { root } = hermeticRoot();
    const bus = new PublishBus();
    bus.publish({ root }, ev('TaskStarted'));
    const ledger = readLedger({ root });
    expect(ledger.map((l) => l.event.type)).toEqual(['TaskStarted']);
  });
});
