/**
 * 只读投影器验收（T24 · #57）：三件输入 → cell 六信号。
 * 全程真实 producer 供给事件面（RuntimeEngine P1 桥接 execute / presentCandidates /
 * recordCandidateDecision / runFlywheelRecord / appendUsageRows）——投影器是纯消费端。
 * 零时钟（nowMs/at 全显式注入）零外部服务，hermetic 临时书。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PublishBus, RuntimeEngine } from '@mozhou/runtime';
import { LocalDataPlane, createBook } from '@mozhou/data-plane';
import {
  appendUsageRows,
  presentCandidates,
  recordCandidateDecision,
  readPipelineLedger,
  readUsageProjection,
  recordUserEdit,
  runFlywheelRecord,
} from '@mozhou/pipeline';
import type { UsageRecord } from '@mozhou/pipeline';
import { aggregateSignals, projectInputs } from './project.js';
import type { SignalSlice } from './project.js';

const TASK_TYPE = 'chapter_draft';
const RECIPE_PAYLOAD = { recipeSnapshot: { recipe: { recipeVersion: 'v1' } } };

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function hermeticBook(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-t24-project-'));
  roots.push(dir);
  createBook({ dir, title: 'T24投影之书' });
  const plane = LocalDataPlane.open(dir);
  for (const chapterIndex of [1, 2, 3, 4]) {
    plane.createChapterDraft({ chapterIndex, title: '第' + chapterIndex + '章' });
  }
  return dir;
}

/** gen taskRef 全局计数器：bridgedEngine 每次新建 engine，计数器必须跨实例递增，
 *  否则两个窗口撞同名 gen_001 ⇒ parentByGen 首胜、后窗丢 cell 归属（C3/S6 曾因此假红）。 */
const newTaskRef = (() => {
  let n = 0;
  return () => `gen_${String(++n).padStart(3, '0')}`;
})();

/** 桥接引擎：P1 meta 三槽全带；nowMs 注入固定计数器（零时钟）。 */
function bridgedEngine(root: string, bus: PublishBus): RuntimeEngine {
  const engine = new RuntimeEngine({
    bus,
    ctx: { root },
    newTaskRef,
    nowMs: (() => {
      let n = 1000;
      return () => (n += 10);
    })(),
  });
  engine.registerCapability({
    taskType: TASK_TYPE,
    providerId: 'prov_a',
    providerVersion: '1.0.0',
    failurePolicy: { timeoutMs: 5_000, fallbackProviderIds: [] },
  });
  engine.registerProviderBinding('prov_a', () => Promise.resolve('正文'));
  return engine;
}

interface WindowSpec {
  readonly taskRef: string;
  readonly chapterIndex: number;
  readonly providerId?: string;
  readonly model?: string;
  readonly recipeVersion?: string;
  /** usage 行时间锚（ISO）。 */
  readonly at?: string;
  readonly costMicros?: number;
  readonly outputTokens?: number;
  readonly edited?: boolean;
  readonly decisions?: readonly [accepted: string[], rejected: string[]][];
  readonly degraded?: boolean;
}

