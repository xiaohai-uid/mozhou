/**
 * 偏好学习器类型与冻结常量（T22 · #55；裁决 t51:A1/A2/A4）。
 *
 * 数值常量单一事实源 = docs/specs/data-flywheel-v1-spec.md §4：
 *   - κ₀=8（冷启动伪计数）；权重表 w=[1.0,0.3,0.15,0,0]（当前决策/编辑增替/
 *     编辑删/assistant 整路排除/FlywheelRecorded 窗口锚——后两档权重 0）；
 *   - 退火 1/(κ₀+W_d) 隐式衰减，无日程表；漂移检测单独 α=0.15 短窗 EMA，
 *     主均值不是 EMA（A1 锚）；σ 用加权增量方差；样本 <5 条跳过判定；
 *   - m₀ 七维全量定案：42/65/0.30/2.0/0.55/0/0.5。
 */

/** 七维特征键（t51:A4 逐字冻结序）。 */
export const PREFERENCE_DIMS = [
  'sent_len_mean',
  'sent_len_p90',
  'dlg_char_ratio',
  'para_line_span',
  'ttr_win500',
  'cand_len_diff',
  'level_ratio',
] as const;

export type PreferenceDim = (typeof PREFERENCE_DIMS)[number];

/** m₀ 七维中性常数（t51:A2 全量定案；词表依赖型特征出界故无第八维）。 */
export const M0: Readonly<Record<PreferenceDim, number>> = {
  sent_len_mean: 42,
  sent_len_p90: 65,
  dlg_char_ratio: 0.3,
  para_line_span: 2.0,
  ttr_win500: 0.55,
  cand_len_diff: 0,
  level_ratio: 0.5,
};

/** κ₀ 冷启动伪计数（Beta-Binomial 共轭均值的连续推广，t47-a §4.1）。 */
export const KAPPA0 = 8;

/** 权重档：candidate_decision（强迫选择，写入时机械保真）。 */
export const W_DECISION = 1.0;
/** 权重档：author 编辑 insert/replace（正向风格样本但动机混杂）。 */
export const W_EDIT_PROSE = 0.3;
/** 权重档：author 编辑 delete（仅贡献位置统计的弱负样本）。 */
export const W_EDIT_DELETE = 0.15;

/** 漂移检测专用短窗 EMA 系数（与主均值更新正交；主均值不是 EMA）。 */
export const DRIFT_ALPHA = 0.15;

/** 漂移判定连击下限：|M−mean|>2σ 连续 ≥10 条才对该维 κ_eff 减半。 */
export const DRIFT_STREAK_MIN = 10;

/** 偏好样本 <5 条跳过判定（σ 阈值在极小样本下无意义）。 */
export const MIN_SAMPLES_FOR_JUDGMENT = 5;

/** M16 动作位 V1 两级（读侧防御性收窄；越级载荷不是合法信号）。 */
export type EditActionLevelV1 = 'cursor' | 'selection';

/**
 * 观测种类词表：candidate_decision 强信号 / edit_blocks 按操作拆分三态 /
 * FlywheelRecorded 任务窗口闭合锚（w=0，只供 degradedWindows 计数）。
 */
export const OBSERVATION_KINDS = [
  'candidate_decision',
  'edit_insert',
  'edit_replace',
  'edit_delete',
  'window_anchor',
] as const;

export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/**
 * 单条偏好观测（observations.jsonl 持久化行形状）。
 *
 * **R1 标量红线**：本形状只许出现数字标量/计数器/id 字符串/null 占位——任何
 * 正文片段（replacementText、候选原文及其可逆编码）禁止进入派生数据（规格 §5）。
 *
 * features 为稀疏七维映射：该观测不产出的维即缺省键（delete 无文本特征、
 * 决策无文本侧）；词表依赖型特征显式出界（t51:A4），永不进此表。
 */
export interface PreferenceObservation {
  /** 稳定幂等键：`${sourcePosition}` 或 `${sourcePosition}:${blockIndex}`。 */
  readonly obsId: string;
  /** readPipelineLedger 的 position（账本行序即权威时序，t52:B6）。 */
  readonly sourcePosition: number;
  readonly kind: ObservationKind;
  readonly taskRef: string;
  readonly chapterIndex?: number;
  readonly level?: EditActionLevelV1;
  /** V1 恒 null：场景归因协议归 #48，本票禁写任何场景分类器。 */
  readonly sceneType: null;
  readonly features: Readonly<Partial<Record<PreferenceDim, number>>>;
  /** 观测档位权重（w 表五档之一；window_anchor 恒 0，不入偏好向量）。 */
  readonly w: number;
  /** 仅 window_anchor：FlywheelRecorded outcome==='state_degraded'（该窗口派生指标不可信）。 */
  readonly degraded?: boolean;
  /** 仅 window_anchor：窗口闭合 commitId（id 标量，R1 允许）。 */
  readonly commitId?: string;
}
