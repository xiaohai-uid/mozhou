/**
 * 阈值五规则 + 反向信号判定（T24 · #57；裁决 t53:C4/C5，研究 t49 §2.3/§2.4）。
 *
 *   R1 资格门前置（锐化条款）：challenger 的 recipeVersion 必须有一份覆盖**当前
 *      CASE 全集**的最新复跑报告且六指标 gate 全过（机械判定一律消费
 *      evaluateMetricGate——门限表零复制）；否则无论偏好信号多好只产 watch。
 *   R2 最小样本：≥30 决策且 ≥5 章（horizon 口径），不足 ⇒ insufficient_sample。
 *   R3 区间优势 + 地板条款：S1 challenger Wilson95 下界 > incumbent Wilson95
 *      上界，且 S2 相对降幅 ≥10%；incumbent edit_ratio <0.05 时改「绝对不劣化」。
 *   R4 切窗滞后确认：每观测窗口 ≤14 天或 ≤20 决策先到；优势须连续两窗口保持，
 *      仅当前窗口成立 ⇒ watch（首窗口观察）。
 *   R5 单变量单 cell：由编排层落成（一条建议=一个 cell 的一个 tier 叶子替换），
 *      本模块输出逐 pair 判定供排序发射。
 *
 * demote 反向信号：incumbent 最近两存档行连续跌破资格门，或 S6 失败率 ≥2× 既有
 * 基线且窗口 ≥10。全部纯函数零时钟零 IO。
 */
import { evaluateMetricGate, METRIC_IDS } from '@mozhou/benchmark';
import type { MetricId, VersionMatrixRow } from '@mozhou/benchmark';
import { wilsonInterval } from './wilson.js';
import type { ArchivedMatrixRow } from './storage.js';
import { EDIT_RATIO_FLOOR, EDIT_RATIO_REL_REDUCTION } from './types.js';
import {
  DEMOTE_FAILURE_RATIO,
  DEMOTE_MIN_WINDOWS,
  EVAL_MIN_CHAPTER_WINDOWS,
  EVAL_MIN_DECISIONS,
} from './types.js';
import type { CellSignals, SuggestionStatus } from './types.js';
import { WINDOW_MAX_DECISIONS, WINDOW_SPAN_MS } from './types.js';
import type { DecisionFact, SignalSlice } from './project.js';

// ---------------------------------------------------------------------------
// 矩阵存档视图：S3/S4 合成 + R1 资格门证据
// ---------------------------------------------------------------------------

export interface ArchiveView {
  /** recipeVersion（含 null 键）→ append 序最新存档行。 */
  readonly latestByRecipe: ReadonlyMap<string | null, ArchivedMatrixRow>;
  /** 当前 CASE 全集 = 存档历史 caseIds 并集（空存档 ⇒ 空集 ⇒ 资格门必不通过）。 */
  readonly caseUniverse: readonly string[];
}

/** 存档行 → 存档视图（append 序权威：同 recipeVersion 后行覆盖前行）。 */
export function buildArchiveView(rows: readonly ArchivedMatrixRow[]): ArchiveView {
  const latestByRecipe = new Map<string | null, ArchivedMatrixRow>();
  const universe = new Set<string>();
  for (const archived of rows) {
    latestByRecipe.set(archived.row.recipeVersion, archived);
    for (const caseId of archived.caseIds) universe.add(caseId);
  }
  return { latestByRecipe, caseUniverse: [...universe] };
}

/** 单行六指标全过判定（消费 evaluateMetricGate，禁复制门限）。 */
export function rowGatePassedAll(row: VersionMatrixRow): boolean {
  return METRIC_IDS.every((metric) => evaluateMetricGate(metric, row.metrics[metric].value));
}

/** 单行六指标读数通过数（S3 分子原料）。 */
function rowGatePassedCount(row: VersionMatrixRow): number {
  return METRIC_IDS.filter((metric) => evaluateMetricGate(metric, row.metrics[metric].value)).length;
}

/** R1 资格门证据（对某 recipeVersion 的机械结论）。 */
export interface EligibilityEvidence {
  /** 最新复跑报告六指标全过（evaluateMetricGate 逐项）。 */
  readonly gatePassedAll: boolean;
  /** 该报告覆盖当前 CASE 全集（caseUniverse ⊆ 报告 caseIds 且全集非空）。 */
  readonly coversCases: boolean;
  readonly matrixRowRef: string | null;
}

export function eligibilityOf(
  view: ArchiveView,
  recipeVersion: string | null,
): EligibilityEvidence {
  const latest = view.latestByRecipe.get(recipeVersion);
  if (latest === undefined) {
    return { gatePassedAll: false, coversCases: false, matrixRowRef: null };
  }
  const coversCases =
    view.caseUniverse.length > 0 && view.caseUniverse.every((id) => latest.caseIds.includes(id));
  return {
    gatePassedAll: rowGatePassedAll(latest.row),
    coversCases,
    matrixRowRef: latest.matrixRowRef,
  };
}

