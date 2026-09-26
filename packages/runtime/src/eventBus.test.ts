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

/**
 * 跨请求续接配对（S9 收口前置能力）：head 只活在实例内存，窗口在上一请求的实例上
 * 开卷后实例即销毁；本请求的新实例要发 tail 前必须据账本认领悬挂的 head。
 */
describe('PublishBus.adoptOpenHeads · 从账本重建未闭合 head', () => {
  it('认领账本悬挂的 head 后，新实例可发 tail（跨请求闭合窗口）', () => {
    const { root } = hermeticRoot();
    // 上一请求：开卷（head 落账），实例随后销毁
    new PublishBus().publish({ root }, { type: 'TaskStarted', taskRef: 'tsk_adopt', chapterIndex: 2 });

    // 本请求：新实例的配对状态是空的
    const bus = new PublishBus();
    expect(bus.openHeadKeys()).toEqual([]);
    bus.adoptOpenHeads({ root });
    expect(bus.openHeadKeys()).toEqual(['TaskStarted#tsk_adopt']);
    // 认领后发 tail 成功，账本闭合为两行
    bus.publish({ root }, { type: 'TaskFinished', taskRef: 'tsk_adopt', chapterIndex: 2, payload: { outcome: 'abandoned' } });
    expect(bus.openHeadKeys()).toEqual([]);
    expect(readLedger({ root }).map((row) => row.event.type)).toEqual(['TaskStarted', 'TaskFinished']);
  });

  it('幂等且不复活已闭合的 head（账本 tail 出列）', () => {
    const { root } = hermeticRoot();
    const bus = new PublishBus();
    bus.publish({ root }, { type: 'TaskStarted', taskRef: 'tsk_closed' });
    bus.publish({ root }, { type: 'TaskFinished', taskRef: 'tsk_closed' });

    const fresh = new PublishBus();
    fresh.adoptOpenHeads({ root });
    fresh.adoptOpenHeads({ root }); // 幂等
    expect(fresh.openHeadKeys()).toEqual([]);
    // 已闭合的 head 不被复活：再发 tail 仍被拒
    expect(() => fresh.publish({ root }, { type: 'TaskFinished', taskRef: 'tsk_closed' })).toThrowError(PairingError);
  });

  it('空/缺失账本安全（无 head 可认领）', () => {
    const { root } = hermeticRoot();
    const bus = new PublishBus();
    bus.adoptOpenHeads({ root });
    expect(bus.openHeadKeys()).toEqual([]);
  });
});

describe('T21 词表增补（#54 · t51:B5）', () => {
  it('StyleProfileUpdated 非成对事件：词表门放行、无配对约束、顶层 taskRef/chapterIndex 回读原样', () => {
    const { root } = hermeticRoot();
    const bus = new PublishBus();
    bus.publish({ root }, {
      type: 'StyleProfileUpdated',
      taskRef: 'tsk_style_1',
      chapterIndex: 9,
      payload: { regime: 'steady' },
    });
    // 非成对收尾事件：无 head/tail 配对（EVENT_PAIRS 不动），发布即落账无悬挂
    expect(bus.openHeadKeys()).toEqual([]);
    const events = readLedger({ root }).map((l) => l.event);
    expect(events.map((e) => e.type)).toEqual(['StyleProfileUpdated']);
    expect(events[0]!.taskRef).toBe('tsk_style_1'); // 顶层既有槽位（t52:B5：禁塞 payload、禁增顶层字段）
    expect(events[0]!.chapterIndex).toBe(9);
    expect(events[0]!.payload).toEqual({ regime: 'steady' });
  });
});
