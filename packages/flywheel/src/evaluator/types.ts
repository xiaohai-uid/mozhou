/**
 * TaskModelEvaluator 类型与冻结常量（T24 · #57；裁决 t53:C1-C7 + t49 §4）。
 *
 * 数值常量单一事实源 = docs/specs/data-flywheel-v1-spec.md §4「评估」行：
 *   - R2 最小样本 = ≥30 决策且 ≥5 章；
 *   - R3 区间优势 = challenger Wilson95 下界 > incumbent Wilson95 上界（S1）
 *     且 S2 相对降幅 ≥10%；地板条款：incumbent edit_ratio <0.05 时改
 *     「绝对不劣化」判据（t53:C4 修订）；
 *   - R4 切窗 = 每观测窗口 ≤14 天或 ≤20 决策先到；优势须连续两窗口保持（t49 §2.4
 *     影子期双轨的 V1 形态 = 时间切窗），首窗口只产 watch；
 *   - R5 单变量单 cell = 一条建议只动一个 cell 的一个 tier 叶子（providerId+model
 *     成对整体替换，尊重 TierRoute 复合键）。
 *
 * 阈值表零复制纪律（C1）：六指标机械判定一律消费 @mozhou/benchmark 的
 * evaluateMetricGate——本模块不出现任何门限数值。
 */

/** R2：acceptance 决策样本下限（不足 ⇒ insufficient_sample 观察条目，不出建议）。 */
export const EVAL_MIN_DECISIONS = 30;
/** R2：独立章窗口下限。 */
export const EVAL_MIN_CHAPTER_WINDOWS = 5;

/** R3 地板阈值：incumbent edit_ratio 低于此值 ⇒ 放弃相对降幅、改绝对不劣化判据。 */
export const EDIT_RATIO_FLOOR = 0.05;
/** R3 相对降幅要求：challenger edit_ratio 须 ≤ incumbent ×(1−本值)。 */
export const EDIT_RATIO_REL_REDUCTION = 0.1;

/** Wilson 95% 区间 z 值（t53:C5 置信区间判据）。 */
export const WILSON_Z_95 = 1.96;

/** R4：单观测窗口决策数上限（先到切窗之一）。 */
export const WINDOW_MAX_DECISIONS = 20;
/** R4：单观测窗口时间跨度上限（天；另一先到切窗）。 */
export const WINDOW_SPAN_DAYS = 14;
export const WINDOW_SPAN_MS = WINDOW_SPAN_DAYS * 24 * 60 * 60 * 1000;

/** demote 反向信号：失败率须 ≥ 基线 ×本倍数，且窗口数 ≥ DEMOTE_MIN_WINDOWS（t49 §2.3）。 */
export const DEMOTE_FAILURE_RATIO = 2;
export const DEMOTE_MIN_WINDOWS = 10;

// ---------------------------------------------------------------------------
// RoutingSuggestion —— t49 §4.1 冻结形状，实现票直写不改一键
// ---------------------------------------------------------------------------

export type SuggestionKind = 'promote' | 'demote' | 'watch';
export type SuggestionStatus = 'sufficient_sample' | 'insufficient_sample';

/**
 * 路由建议物（派生面，落 .mozhou/suggestions/suggestions.jsonl，不入真源账本，
 * C6）：只建议不自动改路由——生效走作者人工编辑 tier 配置后的既有
 * loadTierConfig 机械校验 + mtime 热加载。
 */
export interface RoutingSuggestion {
  /** 'sug_' + ULID（铸法同 record-step.ts entryId 先例）。 */
  readonly suggestionId: string;
  /** 注入时钟 nowUtc（同 benchmark run.ts 先例，禁 Date.now）。 */
  readonly createdAtUtc: string;
  /** cell 主键 = taskType × route(providerId,model) × recipeVersion（C2）。 */
  readonly cell: {
    readonly taskType: string;
    readonly providerId: string;
    readonly model: string;
    readonly recipeVersion: string | null;
  };
  readonly kind: SuggestionKind;
  /** 建议路由（api_key_ref 归作者配置侧补）；watch 条目与 cell 同路由占位。 */
  readonly proposedRoute: { readonly providerId: string; readonly model: string };
  readonly basis: {
    readonly sampleSize: { readonly decisions: number; readonly chapterWindows: number };
    readonly challengerAcceptanceWilson: readonly [number, number];
    readonly incumbentAcceptanceWilson: readonly [number, number];
    readonly editRatioDeltaPct: number;
    readonly benchmarkGatePassed: boolean;
    /** 关联 VersionMatrixRow 存档行引用；无存档证据时 null。 */
    readonly matrixRowRef: string | null;
  };
  readonly status: SuggestionStatus;
}

