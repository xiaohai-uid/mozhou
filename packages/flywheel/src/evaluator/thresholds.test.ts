/**
 * 五规则判定验收（T24 · #57）：R1 资格门前置（含锐化条款）/ R2 最小样本 /
 * R3 区间优势+地板效应 / R4 切窗双轨确认 / demote 反向信号。
 * 全部纯夹具零时钟零 IO；六指标判定消费 evaluateMetricGate 的结论作对照。
 */
import { describe, expect, it } from 'vitest';
import { METRIC_IDS, evaluateMetricGate } from '@mozhou/benchmark';
import {
  acceptanceWilson,
  baselineFailureRate,
  buildArchiveView,
  cutConfirmationWindows,
  cutWindowsOfPositionOrdered,
  eligibilityOf,
  failureRateOf,
  gateStreakFailed,
  judgeDemotion,
  judgePair,
  rowGatePassedAll,
  s2Condition,
  userEditReductionOf,
  withArchiveSignals,
} from './thresholds.js';
import type { ArchivedMatrixRow } from './storage.js';
import { emptySignals } from './types.js';
import type { CellSignals } from './types.js';
import type { DecisionFact, SignalSlice } from './project.js';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 全过读数：六指标逐项落在 evaluateMetricGate 通过侧。 */
const PASSING_METRICS = {
  CANON_ACCURACY: 1,
  KNOWLEDGE_LEAK_RATE: 0,
  PROMISE_RECALL: 1,
  CHANGE_IMPACT_RECALL: 1,
  CONTEXT_BUDGET_OVERFLOW: 0,
  USER_EDIT_RATIO_REDUCTION: 0.5,
} as const;

/** 破门读数：CANON_ACCURACY 低于机械门（0.985 < 门限），其余照旧。 */
const FAILING_METRICS = { ...PASSING_METRICS, CANON_ACCURACY: 0.985 } as const;

type MetricValues = Record<(typeof METRIC_IDS)[number], number>;

function archived(
  recipeVersion: string | null,
  values: MetricValues,
  caseIds: readonly string[],
  recordedAtUtc: string,
  ref?: string,
): ArchivedMatrixRow {
  return {
    matrixRowRef: ref ?? `mxr_${recipeVersion ?? 'null'}@${recordedAtUtc}`,
    row: {
      recipeVersion,
      benchmarkVersion: '0.1.0',
      recordedAtUtc,
      metrics: Object.fromEntries(
        METRIC_IDS.map((metric) => [metric, { metric, value: values[metric], passed: evaluateMetricGate(metric, values[metric]) }]),
      ),
    },
    caseIds,
  } as ArchivedMatrixRow;
}

/** 信号构造器：只覆盖关心的位。 */
function signals(patch: {
  s1?: Partial<CellSignals['s1']>;
  s2?: Partial<CellSignals['s2']>;
  s5?: Partial<CellSignals['s5']>;
  s6?: Partial<CellSignals['s6']>;
}): CellSignals {
  const base = emptySignals();
  return {
    ...base,
    s1: { ...base.s1, ...patch.s1 },
    s2: { ...base.s2, ...patch.s2 },
    s5: { ...base.s5, ...patch.s5 },
    s6: { ...base.s6, ...patch.s6 },
  };
}

function decision(position: number, atMs: number | null, cellId = 'c'): DecisionFact {
  return { position, taskRef: `w${position}`, chapterIndex: 1, cellId, acceptedOptions: 1, rejectedOptions: 1, atMs };
}

/** 双侧优势证据：challenger 全面优于 incumbent（可按窗口覆写）。 */
function evidence(over: {
  horizon?: { ch?: Partial<CellSignals>; inc?: Partial<CellSignals> };
  current?: { ch?: CellSignals; inc?: CellSignals };
  previous?: { ch?: CellSignals; inc?: CellSignals };
  chapters?: number;
}) {
  const chH = signals(over.horizon?.ch ?? {});
  const incH = signals(over.horizon?.inc ?? {});
  return {
    evidence: {
      challengerHorizon: chH,
      incumbentHorizon: incH,
      challengerCurrent: over.current?.ch ?? chH,
      incumbentCurrent: over.current?.inc ?? incH,
      challengerPrevious: over.previous?.ch ?? chH,
      incumbentPrevious: over.previous?.inc ?? incH,
      challengerChapters: over.chapters ?? 6,
    },
  };
}

const ELIGIBLE = { gatePassedAll: true, coversCases: true, matrixRowRef: 'mxr_x' };

