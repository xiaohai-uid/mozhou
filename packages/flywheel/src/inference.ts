/**
 * κ₀ 加权增量推理（T22 · #55；t51:A1/A2 终裁公式，t47-a §4.1 直写）。
 *
 * 对每个特征维 d 维护 (S_d, W_d, M_d, emVar_d)：
 *   S_d += w·x            W_d += w
 *   mean_d = (κ_eff·m₀_d + S_d)/(κ_eff + W_d)   # 后验均值——退火 1/(κ₀+W_d) 隐式衰减，无日程表；
 *                                               # 主均值不是 EMA（A1 锚），是 κ₀ 伪观测共轭均值
 *   M_d ← (1−α)·M_d + α·x                       # α=0.15 固定短窗均值（漂移检测专用）
 *   emVar_d ← (1−α)·emVar_d + α·(x−M_d,prev)²   # 同款 α 的短窗加权增量方差（σ_d=√emVar_d）
 *
 * 漂移：样本 ≥5 条且 |M_d − mean_d| > 2σ_d 连续 ≥10 条 ⇒ 该维 κ_eff 减半
 * （置信衰减保留历史和，不做硬重置），记入 driftLog、连击清零；脱靶即清零。
 * σ 归属短窗监测器而非后验——否则持续型跃迁下累计方差与 |M−mean| 同步膨胀，
 * 判定永不激活（实现票数值验证结论）。
 *
 * 窗口锚（w=0）只计 degradedWindows，不入偏好向量。
 */
import {
  DRIFT_ALPHA,
  DRIFT_STREAK_MIN,
  KAPPA0,
  M0,
  MIN_SAMPLES_FOR_JUDGMENT,
  PREFERENCE_DIMS,
} from './types.js';
import type { PreferenceDim, PreferenceObservation } from './types.js';

/** 单维累积态（profile.json 字段一一对应；全标量，R1 天然满足）。 */
export interface DimState {
  /** 加权和 Σw·x。 */
  readonly S: number;
  /** 权重和 Σw。 */
  readonly W: number;
  /** 漂移检测专用短窗均值（α=0.15 EMA；与主均值正交）。 */
  readonly M: number;
  /** 短窗加权增量方差（同 α EWMA 残差平方；σ=√emVar）。 */
  readonly emVar: number;
  /** 有效伪计数（漂移减半起点 κ₀=8）。 */
  readonly kappaEff: number;
  /** 当前漂移连击数。 */
  readonly driftStreak: number;
}

/** 漂移事件（driftLog 行；全标量）。 */
export interface DriftEvent {
  readonly dim: PreferenceDim;
  readonly sourcePosition: number;
  readonly shortMean: number;
  readonly mean: number;
  readonly sigma: number;
}

/** 画像状态（内存态 ↔ profile.json 一一对应）。 */
export interface PreferenceProfileState {
  readonly version: 1;
  readonly dims: Readonly<Record<PreferenceDim, DimState>>;
  /** 已消费偏好观测数（不含窗口锚——「样本」口径）。 */
  readonly obsCount: number;
  /** 已消费账本 position 游标（幂等续读锚）。 */
  readonly cursor: number;
  /** state_degraded 窗口计数（审计用）。 */
  readonly degradedWindows: number;
  readonly driftLog: readonly DriftEvent[];
}

function coldDim(dim: PreferenceDim): DimState {
  return { S: 0, W: 0, M: M0[dim], emVar: 0, kappaEff: KAPPA0, driftStreak: 0 };
}

/** 冷启动画像：七维回到 m₀ 先验、κ_eff=κ₀、游标归零（R3 删除即重置的落点）。 */
export function coldStartProfile(): PreferenceProfileState {
  const dims = {} as Record<PreferenceDim, DimState>;
  for (const dim of PREFERENCE_DIMS) {
    dims[dim] = coldDim(dim);
  }
  return { version: 1, dims, obsCount: 0, cursor: 0, degradedWindows: 0, driftLog: [] };
}

/** 后验均值：(κ_eff·m₀ + S)/(κ_eff + W)。 */
export function posteriorMean(dim: PreferenceDim, state: DimState): number {
  return (state.kappaEff * M0[dim] + state.S) / (state.kappaEff + state.W);
}

/** 漂移判定用 σ：短窗加权增量方差的开方。 */
export function driftSigma(state: DimState): number {
  return Math.sqrt(Math.max(state.emVar, 0));
}

/**
 * 折叠一批观测进画像（纯函数）。按 sourcePosition 升序处理（同账本确定性；
 * 乱序输入防御性排序）；obsId 先到先得去重。cursor 只推进到本批最大 position，
 * 真实账本末位由调用方覆盖（尾部无观测行也要消费掉）。
 */
export function reduce(
  prev: PreferenceProfileState,
  observations: readonly PreferenceObservation[],
): PreferenceProfileState {
  const dims: Record<PreferenceDim, DimState> = { ...prev.dims };
  let obsCount = prev.obsCount;
  let degradedWindows = prev.degradedWindows;
  const driftLog = [...prev.driftLog];
  const seen = new Set<string>();
  const ordered = [...observations].sort((a, b) => a.sourcePosition - b.sourcePosition);

  for (const observation of ordered) {
    if (seen.has(observation.obsId)) continue;
    seen.add(observation.obsId);

    if (observation.kind === 'window_anchor') {
      if (observation.degraded === true) degradedWindows += 1;
      continue;
    }

    obsCount += 1;
    for (const dim of PREFERENCE_DIMS) {
      const x = observation.features[dim];
      if (x === undefined || !Number.isFinite(x)) continue;
      const current = dims[dim];
      if (current === undefined) continue;

      // 短窗监测器先行（残差相对更新前的 M）
      const residual = x - current.M;
      const M = (1 - DRIFT_ALPHA) * current.M + DRIFT_ALPHA * x;
      const emVar = (1 - DRIFT_ALPHA) * current.emVar + DRIFT_ALPHA * residual * residual;

      let next: DimState = {
        ...current,
        S: current.S + observation.w * x,
        W: current.W + observation.w,
        M,
        emVar,
      };

      // 漂移判定（<5 条全局跳过）：|M−mean|>2σ 连击达标才减半该维 κ_eff
      if (obsCount >= MIN_SAMPLES_FOR_JUDGMENT) {
        const mean = posteriorMean(dim, next);
        const sigma = driftSigma(next);
        if (Math.abs(M - mean) > 2 * sigma) {
          const streak = current.driftStreak + 1;
          if (streak >= DRIFT_STREAK_MIN) {
            driftLog.push({ dim, sourcePosition: observation.sourcePosition, shortMean: M, mean, sigma });
            next = { ...next, kappaEff: next.kappaEff / 2, driftStreak: 0 };
          } else {
            next = { ...next, driftStreak: streak };
          }
        } else {
          next = { ...next, driftStreak: 0 };
        }
      }
      dims[dim] = next;
    }
  }

  const last = ordered[ordered.length - 1];
  const maxPosition = last === undefined ? prev.cursor : last.sourcePosition;
  return {
    version: 1,
    dims,
    obsCount,
    cursor: Math.max(prev.cursor, maxPosition),
    degradedWindows,
    driftLog,
  };
}