/** 铺一个会话窗口：桥接代次 + usage + 决策 + 编辑 + 收尾锚。 */
async function writeWindow(root: string, bus: PublishBus, spec: WindowSpec): Promise<void> {
  const providerId = spec.providerId ?? 'prov_a';
  if (providerId === 'prov_a') {
    const engine = bridgedEngine(root, bus);
    await engine.execute(
      TASK_TYPE,
      {},
      {
        parentTaskRef: spec.taskRef,
        chapterIndex: spec.chapterIndex,
        ...(spec.recipeVersion === undefined
          ? {}
          : { eventPayload: { recipeSnapshot: { recipe: { recipeVersion: spec.recipeVersion } } } }),
      },
    );
  } else {
    // 非 prov_a 路由：直接按引擎冻结形状发桥接 GenerationStarted（wire shape 一致）
    bus.publish({ root }, {
      type: 'GenerationStarted',
      taskRef: `gen_${spec.taskRef}`,
      chapterIndex: spec.chapterIndex,
      payload: {
        snapshot: { taskType: TASK_TYPE, capability: TASK_TYPE, providerId, providerVersion: '1.0.0' },
        ...RECIPE_PAYLOAD,
        parentTaskRef: spec.taskRef,
      },
    });
  }

  const usage: UsageRecord[] = [{
    entryId: `usg_${spec.taskRef}`,
    taskRef: spec.taskRef,
    chapterIndex: spec.chapterIndex,
    commitId: `cmt_${spec.taskRef}`,
    kind: 'usage',
    derived: false,
    ...(spec.model === undefined ? {} : { model: spec.model }),
    ...(spec.outputTokens === undefined ? {} : { outputTokens: spec.outputTokens }),
    ...(spec.costMicros === undefined ? {} : { costMicros: spec.costMicros }),
    ...(spec.at === undefined ? {} : { at: spec.at }),
  }];
  appendUsageRows(root, usage);

  for (const [accepted, rejected] of spec.decisions ?? []) {
    const d = { bus, bookRoot: root, taskRef: spec.taskRef, chapterIndex: spec.chapterIndex };
    const options = [...accepted, ...rejected].map((id) => ({ candidateId: `cand_${spec.taskRef}_${id}`, text: `候选${id}` }));
    presentCandidates(d, { level: 'cursor', options });
    recordCandidateDecision(d, {
      level: 'cursor',
      acceptedOptionIds: accepted.map((id) => `cand_${spec.taskRef}_${id}`),
      rejectedOptionIds: rejected.map((id) => `cand_${spec.taskRef}_${id}`),
    });
  }

  if (spec.edited === true) {
    recordUserEditBlocks(root, bus, spec);
  }

  runFlywheelRecord({
    bus,
    bookRoot: root,
    taskRef: spec.taskRef,
    chapterIndex: spec.chapterIndex,
    commitId: `cmt_${spec.taskRef}`,
    usage: [],
    newEntryId: () => `usg_anchor_${spec.taskRef}`,
    ...(spec.degraded === true ? { projectionSink: () => { throw new Error('fixture degradation'); } } : {}),
  });
}

function recordUserEditBlocks(root: string, bus: PublishBus, spec: WindowSpec): void {
  // 真实 producer：author edit_blocks 行（S2 edited 证据）
  recordUserEdit({
    bus,
    bookRoot: root,
    taskRef: spec.taskRef,
    chapterIndex: spec.chapterIndex,
    level: 'selection',
    source: 'author',
    blocks: [{ op: 'insert', paragraphStart: 1, paragraphEnd: 1, replacementText: '作者补写一句。' }],
  });
}

function project(root: string) {
  return projectInputs({ ledger: readPipelineLedger(root), usage: readUsageProjection(root) });
}