/** S4：recipeVersion 最新存档行的 USER_EDIT_RATIO_REDUCTION 运行级读数。 */
export function userEditReductionOf(view: ArchiveView, recipeVersion: string | null): number | null {
  const latest = view.latestByRecipe.get(recipeVersion);
  if (latest === undefined) return null;
  return latest.row.metrics.USER_EDIT_RATIO_REDUCTION.value;
}

/** 把存档侧 S3/S4 合成进 ledger 聚合信号（aggregateSignals 留空的两位）。 */
export function withArchiveSignals(
  signals: CellSignals,
  rows: readonly ArchivedMatrixRow[],
  recipeVersion: string | null,
): CellSignals {
  const matching = rows.filter((archived) => archived.row.recipeVersion === recipeVersion);
  let passed = 0;
  let readings = 0;
  for (const archived of matching) {
    readings += METRIC_IDS.length;
    passed += rowGatePassedCount(archived.row);
  }
  return {
    ...signals,
    s3: {
      gateReadings: readings,
      gatePassed: passed,
      gatePassRate: readings === 0 ? null : passed / readings,
    },
    s4: { userEditRatioReduction: userEditReductionOf(buildArchiveView(rows), recipeVersion) },
  };
}

// ---------------------------------------------------------------------------
// R4 切窗：决策流 → 连续两个确认窗口
// ---------------------------------------------------------------------------

export interface ConfirmationWindows {
  /** 当前窗口（最新一段）。 */
  readonly current: readonly DecisionFact[];
  /** 前一窗口（紧邻的上一段；不足一段即空）。 */
  readonly previous: readonly DecisionFact[];
}

/**
 * 逆序切窗（账本行序权威）：每窗口 ≤20 决策且窗口内时间跨度 ≤14 天，先到先切；
 * 无时间锚的决策不触发时间切（不猜丢弃）。装满两窗即止，更旧的历史不入判据。
 */
export function cutConfirmationWindows(decisions: readonly DecisionFact[]): ConfirmationWindows {
  const windows: DecisionFact[][] = [];
  let current: DecisionFact[] = [];
  let windowNewestAt: number | null = null;
  for (let i = decisions.length - 1; i >= 0; i -= 1) {
    if (windows.length >= 2) break;
    const decision = decisions[i];
    if (decision === undefined) break;
    if (current.length >= WINDOW_MAX_DECISIONS) {
      windows.push(current);
      current = [];
      windowNewestAt = null;
    }
    // 时间切只看窗口最新锚与候选锚之差（无锚不切，不猜丢弃）
    if (
      current.length > 0 &&
      windowNewestAt !== null &&
      decision.atMs !== null &&
      windowNewestAt - decision.atMs > WINDOW_SPAN_MS
    ) {
      windows.push(current);
      current = [];
      windowNewestAt = null;
    }
    if (current.length === 0 && windows.length >= 2) break;
    if (windowNewestAt === null) windowNewestAt = decision.atMs;
    current.push(decision);
  }
  const slices = [...windows, current];
  const byPositionAsc = (a: DecisionFact, b: DecisionFact): number => a.position - b.position;
  return {
    current: [...(slices[0] ?? [])].sort(byPositionAsc),
    previous: [...(slices[1] ?? [])].sort(byPositionAsc),
  };
}

/** 切窗输入约定：decisions 必须已按账本 position 升序。 */
export function cutWindowsOfPositionOrdered(
  decisions: readonly DecisionFact[],
): ConfirmationWindows {
  const ordered = [...decisions].sort((a, b) => a.position - b.position);
  return cutConfirmationWindows(ordered);
}

// ---------------------------------------------------------------------------
// pair 判定：R1→R2→R4→R3 逐条前置
// ---------------------------------------------------------------------------

/** 一对（incumbent, challenger）cell 的六信号证据包（三切片各自聚合）。 */
export interface PairEvidence {
  readonly challengerHorizon: CellSignals;
  readonly incumbentHorizon: CellSignals;
  readonly challengerCurrent: CellSignals;
  readonly incumbentCurrent: CellSignals;
  readonly challengerPrevious: CellSignals;
  readonly incumbentPrevious: CellSignals;
  /** horizon 口径 challenger 章（去重）数——R2 的 ≥5 章。 */
  readonly challengerChapters: number;
}

export interface PairJudgement {
  readonly kind: 'promote' | 'watch' | 'demote';
  readonly status: SuggestionStatus;
  readonly reasons: readonly string[];
  /** 正值=改写负担下降幅度%（improvement 方向语义）。 */
  readonly editRatioDeltaPct: number;
  readonly benchmarkGatePassed: boolean;
}

