/**
 * T22 验收测试（#55）：κ₀ 加权更新数值断言 / 漂移衰减 / m₀ 冷启动 / <5 跳过判定。
 * 直接折叠合成观测（不经账本）；触发步数锚来自公式确定性算术探针（α=0.15、
 * κ₀=8、连击 ≥10 全为冻结常量，步数随之冻结）。零时钟零外部服务。
 */
import { describe, expect, it } from 'vitest';
import { coldStartProfile, driftSigma, posteriorMean, reduce } from './inference.js';
import type { PreferenceProfileState } from './inference.js';
import { DRIFT_STREAK_MIN, KAPPA0, M0, MIN_SAMPLES_FOR_JUDGMENT, PREFERENCE_DIMS } from './types.js';
import type { PreferenceDim, PreferenceObservation } from './types.js';

let seq = 0;
function syntheticObservation(
  features: Partial<Record<PreferenceDim, number>>,
  w = 1.0,
  kind: PreferenceObservation['kind'] = 'candidate_decision',
): PreferenceObservation {
  seq += 1;
  return {
    obsId: `syn_${seq}`,
    sourcePosition: seq,
    kind,
    taskRef: 'tsk_syn',
    level: 'cursor',
    sceneType: null,
    features,
    w,
  };
}

function fold(profile: PreferenceProfileState, batch: readonly PreferenceObservation[]): PreferenceProfileState {
  return reduce(profile, batch);
}

describe('m₀ 冷启动', () => {
  it('冷启动画像七维全部落在 m₀ 先验、κ_eff=8、短窗 σ=0', () => {
    const profile = coldStartProfile();
    expect(profile.version).toBe(1);
    expect(profile.obsCount).toBe(0);
    expect(profile.cursor).toBe(0);
    expect(profile.degradedWindows).toBe(0);
    expect(profile.driftLog).toHaveLength(0);
    for (const dim of PREFERENCE_DIMS) {
      const state = profile.dims[dim]!;
      expect(posteriorMean(dim, state)).toBe(M0[dim]);
      expect(state.kappaEff).toBe(KAPPA0);
      expect(driftSigma(state)).toBe(0);
    }
  });

  it('m₀ 七维常数逐字对照 t51:A2 定案表', () => {
    expect(M0['sent_len_mean']).toBe(42);
    expect(M0['sent_len_p90']).toBe(65);
    expect(M0['dlg_char_ratio']).toBeCloseTo(0.3, 10);
    expect(M0['para_line_span']).toBe(2.0);
    expect(M0['ttr_win500']).toBeCloseTo(0.55, 10);
    expect(M0['cand_len_diff']).toBe(0);
    expect(M0['level_ratio']).toBeCloseTo(0.5, 10);
  });
});

describe('κ₀ 加权更新数值断言', () => {
  it('两条 x=−40 决策：mean=(8·0−80)/10=−8（精确闭式锚）', () => {
    let profile = fold(coldStartProfile(), [
      syntheticObservation({ cand_len_diff: -40 }),
      syntheticObservation({ cand_len_diff: -40 }),
    ]);
    const state = profile.dims['cand_len_diff']!;
    expect(posteriorMean('cand_len_diff', state)).toBeCloseTo(-8, 10);
    expect(state.W).toBeCloseTo(2, 10);
    expect(profile.obsCount).toBe(2);
  });

  it('权重分档：决策 w=1.0 与编辑 w=0.3 混折按权重入 S/W', () => {
    const profile = fold(coldStartProfile(), [
      syntheticObservation({ level_ratio: 1 }, 1.0),
      syntheticObservation({ level_ratio: 0 }, 0.3),
    ]);
    // mean = (8·0.5 + 1·1 + 0.3·0)/(8+1.3)
    expect(posteriorMean('level_ratio', profile.dims['level_ratio']!))
      .toBeCloseTo((KAPPA0 * 0.5 + 1) / (KAPPA0 + 1.3), 12);
  });

  it('主均值不是 EMA：20 条常值流（无漂移干扰）后验贴闭式解，远离 α-EMA 轨迹', () => {
    const closed = fold(coldStartProfile(), Array.from({ length: 20 }, () =>
      syntheticObservation({ sent_len_mean: 10 })));
    expect(posteriorMean('sent_len_mean', closed.dims['sent_len_mean']!))
      .toBeCloseTo((8 * 42 + 20 * 10) / 28, 10);

    let ema = M0['sent_len_mean'];
    for (let i = 0; i < 20; i += 1) ema += 0.15 * (10 - ema);
    const actual = posteriorMean('sent_len_mean', closed.dims['sent_len_mean']!);
    expect(Math.abs(actual - ema)).toBeGreaterThan(5); // EMA 已贴到 ~11.9，后验仍在 ~19.1
  });
});

