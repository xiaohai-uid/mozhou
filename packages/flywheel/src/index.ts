/**
 * @mozhou/flywheel — 数据飞轮学习者包（Phase 4；t53:C7 随首只 learner 建包）。
 *
 * T22 · #55：AuthorPreferenceLearner——从 readPipelineLedger 只读消费
 * candidate_decision（强信号双路）+ UserEditRecorded{action:'edit_blocks'}
 * （source==='author' 过滤）+ FlywheelRecorded（窗口锚），产出七维偏好画像。
 * 本包是纯消费端：不改事件词表、不加事件、不改既有 payload（受控增补清单为空）。
 */

/** 冻结常量与观测类型（t51:A1/A2/A4）。 */
export {
  DRIFT_ALPHA,
  DRIFT_STREAK_MIN,
  KAPPA0,
  M0,
  MIN_SAMPLES_FOR_JUDGMENT,
  PREFERENCE_DIMS,
  W_DECISION,
  W_EDIT_DELETE,
  W_EDIT_PROSE,
} from './types.js';
export type {
  EditActionLevelV1,
  ObservationKind,
  PreferenceDim,
  PreferenceObservation,
} from './types.js';