// ---------------------------------------------------------------------------
// 投影面内部类型（账本+usage+矩阵存档三件输入 → cell 六信号）
// ---------------------------------------------------------------------------

/** cell 键（C2）。model 来自 usage.jsonl 行证据；缺证据无法成 cell。 */
export interface CellKey {
  readonly taskType: string;
  readonly providerId: string;
  readonly model: string;
  readonly recipeVersion: string | null;
}

/** cell 稳定 id（投影内分组键；'|' 分隔，recipeVersion 缺面记 '-'）。 */
export function cellIdOf(key: CellKey): string {
  return `${key.taskType}|${key.providerId}|${key.model}|${key.recipeVersion ?? '-'}`;
}

/** S1-S6 六信号（全部标量/id，R1 标量红线同源约束）。 */
export interface CellSignals {
  /** S1 acceptance_rate：仅多候选择优窗口上有定义（无决策 ⇒ null）。 */
  readonly s1: {
    readonly decisions: number;
    readonly acceptedOptions: number;
    readonly rejectedOptions: number;
    readonly acceptanceRate: number | null;
  };
  /**
   * S2 edit_ratio：改写负担，越低越好。分母=已闭合窗口（FlywheelRecorded 锚），
   * 分子=有 author edit_blocks 行的窗口；C3 零边界条款：「走完 user_edit 步无编辑
   * 行」记 0 ≠「未走完」——无编辑的闭合窗口入分母、分子计 0（正信号）。
   */
  readonly s2: {
    readonly closedWindows: number;
    readonly editedWindows: number;
    readonly editRatio: number | null;
  };
  /** S3 六指标 gate 通过率：矩阵存档读数逐项过 evaluateMetricGate 的比率。 */
  readonly s3: {
    readonly gateReadings: number;
    readonly gatePassed: number;
    readonly gatePassRate: number | null;
  };
  /** S4 USER_EDIT_RATIO_REDUCTION：该 recipeVersion 最新存档行的运行级读数。 */
  readonly s4: { readonly userEditRatioReduction: number | null };
  /** S5 经济性：ΣcostMicros ÷ ΣoutputTokens（分母 0 ⇒ null，宁缺不猜）。 */
  readonly s5: {
    readonly costMicros: number;
    readonly outputTokens: number;
    readonly microsPerOutputToken: number | null;
  };
  /** S6 可靠性：attempt 密度 + 失败代次 + state_degraded 窗口计数。 */
  readonly s6: {
    readonly windows: number;
    readonly attempts: number;
    readonly failedGenerations: number;
    readonly degradedWindows: number;
  };
  /**
   * S7 重复纠错率（ADR-0025 · 计划 Task 5）：作者结构化纠错在该 cell 上的
   * 复发信号。correctedChapters = 有纠错记录的不同章数；repeatedCorrections =
   * 同一 reason 在更晚章节的再次出现（FailurePattern 活跃期内的复发）；
   * repeatCorrectionRate = repeated ÷ corrected（分母 0 ⇒ null，宁缺不猜）。
   */
  readonly s7: {
    readonly correctedChapters: number;
    readonly repeatedCorrections: number;
    readonly repeatCorrectionRate: number | null;
  };
}

/** 空 signals 零值（投影累加起点）。 */
export function emptySignals(): CellSignals {
  return {
    s1: { decisions: 0, acceptedOptions: 0, rejectedOptions: 0, acceptanceRate: null },
    s2: { closedWindows: 0, editedWindows: 0, editRatio: null },
    s3: { gateReadings: 0, gatePassed: 0, gatePassRate: null },
    s4: { userEditRatioReduction: null },
    s5: { costMicros: 0, outputTokens: 0, microsPerOutputToken: null },
    s6: { windows: 0, attempts: 0, failedGenerations: 0, degradedWindows: 0 },
    s7: { correctedChapters: 0, repeatedCorrections: 0, repeatCorrectionRate: null },
  };
}