// ---------------------------------------------------------------------------
// 存档视图与资格门
// ---------------------------------------------------------------------------

describe('buildArchiveView / eligibilityOf', () => {
  it('append 序权威：同 recipeVersion 后行覆盖前行，CASE 全集取并集', () => {
    const view = buildArchiveView([
      archived('v1', PASSING_METRICS, ['CASE-0001'], '2026-01-01T00:00:00Z'),
      archived('v1', FAILING_METRICS, ['CASE-0002'], '2026-01-02T00:00:00Z'),
    ]);
    expect(view.latestByRecipe.get('v1')?.row.recordedAtUtc).toBe('2026-01-02T00:00:00Z');
    expect([...view.caseUniverse].sort()).toEqual(['CASE-0001', 'CASE-0002']);
  });

  it('R1 锐化条款：最新报告破门 ⇒ 资格门失败（哪怕历史全过）', () => {
    const view = buildArchiveView([
      archived('v1', PASSING_METRICS, ['CASE-0001'], '2026-01-01T00:00:00Z'),
      archived('v1', FAILING_METRICS, ['CASE-0001'], '2026-01-02T00:00:00Z'),
    ]);
    const eligibility = eligibilityOf(view, 'v1');
    expect(eligibility.gatePassedAll).toBe(false);
    expect(eligibility.coversCases).toBe(true);
  });

  it('陈旧报告堵漏：全集因新增 CASE 扩张后，未复跑的旧报告即不再覆盖', () => {
    // v1 的最新报告只跑过 CASE-0001；随后 v2 行把 CASE-0002 带进全集
    const grown = buildArchiveView([
      archived('v1', PASSING_METRICS, ['CASE-0001'], '2026-01-01T00:00:00Z'),
      archived('v2', PASSING_METRICS, ['CASE-0002'], '2026-02-01T00:00:00Z'),
    ]);
    const eligibility = eligibilityOf(grown, 'v1');
    expect(eligibility.coversCases).toBe(false);
  });

  it('空存档 = 无证据：资格门必不通过且 matrixRowRef 为 null', () => {
    const eligibility = eligibilityOf(buildArchiveView([]), 'v1');
    expect(eligibility.gatePassedAll).toBe(false);
    expect(eligibility.coversCases).toBe(false);
    expect(eligibility.matrixRowRef).toBeNull();
  });

  it('S4 取最新存档行的 USER_EDIT_RATIO_REDUCTION 运行级读数', () => {
    const view = buildArchiveView([
      archived('v1', { ...PASSING_METRICS, USER_EDIT_RATIO_REDUCTION: 0.2 }, ['CASE-0001'], '2026-01-01T00:00:00Z'),
      archived('v1', { ...PASSING_METRICS, USER_EDIT_RATIO_REDUCTION: 0.4 }, ['CASE-0001'], '2026-01-02T00:00:00Z'),
    ]);
    expect(userEditReductionOf(view, 'v1')).toBe(0.4);
    expect(userEditReductionOf(view, 'vX')).toBeNull();
  });

  it('S3 合成：通过率跨全部匹配行折算（消费 evaluateMetricGate 口径一致）', () => {
    const rows = [
      archived('v1', PASSING_METRICS, ['CASE-0001'], '2026-01-01T00:00:00Z'),
      archived('v1', FAILING_METRICS, ['CASE-0001'], '2026-01-02T00:00:00Z'), // 5/6 过
    ];
    const merged = withArchiveSignals(emptySignals(), rows, 'v1');
    expect(merged.s3.gateReadings).toBe(12);
    expect(merged.s3.gatePassed).toBe(11);
    expect(merged.s3.gatePassRate).toBeCloseTo(11 / 12);
    expect(merged.s4.userEditRatioReduction).toBe(0.5);
  });
});