describe('<5 条跳过判定', () => {
  it('样本 4 条时极值也不进入漂移判定（κ_eff/短窗状态不动）', () => {
    const profile = fold(coldStartProfile(), Array.from({ length: MIN_SAMPLES_FOR_JUDGMENT - 1 }, () =>
      syntheticObservation({ ttr_win500: 0.99 })));
    expect(profile.obsCount).toBe(4);
    expect(profile.dims['ttr_win500']!.kappaEff).toBe(KAPPA0);
    expect(profile.driftLog).toHaveLength(0);
  });
});

describe('漂移衰减', () => {
  function stepwise(stream: number[], dim: PreferenceDim): { profile: PreferenceProfileState; triggerObs: number | null } {
    let profile = coldStartProfile();
    let triggerObs: number | null = null;
    stream.forEach((x, index) => {
      const before = profile.driftLog.length;
      profile = fold(profile, [syntheticObservation({ [dim]: x })]);
      if (triggerObs === null && profile.driftLog.length > before) triggerObs = index + 1;
    });
    return { profile, triggerObs };
  }

  it('武装后常值流 σ→0；持续跃迁自第 37 条起周期性衰减（60 条内三次减半）', () => {
    const dim: PreferenceDim = 'sent_len_mean';
    const { profile, triggerObs } = stepwise([...Array<number>(5).fill(42), ...Array<number>(60).fill(100)], dim);
    expect(triggerObs).toBe(37); // 公式算术锚：前 10 条偏移全部脱靶（σ 随混合膨胀）
    const state = profile.dims[dim]!;
    expect(state.kappaEff).toBe(KAPPA0 / 8); // 触发点 37/47/57 → 三次减半
    expect(profile.driftLog).toHaveLength(3);
    const event = profile.driftLog[0]!;
    expect(event.dim).toBe(dim);
    expect(event.shortMean).toBeGreaterThan(event.mean); // 短窗 M 领先僵硬后验
    expect(event.sigma).toBeGreaterThanOrEqual(0);
  });

  it('减半即置信衰减：同数据下小 κ_eff 后验步进更大（保留历史和、放低先验权重）', () => {
    // 代数性质：step(κ)=|后验(含新观测)−后验(不含)| 关于 κ 单调递减——漂移减半的加速依据
    const S = 5 * 42;
    const W = 5;
    const step = (kappa: number) =>
      Math.abs((kappa * 42 + S + 100) / (kappa + W + 1) - (kappa * 42 + S) / (kappa + W));
    expect(step(KAPPA0 / 2)).toBeGreaterThan(step(KAPPA0));
  });

  it('命中 9 条回正清零，其后二次命中恰在第 41 条触发且全程仅一次衰减', () => {
    const dim: PreferenceDim = 'para_line_span';
    const stream = [...Array<number>(5).fill(2), ...Array<number>(9).fill(50), 2, ...Array<number>(30).fill(50)];
    const { profile, triggerObs } = stepwise(stream, dim);
    expect(triggerObs).toBe(41); // 公式算术锚（9 连击被回正行清零后重新累计）
    expect(profile.dims[dim]!.kappaEff).toBe(KAPPA0 / 2);
    expect(profile.driftLog).toHaveLength(1); // 有界后续流内不重复锤打
  });

  it('未达连击下限绝不衰减：10 条以下偏移 κ_eff 不动', () => {
    const dim: PreferenceDim = 'sent_len_mean';
    const { profile } = stepwise([...Array<number>(5).fill(42), ...Array<number>(DRIFT_STREAK_MIN - 1 + 20).fill(100)].slice(0, 5 + 9), dim);
    // 前 9 条偏移全脱靶（σ 膨胀期），构造恰好 9 条命中需要越过 σ 膨胀期——此处直接验证短流无触发
    expect(profile.dims[dim]!.kappaEff).toBe(KAPPA0);
    expect(profile.driftLog).toHaveLength(0);
  });
});

describe('窗口锚与去重与游标', () => {
  it('degraded 锚只进 degradedWindows 计数，不入 obsCount/向量', () => {
    let profile = coldStartProfile();
    profile = fold(profile, [
      { ...syntheticObservation({}, 0, 'window_anchor'), degraded: true },
      { ...syntheticObservation({}, 0, 'window_anchor'), degraded: false },
      syntheticObservation({ cand_len_diff: 1 }),
    ]);
    expect(profile.degradedWindows).toBe(1);
    expect(profile.obsCount).toBe(1);
    expect(posteriorMean('cand_len_diff', profile.dims['cand_len_diff']!)).toBe((KAPPA0 * 0 + 1) / (KAPPA0 + 1));
  });

  it('obsId 重复先到先得：同批重复观测只计一次', () => {
    const obs = syntheticObservation({ cand_len_diff: -40 });
    const profile = fold(coldStartProfile(), [obs, obs]);
    expect(profile.obsCount).toBe(1);
    expect(profile.dims['cand_len_diff']!.W).toBe(1);
  });

  it('cursor 只向前推进到本批最大 position；空批不动', () => {
    let profile = fold(coldStartProfile(), [syntheticObservation({})]);
    expect(profile.cursor).toBe(seq);
    profile = fold(profile, []);
    expect(profile.cursor).toBe(seq);
  });
});