function horizonSlice(projection: ReturnType<typeof projectInputs>): SignalSlice {
  return { windows: projection.windows, generations: projection.generations, decisions: projection.decisions };
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('projectInputs · C2 桥接 join', () => {
  it('parentTaskRef 同窗 join：账本+usage+决策归入同一 cell', async () => {
    const root = hermeticBook();
    const bus = new PublishBus();
    await writeWindow(root, bus, {
      taskRef: 'w_aaa',
      chapterIndex: 1,
      model: 'model-a',
      recipeVersion: 'v1',
      decisions: [[['x'], ['y', 'z']]],
      costMicros: 150,
      outputTokens: 300,
    });

    const projection = project(root);
    expect(projection.bridgePresent).toBe(true);
    expect(projection.unattributedRoutes).toEqual([]);
    expect([...projection.cellKeys.values()]).toEqual([
      { taskType: TASK_TYPE, providerId: 'prov_a', model: 'model-a', recipeVersion: 'v1' },
    ]);

    const signalsMap = aggregateSignals(horizonSlice(projection));
    expect(signalsMap.size).toBe(1);
    const cell = [...signalsMap.values()][0];
    if (cell === undefined) throw new Error('期望恰好一个 cell');
    expect(cell.s1).toMatchObject({ decisions: 1, acceptedOptions: 1, rejectedOptions: 2, acceptanceRate: 1 / 3 });
    expect(cell.s2).toMatchObject({ closedWindows: 1, editedWindows: 0, editRatio: 0 }); // C3：无编辑记 0
    expect(cell.s5).toMatchObject({ costMicros: 150, outputTokens: 300, microsPerOutputToken: 0.5 });
  });

  it('桥接缺位守卫：无 parentTaskRef ⇒ bridgePresent=false 且路由不可归因', () => {
    const root = hermeticBook();
    const bus = new PublishBus();
    bus.publish({ root }, {
      type: 'GenerationStarted',
      taskRef: 'gen_orphan',
      payload: { snapshot: { taskType: TASK_TYPE, capability: TASK_TYPE, providerId: 'prov_a', providerVersion: '1.0.0' } },
    });

    const projection = project(root);
    expect(projection.bridgePresent).toBe(false);
    expect(projection.unattributedRoutes).toEqual([{ taskType: TASK_TYPE, providerId: 'prov_a' }]);
    expect(aggregateSignals(horizonSlice(projection)).size).toBe(0);
  });

  it('model 证据缺面：桥接在位但 usage 无 model ⇒ 成不了完整 cell', async () => {
    const root = hermeticBook();
    const bus = new PublishBus();
    await writeWindow(root, bus, { taskRef: 'w_nomodel', chapterIndex: 2, recipeVersion: 'v1' });

    const projection = project(root);
    expect(projection.bridgePresent).toBe(true);
    expect(projection.cellKeys.size).toBe(0);
    expect(projection.unattributedRoutes).toEqual([{ taskType: TASK_TYPE, providerId: 'prov_a' }]);
  });

  it('一窗多代取首代定归属（账本行序权威）', async () => {
    const root = hermeticBook();
    const bus = new PublishBus();
    await writeWindow(root, bus, { taskRef: 'w_first', chapterIndex: 3, model: 'm-first', recipeVersion: 'v1' });
    await writeWindow(root, bus, { taskRef: 'w_first', chapterIndex: 3, providerId: 'prov_b', model: 'm-second', recipeVersion: 'v1' });

    const projection = project(root);
    expect([...projection.cellKeys.values()].map((k) => k.model)).toEqual(['m-first']);
  });
});

describe('projectInputs · 六信号口径', () => {
  it('C3 零边界条款：闭合无编辑窗记 0 入分母；未闭合编辑窗不入分母', async () => {
    const root = hermeticBook();
    const bus = new PublishBus();
    await writeWindow(root, bus, { taskRef: 'w_clean', chapterIndex: 1, model: 'm', recipeVersion: 'v1' });
    await writeWindow(root, bus, { taskRef: 'w_edited', chapterIndex: 2, model: 'm', recipeVersion: 'v1', edited: true });
    // 未闭合窗口：只有代次+usage+决策，无 FlywheelRecorded 锚——手工铺
    bus.publish({ root }, {
      type: 'GenerationStarted',
      taskRef: 'gen_unclosed',
      chapterIndex: 3,
      payload: {
        snapshot: { taskType: TASK_TYPE, capability: TASK_TYPE, providerId: 'prov_a', providerVersion: '1.0.0' },
        ...RECIPE_PAYLOAD,
        parentTaskRef: 'w_unclosed',
      },
    });
    appendUsageRows(root, [{
      entryId: 'usg_unclosed', taskRef: 'w_unclosed', chapterIndex: 3, commitId: 'cmt_u',
      kind: 'usage', derived: false, model: 'm', outputTokens: 10, costMicros: 5,
    }]);
    recordUserEdit({
      bus, bookRoot: root, taskRef: 'w_unclosed', chapterIndex: 3,
      level: 'cursor', source: 'author',
      blocks: [{ op: 'insert', paragraphStart: 1, paragraphEnd: 1, replacementText: '未闭合也改了。' }],
    });

    const projection = project(root);
    const cells = [...aggregateSignals(horizonSlice(projection)).values()];
    if (cells[0] === undefined) throw new Error('期望至少一个 cell');
    expect(cells[0].s2).toMatchObject({ closedWindows: 2, editedWindows: 1, editRatio: 0.5 });
  });

  it('S6 可靠性：attempt 密度、失败代次、state_degraded 窗口分别计数', async () => {
    const root = hermeticBook();
    const bus = new PublishBus();
    await writeWindow(root, bus, { taskRef: 'w_ok', chapterIndex: 1, model: 'm', recipeVersion: 'v1' });
    await writeWindow(root, bus, { taskRef: 'w_bad', chapterIndex: 2, model: 'm', recipeVersion: 'v1', degraded: true });
    // 失败代次 + attempt 密度：直接按引擎冻结形状补事件
    bus.publish({ root }, {
      type: 'GenerationStarted',
      taskRef: 'gen_fail',
      chapterIndex: 2,
      payload: { snapshot: { taskType: TASK_TYPE, capability: TASK_TYPE, providerId: 'prov_a', providerVersion: '1.0.0' }, parentTaskRef: 'w_ok' },
    });
    bus.publish({ root }, { type: 'TaskAttemptRegistered', taskRef: 'gen_fail', payload: { providerId: 'prov_b', reason: 'timeout' } });
    bus.publish({ root }, { type: 'TaskAttemptRegistered', taskRef: 'gen_fail', payload: { providerId: 'prov_c', reason: 'recoverable' } });
    bus.publish({ root }, { type: 'GenerationFinished', taskRef: 'gen_fail', payload: { outcome: 'failed_recoverable', reason: '穷尽', durationMs: 5 } });

    const projection = project(root);
    const cells = [...aggregateSignals(horizonSlice(projection)).values()];
    if (cells[0] === undefined) throw new Error('期望至少一个 cell');
    expect(cells[0].s6).toMatchObject({ windows: 2, attempts: 2, failedGenerations: 1, degradedWindows: 1 });
  });

  it('S1 空语义分离：无决策 ⇒ acceptanceRate=null（非 0）', async () => {
    const root = hermeticBook();
    const bus = new PublishBus();
    await writeWindow(root, bus, { taskRef: 'w_nodecision', chapterIndex: 4, model: 'm', recipeVersion: 'v1' });

    const cells = [...aggregateSignals(horizonSlice(project(root))).values()];
    if (cells[0] === undefined) throw new Error('期望至少一个 cell');
    expect(cells[0].s1).toMatchObject({ decisions: 0, acceptanceRate: null });
    expect(cells[0].s2.editRatio).toBe(0); // 对照 C3：闭合无编辑是 0，不是 null
  });
});

/* -------------------------------------------------------------------------
 * S7 重复纠错率（ADR-0025 · Task 5）：聚合语义
 * ------------------------------------------------------------------------- */

const CELL_A = 'cell-a';

function emptyWindow(taskRef: string, cellId: string | null, chapterIndex: number | null) {
  return { taskRef, chapterIndex, cellId, edited: false, degraded: false, costMicros: 0, outputTokens: 0, atMs: null };
}

function correction(taskRef: string, cellId: string | null, chapterIndex: number | null, reasons: readonly string[], position = 0) {
  return { position, taskRef, chapterIndex, cellId, reasons };
}

describe('S7 重复纠错率（ADR-0025 · Task 5）', () => {
  it('有窗口零纠错 → s7 全零、rate=null（宁缺不猜）', () => {
    const result = aggregateSignals({
      windows: [emptyWindow('w1', CELL_A, 1)],
      generations: [],
      decisions: [],
    });
    expect(result.get(CELL_A)?.s7).toEqual({
      correctedChapters: 0,
      repeatedCorrections: 0,
      repeatCorrectionRate: null,
    });
  });

  it('同 reason 在更晚章节复发 → rate>0', () => {
    const result = aggregateSignals({
      windows: [emptyWindow('w1', CELL_A, 1), emptyWindow('w2', CELL_A, 3)],
      generations: [],
      decisions: [],
      corrections: [
        correction('w1', CELL_A, 1, ['style_drift'], 0),
        correction('w2', CELL_A, 3, ['style_drift'], 1),
      ],
    });
    expect(result.get(CELL_A)?.s7).toEqual({
      correctedChapters: 2,
      repeatedCorrections: 1,
      repeatCorrectionRate: 0.5,
    });
  });

  it('同章重复同 reason 不计复发；不同 reason 各自独立', () => {
    const result = aggregateSignals({
      windows: [emptyWindow('w1', CELL_A, 1), emptyWindow('w2', CELL_A, 2)],
      generations: [],
      decisions: [],
      corrections: [
        correction('w1', CELL_A, 1, ['style_drift'], 0),
        correction('w1', CELL_A, 1, ['style_drift'], 1),
        correction('w2', CELL_A, 2, ['other'], 2),
      ],
    });
    expect(result.get(CELL_A)?.s7).toEqual({
      correctedChapters: 2,
      repeatedCorrections: 0,
      repeatCorrectionRate: 0,
    });
  });

  it('不可归因（cellId=null）与无章号纠错不入 S7', () => {
    const result = aggregateSignals({
      windows: [],
      generations: [],
      decisions: [],
      corrections: [
        correction('w1', null, 1, ['style_drift'], 0),
        correction('w2', CELL_A, null, ['style_drift'], 1),
      ],
    });
    expect(result.size).toBe(0);
  });
});