describe('rowGatePassedAll', () => {
  it('与 evaluateMetricGate 逐项结论一致', () => {
    expect(rowGatePassedAll(archived('v1', PASSING_METRICS, [], 't').row)).toBe(true);
    expect(rowGatePassedAll(archived('v1', FAILING_METRICS, [], 't').row)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R4 切窗
// ---------------------------------------------------------------------------

describe('cutConfirmationWindows', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('20 决策先到切窗：第 21 条滚入前一窗口', () => {
    const decisions = Array.from({ length: 21 }, (_, i) => decision(i, null));
    const { current, previous } = cutConfirmationWindows(decisions);
    expect(current).toHaveLength(20);
    expect(previous).toHaveLength(1);
    expect(previous[0]?.position).toBe(0);
  });

  it('14 天先到切窗：跨度超限的旧决策滚入前一窗口', () => {
    const decisions = [
      decision(0, 0 * DAY),
      decision(1, 15 * DAY),
      decision(2, 16 * DAY),
    ];
    const { current, previous } = cutConfirmationWindows(decisions);
    expect(current.map((d) => d.position)).toEqual([1, 2]);
    expect(previous.map((d) => d.position)).toEqual([0]);
  });

  it('无时间锚的决策不触发时间切（不猜丢弃）', () => {
    const decisions = [decision(0, null), decision(1, 100 * DAY), decision(2, 100 * DAY)];
    const { current } = cutConfirmationWindows(decisions);
    expect(current).toHaveLength(3);
  });

  it('装满两窗即止：更旧历史不入判据（子日间隔使计数先于时限到达）', () => {
    const QUARTER_DAY = (24 * 60 * 60 * 1000) / 4;
    const decisions = Array.from({ length: 60 }, (_, i) => decision(i, i * QUARTER_DAY));
    const { current, previous } = cutWindowsOfPositionOrdered(decisions);
    expect(current).toHaveLength(20);
    expect(previous).toHaveLength(20);
    expect(current[current.length - 1]?.position).toBe(59); // 时间升序：最新在尾
  });

  it('输入乱序时按 position 升序重排后切（账本行序即权威时序）', () => {
    const shuffled = [decision(2, null), decision(0, null), decision(1, null)];
    const { current } = cutWindowsOfPositionOrdered(shuffled);
    expect(current.map((d) => d.position)).toEqual([0, 1, 2]); // 输出时间升序（新窗在切前已按行序归位）
  });
});

// ---------------------------------------------------------------------------
// judgePair：R1→R2→R4→R3 逐条前置
// ---------------------------------------------------------------------------

describe('judgePair', () => {
  it('R1 一票否决：资格门失败时无论信号多强都只产 watch', () => {
    const strong = {
      ...evidence({
        horizon: { ch: { s1: { decisions: 40, acceptedOptions: 38, rejectedOptions: 2, acceptanceRate: 0.95 } } },
        chapters: 6,
      }),
      eligibility: { gatePassedAll: false, coversCases: true, matrixRowRef: 'mxr' },
    };
    const verdict = judgePair(strong);
    expect(verdict.kind).toBe('watch');
    expect(verdict.reasons).toContain('eligibility_gate_failed');
  });

  it('R1 锐化：报告陈旧（coversCases=false）同样否决', () => {
    const verdict = judgePair({
      ...evidence({ horizon: { ch: { s1: { decisions: 40, acceptedOptions: 39, rejectedOptions: 1, acceptanceRate: 0.975 } } } }),
      eligibility: { gatePassedAll: true, coversCases: false, matrixRowRef: 'mxr' },
    });
    expect(verdict.kind).toBe('watch');
    expect(verdict.reasons).toContain('benchmark_cases_stale');
  });

  it('R2 最小样本：<30 决策 ⇒ insufficient_sample 观察条目', () => {
    const verdict = judgePair({
      ...evidence({
        horizon: { ch: { s1: { decisions: 29, acceptedOptions: 29, rejectedOptions: 0, acceptanceRate: 1 }, s2: { closedWindows: 6, editedWindows: 0, editRatio: 0 } } },
        chapters: 6,
      }),
      eligibility: ELIGIBLE,
    });
    expect(verdict.kind).toBe('watch');
    expect(verdict.status).toBe('insufficient_sample');
    expect(verdict.reasons).toContain('insufficient_sample');
  });

  it('promote 正例：双窗优势 + Wilson 分离 + 降幅达标', () => {
    const ch = signals({ s1: { decisions: 36, acceptedOptions: 108, rejectedOptions: 0, acceptanceRate: 1 }, s2: { closedWindows: 6, editedWindows: 0, editRatio: 0 } });
    const inc = signals({ s1: { decisions: 36, acceptedOptions: 36, rejectedOptions: 36, acceptanceRate: 0.5 }, s2: { closedWindows: 6, editedWindows: 6, editRatio: 1 } });
    const verdict = judgePair({
      evidence: {
        challengerHorizon: ch,
        incumbentHorizon: inc,
        challengerCurrent: ch,
        incumbentCurrent: inc,
        challengerPrevious: ch,
        incumbentPrevious: inc,
        challengerChapters: 6,
      },
      eligibility: ELIGIBLE,
    });
    expect(verdict.kind).toBe('promote');
    expect(verdict.editRatioDeltaPct).toBeCloseTo(100);
  });

  it('R3 地板效应：incumbent<0.05 时改绝对不劣化判据（相对降幅条款让位）', () => {
    // 绝对不劣化成立（0.04 → 0.04），相对降幅 0% 本不达标——地板条款放行
    expect(s2Condition(0.04, 0.04)).toMatchObject({ ok: true, floorClause: true, deltaPct: 0 });
    // 劣化即拦（0.04 → 0.05）
    expect(s2Condition(0.04, 0.05)).toMatchObject({ ok: false, floorClause: true });
    // 地板之上恢复相对判据：降幅恰 10% 达标、不足拦
    expect(s2Condition(0.4, 0.36)).toMatchObject({ ok: true, floorClause: false });
    expect(s2Condition(0.4, 0.37)).toMatchObject({ ok: false, floorClause: false });
  });

  it('R3 地板条款在完整判据中生效：低改写基线下微降也 promote', () => {
    const ch = signals({ s1: { decisions: 36, acceptedOptions: 90, rejectedOptions: 18, acceptanceRate: 5 / 6 }, s2: { closedWindows: 6, editedWindows: 0, editRatio: 0 } });
    const inc = signals({ s1: { decisions: 36, acceptedOptions: 36, rejectedOptions: 36, acceptanceRate: 0.5 }, s2: { closedWindows: 6, editedWindows: 0, editRatio: 0.04 } });
    const verdict = judgePair({
      evidence: {
        challengerHorizon: ch,
        incumbentHorizon: inc,
        challengerCurrent: ch,
        incumbentCurrent: inc,
        challengerPrevious: ch,
        incumbentPrevious: inc,
        challengerChapters: 6,
      },
      eligibility: ELIGIBLE,
    });
    expect(verdict.kind).toBe('promote'); // 相对降幅要求 10% 未达，但地板条款放行
  });

  it('R4 滞后确认：仅当前窗口占优 ⇒ watch first_window_only', () => {
    const chH = signals({ s1: { decisions: 36, acceptedOptions: 108, rejectedOptions: 0, acceptanceRate: 1 }, s2: { closedWindows: 6, editedWindows: 0, editRatio: 0 } });
    const incH = signals({ s1: { decisions: 36, acceptedOptions: 36, rejectedOptions: 36, acceptanceRate: 0.5 }, s2: { closedWindows: 6, editedWindows: 6, editRatio: 1 } });
    const chLost = signals({ s1: { decisions: 6, acceptedOptions: 3, rejectedOptions: 3, acceptanceRate: 0.5 }, s2: { closedWindows: 1, editedWindows: 1, editRatio: 1 } });
    const verdict = judgePair({
      evidence: {
        challengerHorizon: chH,
        incumbentHorizon: incH,
        challengerCurrent: chH,
        incumbentCurrent: incH,
        challengerPrevious: chLost,
        incumbentPrevious: incH,
        challengerChapters: 6,
      },
      eligibility: ELIGIBLE,
    });
    expect(verdict.kind).toBe('watch');
    expect(verdict.reasons).toContain('first_window_only');
    expect(verdict.status).toBe('sufficient_sample');
  });

  it('R3 区间重叠：比率接近时 Wilson 下界不越上界 ⇒ watch', () => {
    const ch = signals({ s1: { decisions: 36, acceptedOptions: 20, rejectedOptions: 16, acceptanceRate: 20 / 36 }, s2: { closedWindows: 6, editedWindows: 0, editRatio: 0 } });
    const inc = signals({ s1: { decisions: 36, acceptedOptions: 19, rejectedOptions: 17, acceptanceRate: 19 / 36 }, s2: { closedWindows: 6, editedWindows: 6, editRatio: 1 } });
    const verdict = judgePair({
      evidence: {
        challengerHorizon: ch,
        incumbentHorizon: inc,
        challengerCurrent: ch,
        incumbentCurrent: inc,
        challengerPrevious: ch,
        incumbentPrevious: inc,
        challengerChapters: 6,
      },
      eligibility: ELIGIBLE,
    });
    expect(verdict.kind).toBe('watch');
    expect(verdict.reasons).toContain('wilson_intervals_overlap');
  });

  it('章窗口不足（≥5 章口径）⇒ insufficient_sample', () => {
    const verdict = judgePair({
      ...evidence({
        horizon: { ch: { s1: { decisions: 30, acceptedOptions: 30, rejectedOptions: 0, acceptanceRate: 1 } } },
        chapters: 4,
      }),
      eligibility: ELIGIBLE,
    });
    expect(verdict.kind).toBe('watch');
    expect(verdict.status).toBe('insufficient_sample');
  });

  it('acceptanceWilson：无决策给全宽区间', () => {
    expect(acceptanceWilson(0, 0)).toEqual([0, 1]);
    expect(acceptanceWilson(108, 0)[0]).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
// demote 反向信号
// ---------------------------------------------------------------------------

describe('judgeDemotion', () => {
  it('资格门两连败 + 有回退目标 ⇒ demote', () => {
    const verdict = judgeDemotion({
      gateStreakFailed: true,
      failureRate: 0.1,
      baselineFailureRate: 0.1,
      windows: 12,
      fallbackCellId: 'c_other',
    });
    expect(verdict.kind).toBe('demote');
    expect(verdict.reasons).toContain('gate_streak_failed');
  });

  it('失败率 ≥2× 基线且窗口 ≥10 触发可靠性降级', () => {
    const verdict = judgeDemotion({
      gateStreakFailed: false,
      failureRate: 0.4,
      baselineFailureRate: 0.2,
      windows: 10,
      fallbackCellId: 'c_other',
    });
    expect(verdict.kind).toBe('demote');
    expect(verdict.reasons).toContain('reliability_degraded_vs_baseline');
  });

  it('倍数不足或窗口不足都不触发', () => {
    expect(judgeDemotion({ gateStreakFailed: false, failureRate: 0.39, baselineFailureRate: 0.2, windows: 10, fallbackCellId: 'x' }).kind).toBe('watch');
    expect(judgeDemotion({ gateStreakFailed: false, failureRate: 0.9, baselineFailureRate: 0.2, windows: 9, fallbackCellId: 'x' }).kind).toBe('watch');
  });

  it('有触发但无可指名回退目标 ⇒ watch no_fallback_route（宁缺不猜）', () => {
    const verdict = judgeDemotion({ gateStreakFailed: true, failureRate: null, baselineFailureRate: null, windows: 12, fallbackCellId: null });
    expect(verdict.kind).toBe('watch');
    expect(verdict.reasons).toContain('no_fallback_route');
  });

  it('gateStreakFailed：最近两存档行均破门才成立', () => {
    const rows = [
      archived('v1', PASSING_METRICS, ['CASE-0001'], '2026-01-01T00:00:00Z'),
      archived('v1', FAILING_METRICS, ['CASE-0001'], '2026-01-02T00:00:00Z'),
    ];
    expect(gateStreakFailed(rows, 'v1')).toBe(false);
    expect(gateStreakFailed([...rows, archived('v1', FAILING_METRICS, ['CASE-0001'], '2026-01-03T00:00:00Z')], 'v1')).toBe(true);
    expect(gateStreakFailed(rows.slice(0, 1), 'v1')).toBe(false);
  });

  it('failureRateOf / baselineFailureRate：口径 = (failedGenerations+degradedWindows)/windows', () => {
    const sig = signals({ s6: { windows: 4, attempts: 2, failedGenerations: 1, degradedWindows: 1 } });
    expect(failureRateOf(sig)).toBe(0.5);
    const slice: SignalSlice = {
      windows: [
        { taskRef: 'w1', chapterIndex: 1, cellId: 'me', edited: false, degraded: false, costMicros: 0, outputTokens: 0, atMs: null },
        { taskRef: 'w2', chapterIndex: 2, cellId: 'other', edited: false, degraded: true, costMicros: 0, outputTokens: 0, atMs: null },
        { taskRef: 'w3', chapterIndex: 3, cellId: 'other', edited: false, degraded: false, costMicros: 0, outputTokens: 0, atMs: null },
      ],
      generations: [
        { genTaskRef: 'g1', windowTaskRef: 'w1', cellId: 'me', attempts: 0, failed: true },
        { genTaskRef: 'g2', windowTaskRef: 'w2', cellId: 'other', attempts: 0, failed: false },
      ],
      decisions: [],
    };
    expect(baselineFailureRate(slice, 'me')).toBeCloseTo(1 / 2);
    expect(baselineFailureRate(slice, 'other')).toBeCloseTo(1 / 1);
  });
});