/** R3 的 S2 判据（含地板条款）：地板下改绝对不劣化，地板上要相对降幅 ≥10%。 */
export function s2Condition(
  incumbentRatio: number,
  challengerRatio: number,
): { ok: boolean; floorClause: boolean; deltaPct: number } {
  const floorClause = incumbentRatio < EDIT_RATIO_FLOOR;
  const ok = floorClause
    ? challengerRatio <= incumbentRatio
    : challengerRatio <= incumbentRatio * (1 - EDIT_RATIO_REL_REDUCTION);
  const deltaPct =
    incumbentRatio === 0
      ? challengerRatio === 0
        ? 0
        : -100
      : ((incumbentRatio - challengerRatio) / incumbentRatio) * 100;
  return { ok, floorClause, deltaPct };
}

interface AdvantageInput {
  readonly challenger: CellSignals;
  readonly incumbent: CellSignals;
}

/** 单窗口优势 = S1 更高 **且** S2 条件成立（双条件同时，防单指标误判）。 */
function windowAdvantage(input: AdvantageInput): boolean {
  const chRate = input.challenger.s1.acceptanceRate;
  const incRate = input.incumbent.s1.acceptanceRate;
  if (chRate === null || incRate === null || chRate <= incRate) return false;
  const chEdit = input.challenger.s2.editRatio;
  const incEdit = input.incumbent.s2.editRatio;
  if (chEdit === null || incEdit === null) return false;
  return s2Condition(incEdit, chEdit).ok;
}

/**
 * promote/demote/watch 三态判定。规则序即短路序：
 * 资格门（R1）→ 最小样本（R2）→ 双窗确认（R4）→ 区间+降幅（R3）。
 */
export function judgePair(input: {
  readonly evidence: PairEvidence;
  readonly eligibility: EligibilityEvidence;
}): PairJudgement {
  const { evidence, eligibility } = input;
  const benchmarkGatePassed = eligibility.gatePassedAll && eligibility.coversCases;

  const finishWatch = (reasons: readonly string[], status: SuggestionStatus): PairJudgement => ({
    kind: 'watch',
    status,
    reasons,
    editRatioDeltaPct: deltaPctOf(evidence),
    benchmarkGatePassed,
  });

  // R1 资格门前置：一票否决（无论偏好信号多好）
  if (!benchmarkGatePassed) {
    const reasons: string[] = [];
    if (!eligibility.gatePassedAll) reasons.push('eligibility_gate_failed');
    if (!eligibility.coversCases) reasons.push('benchmark_cases_stale');
    return finishWatch(reasons, 'insufficient_sample');
  }

  // R2 最小样本（horizon 口径，challenger 证据面）
  const chHorizon = evidence.challengerHorizon;
  if (chHorizon.s1.decisions < EVAL_MIN_DECISIONS || evidence.challengerChapters < EVAL_MIN_CHAPTER_WINDOWS) {
    return finishWatch(['insufficient_sample'], 'insufficient_sample');
  }

  // R3 前提面：双侧都有可定义信号（Wilson 区间在判据处现算）
  const chRate = chHorizon.s1.acceptanceRate;
  const incRate = evidence.incumbentHorizon.s1.acceptanceRate;
  if (chRate === null || incRate === null) {
    return finishWatch(['no_acceptance_evidence'], 'sufficient_sample');
  }
  const chEdit = chHorizon.s2.editRatio;
  const incEdit = evidence.incumbentHorizon.s2.editRatio;
  if (chEdit === null || incEdit === null) {
    return finishWatch(['no_edit_denominator'], 'sufficient_sample');
  }

  // R4 滞后确认：连续两窗口保持；仅当前窗口 ⇒ watch（首窗口观察）
  const currentAdvantage = windowAdvantage({
    challenger: evidence.challengerCurrent,
    incumbent: evidence.incumbentCurrent,
  });
  const previousAdvantage = windowAdvantage({
    challenger: evidence.challengerPrevious,
    incumbent: evidence.incumbentPrevious,
  });
  if (!currentAdvantage) {
    return finishWatch(['no_current_window_advantage'], 'sufficient_sample');
  }
  if (!previousAdvantage) {
    return finishWatch(['first_window_only'], 'sufficient_sample');
  }

  // R3 区间优势：challenger Wilson95 下界 > incumbent Wilson95 上界（S1）
  const challengerWilson = wilsonInterval(chHorizon.s1.acceptedOptions, chHorizon.s1.acceptedOptions + chHorizon.s1.rejectedOptions);
  const incumbentWilson = wilsonInterval(
    evidence.incumbentHorizon.s1.acceptedOptions,
    evidence.incumbentHorizon.s1.acceptedOptions + evidence.incumbentHorizon.s1.rejectedOptions,
  );
  if (!(challengerWilson[0] > incumbentWilson[1])) {
    return finishWatch(['wilson_intervals_overlap'], 'sufficient_sample');
  }

  // R3 S2 判据（地板条款内嵌）
  const s2 = s2Condition(incEdit, chEdit);
  if (!s2.ok) {
    return finishWatch([s2.floorClause ? 'floor_clause_violated' : 'edit_ratio_not_reduced'], 'sufficient_sample');
  }

  return { kind: 'promote', status: 'sufficient_sample', reasons: [], editRatioDeltaPct: s2.deltaPct, benchmarkGatePassed };
}

