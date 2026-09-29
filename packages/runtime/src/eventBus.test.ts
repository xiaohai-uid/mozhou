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

/**
 * 工单 02 缺陷 B（.scratch/mozhou-deepening-20260928/issues/02-adopt-open-heads-latent-defect.md）：
 * adoptOpenHeads 对全账本无窗口、无 position 门控地折叠所有 head——把「按设计永不闭合」的
 * 历史悬挂 head（web 提交路径的 CanonProposalCreated，见 proseRoutes.ts 成对账目注；事件
 * 形状 = createCanonProposal 的发布载荷，packages/pipeline/src/proposal-step.ts）灌进本实例
 * 的配对状态机后，同一窗口键的合法新 head（windowTaskRef = web_commit_ch<N>_rev<R> 是
 * 确定性键，同章同 revision 重提交即同键）会撞 PAIRING_HEAD_UNCLOSED。
 *
 * 修复 = adoptOpenHeads 补 position 门控：只认领「当前开卷窗口」（最后一个未闭合
 * TaskStarted 及其后）内的 head，与 projectSession.openHeads 的窗口闸同源
 * （packages/pipeline/src/projection.ts：openedAtPosition 恒 null + position 比较两道闸）。
 * abandon 的跨请求闭合能力（认领当前窗口 TaskStarted）不回退——本组用例逐一钉住。
 */
describe('PublishBus.adoptOpenHeads · 工单 02B position 门控', () => {
  /** web 提案头的真实事件形状（packages/pipeline/src/proposal-step.ts createCanonProposal）。 */
  const webProposalHead = (taskRef: string) => ({
    type: 'CanonProposalCreated' as const,
    taskRef,
    chapterIndex: 1,
    payload: { proposalId: 'prp_legacy', routed: { low: 1, medium: 0, high: 0 }, pendingItems: 0 },
  });

  it('窗口外悬挂的 web 提案头不被认领：同键新提案头可开（同 revision 重提交不再撞 PAIRING_HEAD_UNCLOSED）', () => {
    const { root } = hermeticRoot();
    // 旧 web 书账本的真实形状：web 提交落 CanonProposalCreated 头且按设计无配对尾
    new PublishBus().publish({ root }, webProposalHead('web_commit_ch1_rev1'));

    // 新实例走 adoptOpenHeads（abandon 路径的真实形态，session.ts）
    const bus = new PublishBus();
    bus.adoptOpenHeads({ root });
    // 缺陷 B 复现点（修复前此处抛 PairingError PAIRING_HEAD_UNCLOSED）：
    // 窗口外的历史悬挂头不得灌进本实例，同键新 head（同 revision 重提交的合法新提案）可开
    expect(() => bus.publish({ root }, webProposalHead('web_commit_ch1_rev1'))).not.toThrow();
    expect(bus.openHeadKeys()).toEqual(['CanonProposalCreated#web_commit_ch1_rev1']);
  });

  it('当前开卷窗口内的 head 仍被认领（abandon / 跨请求闭合能力不回退）', () => {
    const { root } = hermeticRoot();
    new PublishBus().publish({ root }, { type: 'TaskStarted', taskRef: 'tsk_win', chapterIndex: 2 });
    // 窗口内的会话提案头（recordProposal，markCommitted 跨请求闭合时依赖认领）
    new PublishBus().publish({ root }, { type: 'CanonProposalCreated', taskRef: 'tsk_win', chapterIndex: 2 });

    const bus = new PublishBus();
    bus.adoptOpenHeads({ root });
    expect(bus.openHeadKeys()).toEqual(['TaskStarted#tsk_win', 'CanonProposalCreated#tsk_win']);
    // 认领后发 tail 仍成功（与上方既有用例同款语义，钉在窗口门控之后的回归面）；
    // 会话提案头不受 TaskFinished 影响——它要等 markCommitted 的 CanonCommitted 闭合
    bus.publish({ root }, { type: 'TaskFinished', taskRef: 'tsk_win', chapterIndex: 2, payload: { outcome: 'abandoned' } });
    expect(bus.openHeadKeys()).toEqual(['CanonProposalCreated#tsk_win']);
  });

  it('被新窗口取代的旧窗口 head 不被认领（重提交 = 新 session，投影同款折叠）', () => {
    const { root } = hermeticRoot();
    new PublishBus().publish({ root }, { type: 'TaskStarted', taskRef: 'tsk_old', chapterIndex: 1 });
    new PublishBus().publish({ root }, { type: 'TaskStarted', taskRef: 'tsk_new', chapterIndex: 1 });

    const bus = new PublishBus();
    bus.adoptOpenHeads({ root });
    expect(bus.openHeadKeys()).toEqual(['TaskStarted#tsk_new']);
  });

  it('窗口闭合之后的窗口间悬挂 head 不被认领（窗口间历史 ≠ 可续接约束）', () => {
    const { root } = hermeticRoot();
    // head + tail 必须同实例发布（配对纪律），这里只造账本形状
    const closer = new PublishBus();
    closer.publish({ root }, { type: 'TaskStarted', taskRef: 'tsk_done', chapterIndex: 1 });
    closer.publish({ root }, { type: 'TaskFinished', taskRef: 'tsk_done', chapterIndex: 1, payload: { outcome: 'succeeded' } });
    new PublishBus().publish({ root }, webProposalHead('web_commit_ch2_rev1'));

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