function deltaPctOf(evidence: PairEvidence): number {
  const chEdit = evidence.challengerHorizon.s2.editRatio;
  const incEdit = evidence.incumbentHorizon.s2.editRatio;
  if (chEdit === null || incEdit === null) return 0;
  return s2Condition(incEdit, chEdit).deltaPct;
}

/** Wilson 区间导出（建议物 basis 用）：accepted/(accepted+rejected)；无样本 ⇒ 全宽。 */
export function acceptanceWilson(acceptedOptions: number, rejectedOptions: number): readonly [number, number] {
  return wilsonInterval(acceptedOptions, acceptedOptions + rejectedOptions);
}

// ---------------------------------------------------------------------------
// demote 反向信号
// ---------------------------------------------------------------------------

/**
 * demote 判定：资格门两连败 或 失败率 ≥2× 基线且窗口 ≥10。
 * demote 需要可指名的回退目标（qualified challenger 由编排层传入 cellId；
 * 缺目标 ⇒ watch——宁缺不猜回退路由）。
 */
export function judgeDemotion(input: {
  /** incumbent 最近两份存档行是否均破门（gate streak 判据）。 */
  readonly gateStreakFailed: boolean;
  /** incumbent (failedGenerations + degradedWindows) / windows。 */
  readonly failureRate: number | null;
  /** 其余全部窗口同口径基线失败率。 */
  readonly baselineFailureRate: number | null;
  /** incumbent 窗口总数（demote 最低样本）。 */
  readonly windows: number;
  /** 可指名的回退目标 cell id；无 ⇒ watch。 */
  readonly fallbackCellId: string | null;
}): { kind: 'promote' | 'demote' | 'watch'; status: SuggestionStatus; reasons: readonly string[] } {
  const reasons: string[] = [];
  if (input.gateStreakFailed) reasons.push('gate_streak_failed');
  if (
    input.failureRate !== null &&
    input.windows >= DEMOTE_MIN_WINDOWS &&
    input.baselineFailureRate !== null &&
    input.failureRate >= DEMOTE_FAILURE_RATIO * input.baselineFailureRate
  ) {
    reasons.push('reliability_degraded_vs_baseline');
  }
  if (reasons.length === 0) return { kind: 'watch', status: 'sufficient_sample', reasons: [] };
  if (input.fallbackCellId === null) {
    return { kind: 'watch', status: 'sufficient_sample', reasons: [...reasons, 'no_fallback_route'] };
  }
  return { kind: 'demote', status: 'sufficient_sample', reasons };
}

/** 存档行按 recipeVersion 的最近两连败判定（append 序最后两行）。 */
export function gateStreakFailed(rows: readonly ArchivedMatrixRow[], recipeVersion: string | null): boolean {
  const matching = rows.filter((archived) => archived.row.recipeVersion === recipeVersion);
  if (matching.length < 2) return false;
  const lastTwo = matching.slice(-2);
  return lastTwo.every((archived) => !rowGatePassedAll(archived.row));
}

/** S6 失败率口径：(failedGenerations + degradedWindows) / windows。 */
export function failureRateOf(signals: CellSignals): number | null {
  if (signals.s6.windows === 0) return null;
  return (signals.s6.failedGenerations + signals.s6.degradedWindows) / signals.s6.windows;
}

/** 全局基线失败率：除排除 cell 外的全部窗口同口径（无其他窗口 ⇒ null 不判）。 */
export function baselineFailureRate(slice: SignalSlice, excludeCellId: string): number | null {
  let bad = 0;
  let total = 0;
  for (const window of slice.windows) {
    if (window.cellId === null || window.cellId === excludeCellId) continue;
    total += 1;
  }
  if (total === 0) return null;
  for (const generation of slice.generations) {
    if (generation.cellId === null || generation.cellId === excludeCellId) continue;
    if (generation.failed) bad += 1;
  }
  for (const window of slice.windows) {
    if (window.cellId === null || window.cellId === excludeCellId) continue;
    if (window.degraded) bad += 1;
  }
  return bad / total;
}

/** MetricId 再导出避免调用方重复 import 词表（本包内使用面收口）。 */
export type { MetricId };
